"""When does the ACME sync land in Constant Contact, and when do the date-based paths send?

Prints hour-of-day counts (America/Chicago) only, never contact details, so the
output is safe for a public Actions log. Used to schedule the date-to-text sync
(sync_date_text.py) after ACME and before the automations.

    python tools/acme_timing.py [--days 14]
"""
import argparse
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from collect import CC, ROOT, get_access_token, load_env  # noqa: E402

CT = ZoneInfo("America/Chicago")
ACME_FIELDS = ("Acme - Visit Date (Next)", "Acme - Last Purchase Date", "Acme - Membership Expiration Date")
# Live date-based paths whose sends show when Constant Contact runs date triggers.
PATHS = {"VISIT: T-3": "a3df1186-26da-4b40-8602-c50cf797b9be",
         "VISIT: T-24h": "74b8112e-8aaa-47d8-a3a8-bc4141ab9eaf"}


def when(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(CT)


def show(title: str, hours: Counter, by_day: dict):
    total = sum(hours.values())
    print(f"\n== {title}: {total} events ==")
    peak = max(hours.values()) if hours else 1
    for h in range(24):
        n = hours.get(h, 0)
        if n:
            print(f"  {h:02d}:00 CT  {n:6d}  {'#' * max(1, round(40 * n / peak))}")
    print("  busiest hour by day:")
    for day in sorted(by_day)[-10:]:
        c = by_day[day]
        h, n = c.most_common(1)[0]
        print(f"    {day}  {h:02d}:00 CT ({n} of {sum(c.values())}), first {min(c):02d}:00, last {max(c):02d}:00")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    a = ap.parse_args()
    load_env(ROOT / ".env")
    cc = CC(get_access_token())
    since = (datetime.now(timezone.utc) - timedelta(days=a.days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    ids = {f["custom_field_id"] for f in cc.get("/contact_custom_fields", limit=100).get("custom_fields", [])
           if f["label"] in ACME_FIELDS}
    hours, by_day = Counter(), defaultdict(Counter)
    for page in cc.paged("/contacts", "contacts", updated_after=since, include="custom_fields",
                         status="all", limit=500):
        for c in page.get("contacts", []):
            if not any(f.get("custom_field_id") in ids for f in c.get("custom_fields") or []):
                continue
            t = when(c["updated_at"])
            hours[t.hour] += 1
            by_day[t.date().isoformat()][t.hour] += 1
    show("Contacts with ACME date fields, by last update time", hours, by_day)
    print("  (A contact counts once, at its latest update, so other syncs can mask ACME's.)")

    for name, cid in PATHS.items():
        camp = cc.get(f"/emails/{cid}") or {}
        hours, by_day = Counter(), defaultdict(Counter)
        for act in camp.get("campaign_activities", []):
            if act.get("role") not in ("primary_email", "multistep_email"):
                continue
            url = f"/reports/email_reports/{act['campaign_activity_id']}/tracking/sends"
            try:
                for page in cc.paged(url, "tracking_activities", created_after=since, limit=500):
                    for s in page.get("tracking_activities", []):
                        t = when(s["created_time"])
                        hours[t.hour] += 1
                        by_day[t.date().isoformat()][t.hour] += 1
            except Exception as e:  # report shape only; never the response body
                print(f"  ! {name}: sends report unavailable ({type(e).__name__})")
        show(f"{name} sends", hours, by_day)


if __name__ == "__main__":
    main()
