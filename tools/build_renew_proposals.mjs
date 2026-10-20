// Builds the RENEW proposal emails with TRPL's own Newsletter Builder and Header Studio,
// so the HTML is exactly what the builder exports.
// Usage (from the repo root): node tools/build_renew_proposals.mjs docs/proposals <photo-dir>
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

const KEEPS = '<ul><li><b>Free admission</b> for every visit, for the number of people your level covers</li><li><b>The member line</b> at the entrance</li><li><b>10% off</b> at the Library Shop and Salt+Scoria</li><li><b>Early ticket access</b> and invitations to member tours and events</li><li><b>The member magazine</b>, quarterly, and virtual member town halls</li></ul>';
const STEPS = '<ol><li>Have your membership number ready. It is at the top of this email.</li><li>Select <b>Renew My Membership</b> and verify with your membership number and the primary cardholder\'s last name.</li><li>Select <b>Renew</b>, choose a level and complete checkout. Your membership number stays the same.</li></ol>';

const emails = [
  {
    slug: 'renew-t-60-renewal-notice',
    title: 'RENEW: T-60 Renewal Notice',
    preheader: 'Renew now and your benefits continue without a gap.',
    blocks: [
      'HEADER',
      h('Another Year in the Arena'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>Thank you for your year as a member of the Theodore Roosevelt Presidential Library. Your membership expires on [[custom.acme_-_membership_expiration_date]]. Renew now and every benefit carries straight on.`),
      p('<b>Save 10%</b> when you choose auto-renew or a two-year membership.', 'center'),
      btn('Renew My Membership'),
      div,
      h('What Your Membership Keeps'),
      img('renew-campfire.jpg', 'A grandfather points out a detail to two children inside the Elkhorn Ranch cabin recreation'),
      p(KEEPS),
      btn('Compare Membership Levels', LEVELS_URL),
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
    preheader: 'Renew by [[custom.acme_-_membership_expiration_date]] to keep your free admission and member benefits.',
    blocks: [
      'HEADER',
      h('One Month to Go'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>Your membership expires on [[custom.acme_-_membership_expiration_date]]. Renewing takes your membership number and the primary cardholder's last name.`),
      p('<b>Save 10%</b> with auto-renew or a two-year membership.', 'center'),
      btn('Renew My Membership'),
      div,
      h('The Right Level for the Year Ahead'),
      p('Individual covers one admission, Dual two, Family four, and Contributing and Patron six. Donor Patron covers eight and adds recognition and an annual in-person member town hall. Every level includes the member line and 10% off at the Library Shop and Salt+Scoria.'),
      btn('Compare Membership Levels', LEVELS_URL),
      p(`Questions? Write to ${MAIL}.`),
      footer,
    ],
  },
  {
    slug: 'renew-t-7-last-week',
    title: 'RENEW: T-7 Last Week',
    preheader: 'Your member benefits end on [[custom.acme_-_membership_expiration_date]].',
    blocks: [
      'HEADER',
      h('One Week Left'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>Your membership ends on [[custom.acme_-_membership_expiration_date]]. Renew this week and nothing changes: same membership number, same benefits, no gap.`),
      btn('Renew My Membership'),
      p(`Need a hand? Reply to this email or write to ${MAIL}, and the membership team will help.`),
      p('With gratitude,<br><b>The Membership Team</b><br>Theodore Roosevelt Presidential Library'),
      footer,
    ],
  },
  {
    slug: 'renew-t-plus-7-membership-ended',
    title: 'RENEW: T+7 Membership Ended',
    preheader: 'Renew online with your membership number.',
    blocks: [
      'HEADER',
      h('Your Membership Has Ended'),
      p(CARD, 'center'),
      p(`${GREET}<br><br>Your membership expired on [[custom.acme_-_membership_expiration_date]]. The Library would be glad to have you back. Renew online with your membership number and the primary cardholder's last name.`),
      btn('Renew My Membership'),
      div,
      img('renew-members.jpg', 'Members gather on the Library terrace outside the lobby'),
      p('Membership supports the Library\'s educational programming, conservation education and the preservation of Theodore Roosevelt\'s legacy.', 'center'),
      btn('Compare Membership Levels', LEVELS_URL),
      p(`Questions? Write to ${MAIL}.`),
      footer,
    ],
  },
  {
    slug: 'renew-t-plus-45-last-note',
    title: 'RENEW: T+45 Last Note',
    preheader: 'A final invitation to renew, and one question.',
    blocks: [
      'HEADER',
      h('One Last Note'),
      p(`${GREET}<br><br>This is the last renewal note you will receive. If you would like to return, your membership can be renewed online at any time.`),
      btn('Renew My Membership'),
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
{
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
  const html = await pg.evaluate(({ title, preheader, blocks }) => {
    NB.setState({ title, preheader, blocks });
    return NB.exportHTML();
  }, e);
  if (/\[#|\$\{|<@/.test(html)) throw new Error('forbidden sequence in ' + e.slug);
  // The builder HTML-escapes quotes inside merge tags; Constant Contact needs them literal.
  const fixed = html.replace(/\[\[[^\]]*\]\]/g, t => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  fs.writeFileSync(`${OUT}/${e.slug}.html`, fixed);
  console.log(e.slug, html.length);
}
await browser.close();
