#!/usr/bin/env python3
"""
HouseFile automations collector.

Reads the automation paths described under `automations:` in config.yml,
pulls each path's email(s) from the Constant Contact v3 API (subject, sender,
preheader, rendered HTML, send stats) and writes:

    docs/data/automations.json        flows -> paths -> emails (metadata + stats)
    docs/data/emails/<slug>.html      one rendered email per file

Constant Contact's public API does not expose an automation path's trigger,
timing or filters, so those come from config.yml. Everything about the email
itself comes from the API.

PRIVACY
-------
Constant Contact renders previews with the ACCOUNT's own details filled in
(the account first name in a greeting, the account contact email in links).
Before writing, those values are turned back into merge tags ([[FIRSTNAME]],
[[LASTNAME]], [[EMAILADDRESS]], [[PHONE]]) so no staff details reach the public
page, and the dashboard fills them with the fake sample contact instead.
The privacy guard in the workflow then fails the run if any email address
outside `allowed_email_domains` appears in the output. No contact records are
read by this script.

Needs the refresh token to carry the `campaign_data` and `account_read`
scopes (re-run authorize.py once after upgrading).

Usage:
    python collect_automations.py            # write docs/data/automations.json + emails/
    python collect_automations.py --dry-run  # print what would be written
    python collect_automations.py --check    # privacy-check docs/data (no API calls)
    python collect_automations.py --offline  # rebuild from config.yml after editing proposals
"""

import argparse
import datetime as dt
import itertools
import json
import re
import sys
from pathlib import Path

import requests
import yaml

from collect import CC, ROOT, get_access_token, load_env

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "email"


def offset_label(trigger: dict) -> str:
    if trigger.get("label"):
        return trigger["label"]
    if trigger.get("type") == "date_field":
        n = int(trigger.get("offset_days", 0))
        field = trigger.get("field", "date field")
        if n == 0:
            return f"On the {field}"
        unit = "day" if abs(n) == 1 else "days"
        return f"{abs(n)} {unit} {'before' if n < 0 else 'after'} the {field}"
    return trigger.get("type", "Unknown trigger")


def detokenize(html: str, account: dict) -> str:
    """Turn the account details CC substitutes into previews back into merge tags."""
    swaps = []
    if account.get("contact_email"):
        swaps.append((re.escape(account["contact_email"]), "[[EMAILADDRESS]]"))
    if account.get("contact_phone"):
        swaps.append((re.escape(account["contact_phone"]), "[[PHONE]]"))
    for key, tag in (("first_name", "[[FIRSTNAME]]"), ("last_name", "[[LASTNAME]]")):
        v = (account.get(key) or "").strip()
        if len(v) >= 2:
            # Only in text nodes and attribute values, as a whole word.
            swaps.append((rf"(?<![A-Za-z]){re.escape(v)}(?![A-Za-z])", tag))
    for pat, tag in swaps:
        html = re.sub(pat, tag, html)
    return html


def find_disallowed(acfg: dict, data: dict, htmls) -> list:
    """Email addresses in the output that are neither a configured Library
    address, an address the emails are sent from / replied to, nor on an
    allowed (sample) domain."""
    ok_addr = {a.lower() for a in acfg.get("allowed_emails", [])}
    for f in data.get("flows", []):
        for p in f.get("paths", []):
            for e in p.get("emails", []):
                ok_addr |= {(e.get("from_email") or "").lower(), (e.get("reply_to") or "").lower()}
    ok_dom = {d.lower() for d in acfg.get("allowed_email_domains", [])}
    blob = json.dumps(data) + "".join(htmls)
    return sorted({m for m in EMAIL_RE.findall(blob)
                   if m.lower() not in ok_addr and m.split("@")[1].lower() not in ok_dom})


def check_output(cfg: dict, out: Path) -> int:
    """Privacy guard for the workflow: re-check what is on disk."""
    acfg = cfg.get("automations") or {}
    f = out / "automations.json"
    if not f.exists():
        return 0
    data = json.loads(f.read_text())
    htmls = [h.read_text() for h in (out / "emails").glob("*.html")]
    htmls += [h.read_text() for h in (out.parent / "proposals").glob("*.html")]
    htmls += [h.read_text() for h in (out.parent / "proposals" / "live").glob("*.html")]
    bad = find_disallowed(acfg, data, htmls)
    if bad:
        print(f"::error::{len(bad)} unexpected email address(es) in automation data")
        return 1
    print("Automation data privacy check passed.")
    return 0


WORD_RE = re.compile(r"[a-z0-9']{3,}")


def _words(html: str) -> set:
    text = re.sub(r"<(style|script)[^>]*>.*?</\1>", " ", html or "", flags=re.S | re.I)
    text = re.sub(r"<[^>]+>|\[\[[^\]]*\]\]|&[a-z#0-9]+;", " ", text)
    return set(WORD_RE.findall(text.lower()))


def _variant_file(p: dict, name: str, root: Path):
    """docs/proposals/live/<slug>-member.html or -nonmember.html for a branch name."""
    slug = (p.get("proposal") or {}).get("slug") or Path((p.get("proposal") or {}).get("html", "")).stem
    if not slug:
        return None
    kind = "nonmember" if re.search(r"not a member|non-?member", name, re.I) else "member"
    f = root / "proposals" / "live" / f"{slug}-{kind}.html"
    return f if f.exists() else None


def match_branches(p: dict, wanted: list, acts: list, fetched: dict, root: Path):
    """Pick the activity for each branch email named in config.

    Constant Contact's API gives a path's emails no name, so names alone can't
    match them. Each branch is matched to the copy that was built into it
    (docs/proposals/live/<slug>-member|nonmember.html) by shared wording; an
    API name, if one is ever returned, wins. Returns (activities in config
    order, each tagged with its branch name in "_task", and missing names)."""
    by_name = {(fetched.get(a["campaign_activity_id"]) or {}).get("name"): a for a in acts}
    if all(n in by_name for n in wanted):
        return [dict(by_name[n], _task=n) for n in wanted], []
    refs = [_words(f.read_text()) if (f := _variant_file(p, n, root)) else None for n in wanted]
    if not acts:
        return [], list(wanted)
    if all(r is None for r in refs):
        # No built copy to compare with: keep the API's order when the counts line up.
        if len(acts) == len(wanted):
            return [dict(a, _task=n) for a, n in zip(acts, wanted)], []
        return [], list(wanted)
    words = [_words((fetched.get(a["campaign_activity_id"]) or {}).get("html_content", "")) for a in acts]
    def jac(r, w):
        return len(r & w) / max(1, len(r | w)) if r is not None else 0.0
    # Branches share most of their wording, so what tells them apart is the words only
    # one branch's copy has (the member thank-you versus the membership offer).
    distinct = [(r - set().union(*(o for o in refs if o is not None and o is not r))) if r is not None else set()
                for r in refs]

    def fit(i, w):
        d = distinct[i]
        return (len(d & w) / len(d) if d else 0.0) + jac(refs[i], w)
    # Best one-to-one assignment (a path has two or three branches, so brute force is fine).
    k = min(len(wanted), len(acts))
    best, best_score = None, -1.0
    for perm in itertools.permutations(range(len(acts)), k):
        sc = sum(fit(i, words[j]) for i, j in enumerate(perm))
        if sc > best_score:
            best, best_score = perm, sc
    chosen, missing = [], list(wanted[k:])
    for i, j in enumerate(best):
        if refs[i] is None or jac(refs[i], words[j]) >= 0.4:
            chosen.append(dict(acts[j], _task=wanted[i]))
        else:
            missing.append(wanted[i])
    return chosen, missing


def built_branch_emails(p: dict, root: Path) -> list:
    """The copy that was built into each branch of a live path (docs/proposals/live),
    shown when the API can't give us the emails. Falls back to the combined proposal."""
    wanted = p.get("emails") or []
    out = []
    for n in wanted:
        f = _variant_file(p, n, root)
        if not f:
            continue
        base = proposal_email(p)
        kind = f.stem.rsplit("-", 1)[-1]
        out.append(dict(base, slug=f"{base['slug']}-{kind}", task=n,
                        html=str(f.relative_to(root)), proposed=False, stale=True))
    if len(out) != len(wanted) or not out:
        return [dict(proposal_email(p), proposed=False, stale=True)] if p.get("proposal") else []
    return out


def safe_get(cc: CC, url: str, **params):
    try:
        return cc.get(url, **params)
    except requests.HTTPError as e:
        print(f"  ! {url}: HTTP {e.response.status_code if e.response is not None else '?'}", file=sys.stderr)
        return None


def proposal_email(p: dict) -> dict:
    """A proposed email: everything comes from config.yml, nothing from the API."""
    pr = p["proposal"]
    return {
        "slug": pr.get("slug") or slugify(p["name"]),
        "task": pr.get("task") or p["name"],
        "subject": pr.get("subject", ""),
        "preheader": pr.get("preheader", ""),
        "from_name": pr.get("from_name", ""),
        "from_email": pr.get("from_email", ""),
        "reply_to": pr.get("reply_to", "") or pr.get("from_email", ""),
        "html": pr["html"],
        "proposed": True,
        "notes": pr.get("notes") or [],
        "stats": {},
    }


def collect(cfg: dict, cc, out: Path, dry: bool, offline: bool = False):
    """cc=None with offline=True rebuilds automations.json from config.yml, keeping
    the last API data for live paths. Used after editing proposals or path timing."""
    acfg = cfg.get("automations") or {}
    previous, prev_meta = {}, {}
    prev_file = out / "automations.json"
    if prev_file.exists():
        # Live runs read it too: when the API returns no email for a live path, the
        # last good copy is kept instead of being wiped from the dashboard.
        prev_meta = json.loads(prev_file.read_text())
        for f in prev_meta.get("flows", []):
            for pp in f.get("paths", []):
                previous[pp["name"]] = pp
    if offline:
        account = {}
    else:
        account = safe_get(cc, "/account/summary") or {}
        if not account:
            # Without it, account details CC fills into previews can't be removed.
            sys.exit("/account/summary unavailable (token needs the account_read scope); "
                     "not publishing automation previews")

    emails_dir = out / "emails"
    pages = {}  # filename -> html, written only after the privacy check
    flows = [dict(f, paths=[]) for f in acfg.get("flows", [])]
    by_flow = {f["key"]: f for f in flows}

    for p in acfg.get("paths", []):
        trig = dict(p.get("trigger") or {})
        trig["label"] = offset_label(trig)
        path = {
            "name": p["name"],
            "status": p.get("status", "active"),
            "activated": p.get("activated"),
            "trigger": trig,
            "filters": p.get("filters") or [],
            "action": p.get("action", ""),
            "split": p.get("split"),
            "emails": [],
        }
        cid = p.get("campaign_id")
        if p.get("proposal") and not (cid and p.get("status") == "active"):
            email = proposal_email(p)
            path["emails"].append(email)
            if not (out.parent / email["html"]).exists():
                print(f"  ! {p['name']}: proposal file {email['html']} not found", file=sys.stderr)
            print(f"  {p['name']}: proposed, {email['subject']!r}")
        elif cid and offline:
            old = previous.get(p["name"], {})
            path["emails"] = [e for e in old.get("emails", []) if not e.get("proposed")
                              and (not p.get("emails") or e.get("task") in p["emails"])]
            if old.get("cc_status"):
                path["cc_status"] = old["cc_status"]
            for e in path["emails"]:
                f = out / "emails" / Path(e["html"]).name
                if f.exists():
                    pages[f.name] = f.read_text()
            if not path["emails"] and p.get("proposal"):
                # Just went live and not refreshed from the API yet: show the built copy.
                path["emails"] = built_branch_emails(p, out.parent)
            print(f"  {p['name']}: kept last refresh ({len(path['emails'])} email)")
        elif cid:
            camp = safe_get(cc, f"/emails/{cid}")
            # Single-email paths use a primary_email; split paths hold one multistep_email per
            # branch. A path's campaign can also keep unattached drafts, so when config lists
            # `emails` (exact email names, in branch order) only those are shown.
            acts = [a for a in (camp or {}).get("campaign_activities", [])
                    if a.get("role") in ("primary_email", "multistep_email")]
            wanted = p.get("emails") or []
            fetched = {}  # activity id -> /emails/activities/{id}
            if wanted:
                for a in acts:
                    fetched[a["campaign_activity_id"]] = safe_get(
                        cc, f"/emails/activities/{a['campaign_activity_id']}") or {}
                acts, missing = match_branches(p, wanted, acts, fetched, out.parent)
                if missing:
                    print(f"  ! {p['name']}: emails not found in campaign: {missing}", file=sys.stderr)
            if not acts:
                # Shape only (keys and activity roles), never content, to diagnose.
                shape = {"keys": sorted((camp or {}).keys()),
                         "roles": [a.get("role") for a in (camp or {}).get("campaign_activities", [])]}
                print(f"  ! {p['name']}: no primary email from /emails/{{id}} {shape}", file=sys.stderr)
            if camp and camp.get("current_status"):
                path["cc_status"] = camp["current_status"]
            for i, a in enumerate(acts):
                aid = a["campaign_activity_id"]
                act = fetched.get(aid) or safe_get(cc, f"/emails/activities/{aid}") or {}
                prev = safe_get(cc, f"/emails/activities/{aid}/previews") or {}
                html = prev.get("preview_html_content") or act.get("html_content") or ""
                html = detokenize(html, account)
                slug = slugify(p["name"]) + (f"-{i + 1}" if len(acts) > 1 else "")
                stats = {}
                rep = safe_get(cc, f"/reports/stats/email_campaign_activities/{aid}")
                for row in (rep or {}).get("results", []):
                    s = row.get("stats", {})
                    stats = {
                        "sends": s.get("em_sends"),
                        "opens": s.get("em_opens"),
                        "clicks": s.get("em_clicks"),
                        "bounces": s.get("em_bounces"),
                        "unsubscribes": s.get("em_optouts"),
                    }
                email = {
                    "slug": slug,
                    "task": a.get("_task") or act.get("name") or p["name"],
                    "subject": detokenize(act.get("subject", ""), account),
                    "preheader": detokenize(act.get("preheader", ""), account),
                    "from_name": act.get("from_name", ""),
                    "from_email": act.get("from_email", ""),
                    "reply_to": act.get("reply_to_email", ""),
                    "html": f"data/emails/{slug}.html",
                    "stats": {k: v for k, v in stats.items() if v is not None},
                }
                path["emails"].append(email)
                pages[f"{slug}.html"] = html
                print(f"  {p['name']}: {email['subject']!r}")
            if not path["emails"] or not any(pages.get(Path(e["html"]).name) for e in path["emails"]):
                old = [e for e in previous.get(p["name"], {}).get("emails", []) if not e.get("proposed")]
                kept = []
                for e in old:
                    f = emails_dir / Path(e["html"]).name
                    if f.exists():
                        pages[f.name] = f.read_text()
                        kept.append(dict(e, stale=True))
                if kept:
                    for e in path["emails"]:
                        pages.pop(Path(e["html"]).name, None)
                    path["emails"] = kept
                    print(f"  ! {p['name']}: API returned no email; kept the last good copy", file=sys.stderr)
                elif p.get("proposal"):
                    # Live, but the API gave nothing usable: show the copy that was built
                    # into Constant Contact rather than an empty card.
                    for e in path["emails"]:
                        pages.pop(Path(e["html"]).name, None)
                    path["emails"] = built_branch_emails(p, out.parent)
                    print(f"  ! {p['name']}: API returned no email; showing the built copy", file=sys.stderr)
        else:
            print(f"  {p['name']}: no campaign_id (draft or not built yet)")
        flow = by_flow.get(p.get("flow"))
        if flow is None:
            flow = by_flow.get("other")
            if flow is None:
                flow = by_flow["other"] = {"key": "other", "label": "Other", "paths": []}
                flows.append(flow)
        flow["paths"].append(path)

    for f in flows:
        f["paths"].sort(key=lambda x: (x["trigger"].get("offset_days", 9999), x["name"]))

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    data = {
        # Offline rebuilds keep the time of the last real refresh: that is what the
        # subjects, HTML and stats of live emails reflect.
        "generated_at": prev_meta.get("generated_at", now) if offline else now,
        "rebuilt_at": now,
        "source": prev_meta.get("source", "seed") if offline else "api",
        "sample_contact": acfg.get("sample_contact", {}),
        "flows": flows,
    }

    # Privacy check before anything is written.
    proposal_html = [(out.parent / e["html"]).read_text()
                     for f in flows for pp in f["paths"] for e in pp["emails"]
                     if (e.get("proposed") or e["html"].startswith("proposals/"))
                     and (out.parent / e["html"]).exists()]
    bad = find_disallowed(acfg, data, list(pages.values()) + proposal_html)
    if bad:
        sys.exit(f"Privacy check failed: {len(bad)} unexpected email address(es) in automation output")

    if dry:
        print(json.dumps(data, indent=1)[:4000])
        return
    emails_dir.mkdir(parents=True, exist_ok=True)
    for name, html in pages.items():
        (emails_dir / name).write_text(html)
    for f in emails_dir.glob("*.html"):  # drop previews for emails that no longer exist
        if f.name not in pages:
            f.unlink()
    (out / "automations.json").write_text(json.dumps(data, indent=1))
    print(f"Wrote {out / 'automations.json'} ({sum(len(f['paths']) for f in flows)} paths, {len(pages)} emails)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(ROOT / "config.yml"))
    ap.add_argument("--out", default=str(ROOT / "docs" / "data"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true", help="privacy-check the files on disk and exit")
    ap.add_argument("--offline", action="store_true",
                    help="rebuild automations.json from config.yml without the API (after editing proposals)")
    args = ap.parse_args()
    cfg = yaml.safe_load(Path(args.config).read_text())
    if args.check:
        return check_output(cfg, Path(args.out))
    if args.offline:
        collect(cfg, None, Path(args.out), args.dry_run, offline=True)
        return 0
    load_env(ROOT / ".env")
    if not cfg.get("automations"):
        print("No automations configured; nothing to do.")
        return 0
    collect(cfg, CC(get_access_token()), Path(args.out), args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
