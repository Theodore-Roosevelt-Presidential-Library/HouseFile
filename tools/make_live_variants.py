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
    # Post-visit series, uploaded 2026-10-21.
    "proposals/img/visit-t-plus-2-thank-you-header.jpg": "https://files.constantcontact.com/d94543ed901/3203f1cf-2282-4dab-987c-8a1b35ec12ce.jpg",
    "proposals/img/visit-t-plus-7-keep-exploring-header.jpg": "https://files.constantcontact.com/d94543ed901/841f3c3d-6895-4b63-a8f6-7ac98c87df37.jpg",
    "proposals/img/visit-t-plus-14-shop-header.jpg": "https://files.constantcontact.com/d94543ed901/25ce2d76-f8c0-48bc-8d13-cdd66ed8a8c9.jpg",
    "proposals/img/visit-t-plus-30-host-an-event-header.jpg": "https://files.constantcontact.com/d94543ed901/3af8f475-5a5c-410c-8f30-11d34e3f01fd.jpg",
    "proposals/img/visit-t-plus-60-come-back-header.jpg": "https://files.constantcontact.com/d94543ed901/22c9df38-50b7-4885-b437-bd3b7602679f.jpg",
    "proposals/img/pv-come-back-events.jpg": "https://files.constantcontact.com/d94543ed901/003b0f29-1881-48f6-8c84-27efb9c5f3d7.jpg",
    "proposals/img/pv-come-back-tours.jpg": "https://files.constantcontact.com/d94543ed901/acf0ad1a-dd79-4966-ba87-5ec6763800bb.jpg",
    "proposals/img/pv-events-galleries.jpg": "https://files.constantcontact.com/d94543ed901/869fa03b-9631-474d-9c52-b3ec2e0a929a.jpg",
    "proposals/img/pv-events-overlook-wide.jpg": "https://files.constantcontact.com/d94543ed901/5b016321-c2c5-4d6f-a467-b86bb0389f41.jpg",
    "proposals/img/pv-events-terrace.jpg": "https://files.constantcontact.com/d94543ed901/5c8ca671-ddd2-4e5d-8553-4a77f7bbca5f.jpg",
    "proposals/img/pv-quiz-family.jpg": "https://files.constantcontact.com/d94543ed901/de111365-7965-407f-bf2b-fc37c26fb409.jpg",
    "proposals/img/pv-quiz-myths.jpg": "https://files.constantcontact.com/d94543ed901/7ba41e53-1564-49ca-97af-3292f37216ef.jpg",
    "proposals/img/pv-shop-arena-tee.jpg": "https://files.constantcontact.com/d94543ed901/1ee56ff3-26a8-4b62-b6a0-465262894e0f.jpg",
    "proposals/img/pv-shop-backpack.jpg": "https://files.constantcontact.com/d94543ed901/65765f89-7e40-4ed7-b3b4-8ff604f013e1.jpg",
    "proposals/img/pv-shop-bully-hat.jpg": "https://files.constantcontact.com/d94543ed901/f2167526-c416-43d5-9bde-71b911b7b12c.jpg",
    "proposals/img/pv-shop-journal.jpg": "https://files.constantcontact.com/d94543ed901/d1eccedd-ca33-4d9d-b1c9-f490589f6096.jpg",
    "proposals/img/pv-tr-badlands.jpg": "https://files.constantcontact.com/d94543ed901/f42884b6-8a24-4215-93d5-4880cb49ceef.jpg",
    "proposals/img/pv-tr-conservation.jpg": "https://files.constantcontact.com/d94543ed901/c5fd709a-807d-45cd-8ba2-c63276d1ee39.jpg",
    "proposals/img/pv-watch-videos.jpg": "https://files.constantcontact.com/d94543ed901/89af0c99-fdf0-4517-bf29-03bd0eab3ab7.jpg",
    "proposals/img/pv-watch-youtube.jpg": "https://files.constantcontact.com/d94543ed901/60697ae5-79ea-4c7d-9ce7-615258f8d644.jpg",
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


for slug in ["visit-t1-welcome", "visit-t-30-plan-ahead", "visit-t-3-know-before",
             "visit-t-plus-2-thank-you", "visit-t-plus-7-keep-exploring", "visit-t-plus-14-shop",
             "visit-t-plus-30-host-an-event", "visit-t-plus-60-come-back"]:
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
