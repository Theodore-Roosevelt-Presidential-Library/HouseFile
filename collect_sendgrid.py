#!/usr/bin/env python3
"""
HouseFile transactional-email collector (SendGrid dynamic templates).

The ticket and membership confirmations people get from ACME are SendGrid
dynamic templates. For each template listed under `transactional:` in
config.yml this script reads the template's ACTIVE version from the SendGrid
v3 API (name, version, subject, HTML, last edited) and writes:

    docs/data/transactional.json          templates -> versions (metadata only)
    docs/data/transactional/<slug>.html   the raw Handlebars template

The dashboard renders each template in the browser with the fake sample
orders in config.yml (`transactional.samples`), so a ticket order and a
membership order can be previewed from the one template.

PRIVACY
-------
Only templates are read. SendGrid's stored "test data" for a version is never
requested or written, because it can hold a real order pasted in for testing.
No message activity, recipients or contact records are read. The same
email-address guard as the automations collector runs before anything is
written.

Needs a SendGrid API key with *Template Engine: Read Access* only, in the
SENDGRID_API_KEY environment variable (a GitHub Actions secret). Without it the
script leaves the last snapshot in place and exits cleanly.

Usage:
    python collect_sendgrid.py            # refresh from the API
    python collect_sendgrid.py --check    # privacy-check docs/data (no API calls)
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parent
API = "https://api.sendgrid.com/v3"
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "template"


def disallowed(tcfg: dict, blobs) -> list:
    ok_addr = {a.lower() for a in tcfg.get("allowed_emails", [])}
    ok_dom = {d.lower() for d in tcfg.get("allowed_email_domains", [])}
    found = {m for b in blobs for m in EMAIL_RE.findall(b)}
    return sorted(m for m in found
                  if m.lower() not in ok_addr and m.split("@")[1].lower() not in ok_dom)


def check(cfg: dict, out: Path) -> int:
    tcfg = cfg.get("transactional") or {}
    f = out / "transactional.json"
    if not f.exists():
        return 0
    blobs = [f.read_text()] + [h.read_text() for h in (out / "transactional").glob("*.html")]
    bad = disallowed(tcfg, blobs)
    if bad:
        print(f"::error::{len(bad)} unexpected email address(es) in SendGrid template data")
        return 1
    print("SendGrid template privacy check passed.")
    return 0


def collect(cfg: dict, key: str, out: Path) -> int:
    tcfg = cfg.get("transactional") or {}
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {key}"
    rows, pages = [], {}
    for t in tcfg.get("templates", []):
        tid = t["template_id"]
        r = s.get(f"{API}/templates/{tid}", timeout=30)
        if r.status_code != 200:
            print(f"  ! {t.get('label', tid)}: HTTP {r.status_code}", file=sys.stderr)
            continue
        tpl = r.json()
        versions = tpl.get("versions") or []
        active = next((v for v in versions if v.get("active") == 1), None)
        if not active:
            print(f"  ! {tpl.get('name')}: no active version", file=sys.stderr)
            continue
        # The template's list entry has no HTML; the version endpoint does.
        vr = s.get(f"{API}/templates/{tid}/versions/{active['id']}", timeout=30)
        if vr.status_code != 200:
            print(f"  ! {tpl.get('name')}: version HTTP {vr.status_code}", file=sys.stderr)
            continue
        v = vr.json()
        slug = t.get("slug") or slugify(tpl.get("name") or tid)
        pages[f"{slug}.html"] = v.get("html_content") or ""
        rows.append({
            "slug": slug,
            "label": t.get("label") or tpl.get("name"),
            "template_name": tpl.get("name"),
            "sent_by": t.get("sent_by", ""),
            "trigger": t.get("trigger", ""),
            "description": t.get("description", ""),
            "variants": t.get("variants") or [],
            "version_name": v.get("name"),
            "editor": v.get("editor"),
            "subject": v.get("subject") or "",
            "updated_at": v.get("updated_at"),
            "html": f"data/transactional/{slug}.html",
            "other_versions": len(versions) - 1,
        })
        print(f"  {tpl.get('name')}: active version {v.get('name')!r}, edited {v.get('updated_at')}")

    if not rows:
        print("No SendGrid templates read; keeping the last snapshot.", file=sys.stderr)
        return 0
    data = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "sendgrid",
        "samples": tcfg.get("samples") or {},
        "templates": rows,
    }
    bad = disallowed(tcfg, [json.dumps(data)] + list(pages.values()))
    if bad:
        # Don't fail the whole daily run over a template: keep the last snapshot.
        print(f"::error::SendGrid privacy check failed: {len(bad)} unexpected email address(es); "
              "not publishing. Add the address to transactional.allowed_emails if it is the Library's own.")
        return 0
    d = out / "transactional"
    d.mkdir(parents=True, exist_ok=True)
    for name, html in pages.items():
        (d / name).write_text(html)
    for f in d.glob("*.html"):
        if f.name not in pages:
            f.unlink()
    (out / "transactional.json").write_text(json.dumps(data, indent=1))
    print(f"Wrote {out / 'transactional.json'} ({len(rows)} template(s))")
    return 0


def write_samples(cfg: dict, out: Path) -> None:
    """Keep the fake sample orders in transactional.json in step with config.yml
    without calling the API (after editing samples or labels)."""
    f = out / "transactional.json"
    tcfg = cfg.get("transactional") or {}
    if f.exists():
        data = json.loads(f.read_text())
    else:
        # First run without an API key: list the templates so the dashboard can say
        # what is coming; previews appear after the first API refresh.
        data = {"generated_at": None, "source": "config", "templates": [
            {"slug": t.get("slug") or slugify(t.get("label", t["template_id"])),
             "label": t.get("label"), "template_name": t.get("label"), "html": None}
            for t in tcfg.get("templates", [])]}
    data["samples"] = tcfg.get("samples") or {}
    by_id = {t["template_id"]: t for t in tcfg.get("templates", [])}
    for row in data.get("templates", []):
        t = next((x for x in by_id.values() if (x.get("slug") or "") == row["slug"]), None)
        if t:
            for k in ("label", "sent_by", "trigger", "description", "variants"):
                if k in t:
                    row[k] = t[k]
    f.write_text(json.dumps(data, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(ROOT / "config.yml"))
    ap.add_argument("--out", default=str(ROOT / "docs" / "data"))
    ap.add_argument("--check", action="store_true", help="privacy-check the files on disk and exit")
    ap.add_argument("--offline", action="store_true", help="refresh samples and labels from config.yml only")
    args = ap.parse_args()
    cfg = yaml.safe_load(Path(args.config).read_text())
    out = Path(args.out)
    if args.check:
        return check(cfg, out)
    if not cfg.get("transactional"):
        print("No transactional templates configured; nothing to do.")
        return 0
    if args.offline:
        write_samples(cfg, out)
        return 0
    key = os.environ.get("SENDGRID_API_KEY", "").strip()
    if not key:
        print("::warning::SENDGRID_API_KEY is not set; SendGrid templates not refreshed.")
        write_samples(cfg, out)
        return 0
    return collect(cfg, key, out)


if __name__ == "__main__":
    sys.exit(main())
