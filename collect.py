#!/usr/bin/env python3
"""
HouseFile collector.

Pulls every contact from Constant Contact (v3 API), computes aggregate
statistics in memory, and writes docs/data/stats.json plus a daily row in
docs/data/history.json.

PRIVACY CONTRACT
----------------
Nothing identifying a person is ever written to disk, logged, or printed:
no names, email addresses, street addresses, phone numbers, contact IDs,
or free-text custom-field values. Only counts, percentages, dates of the
most recent record, state/ZIP tallies (ZIPs below a minimum count are
suppressed), and email-domain tallies leave this process.

Resumable: pass --checkpoint PATH to save aggregate-only progress between
runs when the environment has a short time limit (the checkpoint contains
counters and max-dates, never contact records).

Usage:
    python collect.py                      # full run, writes docs/data/stats.json
    python collect.py --dry-run            # compute, print summary, write nothing
    python collect.py --fetch-centroids    # (re)build docs/data/zip_centroids.json
"""

import argparse
import collections
import datetime as dt
import io
import json
import os
import re
import sys
import time
import zipfile
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parent
TOKEN_URL = "https://authz.constantcontact.com/oauth2/default/v1/token"
API = "https://api.cc.email/v3"
GEONAMES_US = "https://download.geonames.org/export/zip/US.zip"

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
    "PR": "Puerto Rico", "VI": "U.S. Virgin Islands", "GU": "Guam", "AS": "American Samoa",
    "MP": "Northern Mariana Islands",
}
STATE_BY_NAME = {v.lower(): k for k, v in US_STATES.items()}
CA_PROVINCES = {"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"}


# --------------------------------------------------------------------------- #
# Config & auth
# --------------------------------------------------------------------------- #
def load_env(path: Path) -> None:
    """Load KEY=VALUE lines from a .env file into os.environ (if not already set)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def get_access_token() -> str:
    cid, secret, refresh = (os.environ.get(k) for k in ("CC_CLIENT_ID", "CC_CLIENT_SECRET", "CC_REFRESH_TOKEN"))
    if not all([cid, secret, refresh]):
        sys.exit("Missing CC_CLIENT_ID / CC_CLIENT_SECRET / CC_REFRESH_TOKEN (set env vars or .env)")
    r = requests.post(TOKEN_URL, data={"grant_type": "refresh_token", "refresh_token": refresh},
                      auth=(cid, secret), timeout=30)
    if r.status_code != 200:
        sys.exit(f"Token refresh failed: HTTP {r.status_code}")
    tok = r.json()
    new_refresh = tok.get("refresh_token")
    if new_refresh and new_refresh != refresh:
        # Constant Contact may rotate refresh tokens. Surface it loudly so the
        # stored secret can be updated; never print the token itself.
        print("WARNING: Constant Contact issued a NEW refresh token. Update the CC_REFRESH_TOKEN secret.",
              file=sys.stderr)
        rotated = os.environ.get("CC_ROTATED_TOKEN_FILE")
        if rotated:
            Path(rotated).write_text(new_refresh)
    return tok["access_token"]


class CC:
    """Thin Constant Contact client with rate-limit handling."""

    def __init__(self, token: str):
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})

    def get(self, url: str, **params):
        if url.startswith("/"):
            url = API + url
        for attempt in range(6):
            r = self.s.get(url, params=params or None, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(1.5 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()
        r.raise_for_status()

    def paged(self, first_url: str, key: str, **params):
        url, p = first_url, params
        while url:
            d = self.get(url, **p)
            p = {}
            yield d
            nxt = d.get("_links", {}).get("next", {}).get("href")
            url = ("https://api.cc.email" + nxt) if nxt else None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def norm_state(raw) -> str | None:
    if not raw:
        return None
    s = re.sub(r"[^A-Za-z ]", "", str(raw)).strip()
    if not s:
        return None
    up = s.upper()
    if up in US_STATES:
        return up
    if s.lower() in STATE_BY_NAME:
        return STATE_BY_NAME[s.lower()]
    if up in CA_PROVINCES:
        return "CA-" + up
    return "OTHER"


def norm_zip(raw) -> str | None:
    if not raw:
        return None
    m = re.match(r"\s*(\d{5})", str(raw))
    return m.group(1) if m else None


def norm_country(raw) -> str:
    if not raw:
        return "unknown"
    s = str(raw).strip().lower()
    if s in {"us", "usa", "united states", "united states of america", "u.s.", "u.s.a."}:
        return "US"
    return "other"


def parse_dt(s):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def pct(n, d):
    return round(100.0 * n / d, 1) if d else 0.0


def list_base_name(name: str) -> str:
    return name.split(" - ", 1)[0].strip()


# --------------------------------------------------------------------------- #
# Aggregator (checkpointable; holds counters only)
# --------------------------------------------------------------------------- #
class Agg:
    def __init__(self, cfg, cf_labels, list_names):
        self.cfg = cfg
        self.cf_labels = cf_labels          # custom_field_id -> label
        self.list_names = list_names        # list_id -> name
        self.now = dt.datetime.now(dt.timezone.utc)
        self.n = 0
        self.c = collections.Counter()      # simple boolean tallies
        self.permission = collections.Counter()
        self.create_source = collections.Counter()
        self.opt_in_source = collections.Counter()
        self.confirm_status = collections.Counter()
        self.states = collections.Counter()
        self.zips = collections.Counter()
        self.countries = collections.Counter()
        self.domains = collections.Counter()
        self.created_month = collections.Counter()
        self.updated_month = collections.Counter()
        self.list_count_hist = collections.Counter()
        self.source_count_hist = collections.Counter()
        self.src = {s["key"]: {"total": 0, "last_created": None, "last_updated": None,
                               "first_created": None, "created_7d": 0, "created_30d": 0,
                               "opt_in_true": 0, "opt_in_false": 0}
                    for s in cfg["sources"]}
        self.list_members = collections.Counter()   # list_id -> members seen in scan
        self.cursor = None

    # -- (de)serialization for checkpoints ---------------------------------
    def to_dict(self):
        d = {k: v for k, v in self.__dict__.items() if k not in ("cfg", "cf_labels", "list_names", "now")}
        d["now"] = self.now.isoformat()
        return d

    @classmethod
    def from_dict(cls, d, cfg, cf_labels, list_names):
        a = cls(cfg, cf_labels, list_names)
        for k, v in d.items():
            if k == "now":
                a.now = dt.datetime.fromisoformat(v)
            elif isinstance(getattr(a, k, None), collections.Counter):
                setattr(a, k, collections.Counter(v))
            else:
                setattr(a, k, v)
        return a

    # -- per-contact -------------------------------------------------------
    def add(self, c: dict):
        self.n += 1
        cfg = self.cfg
        fields = {}
        for f in c.get("custom_fields", []) or []:
            label = self.cf_labels.get(f.get("custom_field_id"))
            if label:
                fields[label] = f.get("value")

        email = c.get("email_address") or {}
        perm = email.get("permission_to_send") or "not_set"
        self.permission[perm] += 1
        if perm in ("unsubscribed", "temp_hold"):
            self.c["do_not_contact"] += 1
        self.create_source[c.get("create_source") or "unknown"] += 1
        self.opt_in_source[email.get("opt_in_source") or "unknown"] += 1
        self.confirm_status[email.get("confirm_status") or "unknown"] += 1
        addr_email = email.get("address") or ""
        if "@" in addr_email:
            self.domains[addr_email.rsplit("@", 1)[1].lower()] += 1

        # names / phone
        if c.get("first_name") and c.get("last_name"):
            self.c["name_complete"] += 1
        if c.get("first_name") or c.get("last_name"):
            self.c["name_partial"] += 1
        if c.get("phone_numbers"):
            self.c["has_phone"] += 1

        # address: standard first, then configured fallbacks
        std = (c.get("street_addresses") or [{}])[0]
        fb = cfg.get("address_fallbacks", {})

        def pick(std_key, fb_key):
            v = std.get(std_key)
            if v:
                return v
            for label in fb.get(fb_key, []):
                if fields.get(label):
                    return fields[label]
            return None

        street, city = pick("street", "street"), pick("city", "city")
        state, zip_, country = norm_state(pick("state", "state")), norm_zip(pick("postal_code", "zip")), pick("country", "country")
        if std:
            self.c["has_std_address"] += 1
        if zip_:
            self.c["zip_complete"] += 1
            self.zips[zip_] += 1
        if state:
            self.c["state_complete"] += 1
            self.states[state] += 1
        if street and city and state and zip_:
            self.c["full_address_complete"] += 1
        if street or city or state or zip_:
            self.c["any_address"] += 1
            self.countries[norm_country(country) if country else ("US" if state and state in US_STATES else "unknown")] += 1

        # dates
        created, updated = parse_dt(c.get("created_at")), parse_dt(c.get("updated_at"))
        if created:
            self.created_month[created.strftime("%Y-%m")] += 1
            age = (self.now - created).days
            for d in (7, 30, 90, 365):
                if age <= d:
                    self.c[f"created_{d}d"] += 1
        if updated:
            self.updated_month[updated.strftime("%Y-%m")] += 1
            age = (self.now - updated).days
            if age <= 30:
                self.c["updated_30d"] += 1
            if age > cfg.get("stale_days", 365):
                self.c["stale"] += 1

        # lists
        lids = c.get("list_memberships") or []
        self.list_count_hist[str(min(len(lids), 5))] += 1
        for lid in lids:
            self.list_members[lid] += 1
        lnames = {self.list_names.get(lid, "") for lid in lids}

        # sources
        ss_field = cfg.get("source_system_field", "Source System")
        ss_val = (fields.get(ss_field) or "").strip().lower()
        if fields.get(ss_field):
            self.c["has_source_system"] += 1
        hits = 0
        for s in cfg["sources"]:
            m = s.get("match", {})
            hit = (m.get("list") and m["list"] in lnames) \
                or (m.get("source_system") and ss_val == m["source_system"].lower()) \
                or (m.get("custom_field_prefix") and any(l.startswith(m["custom_field_prefix"]) for l in fields))
            if not hit:
                continue
            hits += 1
            st = self.src[s["key"]]
            st["total"] += 1
            if created:
                iso = created.isoformat()
                st["last_created"] = max(st["last_created"] or iso, iso)
                st["first_created"] = min(st["first_created"] or iso, iso)
                age = (self.now - created).days
                if age <= 7:
                    st["created_7d"] += 1
                if age <= 30:
                    st["created_30d"] += 1
            if updated:
                iso = updated.isoformat()
                st["last_updated"] = max(st["last_updated"] or iso, iso)
            oif = s.get("opt_in_field")
            if oif and oif in fields:
                v = str(fields[oif]).strip().lower()
                if v in ("true", "yes", "1"):
                    st["opt_in_true"] += 1
                elif v in ("false", "no", "0"):
                    st["opt_in_false"] += 1
        self.source_count_hist[str(min(hits, 3))] += 1
        if hits == 0:
            self.c["unattributed"] += 1


# --------------------------------------------------------------------------- #
# ZIP centroids (public reference data)
# --------------------------------------------------------------------------- #
def fetch_centroids(path: Path):
    print("Downloading GeoNames US postal codes…")
    r = requests.get(GEONAMES_US, timeout=120)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    out = {}
    with z.open("US.txt") as fh:
        for line in io.TextIOWrapper(fh, encoding="utf-8"):
            p = line.rstrip("\n").split("\t")
            if len(p) >= 11 and p[1].isdigit() and p[9] and p[10]:
                out[p[1]] = [round(float(p[9]), 3), round(float(p[10]), 3)]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {len(out)} ZIP centroids to {path}")


# --------------------------------------------------------------------------- #
# Build output
# --------------------------------------------------------------------------- #
def build_stats(agg: Agg, cfg, lists, counts, centroids):
    n = agg.n
    c = agg.c
    gen = dt.datetime.now(dt.timezone.utc)

    def comp(key, label, hint=None):
        return {"key": key, "label": label, "count": c[key], "pct": pct(c[key], n), "hint": hint}

    completeness = [
        comp("name_complete", "Name (first + last)"),
        comp("full_address_complete", "Full address (street, city, state, ZIP)"),
        comp("zip_complete", "ZIP code"),
        comp("state_complete", "State"),
        comp("has_phone", "Phone number"),
        comp("has_source_system", "Source System tagged"),
    ]

    sources = []
    for s in cfg["sources"]:
        st = agg.src[s["key"]]
        lc = parse_dt(st["last_created"])
        sources.append({
            "key": s["key"], "label": s["label"], "total": st["total"], "pct": pct(st["total"], n),
            "last_created": st["last_created"], "last_updated": st["last_updated"],
            "first_created": st["first_created"],
            "days_since_created": (gen - lc).days if lc else None,
            "created_7d": st["created_7d"], "created_30d": st["created_30d"],
            "opt_in_true": st["opt_in_true"], "opt_in_false": st["opt_in_false"],
            "configured": True, "active": st["total"] > 0,
        })

    # Public lists: match on base name; use the API's membership_count (authoritative)
    by_base = {}
    for l in lists:
        by_base.setdefault(list_base_name(l["name"]), l)
    public = []
    for name in cfg.get("public_lists", []):
        l = by_base.get(name)
        public.append({
            "name": name,
            "description": (l["name"].split(" - ", 1)[1].strip() if l and " - " in l["name"] else None),
            "count": (l.get("membership_count") if l else None),
            "pct": pct(l.get("membership_count", 0), n) if l else None,
            "found": l is not None,
        })

    all_lists = None
    if cfg.get("include_all_lists"):
        all_lists = sorted([{"name": l["name"], "count": l.get("membership_count", 0)} for l in lists],
                           key=lambda x: -x["count"])

    # Geo
    min_zip = int(cfg.get("geo", {}).get("min_zip_count", 3))
    zip_points, suppressed_zips, suppressed_contacts, unmapped = [], 0, 0, 0
    for z, k in agg.zips.items():
        if k < min_zip:
            suppressed_zips += 1
            suppressed_contacts += k
            continue
        ll = centroids.get(z)
        if not ll:
            unmapped += k
            continue
        zip_points.append({"z": z[:3] + "xx" if k < 2 * min_zip else z, "lat": ll[0], "lng": ll[1], "n": k})
    zip_points.sort(key=lambda p: -p["n"])
    states = {k: v for k, v in agg.states.items() if k in US_STATES}
    other_states = sum(v for k, v in agg.states.items() if k not in US_STATES)

    months = sorted(set(agg.created_month) | set(agg.updated_month))[-24:]
    growth = [{"month": m, "created": agg.created_month.get(m, 0), "updated": agg.updated_month.get(m, 0)} for m in months]

    top_domains = [{"domain": d, "count": k, "pct": pct(k, n)} for d, k in agg.domains.most_common(10)]

    return {
        "generated_at": gen.isoformat(),
        "site": cfg.get("site", {}),
        "totals": {
            "contacts": n,
            "api_counts": counts,                       # CC's own summary (total/explicit/implicit/pending/unsubscribed)
            "do_not_contact": c["do_not_contact"],
            "do_not_contact_pct": pct(c["do_not_contact"], n),
            "mailable": n - c["do_not_contact"],
            "lists": len(lists),
            "unattributed": c["unattributed"],
            "unattributed_pct": pct(c["unattributed"], n),
            "in_no_list": agg.list_count_hist.get("0", 0),
            "stale": c["stale"], "stale_days": cfg.get("stale_days", 365),
            "created_7d": c["created_7d"], "created_30d": c["created_30d"],
            "created_90d": c["created_90d"], "created_365d": c["created_365d"],
            "updated_30d": c["updated_30d"],
        },
        "permission_to_send": dict(agg.permission),
        "create_source": dict(agg.create_source),
        "opt_in_source": dict(agg.opt_in_source),
        "confirm_status": dict(agg.confirm_status),
        "completeness": completeness,
        "sources": sources,
        "source_overlap": dict(sorted(agg.source_count_hist.items())),
        "list_membership_hist": dict(sorted(agg.list_count_hist.items())),
        "public_lists": public,
        "all_lists": all_lists,
        "geo": {
            "states": states,
            "non_us_or_unknown_state": other_states,
            "countries": dict(agg.countries),
            "zips": zip_points,
            "zip_min_count": min_zip,
            "zips_suppressed": suppressed_zips,
            "contacts_in_suppressed_zips": suppressed_contacts,
            "contacts_in_unmapped_zips": unmapped,
            "contacts_with_zip": c["zip_complete"],
        },
        "growth": growth,
        "top_email_domains": top_domains,
    }


def append_history(path: Path, stats: dict, keep_days=730):
    hist = []
    if path.exists():
        try:
            hist = json.loads(path.read_text())
        except json.JSONDecodeError:
            hist = []
    today = stats["generated_at"][:10]
    row = {
        "date": today,
        "contacts": stats["totals"]["contacts"],
        "do_not_contact": stats["totals"]["do_not_contact"],
        "name_pct": next(x["pct"] for x in stats["completeness"] if x["key"] == "name_complete"),
        "zip_pct": next(x["pct"] for x in stats["completeness"] if x["key"] == "zip_complete"),
        "sources": {s["key"]: s["total"] for s in stats["sources"]},
        "public_lists": {p["name"]: p["count"] for p in stats["public_lists"]},
    }
    hist = [h for h in hist if h.get("date") != today] + [row]
    hist = hist[-keep_days:]
    path.write_text(json.dumps(hist, separators=(",", ":")))
    return hist


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(ROOT / "config.yml"))
    ap.add_argument("--out", default=str(ROOT / "docs" / "data"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--fetch-centroids", action="store_true")
    ap.add_argument("--checkpoint", help="aggregate-only checkpoint file for resumable runs")
    ap.add_argument("--max-seconds", type=int, default=0, help="stop and checkpoint after N seconds")
    args = ap.parse_args()

    load_env(ROOT / ".env")
    cfg = yaml.safe_load(Path(args.config).read_text())
    out = Path(args.out)
    centroids_path = ROOT / cfg.get("geo", {}).get("centroids_file", "docs/data/zip_centroids.json")

    if args.fetch_centroids or not centroids_path.exists():
        fetch_centroids(centroids_path)
        if args.fetch_centroids and not any([args.checkpoint, args.dry_run]):
            pass  # continue to a normal run

    cc = CC(get_access_token())
    counts = cc.get("/contacts/counts")
    cf_labels = {f["custom_field_id"]: f["label"]
                 for f in cc.get("/contact_custom_fields", limit=100).get("custom_fields", [])}
    lists = []
    for page in cc.paged("/contact_lists", "lists", include_count="true", limit=1000):
        lists.extend(page.get("lists", []))
    list_names = {l["list_id"]: l["name"] for l in lists}

    ckpt = Path(args.checkpoint) if args.checkpoint else None
    if ckpt and ckpt.exists():
        agg = Agg.from_dict(json.loads(ckpt.read_text()), cfg, cf_labels, list_names)
        print(f"Resuming from checkpoint: {agg.n} contacts already aggregated")
    else:
        agg = Agg(cfg, cf_labels, list_names)

    t0 = time.time()
    first = agg.cursor or "/contacts"
    params = {} if agg.cursor else {"include": "custom_fields,list_memberships,street_addresses,phone_numbers",
                                    "status": "all", "limit": 500}
    for page in cc.paged(first, "contacts", **params):
        for contact in page.get("contacts", []):
            agg.add(contact)
        nxt = page.get("_links", {}).get("next", {}).get("href")
        agg.cursor = ("https://api.cc.email" + nxt) if nxt else None
        print(f"  …{agg.n} contacts", end="\r", flush=True)
        if agg.cursor is None:
            break
        if args.max_seconds and time.time() - t0 > args.max_seconds:
            if ckpt:
                ckpt.write_text(json.dumps(agg.to_dict()))
                print(f"\nCheckpointed at {agg.n} contacts; re-run to continue.")
                return 2
    print(f"\nAggregated {agg.n} contacts (API reports {counts.get('total')})")

    centroids = json.loads(centroids_path.read_text()) if centroids_path.exists() else {}
    stats = build_stats(agg, cfg, lists, counts, centroids)

    if args.dry_run:
        s = dict(stats)
        s["geo"] = {k: (v if k != "zips" else f"[{len(v)} zip points]") for k, v in stats["geo"].items()}
        s["geo"]["states"] = dict(sorted(stats["geo"]["states"].items(), key=lambda x: -x[1])[:8])
        print(json.dumps(s, indent=1, default=str)[:6000])
        if ckpt and ckpt.exists():
            ckpt.unlink()
        return 0

    out.mkdir(parents=True, exist_ok=True)
    stats["history"] = append_history(out / "history.json", stats)[-90:]
    (out / "stats.json").write_text(json.dumps(stats, separators=(",", ":"), default=str))
    print(f"Wrote {out / 'stats.json'} and history.json")
    if ckpt and ckpt.exists():
        ckpt.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
