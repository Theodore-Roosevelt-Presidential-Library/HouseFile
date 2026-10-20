// Builds the RENEW proposal emails with TRPL's own Newsletter Builder and Header Studio,
// so the HTML is exactly what the builder exports.
// Usage (from the repo root): node tools/build_renew_proposals.mjs docs/proposals [<photo-dir>]
// (omit <photo-dir> to rebuild the copy and keep the existing header images)
// <photo-dir> holds the header photos named in HEADERS below (downloaded from trlibrary.com,
// resized to ~2400 px wide). Each email gets its own photo and plaque colour.
// then: python collect_automations.py --offline
import { chromium } from 'playwright';
import fs from 'fs';

const OUT = process.argv[2];               // .../docs/proposals
const IMG = 'proposals/img/';              // relative to docs/, resolves inside the dashboard
fs.mkdirSync(OUT + '/img', { recursive: true });

const RENEW_URL = 'https://buy.acmeticketing.com/auth/613/members?ref=%2Fmembership%2F613%2Fprofile';
const LEVELS_URL = 'https://www.trlibrary.com/membership';
const MAIL = '<a href="mailto:membership@trlibrary.com">membership@trlibrary.com</a>';
const GREET = 'Dear [[FIRSTNAME OR "Friend of the Library"]],';
const CARD = '<b>Membership number:</b> [[custom.acme_-_membership_number]]<br><b>Level:</b> [[custom.acme_-_membership_level]]<br><b>Expires:</b> [[custom.acme_-_membership_expiration_date]]';
const NOTE = 'You are receiving this email because you are a member of the Theodore Roosevelt Presidential Library.';

// One Header Studio banner per email. Brand rules (TRPL Brand Guidelines):
//  - Wordmark only in the approved background/wordmark pairings (p.13; black on Sand, p.6):
//    Dark Gray/White, Night Sky/White, Dark Forest/White, Bright Forest/Black, Deep Orange/Black,
//    Sand/Black. Not Deep Orange/White, not Dark Gray/Sand.
//  - Clear space of 2x the "T" stem on every side (p.37). The Header Studio plaque gives
//    >= 2x on all four sides, so the wordmark always sits on its plaque, never bare on a photo.
//  - Minimum height 0.75" (p.37): keep plaque scale >= 0.6.
//  - Framing keeps faces and people out from under the plaque.
const HEADERS = {
  'renew-t-60-renewal-notice':       { photo: 'TRPL-Boardwalk_Threefold-016.jpg', opts: { plaque: '#1B4532', mark: '#FFFFFF' } },            // Dark Forest / White · cyclists above the badlands
  'renew-t-30-reminder':             { photo: 'Theodore_Roosevelt_Presidential_Library-088_half-size.jpg', opts: { plaque: '#E7805D', mark: '#000000' } }, // Deep Orange / Black · the Library Shop
  'renew-t-7-last-week':             { photo: 'TRPL-MainGuest_Threefold-003.jpg', opts: { plaque: '#092A4D', mark: '#FFFFFF', panY: 400 } },            // Night Sky / White · lobby timber
  'renew-t-plus-7-membership-ended': { photo: 'TRPL-ElkhornCampfire_Threefold-008.jpg', opts: { plaque: '#25282A', mark: '#FFFFFF', yoff: -6 } }, // Dark Gray / White · Elkhorn campfire
  'renew-t-plus-45-last-note':       { photo: 'building-clean-june.jpg', opts: { plaque: '#D1CCBD', mark: '#000000', scale: 0.6, yoff: -18, panY: 160 } }, // Sand / Black · the Library on the prairie
};
const headerFor = slug => ({ type: 'header', props: { src: IMG + slug + '-header.jpg', alt: 'Theodore Roosevelt Presidential Library', href: 'https://www.trlibrary.com' } });
const footer = { type: 'footer', props: { note: NOTE, contactLabel: 'Membership Questions', contactUrl: 'mailto:membership@trlibrary.com' } };
const h = t => ({ type: 'heading', props: { text: t, align: 'center' } });
const p = (html, align = 'left') => ({ type: 'text', props: { html, align } });
const btn = (label, href = RENEW_URL) => ({ type: 'button', props: { label, href } });
const img = (src, alt) => ({ type: 'image', props: { src: IMG + src, alt, href: '', caption: '' } });
const div = { type: 'divider', props: {} };

// ---- Membership facts (access.trlibrary.com/membership/613/join, checked 2026-10-20) ----
// Every level: 1 year, Annual Auto-Renew (10% off) or 2 Years (10% off).
// Founding Membership (Jan 1 - Jul 31, 2026, valid through Dec 31, 2026) is a once-only
// designation: member + one additional adult + children under 13. Founding Members keep the
// designation and their place on the Digital Donor Wall permanently (Matt, 2026-10-20).
const LEVELS = {
  'Individual':   { price: '$50',    auto: '$45',     two: '$90',    covers: 'free admission for you on every visit',
                    up: 'Dual is $95 and adds a guest on every visit, so a friend or partner comes in free too.' },
  'Dual':         { price: '$95',    auto: '$85.50',  two: '$171',   covers: 'free admission for you and a guest on every visit',
                    up: 'Family is $175 and covers you and three guests, plus family programming.' },
  'Family':       { price: '$175',   auto: '$157.50', two: '$315',   covers: 'free admission for you and three guests, plus family programming',
                    up: 'Contributing is $250 and covers you and five guests, with a commemorative gift.' },
  'Contributing': { price: '$250',   auto: '$225',    two: '$450',   covers: 'free admission for you and five guests, family programming and a commemorative gift',
                    up: 'Patron is $500. It keeps the same six admissions and doubles your support of the Library\'s programs.' },
  'Patron':       { price: '$500',   auto: '$450',    two: '$900',   covers: 'free admission for you and five guests, family programming and a commemorative gift',
                    up: 'Donor Patron is $1,000. It covers you and seven guests and adds your name to the Library\'s Digital Donor Wall.' },
  'Donor Patron': { price: '$1,000', auto: '$900',    two: '$1,800', covers: 'free admission for you and seven guests, family programming, a commemorative gift and your name on the Digital Donor Wall',
                    up: null },
};
const FOUNDING = 'Founding Membership';
const STANDARD = Object.keys(LEVELS);

// ---- Conditional rows (Constant Contact dynamic content) ----
// cond(block, spec) marks a builder block; after export its row is wrapped in
// <!--cc:if …-->…<!--cc:end--> or <!--cc:else …-->…<!--cc:end--> comments, which the dashboard
// preview reads and email clients ignore. In Constant Contact each becomes a row with a
// display condition, built in the drag-and-drop editor.
const LEVEL_F = { tag: 'custom.acme_-_membership_level', field: 'Acme - Membership Level', label: 'Membership level', other: 'No level on file' };
const TICKET_F = { tag: 'custom.acme_-_ticket_type_last', field: 'Acme - Ticket Type (Last)', label: 'Last ticket', other: 'Not a member ticket' };
let G = 0;
const cond = (block, spec) => Object.assign(block, { cond: spec });
// One row per value (or value list), plus a default row. variants: [[isList, block], …], fallback block or null.
function byField(F, variants, fallback) {
  const group = 'g' + (++G);
  const out = variants.map(([is, b]) => cond(b, Object.assign({ group, kind: 'if', is: [].concat(is).join('|') }, F)));
  if (fallback) out.push(cond(fallback, Object.assign({ group, kind: 'else' }, F)));
  return out;
}
const byLevel = (fn, fallback) => byField(LEVEL_F, [FOUNDING, ...STANDARD].map(l => [l, fn(l)]).filter(([, b]) => b), fallback);
const MEMBER_TICKETS = ['Member Adult', 'Member Youth'];

const EXP = '[[custom.acme_-_membership_expiration_date]]';
const VISIT_URL = 'https://www.trlibrary.com/visit';

// The builder's text block strips <table>/<div>, so raw HTML rides through as a token and is
// swapped back in after export.
const RAW = [];
const raw = html => `ZQR${RAW.push(html) - 1}QZ`;
// Price tables: plain inline-styled HTML tables, safe in email clients and in a CC text block.
const TH = "padding:8px 6px;border:1px solid #D1D1D1;background:#F4F2EC;font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;text-align:center;";
const TD = "padding:10px 6px 2px;border:1px solid #D1D1D1;border-bottom:0;text-align:center;font-size:22px;font-weight:bold;line-height:1.2;";
const TN = "padding:0 6px 10px;border:1px solid #D1D1D1;border-top:0;text-align:center;font-size:13px;line-height:1.35;color:#52514e;";
const TL = "padding:8px 10px;border:1px solid #D1D1D1;text-align:left;font-size:15px;line-height:1.35;";
const TP = "padding:8px 6px;border:1px solid #D1D1D1;text-align:center;font-size:16px;font-weight:bold;";
const TABLE = '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:10px 0 0;">';
const priceLine = (l, verb = 'Renew') => {
  const x = LEVELS[l];
  return raw(`<div style="text-align:center;"><b>${verb} at ${l}</b>: ${x.covers}.</div>` + TABLE
    + `<tr><td style="${TH}">1 year</td><td style="${TH}">Auto-renew</td><td style="${TH}">2 years</td></tr>`
    + `<tr><td style="${TD}">${x.price}</td><td style="${TD}">${x.auto}</td><td style="${TD}">${x.two}</td></tr>`
    + `<tr><td style="${TN}">renew each year<br>yourself</td><td style="${TN}">a year, renews itself<br><b>save 10%</b></td><td style="${TN}">for two years<br><b>save 10%</b></td></tr>`
    + '</table>');
};
const foundingRow = l => `<tr><td style="${TL}"><b>${l}</b><br><span style="font-size:13px;color:#52514e;">${LEVELS[l].covers[0].toUpperCase() + LEVELS[l].covers.slice(1)}</span></td><td style="${TP}">${LEVELS[l].price}</td><td style="${TP}">${LEVELS[l].auto}</td><td style="${TP}">${LEVELS[l].two}</td></tr>`;
// Founding Members: lead with Contributing (keep them at the higher level); Dual and Family
// are the recovery option, offered from T-7 on and after the membership ends (Matt, 2026-10-20).
const FOUNDING_LEAD = 'Founding Membership covered you, one more adult and children under 13. <b>Contributing</b> keeps your whole party covered with room for more: free admission for you and five guests, family programming and a commemorative gift.'
  + raw('<div style="text-align:center;margin-top:10px;"><b>Recommended for Founding Members: Contributing</b></div>' + TABLE
    + `<tr><td style="${TH}">1 year</td><td style="${TH}">Auto-renew</td><td style="${TH}">2 years</td></tr>`
    + `<tr><td style="${TD}">${LEVELS.Contributing.price}</td><td style="${TD}">${LEVELS.Contributing.auto}</td><td style="${TD}">${LEVELS.Contributing.two}</td></tr>`
    + `<tr><td style="${TN}">renew each year<br>yourself</td><td style="${TN}">a year, renews itself<br><b>save 10%</b></td><td style="${TN}">for two years<br><b>save 10%</b></td></tr>`
    + '</table>');
const FOUNDING_LEAD_ONLY = FOUNDING_LEAD + `<br>Other levels start at $50. <a href="${LEVELS_URL}">Compare all levels</a>.`;
const FOUNDING_RECOVERY = '<b>Want a smaller membership this year?</b> You can stay on at Dual or Family and keep free admission, the member line and your member discounts:' + raw(TABLE
  + `<tr><td style="${TH}text-align:left;">Level</td><td style="${TH}">1 year</td><td style="${TH}">Auto-renew<br>save 10%</td><td style="${TH}">2 years<br>save 10%</td></tr>`
  + foundingRow('Family') + foundingRow('Dual') + '</table>');
const FOUNDING_BOTH = FOUNDING_LEAD + '<br><br>' + FOUNDING_RECOVERY;
const FOUNDING_KEEPS = 'Two things do not expire, whether or not you renew. <b>You are a Founding Member for good</b>, and <b>your name stays on the Library\'s Digital Donor Wall permanently</b>, in recognition of your early commitment.';

const CORE = '<ul><li><b>Free general admission</b> for the people your level covers, and <b>25% off</b> extra admission tickets</li>'
  + '<li><b>The member line</b> at the entrance and dedicated member support</li>'
  + '<li><b>10% off</b> in the Library Shop, online and onsite, and at Salt+Scoria (excluding alcohol)</li>'
  + '<li><b>Priority access</b> to select ticketed events and discounted tickets for programs and lectures</li>'
  + '<li><b>Member tours</b>, exhibition previews and member events</li>'
  + '<li><b>10% off gift memberships</b>, and the monthly member e-news</li></ul>';

const visitedRows = (short) => byField(TICKET_F, [[MEMBER_TICKETS, p(short
    ? 'Thank you for using your membership in Medora this year.'
    : 'Thank you for using your membership in Medora this year. Renew, and your free admission carries on into next year.')]],
  p(short
    ? `There is still time to use your free admission before ${EXP}. <a href="${VISIT_URL}">Plan a visit</a>.`
    : `If you have not made it to Medora yet, there is still time: your free admission, the member line and 10% off in the Library Shop and Salt+Scoria run through ${EXP}. <a href="${VISIT_URL}">Plan a visit</a>.`));

const STEPS = '<ol><li>Have your membership number ready. It is at the top of this email.</li><li>Select <b>Renew My Membership</b> and verify with your membership number and the primary cardholder\'s last name.</li><li>Choose your level and term: 1 year, auto-renew or 2 years. Your membership number stays the same.</li></ol>';

const emails = [
  {
    slug: 'renew-t-60-renewal-notice',
    title: 'RENEW: T-60 Renewal Notice',
    preheader: 'Your level, your renewal options, and 10% off with auto-renew or two years.',
    blocks: [
      'HEADER',
      ...byField(LEVEL_F, [[FOUNDING, h('Thank You, Founding Member')]], h('Another Year in the Arena')),
      p(CARD, 'center'),
      ...byField(LEVEL_F, [[FOUNDING, p(`${GREET}<br><br>You joined the Theodore Roosevelt Presidential Library in its founding year and helped open its doors. Founding Membership was a once-only offer for 2026, so it ends on ${EXP} and does not renew. To keep free admission and member benefits in 2027, continue at Contributing, the level that keeps your whole party covered.`)]],
        p(`${GREET}<br><br>Thank you for a year as a [[custom.acme_-_membership_level]] member of the Theodore Roosevelt Presidential Library. Your membership expires on ${EXP}. Renew now and every benefit carries on without a gap.`)),
      ...byField(LEVEL_F, [[FOUNDING, p(FOUNDING_KEEPS)]], null),
      ...visitedRows(false),
      div,
      ...byField(LEVEL_F, [[FOUNDING, h('Continue at Contributing')]], h('Your Renewal Options')),
      ...byLevel(l => p(l === FOUNDING ? FOUNDING_LEAD_ONLY : priceLine(l)),
        p('Every level is <b>10% off</b> with auto-renew or a two-year membership.', 'center')),
      p('<b>Auto-renew</b> takes care of next year for you. <b>Two years</b> covers your next two membership years in one step.', 'center'),
      btn('Renew My Membership'),
      ...byLevel(l => l === FOUNDING ? null : LEVELS[l].up
        ? p(`<b>Room for more people next year?</b> ${LEVELS[l].up} <a href="${LEVELS_URL}">Compare levels</a>.`, 'center')
        : p('Thank you for supporting the Library at its highest membership level.', 'center'), null),
      div,
      h('Every Membership Includes'),
      img('renew-campfire.jpg', 'A grandfather points out a detail to two children inside the Elkhorn Ranch cabin recreation'),
      p(CORE),
      div,
      h('How to Renew'),
      p(STEPS),
      p(`Questions about your membership? Write to ${MAIL}.`),
      footer,
    ],
  },
  {
    slug: 'renew-t-30-reminder',
    title: 'RENEW: T-30 Reminder',
    preheader: `Renew by ${EXP}: your level, your price, and 10% off with auto-renew or two years.`,
    blocks: [
      'HEADER',
      ...byField(LEVEL_F, [[FOUNDING, h('Your Founding Year Ends Soon')]], h('One Month to Go')),
      p(CARD, 'center'),
      ...byField(LEVEL_F, [[FOUNDING, p(`${GREET}<br><br>Your Founding Membership ends on ${EXP}. Continue at Contributing now and your free admission, the member line and your member discounts carry straight into 2027.`)]],
        p(`${GREET}<br><br>Your [[custom.acme_-_membership_level]] membership expires on ${EXP}. Renew in the next month and nothing lapses: same membership number, same benefits, no gap.`)),
      ...byField(LEVEL_F, [[FOUNDING, p(FOUNDING_KEEPS)]], null),
      ...visitedRows(false),
      div,
      ...byField(LEVEL_F, [[FOUNDING, h('Continue at Contributing')]], h('Your Renewal Options')),
      ...byLevel(l => p(l === FOUNDING ? FOUNDING_LEAD_ONLY : priceLine(l)),
        p('Every level is <b>10% off</b> with auto-renew or a two-year membership.', 'center')),
      p('<b>Auto-renew</b> means this is the last renewal email you need to read. <b>Two years</b> covers your next two membership years in one step.', 'center'),
      btn('Renew My Membership'),
      ...byLevel(l => l === FOUNDING ? null : LEVELS[l].up
        ? p(`<b>Room for more people next year?</b> ${LEVELS[l].up} <a href="${LEVELS_URL}">Compare levels</a>.`, 'center')
        : p('Thank you for supporting the Library at its highest membership level.', 'center'), null),
      div,
      h('What You Keep When You Renew'),
      img('renew-members.jpg', 'Members gather on the Library terrace outside the lobby'),
      p(CORE),
      div,
      h('How to Renew'),
      p(STEPS),
      p(`Questions? Write to ${MAIL}.`),
      footer,
    ],
  },
  {
    slug: 'renew-t-7-last-week',
    title: 'RENEW: T-7 Last Week',
    preheader: `Your member benefits end on ${EXP}.`,
    blocks: [
      'HEADER',
      h('One Week Left'),
      p(CARD, 'center'),
      ...byField(LEVEL_F, [[FOUNDING, p(`${GREET}<br><br>Your Founding Membership ends on ${EXP}. Renew this week and your free admission carries straight into 2027.`)]],
        p(`${GREET}<br><br>Your membership ends on ${EXP}. Renew this week and nothing changes: same membership number, same benefits, no gap.`)),
      ...byLevel(l => p(l === FOUNDING ? FOUNDING_BOTH : priceLine(l)), null),
      btn('Renew My Membership'),
      p(`Need a hand? Reply to this email or write to ${MAIL}, and the membership team will help.`),
      p('With gratitude,<br><b>The Membership Team</b><br>Theodore Roosevelt Presidential Library'),
      footer,
    ],
  },
  {
    slug: 'renew-t-plus-7-membership-ended',
    title: 'RENEW: T+7 Membership Ended',
    preheader: 'Rejoin at your level and your free admission and member benefits come right back.',
    blocks: [
      'HEADER',
      ...byField(LEVEL_F, [[FOUNDING, h('Still a Founding Member')]], h('Come Back to the Arena')),
      p(CARD, 'center'),
      ...byField(LEVEL_F, [[FOUNDING, p(`${GREET}<br><br>Your Founding Membership ended on ${EXP}. Thank you for being one of the people who helped open the Library. To bring back free admission and member benefits, continue at Contributing, or stay on at a smaller level.`)]],
        p(`${GREET}<br><br>Your [[custom.acme_-_membership_level]] membership ended on ${EXP}. The Library would be glad to have you back, and rejoining is quick: your membership number and the primary cardholder's last name are all it takes.`)),
      ...byField(LEVEL_F, [[FOUNDING, p(FOUNDING_KEEPS)]], null),
      ...byField(TICKET_F, [[MEMBER_TICKETS, p('Thank you for using your membership in Medora this past year. Rejoin, and your next visit is free again.')]], null),
      div,
      ...byField(LEVEL_F, [[FOUNDING, h('Continue at Contributing')]], h('Pick Up Where You Left Off')),
      ...byLevel(l => p(l === FOUNDING ? FOUNDING_BOTH : priceLine(l, 'Rejoin')),
        p('Every level is <b>10% off</b> with auto-renew or a two-year membership.', 'center')),
      p('<b>Auto-renew</b> means you never have to think about it again. <b>Two years</b> covers your next two membership years in one step.', 'center'),
      btn('Renew My Membership'),
      ...byLevel(l => l === FOUNDING ? null : LEVELS[l].up
        ? p(`<b>Room for more people this time?</b> ${LEVELS[l].up} <a href="${LEVELS_URL}">Compare levels</a>.`, 'center')
        : p('Thank you for supporting the Library at its highest membership level.', 'center'), null),
      div,
      h('What Membership Brings Back'),
      img('renew-members.jpg', 'Members gather on the Library terrace outside the lobby'),
      p(CORE),
      p('Membership also supports the Library\'s educational programming, conservation education and the preservation of Theodore Roosevelt\'s legacy.', 'center'),
      div,
      h('How to Rejoin'),
      p(STEPS),
      p(`Questions? Write to ${MAIL}.`),
      footer,
    ],
  },
  {
    slug: 'renew-t-plus-45-last-note',
    title: 'RENEW: T+45 Last Note',
    preheader: 'Your level is still here when you want it, and one question.',
    blocks: [
      'HEADER',
      h('One Last Note'),
      ...byField(LEVEL_F, [[FOUNDING, p(`${GREET}<br><br>This is the last renewal note you will receive. Whatever you decide, you will always be one of the Library's Founding Members, and your name stays on the Digital Donor Wall. If you would like free admission and member benefits again, Contributing or a smaller level is waiting below.`)]],
        p(`${GREET}<br><br>This is the last renewal note you will receive. Your [[custom.acme_-_membership_level]] membership is still here whenever you want it, with the same benefits and the same 10% savings on auto-renew or two years.`)),
      ...byLevel(l => p(l === FOUNDING ? FOUNDING_BOTH : priceLine(l, 'Rejoin')),
        p('Every level is <b>10% off</b> with auto-renew or a two-year membership.', 'center')),
      btn('Renew My Membership'),
      p(`<b>Members get:</b>${CORE}`),
      div,
      h('One Question'),
      p('If you have decided not to renew, a one-line reply to this email saying why would help the Library plan membership for the years ahead. Replies go straight to the membership team.'),
      p('Thank you for the time you spent as a member.<br><br>With gratitude,<br><b>The Membership Team</b><br>Theodore Roosevelt Presidential Library'),
      footer,
    ],
  },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

// 1. Headers from Header Studio (PNG, 1800 x 600; convert to JPG at 1320 x 440 afterwards).
//    Only when a photo directory is given; otherwise the existing header JPGs are kept.
if (process.argv[3]) {
  const pg = await browser.newPage();
  await pg.goto('https://newsletter.labs.trlibrary.com/header.html');
  for (const [slug, h] of Object.entries(HEADERS)) {
    const b64 = fs.readFileSync(process.argv[3] + '/' + h.photo).toString('base64');
    const data = await pg.evaluate(async ({ b64, opts }) => {
      await HDR.setImage('data:image/jpeg;base64,' + b64);
      await HDR.setOptions(Object.assign({ zoom: 1, panX: 0, panY: 0, dim: 0, scale: 0.78, yoff: 0 }, opts));
      return await HDR.exportDataURL();
    }, { b64, opts: h.opts });
    fs.writeFileSync(`${OUT}/img/${slug}-header.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  await pg.close();
}

// 2. Emails from the Newsletter Builder.
const pg = await browser.newPage();
await pg.goto('https://newsletter.labs.trlibrary.com/');
await pg.waitForFunction(() => window.NB);
for (const e of emails) {
  e.blocks = e.blocks.map(b => b === 'HEADER' ? headerFor(e.slug) : b);
  // Conditional blocks carry a sentinel through the builder, then their row is wrapped.
  const conds = [];
  const blocks = e.blocks.map(b => {
    if (!b.cond) return b;
    const id = `ZQC${conds.length}QZ`; conds.push(b.cond);
    const props = Object.assign({}, b.props);
    if ('html' in props) props.html = id + props.html;
    else if ('text' in props) props.text = id + props.text;
    else if ('label' in props) props.label = id + props.label;
    return { type: b.type, props };
  });
  let html = await pg.evaluate(({ title, preheader, blocks }) => {
    NB.setState({ title, preheader, blocks });
    return NB.exportHTML();
  }, { title: e.title, preheader: e.preheader, blocks });
  conds.forEach((c, i) => {
    const id = `ZQC${i}QZ`, pos = html.indexOf(id);
    if (pos < 0 || html.indexOf(id, pos + 1) >= 0) throw new Error(`${e.slug}: condition ${i} not found once`);
    const start = html.lastIndexOf('\n<tr>', pos) + 1;
    const ends = [html.indexOf('\n<tr>', pos), html.indexOf('\n</table>', pos)].filter(x => x > 0);
    const end = Math.min(...ends);
    const attr = Object.entries({ group: c.group, tag: c.tag, field: c.field, label: c.label, other: c.other, ...(c.kind === 'if' ? { is: c.is } : {}) })
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ');
    const row = html.slice(start, end).replace(id, '');
    html = html.slice(0, start) + `<!--cc:${c.kind} ${attr}-->\n${row}\n<!--cc:end-->` + html.slice(end);
  });
  html = html.replace(/ZQR(\d+)QZ/g, (_, n) => RAW[+n]);
  if (/ZQ[CR]\d+QZ/.test(html)) throw new Error('leftover condition marker in ' + e.slug);
  if (/\[#|\$\{|<@/.test(html)) throw new Error('forbidden sequence in ' + e.slug);
  // The builder HTML-escapes quotes inside merge tags; Constant Contact needs them literal.
  const fixed = html.replace(/\[\[[^\]]*\]\]/g, t => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  fs.writeFileSync(`${OUT}/${e.slug}.html`, fixed);
  console.log(e.slug, html.length);
}
await browser.close();
