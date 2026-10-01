#!/usr/bin/env python3
"""
Fill in missing US states from ZIP codes, directly in Constant Contact.

For every contact that has a 5-digit US ZIP (standard address or a configured
fallback custom field such as "Acme - Billing Zip") but NO state anywhere,
derive the state from the GeoNames ZIP table and write it onto the contact's
standard Constant Contact street address. If the contact has no standard
address at all, one is created (kind "home") with the ZIP and state — and the
city, when --city is passed.

Custom fields are never modified, so a nightly sync that owns them cannot
undo this and this script cannot clobber it.

PRIVACY: contacts are fetched, patched and written back in memory only.
Nothing identifying is printed or written to disk — the log shows counts.

    python fill_state.py                 # dry run: count what would change
    python fill_state.py --apply         # write the changes
    python fill_state.py --apply --city  # also fill city from GeoNames
    python fill_state.py --limit 50 --apply   # cautious first batch
"""
import argparse
import json
import sys
import time
from pathlib import Path

import yaml

from collect import (ROOT, US_STATES, CC, get_access_token, load_env, norm_state, norm_zip)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    ap.add_argument("--city", action="store_true", help="also fill city from GeoNames when creating an address")
    ap.add_argument("--limit", type=int, default=0, help="stop after N updates (0 = no limit)")
    ap.add_argument("--max-seconds", type=int, default=0, help="stop scanning after N seconds (re-run to continue; idempotent)")
    ap.add_argument("--config", default=str(ROOT / "config.yml"))
    ap.add_argument("--checkpoint", help="file holding the page cursor + counters so a run can resume (no contact data)")
    args = ap.parse_args()

    load_env(ROOT / ".env")
    cfg = yaml.safe_load(Path(args.config).read_text())
    centroids_path = ROOT / cfg.get("geo", {}).get("centroids_file", "docs/data/zip_centroids.json")
    if not centroids_path.exists():
        sys.exit("ZIP table missing — run: python collect.py --fetch-centroids")
    zips = json.loads(centroids_path.read_text())
    if not zips or len(next(iter(zips.values()))) < 3:
        sys.exit("ZIP table has no state column — rebuild with: python collect.py --fetch-centroids")

    # GeoNames place names for --city (only loaded if asked; same public file)
    cities = {}
    if args.city:
        import io, zipfile, requests
        from collect import GEONAMES_US
        r = requests.get(GEONAMES_US, timeout=120); r.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(r.content)).open("US.txt") as fh:
            for line in io.TextIOWrapper(fh, encoding="utf-8"):
                p = line.rstrip("\n").split("\t")
                if len(p) >= 5 and p[1].isdigit():
                    cities[p[1]] = p[2]

    cc = CC(get_access_token())
    cf_labels = {f["custom_field_id"]: f["label"]
                 for f in cc.get("/contact_custom_fields", limit=100).get("custom_fields", [])}
    fb = cfg.get("address_fallbacks", {})

    stats = dict(scanned=0, candidates=0, no_lookup=0, updated=0, failed=0, created_address=0, set_state_only=0)
    ckpt = Path(args.checkpoint) if args.checkpoint else None
    first, params = "/contacts", {"include": "custom_fields,street_addresses,phone_numbers,list_memberships,taggings,notes",
                                  "status": "all", "limit": 500}
    if ckpt and ckpt.exists():
        saved = json.loads(ckpt.read_text())
        if saved.get("apply") == args.apply and saved.get("cursor"):
            first, params, stats = saved["cursor"], {}, saved["stats"]
            print(f"Resuming at {stats['scanned']:,} scanned")
    t0 = time.time()
    cursor = None
    for page in cc.paged(first, "contacts", **params):
        nxt = page.get("_links", {}).get("next", {}).get("href")
        cursor = ("https://api.cc.email" + nxt) if nxt else None
        for c in page.get("contacts", []):
            stats["scanned"] += 1
            fields = {cf_labels.get(f["custom_field_id"]): f.get("value") for f in c.get("custom_fields", []) or []}
            addrs = c.get("street_addresses") or []
            std = addrs[0] if addrs else {}

            def pick(std_key, fb_key):
                if std.get(std_key):
                    return std[std_key]
                return next((fields[l] for l in fb.get(fb_key, []) if fields.get(l)), None)

            state = norm_state(pick("state", "state"))
            zip_ = norm_zip(pick("postal_code", "zip"))
            if state or not zip_:
                continue
            stats["candidates"] += 1
            z = zips.get(zip_)
            if not z or len(z) < 3 or z[2] not in US_STATES:
                stats["no_lookup"] += 1
                continue
            new_state = z[2]

            if not args.apply:
                stats["updated"] += 1
                stats["created_address" if not std else "set_state_only"] += 1
                continue

            # Build the update body from what the API gave us, changing only the address.
            body = {k: c[k] for k in ("first_name", "last_name", "job_title", "company_name", "birthday_month",
                                      "birthday_day", "anniversary", "phone_numbers", "custom_fields",
                                      "list_memberships", "taggings", "notes") if c.get(k) is not None}
            body["email_address"] = {"address": c["email_address"]["address"],
                                     "permission_to_send": c["email_address"].get("permission_to_send", "implicit")}
            body["update_source"] = "Account"
            if std:
                std = dict(std); std["state"] = new_state
                if not std.get("postal_code"):
                    std["postal_code"] = zip_
                stats["set_state_only"] += 1
            else:
                std = {"kind": "home", "postal_code": zip_, "state": new_state, "country": "US"}
                if args.city and cities.get(zip_):
                    std["city"] = cities[zip_]
                stats["created_address"] += 1
            body["street_addresses"] = [std]

            r = cc.s.put(f"https://api.cc.email/v3/contacts/{c['contact_id']}", json=body, timeout=60)
            if r.status_code == 429:
                time.sleep(2)
                r = cc.s.put(f"https://api.cc.email/v3/contacts/{c['contact_id']}", json=body, timeout=60)
            if r.status_code in (200, 201):
                stats["updated"] += 1
            else:
                stats["failed"] += 1
                if stats["failed"] <= 3:
                    print(f"  update failed: HTTP {r.status_code} {r.text[:160]}", file=sys.stderr)
            time.sleep(0.25)  # stay under 4 req/s
            if args.limit and stats["updated"] >= args.limit:
                break
        print(f"  …scanned {stats['scanned']}, candidates {stats['candidates']}, "
              f"{'would update' if not args.apply else 'updated'} {stats['updated']}", end="\r", flush=True)
        if args.limit and stats["updated"] >= args.limit:
            break
        if cursor is None:
            break
        if args.max_seconds and time.time() - t0 > args.max_seconds:
            if ckpt:
                ckpt.write_text(json.dumps({"cursor": cursor, "stats": stats, "apply": args.apply}))
            print(f"\nStopped on time limit at {stats['scanned']:,} scanned; re-run to continue.")
            return 2
    if ckpt and ckpt.exists():
        ckpt.unlink()

    mode = "DRY RUN — nothing written" if not args.apply else "APPLIED"
    print(f"\n{mode}\n  scanned:                 {stats['scanned']:,}\n  ZIP but no state:        {stats['candidates']:,}"
          f"\n  ZIP not in lookup table: {stats['no_lookup']:,}\n  {'would update' if not args.apply else 'updated'}:"
          f"            {stats['updated']:,}\n    set state on existing address: {stats['set_state_only']:,}"
          f"\n    created new address (ZIP+state): {stats['created_address']:,}\n  failed:                  {stats['failed']:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
