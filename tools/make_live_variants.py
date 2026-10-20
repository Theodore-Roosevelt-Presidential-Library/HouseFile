"""Turn a proposal email into the Constant Contact versions that go live.

Constant Contact's dynamic content only works in its drag-and-drop editor, so the live paths
use a Conditional split on "Acme - Is Active Member" instead, with one custom-code email per
branch. This writes, for each email, a member and a non-member HTML file: the conditional rows
resolved for that branch, and preview image paths swapped for Constant Contact library URLs.

Usage: python tools/make_live_variants.py   (reads docs/proposals, writes docs/proposals/live)
"""
import re
from pathlib import Path

SRC = Path("docs/proposals")
OUT = SRC / "live"
OUT.mkdir(exist_ok=True)

# Uploaded to the Constant Contact library on 2026-10-20.
LIBRARY = {
    "proposals/img/visit-t1-welcome-header.jpg": "https://files.constantcontact.com/d94543ed901/e4907289-594f-4fb1-9225-4ce6cefb1c82.jpg",
    "proposals/img/visit-t-30-plan-ahead-header.jpg": "https://files.constantcontact.com/d94543ed901/98a8c368-b927-42cd-a239-cb0c930bce9d.jpg",
    "proposals/img/visit-t-3-know-before-header.jpg": "https://files.constantcontact.com/d94543ed901/d6b2c888-1fb6-4a39-a328-034a773784ce.jpg",
    "proposals/img/video-W9sq8PuGQVo-teaser.gif": "https://files.constantcontact.com/d94543ed901/3654075d-f4c7-4dab-a126-12f300eb3ba5.gif",
    "proposals/img/video-qrwdZmqFO5A-teaser.gif": "https://files.constantcontact.com/d94543ed901/23465662-c9d6-4af4-863c-533a4c336bae.gif",
    "proposals/img/video-yEEsRy7sdng.jpg": "https://files.constantcontact.com/d94543ed901/6d5b123c-3b40-4310-a2d0-3022d9acae27.jpg",
    "proposals/img/video-zRPJAdE-IBI.jpg": "https://files.constantcontact.com/d94543ed901/5585d129-3c85-4eed-855e-25358d9a9d79.jpg",
}
COND = re.compile(r"<!--cc:(if|else)\s+([^>]*?)-->([\s\S]*?)<!--cc:end-->")


def attrs(s):
    return dict(re.findall(r'(\w+)="([^"]*)"', s))


def resolve(html, values):
    hit = set()
    for kind, at, _ in COND.findall(html):
        a = attrs(at)
        if kind == "if" and values.get(a["tag"], "") in a.get("is", "").split("|"):
            hit.add(a["group"])

    def sub(m):
        kind, at, body = m.groups()
        a = attrs(at)
        if kind == "if":
            return body if values.get(a["tag"], "") in a.get("is", "").split("|") else ""
        return "" if a["group"] in hit else body
    return COND.sub(sub, html)


for slug in ["visit-t1-welcome", "visit-t-30-plan-ahead", "visit-t-3-know-before"]:
    html = (SRC / f"{slug}.html").read_text()
    for rel, url in LIBRARY.items():
        html = html.replace(rel, url)
    left = re.findall(r'src="(?!https://)[^"]+"', html)
    assert not left, f"{slug}: unhosted images {left}"
    for name, value in [("member", "active"), ("nonmember", "")]:
        out = resolve(html, {"custom.acme_-_is_active_member": value})
        assert "<!--cc:" not in out
        (OUT / f"{slug}-{name}.html").write_text(out)
        print(slug, name, len(out))
