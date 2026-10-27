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
- `docs/index.html` — the static dashboard, in two tabs: **House file** (reads `data/stats.json`) and **Automations** (reads `data/automations.json`; open directly with `#automations`). No build step.
- `docs/email.html?e=<slug>` — full preview of one automated email: the HTML in an iframe (desktop/mobile), subject, preheader, from name and address, the trigger and timing, send stats, every Constant Contact merge field it uses (editable sample values), and every link with its query-string data.
- `collect_automations.py` — refreshes the Automations tab. Runs inside `collect.py` after the contact stats, or on its own.
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

## Dates & members tab

Aggregates of the ACME date and membership fields that sync into Constant Contact (`insights:` in `config.yml` names the fields): booking lead time (next visit date minus last purchase date, overall, in-state vs out-of-state, and by visit month), upcoming visits by day, visits and purchases by weekday and month, purchase recency, latest ticket type, and membership (active members by level, expirations by month, the renewal calendar by level, where members live, whether they have a visit booked, overlap with other source systems). Computed in `insights.py` during the daily collector run; only counts are published, and category labels on fewer than `min_cell` contacts fold into "Other". Each contact carries only its latest order and next visit, so lead time describes each person's most recent booking. Open with `#dates`.

## Automations tab

Shows every Constant Contact automation path, grouped by flow (pre-visit, post-visit, membership) and ordered by when it sends relative to the trigger date, with a thumbnail of each email.

- **Where the data comes from.** Constant Contact's public API can read an automation's emails but not the path itself. So the trigger, timing, filters and flow of each path live under `automations:` in `config.yml`; the subject, sender, preheader, rendered HTML and send stats come from the API (`/emails/{campaign_id}`, `/emails/activities/{id}/previews`, `/reports/stats/email_campaign_activities/{id}`). When a path changes in Constant Contact, update its block in `config.yml`. A path's `campaign_id` is the ID in its URL (`…/pages/cjb/workflow-reporting/<campaign_id>`).
- **Sample contact.** Previews fill merge tags (`[[FIRSTNAME]]`, `[[custom.acme_-_recent_order_id]]`, …) with the fake contact in `automations.sample_contact` (Jane Doe). Viewers can edit the values on the preview page.
- **Privacy.** Constant Contact renders previews with the account's own name and contact email filled in. The collector swaps those back to merge tags using `/account/summary`, refuses to publish if it can't, and `python collect_automations.py --check` (run by the workflow's privacy guard) fails on any email address other than the senders, `allowed_emails`, or the sample contact's domain. No contact records are read.
- **Proposed automations.** To show the team an automation before it exists in Constant Contact, add a path to `config.yml` with `status: proposed` and a `proposal:` block (subject, preheader, sender, `html`, optional `notes`), and put the email's HTML in `docs/proposals/`. Then run `python collect_automations.py --offline` to rebuild `automations.json` without the API. Proposals show with a dashed **Proposed** badge and a review banner on the preview page; the nightly refresh never touches `docs/proposals/`. Build proposal emails in the [Newsletter Builder](https://newsletter.labs.trlibrary.com) (`tools/build_renew_proposals.mjs` scripts it for the RENEW series). When a proposal is built in Constant Contact, set its real `status` and `campaign_id` and delete the `proposal:` block.
- **Naming.** Paths follow `PROGRAM: T±timing Description` (`VISIT:` off the ACME visit date, `RENEW:` off the membership expiration date). See Outline: TRPL / Recurring Processes.
- **Scopes.** Needs `campaign_data` and `account_read` in addition to `contact_data`. After pulling this change, run `python authorize.py` once and update the `CC_REFRESH_TOKEN` secret. Until then the contact stats keep refreshing and the Automations tab shows the snapshot taken on 2026-10-20.

## Setup

1. **Developer app.** In the [Constant Contact developer portal](https://developer.constantcontact.com/) create an app with scopes `contact_data`, `campaign_data`, `account_read` and `offline_access`, redirect URI `http://localhost:8080/callback`.
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

## Confirmation emails (SendGrid)

The Automations tab also shows the emails sent through SendGrid dynamic
templates rather than Constant Contact: the ACME order confirmation that ticket
and membership buyers get, and the Trailblazer Takeaway the Cortina visitor
system sends after a visit.
`collect_sendgrid.py` runs in the daily job and reads each template listed under
`transactional:` in `config.yml` (active version only: HTML, subject, version
name, last edited). It needs a SendGrid API key with **Template Engine: Read
Access** and nothing else, stored as the `SENDGRID_API_KEY` Actions secret;
without it the step warns and the dashboard lists the template without a
preview. SendGrid's stored test data is never read. Previews are rendered in the
browser (`docs/confirmation.html`) with the fake sample orders and fake visitor in `config.yml`.
