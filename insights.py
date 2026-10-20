"""
Date and membership insights for the HouseFile dashboard ("Dates & members" tab).

Reads the ACME date and membership fields that sync into Constant Contact and
keeps COUNTERS only: how many contacts fall in each month, weekday, lead-time
bucket, membership level or expiration month. No dates, values or identifiers
of any one contact leave the collector. Category labels (membership levels,
ticket types) seen on fewer than `min_cell` contacts are folded into "Other".

Field names are configurable under `insights:` in config.yml, so the module
works for any ticketing or membership sync that writes dates to custom fields.
"""

import collections
import datetime as dt
import re
import statistics

LEAD_BUCKETS = [  # (label, low, high) in days between purchase and visit, inclusive
    ("Same day", 0, 0), ("1 day", 1, 1), ("2–3 days", 2, 3), ("4–7 days", 4, 7),
    ("8–14 days", 8, 14), ("15–30 days", 15, 30), ("31–60 days", 31, 60),
    ("61–90 days", 61, 90), ("91–180 days", 91, 180), ("181+ days", 181, 10 ** 6),
]
EXP_BUCKETS = [  # days until expiration (negative = already expired)
    ("Expired over a year ago", -10 ** 6, -366), ("Expired 1–12 months ago", -365, -31),
    ("Expired in the last 30 days", -30, -1), ("Expires within 30 days", 0, 30),
    ("31–60 days", 31, 60), ("61–90 days", 61, 90), ("91–180 days", 91, 180),
    ("181–365 days", 181, 365), ("More than a year", 366, 10 ** 6),
]
RECENCY_BUCKETS = [  # days since last purchase
    ("Last 7 days", 0, 7), ("8–30 days", 8, 30), ("31–90 days", 31, 90),
    ("91–180 days", 91, 180), ("181–365 days", 181, 365), ("Over a year", 366, 10 ** 6),
]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
TRUE = {"true", "yes", "y", "1", "active", "new", "t"}   # ACME: active, new (renewal already bought), lapsed, dropped
FALSE = {"false", "no", "n", "0", "inactive", "lapsed", "dropped", "f"}  # lapsed = expired; dropped = ended early


def bucket(days, buckets):
    for i, (_, lo, hi) in enumerate(buckets):
        if lo <= days <= hi:
            return i
    return None


def parse_date(v):
    """Constant Contact date custom fields arrive as YYYY-MM-DD, MM/DD/YYYY, or ISO datetimes."""
    if not v:
        return None
    s = str(v).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
        if not m:
            return None
        mo, d, y = map(int, m.groups())
    try:
        return dt.date(y, mo, d)
    except ValueError:
        return None


class Insights:
    COUNTERS = (
        "c", "visit_month", "visit_day", "visit_dow", "purchase_month", "purchase_dow",
        "recency", "lead_days", "lead_month_bucket", "lead_region_days", "ticket_type",
        "active_value", "level_all", "level_active", "exp_month_all", "exp_month_active",
        "exp_bucket", "level_exp_month", "member_region", "member_sources", "member_visit",
    )

    def __init__(self, icfg: dict, now: dt.datetime):
        self.cfg = icfg or {}
        self.today = now.date()
        for k in self.COUNTERS:
            setattr(self, k, collections.Counter())

    # -- checkpoint support ----------------------------------------------------
    def to_dict(self):
        return {k: dict(getattr(self, k)) for k in self.COUNTERS}

    @classmethod
    def from_dict(cls, d, icfg, now):
        ins = cls(icfg, now)
        for k in cls.COUNTERS:
            setattr(ins, k, collections.Counter(d.get(k, {})))
        return ins

    # -- per contact -----------------------------------------------------------
    def add(self, fields: dict, state, src_keys):
        f, c, today = self.cfg, self.c, self.today
        home = f.get("home_state", "ND")
        region = "home" if state == home else ("elsewhere" if state else "unknown")

        visit = parse_date(fields.get(f.get("visit_date_field")))
        purchase = parse_date(fields.get(f.get("purchase_date_field")))
        exp = parse_date(fields.get(f.get("membership_expiration_field")))
        level = (fields.get(f.get("membership_level_field")) or "").strip()
        active_raw = str(fields.get(f.get("active_member_field")) or "").strip()
        ticket = (fields.get(f.get("ticket_type_field")) or "").strip()

        if visit:
            c["has_visit"] += 1
            self.visit_month[visit.strftime("%Y-%m")] += 1
            self.visit_dow[str(visit.weekday())] += 1
            ahead = (visit - today).days
            if ahead >= 0:
                c["visit_upcoming"] += 1
                if ahead <= f.get("upcoming_days", 120):
                    self.visit_day[visit.isoformat()] += 1
                if ahead <= 7:
                    c["visit_next_7"] += 1
                if ahead <= 30:
                    c["visit_next_30"] += 1
        if purchase:
            c["has_purchase"] += 1
            self.purchase_month[purchase.strftime("%Y-%m")] += 1
            self.purchase_dow[str(purchase.weekday())] += 1
            since = (today - purchase).days
            if since >= 0:
                self.recency[str(bucket(since, RECENCY_BUCKETS))] += 1
        if visit and purchase:
            lead = (visit - purchase).days
            if lead < 0:
                c["lead_negative"] += 1          # visit before purchase: an older visit, or a sync issue
            elif lead > 730:
                c["lead_outlier"] += 1
            else:
                c["lead_measured"] += 1
                self.lead_days[str(min(lead, 400))] += 1
                b = bucket(lead, LEAD_BUCKETS)
                self.lead_month_bucket[f"{visit.strftime('%Y-%m')}|{b}"] += 1
                self.lead_region_days[f"{region}|{min(lead, 400)}"] += 1
        if ticket:
            self.ticket_type[ticket] += 1

        # membership
        if active_raw:
            self.active_value[active_raw.lower()] += 1
        has_member_data = bool(level or exp or active_raw)
        if not has_member_data:
            return
        c["member_any"] += 1
        is_active = active_raw.lower() in TRUE if active_raw else (exp is not None and exp >= today)
        if active_raw.lower() in FALSE and exp and exp >= today:
            c["member_flag_conflict"] += 1       # flagged inactive but expiration still ahead
        if level:
            self.level_all[level] += 1
        if exp:
            c["member_has_exp"] += 1
            self.exp_month_all[exp.strftime("%Y-%m")] += 1
            self.exp_bucket[str(bucket((exp - today).days, EXP_BUCKETS))] += 1
        if is_active:
            c["member_active"] += 1
            if level:
                self.level_active[level] += 1
            if exp:
                self.exp_month_active[exp.strftime("%Y-%m")] += 1
                self.level_exp_month[f"{level or 'No level'}|{exp.strftime('%Y-%m')}"] += 1
            self.member_region[region] += 1
            for k in src_keys:
                self.member_sources[k] += 1
            if visit and visit >= today:
                self.member_visit["upcoming"] += 1
            elif visit:
                self.member_visit["past_only"] += 1
            else:
                self.member_visit["none"] += 1
            if purchase and (today - purchase).days <= 365:
                c["member_purchase_365"] += 1

    # -- output ----------------------------------------------------------------
    def build(self, n_contacts: int, source_labels: dict) -> dict:
        min_cell = self.cfg.get("min_cell", 3)

        def fold(counter, top=20):
            items = sorted(counter.items(), key=lambda kv: -kv[1])
            out, other = [], 0
            for k, v in items:
                if v < min_cell or len(out) >= top:
                    other += v
                else:
                    out.append({"label": k, "count": v})
            if other:
                out.append({"label": "Other", "count": other})
            return out

        def series(counter):
            return [{"key": k, "count": v} for k, v in sorted(counter.items())]

        def days_stats(counter):
            vals = []
            for k, v in counter.items():
                vals.extend([int(k)] * v)
            if not vals:
                return None
            vals.sort()
            q = lambda p: vals[min(len(vals) - 1, int(p * (len(vals) - 1) + 0.5))]
            return {"n": len(vals), "median": statistics.median(vals), "mean": round(statistics.fmean(vals), 1),
                    "p25": q(0.25), "p75": q(0.75), "p90": q(0.9),
                    "within_7": sum(1 for x in vals if x <= 7), "within_30": sum(1 for x in vals if x <= 30)}

        lead_hist = [0] * len(LEAD_BUCKETS)
        for k, v in self.lead_days.items():
            lead_hist[bucket(int(k), LEAD_BUCKETS)] += v

        by_month = collections.defaultdict(lambda: [0] * len(LEAD_BUCKETS))
        for k, v in self.lead_month_bucket.items():
            m, b = k.split("|")
            by_month[m][int(b)] += v
        regions = {}
        for reg in ("home", "elsewhere", "unknown"):
            cnt = collections.Counter({k.split("|")[1]: v for k, v in self.lead_region_days.items() if k.startswith(reg + "|")})
            hist = [0] * len(LEAD_BUCKETS)
            for k, v in cnt.items():
                hist[bucket(int(k), LEAD_BUCKETS)] += v
            regions[reg] = {"stats": days_stats(cnt), "hist": hist}

        # level x expiration month, with small cells folded per level
        lvl_exp = collections.defaultdict(dict)
        for k, v in self.level_exp_month.items():
            lvl, m = k.rsplit("|", 1)
            lvl_exp[lvl][m] = v
        kept_levels = {x["label"] for x in fold(self.level_active)} - {"Other"}
        level_by_exp = collections.defaultdict(collections.Counter)
        for lvl, months in lvl_exp.items():
            for m, v in months.items():
                level_by_exp[lvl if lvl in kept_levels else "Other"][m] += v

        c = self.c
        return {
            "fields": {k: v for k, v in self.cfg.items() if k.endswith("_field")},
            "home_state": self.cfg.get("home_state", "ND"),
            "today": self.today.isoformat(),
            "min_cell": min_cell,
            "coverage": {
                "contacts": n_contacts, "has_visit": c["has_visit"], "has_purchase": c["has_purchase"],
                "lead_measured": c["lead_measured"], "lead_negative": c["lead_negative"], "lead_outlier": c["lead_outlier"],
                "visit_upcoming": c["visit_upcoming"], "visit_next_7": c["visit_next_7"], "visit_next_30": c["visit_next_30"],
            },
            "lead_time": {
                "buckets": [b[0] for b in LEAD_BUCKETS], "hist": lead_hist,
                "stats": days_stats(self.lead_days),
                "by_visit_month": [{"month": m, "hist": h} for m, h in sorted(by_month.items())],
                "by_region": regions,
            },
            "visits": {
                "by_month": series(self.visit_month),
                "upcoming_by_day": series(self.visit_day),
                "by_weekday": [self.visit_dow.get(str(i), 0) for i in range(7)],
            },
            "purchases": {
                "by_month": series(self.purchase_month),
                "by_weekday": [self.purchase_dow.get(str(i), 0) for i in range(7)],
                "recency": {"buckets": [b[0] for b in RECENCY_BUCKETS],
                            "counts": [self.recency.get(str(i), 0) for i in range(len(RECENCY_BUCKETS))]},
            },
            "ticket_types": fold(self.ticket_type),
            "membership": {
                "contacts_with_member_data": c["member_any"],
                "active": c["member_active"],
                "active_flag_values": fold(self.active_value, top=6),
                "flag_conflicts": c["member_flag_conflict"],
                "has_expiration": c["member_has_exp"],
                "levels_active": fold(self.level_active),
                "levels_all": fold(self.level_all),
                "expiration_by_month_active": series(self.exp_month_active),
                "expiration_by_month_all": series(self.exp_month_all),
                "expiration_buckets": {"buckets": [b[0] for b in EXP_BUCKETS],
                                       "counts": [self.exp_bucket.get(str(i), 0) for i in range(len(EXP_BUCKETS))]},
                "level_by_expiration_month": {lvl: dict(sorted(ms.items())) for lvl, ms in level_by_exp.items()},
                "region": dict(self.member_region),
                "sources": [{"key": k, "label": source_labels.get(k, k), "count": v} for k, v in self.member_sources.most_common()],
                "visit": dict(self.member_visit),
                "purchased_last_365": c["member_purchase_365"],
            },
            "weekdays": WEEKDAYS,
        }
