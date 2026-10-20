"""Copy ACME's date fields into text fields Constant Contact can print in emails.

Constant Contact only merges TEXT custom fields into custom-code emails; date fields
are stripped at send. ACME syncs dates, so this job writes a formatted text copy of
each one next to it:

    Acme - Visit Date (Next)          -> Acme - Visit Date (Text)            "Saturday, October 24, 2026"
    Acme - Last Purchase Date         -> Acme - Last Purchase Date (Text)    "October 18, 2026"
    Acme - Membership Expiration Date -> Acme - Membership Expiration (Text) "December 31, 2026"

Only contacts whose text is missing or out of date are written, so repeat runs are
cheap and harmless. Writes go through the bulk JSON import, which updates fields
without touching anything else; each contact is imported into a list it is already
on, so list memberships don't change. Contacts on no list (unsubscribed) are skipped.

Privacy: this runs in a public repo. It keeps nothing on disk and prints counts only:
never an email address, name or contact ID.

    python sync_date_text.py                  # dry run: counts of what would change
    python sync_date_text.py --create-fields  # create any missing text fields (once)
    python sync_date_text.py --apply --limit 25  # test on 25 contacts
    python sync_date_text.py --apply          # write the changes
"""
import argparse
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from collect import CC, ROOT, get_access_token, load_env

FIELDS = [  # (date field label, text field label, strftime pattern)
    ("Acme - Visit Date (Next)", "Acme - Visit Date (Text)", "%A, %B {d}, %Y"),
    ("Acme - Last Purchase Date", "Acme - Last Purchase Date (Text)", "%B {d}, %Y"),
    ("Acme - Membership Expiration Date", "Acme - Membership Expiration (Text)", "%B {d}, %Y"),
]
IMPORT_BATCH = 40000  # Constant Contact's per-request import limit


def parse_date(v) -> date | None:
    s = str(v or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            return datetime.strptime(s.replace("Z", "+0000"), fmt).date()
        except ValueError:
            pass
    return None


def fmt(d: date, pattern: str) -> str:
    return d.strftime(pattern.replace("{d}", str(d.day)))  # "October 4", not "October 04"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    ap.add_argument("--create-fields", action="store_true", help="create missing text fields")
    ap.add_argument("--limit", type=int, default=0, help="update at most this many contacts (test runs)")
    ap.add_argument("--since-days", type=int, default=0,
                    help="only scan contacts updated in the last N days (0 = every contact; daily runs use 2)")
    ap.add_argument("--wait", action="store_true",
                    help="wait for the imports to finish and report their results (slow on big runs)")
    a = ap.parse_args()
    load_env(ROOT / ".env")
    cc = CC(get_access_token())

    defs = cc.get("/contact_custom_fields", limit=100).get("custom_fields", [])
    by_label = {f["label"]: f for f in defs}
    missing = [t for _, t, _ in FIELDS if t not in by_label]
    if missing and a.apply and not a.create_fields:
        sys.exit(f"Missing text fields {missing}. Run once with --create-fields first.")
    if missing and not a.create_fields:
        print(f"Text fields not created yet: {missing} (counting as empty)")
    if missing and a.create_fields:
        for label in missing:
            r = cc.s.post("https://api.cc.email/v3/contact_custom_fields",
                          json={"label": label, "type": "string"}, timeout=60)
            r.raise_for_status()
            by_label[label] = r.json()
            print(f"Created text field: {label}")
    src_ids = {by_label[s]["custom_field_id"]: (s, t, p) for s, t, p in FIELDS if s in by_label}
    tgt_ids = {by_label[t]["custom_field_id"]: t for _, t, _ in FIELDS if t in by_label}
    tgt_name = {t: by_label[t].get("name", t) for _, t, _ in FIELDS if t in by_label}

    stats = Counter()
    rows_by_list = defaultdict(list)
    params = {"include": "custom_fields,list_memberships", "limit": 500}
    if a.since_days:
        since = datetime.now(timezone.utc) - timedelta(days=a.since_days)
        params["updated_after"] = since.strftime("%Y-%m-%dT%H:%M:%SZ")
        print(f"Scanning contacts updated in the last {a.since_days} day(s)")
    for page in cc.paged("/contacts", "contacts", **params):
        for c in page.get("contacts", []):
            stats["contacts scanned"] += 1
            cf = {f.get("custom_field_id"): f.get("value") for f in c.get("custom_fields") or []}
            have = {tgt_ids[k]: (v or "") for k, v in cf.items() if k in tgt_ids}
            want = {}
            for fid, (src, tgt, pattern) in src_ids.items():
                d = parse_date(cf.get(fid))
                if cf.get(fid) and not d:
                    stats[f"{src}: unreadable date"] += 1
                text = fmt(d, pattern) if d else ""
                if text != have.get(tgt, ""):
                    want[tgt] = text
                    stats[f"{tgt}: {'set' if text else 'clear'}"] += 1
            if not want:
                continue
            lists = c.get("list_memberships") or []
            addr = (c.get("email_address") or {}).get("address")
            if not lists or not addr:
                stats["skipped: on no list (unsubscribed) or no email"] += 1
                continue
            stats["contacts to update"] += 1
            if a.limit and sum(len(r) for r in rows_by_list.values()) >= a.limit:
                stats["held back by --limit"] += 1
                continue
            row = {"email": addr}
            row.update({f"cf:{tgt_name.get(t, t)}": v for t, v in want.items()})
            rows_by_list[sorted(lists)[0]].append(row)

    print(("APPLY" if a.apply else "DRY RUN") + " — counts only")
    for k in sorted(stats):
        print(f"  {k}: {stats[k]}")
    if not a.apply or not rows_by_list:
        return

    jobs = []
    for list_id, rows in rows_by_list.items():
        for i in range(0, len(rows), IMPORT_BATCH):
            r = cc.s.post("https://api.cc.email/v3/activities/contacts_json_import",
                          json={"import_data": rows[i:i + IMPORT_BATCH], "list_ids": [list_id]}, timeout=120)
            r.raise_for_status()
            jobs.append(r.json()["activity_id"])
    print(f"Started {len(jobs)} import(s) for {sum(len(r) for r in rows_by_list.values())} contacts.")
    if not a.wait:
        # Constant Contact finishes them in the background; the next run's counts show
        # anything that didn't land (it is picked up again then).
        return
    done = Counter()
    for job in jobs:
        for _ in range(60):
            st = cc.get(f"/activities/{job}") or {}
            if st.get("state") in ("completed", "failed", "timed_out", "cancelled"):
                break
            time.sleep(5)
        done[st.get("state", "unknown")] += 1
        status = st.get("status") or {}
        for k in ("items_total_count", "items_completed_count", "error_count"):
            if k in status:
                done[k] += status[k] or 0
    for k in sorted(done):
        print(f"  import {k}: {done[k]}")
    if done.get("failed") or done.get("error_count"):
        sys.exit("Some imports failed or reported errors.")


if __name__ == "__main__":
    main()
