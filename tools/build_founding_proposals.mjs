// Builds the FOUNDING proposal emails (the Founding Member renewal campaign) with TRPL's
// Newsletter Builder, so the HTML is exactly what the builder exports.
// This is its own campaign, separate from the RENEW series: every Founding Membership ends
// December 31, 2026, so these emails run on fixed dates from early November to December 31,
// then a lapsed recovery stretch (T+7, T+30, T+60) for Founding Members who did not renew.
// Usage (from the repo root): node tools/build_founding_proposals.mjs docs/proposals
// then: python collect_automations.py --offline
// Header images reuse the existing Header Studio banners in docs/proposals/img/.
import { chromium } from 'playwright';
import fs from 'fs';

const OUT = process.argv[2];               // .../docs/proposals
const IMG = 'proposals/img/';              // relative to docs/, resolves inside the dashboard

const RENEW_URL = 'https://buy.acmeticketing.com/auth/613/members?ref=%2Fmembership%2F613%2Fprofile';
const LEVELS_URL = 'https://www.trlibrary.com/membership';
const VISIT_URL = 'https://www.trlibrary.com/visit';
const MAIL = '<a href="mailto:membership@trlibrary.com">membership@trlibrary.com</a>';
const GREET = 'Dear [[FIRSTNAME OR "Friend of the Library"]],';
const CARD = '<b>Membership number:</b> [[custom.acme_-_membership_number]]<br><b>Level:</b> Founding Member<br><b>Ends:</b> December 31';
const NOTE = 'You are receiving this email because you are a Founding Member of the Theodore Roosevelt Presidential Library.';

const HEADERS = {
  'founding-t-55-thank-you':      'renew-t-plus-45-last-note-header.jpg',        // Sand / Black · the Library on the prairie
  'founding-t-41-benefits':       'renew-t-30-reminder-header.jpg',              // Deep Orange / Black · the Library Shop
  'founding-t-30-giving-tuesday': 'renew-t-60-renewal-notice-header.jpg',        // Dark Forest / White · above the badlands
  'founding-t-21-two-ways':       'renew-t-plus-7-membership-ended-header.jpg',  // Dark Gray / White · Elkhorn campfire
  'founding-t-10-ten-days':       'renew-t-7-last-week-header.jpg',              // Night Sky / White · lobby timber
  'founding-t-3-ends-thursday':   'renew-t-60-renewal-notice-header.jpg',
  'founding-t-0-last-day':        'renew-t-plus-45-last-note-header.jpg',
  'founding-t-plus-7-membership-ended': 'renew-t-plus-7-membership-ended-header.jpg',
  'founding-t-plus-30-come-back':       'renew-t-7-last-week-header.jpg',
  'founding-t-plus-60-last-note':       'renew-t-plus-45-last-note-header.jpg',
};
const headerFor = slug => ({ type: 'header', props: { src: IMG + HEADERS[slug], alt: 'Theodore Roosevelt Presidential Library', href: 'https://www.trlibrary.com' } });
const footer = { type: 'footer', props: { note: NOTE, contactLabel: 'Membership Questions', contactUrl: 'mailto:membership@trlibrary.com' } };
const h = t => ({ type: 'heading', props: { text: t, align: 'center' } });
const p = (html, align = 'left') => ({ type: 'text', props: { html, align } });
const btn = (label, href = RENEW_URL) => ({ type: 'button', props: { label, href } });
const img = (src, alt) => ({ type: 'image', props: { src: IMG + src, alt, href: '', caption: '' } });
const div = { type: 'divider', props: {} };

// ---- Membership facts (same source as build_renew_proposals.mjs, checked 2026-10-20) ----
// Founding Membership: $250, member + one additional adult + children under 13, valid through
// Dec 31, 2026, once-only. Founding Members keep the designation and their place on the
// Digital Donor Wall permanently, whether or not they renew (Matt, 2026-10-20).
// Strategy: keep them at Contributing ($250, the same price); Family is the stay-on option.
const LEVELS = {
  'Family':       { price: '$175', auto: '$157.50', two: '$315', covers: 'free admission for you and three guests, plus family programming' },
  'Contributing': { price: '$250', auto: '$225',    two: '$450', covers: 'free admission for you and five guests, family programming and a commemorative gift' },
};

// Conditional rows on the last ticket (visited as a member or not), same mechanism as RENEW.
const TICKET_F = { tag: 'custom.acme_-_ticket_type_last', field: 'Acme - Ticket Type (Last)', label: 'Last ticket', other: 'Not a member ticket' };
let G = 0;
const cond = (block, spec) => Object.assign(block, { cond: spec });
function byField(F, variants, fallback) {
  const group = 'g' + (++G);
  const out = variants.map(([is, b]) => cond(b, Object.assign({ group, kind: 'if', is: [].concat(is).join('|') }, F)));
  if (fallback) out.push(cond(fallback, Object.assign({ group, kind: 'else' }, F)));
  return out;
}
const MEMBER_TICKETS = ['Member Adult', 'Member Youth'];
const visited = (yes, no) => byField(TICKET_F, [[MEMBER_TICKETS, p(yes)]], p(no));

const RAW = [];
const raw = html => `ZQR${RAW.push(html) - 1}QZ`;
const TH = "padding:8px 6px;border:1px solid #D1D1D1;background:#F4F2EC;font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;text-align:center;";
const TD = "padding:10px 6px 2px;border:1px solid #D1D1D1;border-bottom:0;text-align:center;font-size:22px;font-weight:bold;line-height:1.2;";
const TN = "padding:0 6px 10px;border:1px solid #D1D1D1;border-top:0;text-align:center;font-size:13px;line-height:1.35;color:#52514e;";
const TL = "padding:8px 10px;border:1px solid #D1D1D1;text-align:left;font-size:15px;line-height:1.35;";
const TP = "padding:8px 6px;border:1px solid #D1D1D1;text-align:center;font-size:16px;font-weight:bold;";
const TABLE = '<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:10px 0 0;">';

const CONTRIBUTING = raw('<div style="text-align:center;"><b>Contributing</b>: ' + LEVELS.Contributing.covers + '.</div>' + TABLE
  + `<tr><td style="${TH}">1 year</td><td style="${TH}">Auto-renew</td><td style="${TH}">2 years</td></tr>`
  + `<tr><td style="${TD}">${LEVELS.Contributing.price}</td><td style="${TD}">${LEVELS.Contributing.auto}</td><td style="${TD}">${LEVELS.Contributing.two}</td></tr>`
  + `<tr><td style="${TN}">renew each year<br>yourself</td><td style="${TN}">a year, renews itself<br><b>save 10%</b></td><td style="${TN}">for two years<br><b>save 10%</b></td></tr>`
  + '</table>');
const row = l => `<tr><td style="${TL}"><b>${l}</b><br><span style="font-size:13px;color:#52514e;">${LEVELS[l].covers[0].toUpperCase() + LEVELS[l].covers.slice(1)}</span></td><td style="${TP}">${LEVELS[l].price}</td><td style="${TP}">${LEVELS[l].auto}</td><td style="${TP}">${LEVELS[l].two}</td></tr>`;
const BOTH = raw(TABLE
  + `<tr><td style="${TH}text-align:left;">Level</td><td style="${TH}">1 year</td><td style="${TH}">Auto-renew<br>save 10%</td><td style="${TH}">2 years<br>save 10%</td></tr>`
  + row('Contributing') + row('Family') + '</table>');

const SAME_PRICE = 'Contributing is $250, the same as your Founding Membership, and it covers more: free admission for you and five guests on every visit, family programming and a commemorative gift.';
const WALL = 'Your name is on the Library\'s Digital Donor Wall, and it stays there permanently, whether or not you renew. You will always be a Founding Member.';
const CORE = '<ul><li><b>Free general admission</b> for the people your level covers, and <b>25% off</b> extra admission tickets</li>'
  + '<li><b>The member line</b> at the entrance and dedicated member support</li>'
  + '<li><b>10% off</b> in the Library Shop, online and onsite, and at Salt+Scoria (excluding alcohol)</li>'
  + '<li><b>Priority access</b> to select ticketed events and discounted tickets for programs and lectures</li>'
  + '<li><b>Member tours</b>, exhibition previews and member events</li>'
  + '<li><b>10% off gift memberships</b>, and the monthly member e-news</li></ul>';
const STEPS = '<ol><li>Have your membership number ready. It is at the top of this email.</li><li>Select <b>Renew My Membership</b> and verify with your membership number and the primary cardholder\'s last name.</li><li>Choose Contributing or Family, and a term: 1 year, auto-renew or 2 years.</li></ol>';
const SIGN_TEAM = 'With gratitude,<br><b>The Membership Team</b><br>Theodore Roosevelt Presidential Library';

const emails = [
  {
    slug: 'founding-t-55-thank-you',
    title: 'FOUNDING: T-55 Thank You',
    preheader: 'Your name is on the Digital Donor Wall for good. Here is what you made possible.',
    blocks: [
      'HEADER',
      h('You Helped Open the Library'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>You joined as a Founding Member before the Library had a track record. Thank you.`),
      p('Since opening day on July 4, the Library has welcomed more than 180,000 visits from across the country. Theodore Roosevelt\'s 1884 diary, on loan from the Library of Congress, is on view in the galleries. <i>In the Room</i>, the photography of David Hume Kennerly, opened this fall. The Library\'s programs, school groups and member events are under way. None of it happens without the people who signed on first.'),
      p(`<b>Permanent recognition.</b> ${WALL}`),
      div,
      h('Stay On at Contributing'),
      p('Founding Membership was a once-only offer for the opening year, and it ends on December 31. ' + SAME_PRICE),
      p(CONTRIBUTING),
      btn('Renew My Membership'),
      p('With gratitude,<br><b>Robbie Lauf</b><br>Interim Chief Executive Officer<br>Theodore Roosevelt Presidential Library'),
      footer,
    ],
  },
  {
    slug: 'founding-t-41-benefits',
    title: 'FOUNDING: T-41 Your Member Benefits',
    preheader: 'Free admission, the member line, 10% off in the Shop and at Salt+Scoria, and more.',
    blocks: [
      'HEADER',
      h('What Your Membership Includes'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>Your Founding Membership runs through December 31. Here is everything it includes, and everything that carries into next year when you renew.`),
      img('renew-members.jpg', 'Members gather on the Library terrace outside the lobby'),
      p(CORE),
      p(`Your free admission runs through December 31, and the lobby, Library Shop and café are decorated for the holidays. <a href="${VISIT_URL}">Plan a visit</a>.`),
      p('<b>A gift for someone else.</b> Members save 10% on gift memberships, in time for the holidays.'),
      div,
      h('Stay On at Contributing'),
      p(SAME_PRICE),
      p(CONTRIBUTING),
      btn('Renew My Membership'),
      p(`<b>Permanent recognition.</b> ${WALL}`),
      footer,
    ],
  },
  {
    slug: 'founding-t-30-giving-tuesday',
    title: 'FOUNDING: T-30 Giving Tuesday',
    preheader: 'One month left in your Founding year, and what your membership supports.',
    blocks: [
      'HEADER',
      h('One Month Left in Your Founding Year'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>Today is Giving Tuesday, and your Founding Membership has one month left. Membership does more than open the doors for you. It supports the Library's education programs, conservation education and the work of carrying Theodore Roosevelt's story to the next generation of citizens.`),
      p('The Library\'s first season drew national attention, including a nomination for USA TODAY 10Best Readers\' Choice Best New Museum.'),
      p(`<b>Permanent recognition.</b> ${WALL}`),
      div,
      h('Continue at Contributing'),
      p(SAME_PRICE + ' Choose auto-renew or two years and save 10%.'),
      p(CONTRIBUTING),
      btn('Renew My Membership'),
      p(`Other levels start at $50. <a href="${LEVELS_URL}">Compare all levels</a>.`, 'center'),
      footer,
    ],
  },
  {
    slug: 'founding-t-21-two-ways',
    title: 'FOUNDING: T-21 Two Ways to Stay',
    preheader: 'Contributing keeps your whole party covered. Family keeps you on for less.',
    blocks: [
      'HEADER',
      h('Two Ways to Stay a Member'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>Your Founding Membership ends on December 31. There are two easy ways to keep free admission and your member benefits next year.`),
      p('<b>Contributing</b> is the natural next step: the same $250 you paid as a Founding Member, with free admission for you and five guests, family programming and a commemorative gift.<br><br><b>Family</b> keeps you on for less: free admission for you and three guests, plus family programming.'),
      p(BOTH),
      btn('Renew My Membership'),
      div,
      h('How to Renew'),
      p(STEPS),
      p(`<b>Permanent recognition.</b> ${WALL}`),
      p(`Questions? Write to ${MAIL}.`),
      footer,
    ],
  },
  {
    slug: 'founding-t-10-ten-days',
    title: 'FOUNDING: T-10 Ten Days Left',
    preheader: 'Your Founding Membership ends December 31. Renew and nothing lapses.',
    blocks: [
      'HEADER',
      h('Ten Days Left'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>Your Founding Membership ends on December 31. Renew now and your free admission, the member line and your member discounts carry straight into the new year.`),
      p(BOTH),
      btn('Renew My Membership'),
      p(WALL),
      p(SIGN_TEAM),
      footer,
    ],
  },
  {
    slug: 'founding-t-3-ends-thursday',
    title: 'FOUNDING: T-3 Ends Thursday',
    preheader: 'Your Founding Membership ends Thursday, December 31.',
    blocks: [
      'HEADER',
      h('Your Founding Year Ends Thursday'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>Your Founding Membership ends this Thursday, December 31. It takes two minutes to renew at Contributing or Family.`),
      p(BOTH),
      btn('Renew My Membership'),
      p(`Need a hand? Reply to this email or write to ${MAIL}, and the membership team will help.`),
      p(SIGN_TEAM),
      footer,
    ],
  },
  {
    slug: 'founding-t-0-last-day',
    title: 'FOUNDING: T-0 Last Day',
    preheader: 'Renew today and your membership carries into the new year without a gap.',
    blocks: [
      'HEADER',
      h('Last Day'),
      p(`${GREET}<br><br>Today is the last day of your Founding Membership. Thank you for helping open the Theodore Roosevelt Presidential Library. Your name stays on the Digital Donor Wall permanently.`),
      p('Renew today at Contributing ($250) or Family ($175) and your membership carries into the new year without a gap.', 'center'),
      btn('Renew My Membership'),
      p(SIGN_TEAM),
      footer,
    ],
  },
  // ---- Lapsed recovery: Founding Members who did not renew by December 31 ----
  {
    slug: 'founding-t-plus-7-membership-ended',
    title: 'FOUNDING: T+7 Membership Ended',
    preheader: 'You are still a Founding Member. Rejoin and free admission comes right back.',
    blocks: [
      'HEADER',
      h('Still a Founding Member'),
      p(CARD.replace('<b>Ends:</b> December 31', '<b>Ended:</b> December 31'), 'center'),
      p(`${GREET}<br><br>Your Founding Membership ended on December 31. You will always be one of the people who helped open the Theodore Roosevelt Presidential Library, and your name stays on the Digital Donor Wall permanently.`),
      p('Rejoin at Contributing or Family and your free admission, the member line and your member discounts come right back. Your membership number stays the same.'),
      p(BOTH),
      btn('Renew My Membership'),
      div,
      h('What Membership Brings Back'),
      img('renew-members.jpg', 'Members gather on the Library terrace outside the lobby'),
      p(CORE),
      h('How to Rejoin'),
      p(STEPS),
      p(`Questions? Write to ${MAIL}.`),
      footer,
    ],
  },
  {
    slug: 'founding-t-plus-30-come-back',
    title: 'FOUNDING: T+30 Come Back',
    preheader: 'The Library is open through the winter. Rejoin and your visits are free again.',
    blocks: [
      'HEADER',
      h('Your Place Is Still Here'),
      p(`${GREET}<br><br>The Library is open through the winter, and the badlands are at their quietest. As a member, every visit is free for the people your level covers, with the member line at the entrance and 10% off in the Library Shop and at Salt+Scoria.`),
      p(`Rejoin, and your next visit is free again. <a href="${VISIT_URL}">Plan a visit</a>.`),
      p('<b>Contributing</b> is the same $250 as your Founding Membership and covers you and five guests. <b>Family</b> covers you and three guests for $175.'),
      p(BOTH),
      btn('Renew My Membership'),
      p(WALL),
      footer,
    ],
  },
  {
    slug: 'founding-t-plus-60-last-note',
    title: 'FOUNDING: T+60 Last Note',
    preheader: 'Your membership is ready when you are, and one question.',
    blocks: [
      'HEADER',
      h('One Last Note'),
      p(`${GREET}<br><br>This is the last membership reminder you will receive from the Library. Whatever you decide, you will always be a Founding Member, and your name stays on the Digital Donor Wall permanently.`),
      p('If you would like free admission and member benefits again, Contributing and Family are ready below, with 10% off when you choose auto-renew or two years.'),
      p(BOTH),
      btn('Renew My Membership'),
      div,
      h('One Question'),
      p('If you have decided not to renew, a one-line reply to this email saying why would help the Library plan membership for the years ahead. Replies go straight to the membership team.'),
      p(SIGN_TEAM),
      footer,
    ],
  },
];

const browser = await chromium.launch();
const pg = await browser.newPage();
await pg.goto('https://newsletter.labs.trlibrary.com/');
await pg.waitForFunction(() => window.NB);
for (const e of emails) {
  e.blocks = e.blocks.map(b => b === 'HEADER' ? headerFor(e.slug) : b);
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
    return NB.exportHTML({ strict: false });
  }, { title: e.title, preheader: e.preheader, blocks });
  conds.forEach((c, i) => {
    const id = `ZQC${i}QZ`, pos = html.indexOf(id);
    if (pos < 0 || html.indexOf(id, pos + 1) >= 0) throw new Error(`${e.slug}: condition ${i} not found once`);
    const start = html.lastIndexOf('\n<tr>', pos) + 1;
    const ends = [html.indexOf('\n<tr>', pos), html.indexOf('\n</table>', pos)].filter(x => x > 0);
    const end = Math.min(...ends);
    const attr = Object.entries({ group: c.group, tag: c.tag, field: c.field, label: c.label, other: c.other, ...(c.kind === 'if' ? { is: c.is } : {}) })
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ');
    const r = html.slice(start, end).replace(id, '');
    html = html.slice(0, start) + `<!--cc:${c.kind} ${attr}-->\n${r}\n<!--cc:end-->` + html.slice(end);
  });
  html = html.replace(/ZQR(\d+)QZ/g, (_, n) => RAW[+n]);
  if (/ZQ[CR]\d+QZ/.test(html)) throw new Error('leftover marker in ' + e.slug);
  if (/\[#|\$\{|<@/.test(html)) throw new Error('forbidden sequence in ' + e.slug);
  const fixed = html.replace(/\[\[[^\]]*\]\]/g, t => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  fs.writeFileSync(`${OUT}/${e.slug}.html`, fixed);
  console.log(e.slug, fixed.length);
}
await browser.close();
