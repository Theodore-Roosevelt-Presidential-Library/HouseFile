# HouseFile

A daily-updating, privacy-safe dashboard of the email house file in Constant Contact.

**Live:** https://housefile.labs.trlibrary.com

The dashboard shows aggregate numbers only: file size, mailability, field completeness, per-source-system totals and sync freshness, public newsletter list sizes, a state/ZIP map, and growth trends. **No names, email addresses, street addresses, phone numbers, or record IDs are ever collected, stored, committed, or displayed.**

## How it works

```
Constant Contact API ──► collect.py (in memory, aggregates only) ──► docs/data/stats.json
                                                                       docs/data/history.json
GitHub Actions runs collect.py every morning, commits the two JSON files,
and GitHub Pages serves docs/ at housefile.labs.trlibrary.com.
```

- `collect.py` — pages through every contact, tallies counters, writes `docs/data/stats.json` and appends a daily row to `docs/data/history.json`. A privacy guard in the workflow fails the run if anything resembling an email, phone number, or record ID appears in the output.
- `config.yml` — everything specific to this account: source systems and how to recognise them, the public newsletter lists, address-fallback custom fields, ZIP suppression threshold. Another organisation can reuse this repo by editing this file only.
- `docs/index.html` — the static dashboard. Reads `data/stats.json`; no build step.
- `docs/data/zip_centroids.json` — public ZIP-code centroids from [GeoNames](https://www.geonames.org/) (CC BY 4.0). Reference data, not contact data. Rebuild with `python collect.py --fetch-centroids`.
- `authorize.py` — one-time OAuth helper that produces the refresh token.
- `fill_state.py` — data-quality fixer: for contacts with a US ZIP but no state, derives the state from the ZIP table and writes it to the contact's standard Constant Contact address (never to custom fields, so a nightly sync can't undo it). Dry run by default; `--apply` writes, `--limit N` for a cautious batch, `--checkpoint` to resume. Run it by hand after reviewing the "ZIP ↔ state consistency" panel.

### Search engines

The page is intentionally not indexable: `docs/robots.txt` disallows everything and `index.html` carries `noindex, nofollow, noarchive, nosnippet`. Anyone with the URL can still open it.

### Source attribution

A contact is attributed to a source when **any** rule in its `match` block hits: membership in a list of that name, the `Source System` custom field equals the value, or the contact carries any custom field whose label starts with the given prefix (e.g. `Acme - `). "Last record created" per source is what tells you a nightly sync is still landing. A source with no matches (Trailblazer today) shows as *Not yet syncing* until data arrives — add the list name or field prefix to `config.yml` once the sync exists.

### Completeness rules

- **Name** — first *and* last name present.
- **ZIP / State / Full address** — standard Constant Contact street address first; if empty, the custom fields listed under `address_fallbacks` (ACME writes billing addresses there).
- **State (incl. inferred from ZIP)** — adds contacts whose state is blank but whose US ZIP resolves to one; the map uses this. Controlled by `geo.infer_state_from_zip`.
- **Full address** requires street, city, state and ZIP.

### Privacy design

- Contacts are only ever held in memory inside the collector process.
- Output contains counts, percentages, timestamps of the newest record, state and ZIP tallies, and email-domain tallies.
- ZIPs with fewer than `geo.min_zip_count` contacts (default 3) are folded into the state total; ZIPs with fewer than twice that have their last two digits masked.
- `include_all_lists` is `false` by default so internal segment names (donor tiers, staff lists) stay off the public page.
- The optional `--checkpoint` file holds the same counters, never records, and is gitignored.

## Setup

1. **Developer app.** In the [Constant Contact developer portal](https://developer.constantcontact.com/) create an app with scopes `contact_data` and `offline_access`, redirect URI `http://localhost:8080/callback`.
2. **Local `.env`.** `cp .env.example .env`, fill in `CC_CLIENT_ID`, `CC_CLIENT_SECRET`, `CC_REDIRECT_URI`.
3. **Authorize once.** `pip install -r requirements.txt && python authorize.py` — writes `CC_REFRESH_TOKEN` into `.env`.
4. **Repository secrets** (Settings → Secrets and variables → Actions): `CC_CLIENT_ID`, `CC_CLIENT_SECRET`, `CC_REFRESH_TOKEN`. Optionally `ADMIN_TOKEN` (a fine-grained PAT with *Secrets: read and write* on this repo) so the workflow can store a rotated refresh token by itself.
5. **GitHub Pages** (Settings → Pages): Source *Deploy from a branch*, branch `main`, folder `/docs`. Custom domain `housefile.labs.trlibrary.com` (the `docs/CNAME` file is already there); add a DNS `CNAME` record for `housefile.labs` pointing to `theodore-roosevelt-presidential-library.github.io`, then tick *Enforce HTTPS* once the certificate issues.
6. **First run.** Actions → *Update house file stats* → *Run workflow*. It then runs daily at 05:17 Mountain.

## Running locally

```bash
python collect.py --dry-run                 # print a summary, write nothing
python collect.py                           # write docs/data/stats.json + history.json
python -m http.server -d docs 8000          # view at http://localhost:8000
```

If your shell has a short time limit, run in resumable chunks:
`python collect.py --checkpoint ~/ckpt.json --max-seconds 150` (repeat until it finishes).

## Reusing for another organisation

Fork, edit `config.yml` (title, sources, public lists, fallback fields), replace `docs/CNAME`, add the three secrets. Nothing else references TRPL.

## License

MIT — see [LICENSE](LICENSE). ZIP centroid data © GeoNames, CC BY 4.0.
