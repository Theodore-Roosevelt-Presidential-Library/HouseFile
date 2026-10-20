// Builds the proposed VISIT (pre-visit) emails with the Newsletter Builder v2 API
// (window.NB: table, columns and conditional "Show when" rows) and Header Studio (window.HDR).
// Usage (from the repo root): node tools/build_visit_proposals.mjs docs/proposals [<photo-dir>]
//   <photo-dir> holds the header photos named in HEADERS (from trlibrary.com, <= 2400 px wide);
//   omit it to keep the existing header JPGs. Then: python collect_automations.py --offline
// Facts come from trlibrary.com/visit and its FAQ pages (checked 2026-10-20). Proposals only:
// nothing here goes into Constant Contact.
import { chromium } from 'playwright';
import fs from 'fs';

const OUT = process.argv[2];
const PHOTOS = process.argv[3];
const IMG = 'proposals/img/';
const SITE = 'https://www.trlibrary.com';
const F = `${SITE}/sites/default/files`;
const VID = id => `${SITE}/video/view/${id}?pid=PLafKMriNZlgo`;
// Play-button thumbnails and the premiere teaser GIF come from tools/make_video_thumbs.py.
const THUMB = id => `${IMG}video-${id}.jpg`;
const TEASER = `${IMG}video-W9sq8PuGQVo-teaser.gif`;
const HELLO = '<a href="mailto:hello@trlibrary.com">hello@trlibrary.com</a>';
const MEMBERSHIP_MAIL = '<a href="mailto:membership@trlibrary.com">membership@trlibrary.com</a>';
const GREET = 'Hello [[FIRSTNAME OR "Friend"]],';
// Constant Contact only prints TEXT custom fields; date fields (Visit Date (Next), Last Purchase
// Date, Membership Expiration Date) can trigger paths but can't appear in an email.
const ORDER = '[[custom.acme_-_recent_order_id]]';
const NOTE = 'You are receiving this email because you have tickets to the Theodore Roosevelt Presidential Library.';

// Header Studio banners (approved pairings only; HDR v2 rejects anything else).
const HEADERS = {
  'visit-t1-welcome':          { photo: 'chaney-little-mo-river_016_articlecrop_1.jpg', opts: { pairing: 'dark-forest-white' } },  // the Little Missouri below the buttes
  'visit-t-30-plan-ahead':     { photo: 'medora-buggy-rides-in-dowtownmedora-from-ND-Tourism-scaled.jpg', opts: { pairing: 'deep-orange-black' } }, // downtown Medora
  'visit-t-3-know-before':     { photo: 'painted-canyon.jpg', opts: { pairing: 'night-sky-white', panY: 300 } },                   // Badlands sky
};

// ---- blocks ----
const header = slug => ({ type: 'header', props: { src: IMG + slug + '-header.jpg', alt: 'Theodore Roosevelt Presidential Library', href: SITE } });
const footer = { type: 'footer', props: { note: NOTE, contactLabel: 'Visit Questions', contactUrl: 'mailto:hello@trlibrary.com' } };
const h = text => ({ type: 'heading', props: { text, align: 'center' } });
const p = (html, align = 'left') => ({ type: 'text', props: { html, align } });
const btn = (label, href) => ({ type: 'button', props: { label, href } });
const img = (src, alt, href = '', caption = '') => ({ type: 'image', props: { src, alt, href, caption } });
const div = { type: 'divider', props: {} };
const cols = (a, b) => ({ type: 'columns', props: { cols: [a, b] } });
const table = props => ({ type: 'table', props: Object.assign({ rowLabels: false, highlight: null, style: 'standard', note: '', intro: '' }, props) });

// Member or not: Acme - Is Active Member is written by the ACME sync as active / new / dropped.
const MEMBER = { tag: 'custom.acme_-_is_active_member', field: 'Acme - Is Active Member', label: 'Membership', other: 'Not a member' };
let G = 0;
const clone = b => JSON.parse(JSON.stringify(b));
// One group: the member rows show for active/new members; the default rows show for everyone else.
const memberRows = (memberBlocks, otherBlocks) => {
  const group = 'm' + (++G);
  return [
    ...memberBlocks.map(b => Object.assign(clone(b), { cond: Object.assign({ group, kind: 'if', is: ['active', 'new'] }, MEMBER) })),
    ...otherBlocks.map(b => Object.assign(clone(b), { cond: Object.assign({ group, kind: 'else', is: [] }, MEMBER) })),
  ];
};
const memberOnly = (...blocks) => memberRows(blocks, []);
const GIFT = p('<b>Know someone who would love it here?</b> As a member you take 10% off gift memberships.', 'center');

// ---- shared content ----
const MEMBERSHIP_TABLE = table({
  columns: ['Level', 'Free admission for', 'A year'],
  rowLabels: true,
  rows: [
    ['Individual', 'You', '$50'],
    ['Dual', 'You and a guest', '$95'],
    ['Family', 'You and three guests, plus family programming', '$175'],
    ['Contributing', 'You and five guests, plus a commemorative gift', '$250'],
  ],
  note: 'Every level adds the member line, 25% off extra admission tickets, and 10% off in the Library Shop and at Salt+Scoria. Save 10% more with auto-renew or two years.',
});
const MEMBER_THANKS = p('<b>Thank you for coming as a member.</b> Head for the member line when you arrive. Your membership also takes <b>25% off</b> any extra admission tickets for friends, and <b>10% off</b> in the Library Shop and at Salt+Scoria (excluding alcohol).');
const SELL_HEAD = h('Make This Visit a Membership');
const SELL_BODY = p(`Admission is $26 for adults and $16 for youth. A membership covers a full year of visits, and Individual and Dual pay for themselves on your second trip. <b>Already have tickets? You don't lose them.</b> The Library will refund your tickets and put what you paid toward a membership, and your reservation stays exactly as it is.`);
const SELL_HOW = p(`To switch, email ${MEMBERSHIP_MAIL} with the order number from your ticket confirmation, or ask anyone at the front desk when you visit. They can take care of the refund for you.`);
const SELL_BTN = btn('See Membership Levels', `${SITE}/membership`);

const emails = [
  // ------------------------------------------------------------------ T+1
  {
    slug: 'visit-t1-welcome',
    title: 'VISIT: T+1 Welcome',
    subject: "You're going to Medora. Here's how to plan it.",
    preheader: 'Where to stay, how to get here and what to see before your visit.',
    blocks: [
      header('visit-t1-welcome'),
      h("You're Coming to the Badlands"),
      p(`${GREET}<br><br>Your tickets to the Theodore Roosevelt Presidential Library are booked, and your date and entry time are on your ticket confirmation. Medora is a small town in a big landscape, so a little planning now makes the whole trip easier. Here is what to sort out first.`),
      ...memberOnly(MEMBER_THANKS),
      img(TEASER, 'Watch the preview: Discover the Theodore Roosevelt Presidential Library (3:35)', VID('W9sq8PuGQVo'), 'A 3½-minute look at the galleries, the building, Medora and the national park'),
      div,
      h('Four Things to Plan Now'),
      cols(
        { src: `${F}/2026-03/medora-buggy-rides-in-dowtownmedora-from-ND-Tourism-scaled.jpg`, alt: 'A horse-drawn carriage passes shops in downtown Medora', heading: 'Where to Stay',
          text: 'Medora has limited lodging, and summer weekends book up fast. See hotels, cabins, rentals and campgrounds with room on your dates, all in one place.', label: 'Check Availability', href: `${SITE}/visit/lodging/availability` },
        { src: `${F}/2026-06/building-clean-june.jpg`, alt: 'The Library on the prairie above Medora', heading: 'Getting Here',
          text: 'Medora sits on I-94: Exit 24 from the west, Exit 27 from the east. A rental car is the way to see the Badlands. Coverage is spotty, so download your route before you go.', label: 'Directions', href: `${SITE}/visit/directions` }),
      cols(
        { src: `${F}/2026-07/painted-canyon.jpg`, alt: 'Two children run along a ridge above the Badlands', heading: 'Plan Your Days',
          text: 'Allow about three and a half hours for the galleries, plus time for the boardwalk and the rooftop prairie. The Trip Planner builds a day-by-day route around your interests.', label: 'Trip Planner', href: `${SITE}/visit/planner` },
        { src: `${F}/2026-02/chaney-little-mo-river_016_articlecrop_1.jpg`, alt: 'The Little Missouri River winding through the Badlands', heading: 'The National Park',
          text: "Theodore Roosevelt National Park's South Unit entrance is right in town. A favorite plan: the scenic loop in the morning, the Library in the afternoon.", label: 'Plan a Park Day', href: `${SITE}/visit/national-park/trip-planner` }),
      table({
        intro: '<b>Flying in?</b> The nearest airports:',
        columns: ['Airport', 'Miles', 'Drive'],
        rowLabels: true,
        rows: [
          ['Dickinson (DIK)', '35', 'About 35 minutes'],
          ['Williston (XWA)', '125', 'About 2 hours'],
          ['Bismarck (BIS)', '135', 'About 2 hours'],
          ['Billings, Mont. (BIL)', '280', 'About 4 hours'],
        ],
      }),
      p(`Want it all handled? <a href="${SITE}/visit/one-medora">One Medora packages</a> bundle a hotel night, an evening show and Library admission in one booking.`),
      ...memberRows([GIFT], [div, SELL_HEAD, SELL_BODY, MEMBERSHIP_TABLE, SELL_HOW, SELL_BTN]),
      div,
      p(`Questions about your trip? Write to ${HELLO} and the Welcome Team will help you plan.`, 'center'),
      btn('Plan Your Visit', `${SITE}/visit`),
      footer,
    ],
  },
  // ------------------------------------------------------------------ T-30
  {
    slug: 'visit-t-30-plan-ahead',
    title: 'VISIT: T-30 Plan Ahead',
    subject: 'One month to Medora: your planning checklist',
    preheader: 'Lodging, seasonal hours and what to book before you go.',
    blocks: [
      header('visit-t-30-plan-ahead'),
      h('One Month to Medora'),
      p(`${GREET}<br><br>Your visit to the Theodore Roosevelt Presidential Library is one month away. This is the right moment to lock in the parts of a Badlands trip that fill up.`),
      ...memberOnly(p('<b>Thank you for planning another visit as a member.</b> Bringing friends? Your membership takes 25% off their admission tickets.')),
      h('Your Checklist'),
      table({
        columns: ['To do', 'Why now', ''],
        rowLabels: true,
        rows: [
          ['Book a place to stay', 'Medora is a small town. When it is full, Dickinson is 35 minutes east on I-94.', `<a href="${SITE}/visit/lodging/availability">Check availability</a>`],
          ['Pick your evenings', 'The Medora Musical and many attractions run on a summer season, roughly Memorial Day to Labor Day.', `<a href="${SITE}/visit/activities">Things to do</a>`],
          ['Map the drive', 'Mobile coverage is limited in parts of the Badlands. Download your route before you go.', `<a href="${SITE}/visit/directions">Directions</a>`],
          ['Plan a park day', 'The South Unit is minutes from the Library; the quieter North Unit is about 70 minutes north.', `<a href="${SITE}/visit/national-park">The park</a>`],
        ],
      }),
      h('Your Visit Day'),
      p(`Your date and entry time are on your ticket confirmation. The Library's hours change with the season, so check what time the doors open and close that day before you plan the rest of it. Salt+Scoria is open when the Library is, and no admission ticket is needed to eat there.`),
      btn('Hours for Your Visit', `${SITE}/visit/hours`),
      p('<b>Coming between late fall and spring?</b> Snow and high winds can close I-94 in western North Dakota. Check road conditions before you set out and give yourself extra time.'),
      div,
      h('A Preview of What Is Waiting'),
      img(TEASER, 'Watch the preview: Discover the Theodore Roosevelt Presidential Library (3:35)', VID('W9sq8PuGQVo'), 'Not seen it yet? A 3½-minute look at the Library, Medora and the national park'),
      cols(
        { src: THUMB('yEEsRy7sdng'), alt: "Step into the Amazon: Theodore Roosevelt's River of Doubt", heading: 'The River of Doubt',
          text: "Step into Roosevelt's Amazon expedition, one of the galleries you will walk through.", label: 'Watch (0:53)', href: VID('yEEsRy7sdng') },
        { src: THUMB('zRPJAdE-IBI'), alt: 'The TR Library Boardwalk through the Badlands', heading: 'The Boardwalk',
          text: 'A one-mile loop through restored prairie, with Badlands views the whole way.', label: 'Watch (1:34)', href: VID('zRPJAdE-IBI') }),
      ...memberRows([GIFT], [div, SELL_HEAD, SELL_BODY, MEMBERSHIP_TABLE, SELL_HOW, SELL_BTN]),
      div,
      p(`Questions? Write to ${HELLO}. The Welcome Team is glad to help you plan.`, 'center'),
      btn('Plan Your Visit', `${SITE}/visit`),
      footer,
    ],
  },
  // ------------------------------------------------------------------ T-3 (proposed replacement)
  {
    slug: 'visit-t-3-know-before',
    title: 'VISIT: T-3 Know Before You Go',
    subject: 'Three days to the Badlands: what to know before you go',
    preheader: 'Your entry window, parking, what to bring and how to make a day of it.',
    blocks: [
      header('visit-t-3-know-before'),
      h('Three Days to the Badlands'),
      p(`${GREET}<br><br>In three days, you will stand where a young Theodore Roosevelt rebuilt himself, on the buttes above the Little Missouri. Here is everything that makes the day go smoothly.`),
      ...memberRows(
        [p('<b>Welcome back, member.</b> Use the member line at the entrance, and remember 25% off extra admission tickets and 10% off in the Library Shop and at Salt+Scoria.')],
        [p(`<b>Thinking about membership?</b> Anyone at the front desk can refund these tickets and put what you paid toward a membership, and your reservation stays as it is. You can also email ${MEMBERSHIP_MAIL} before you come.`)]),
      h('Your Entry Window'),
      p('Arrive up to <b>15 minutes before</b> the time on your ticket, or any time within that hour. With a 10:00 AM ticket, come any time from 9:45 to 11:00 AM. Leave a few minutes for the walk from the lot and a quick security check.', 'left'),
      table({
        columns: ['Bring', 'Leave in the car'],
        rows: [
          ['Comfortable shoes and a layer for the wind', 'Bags larger than 12 × 12 × 6 inches (free lockers hold a day bag)'],
          ['A water bottle with a sealed lid; refill stations inside', 'Pocket knives (staff will hold one for you); no weapons on site'],
          ['A card or phone: the campus is cashless', 'Double-wide strollers (single strollers are welcome)'],
        ],
        note: 'Only service animals go inside; leashed dogs are welcome on the grounds. Never leave a pet in a parked car.',
      }),
      h('Parking'),
      p('Parking is free. Take the first roundabout into the main lot under the solar canopies. Driving an RV or towing? Use the Medora Musical lot instead. Accessible spaces and a drop-off sit right by the entrance, and EV chargers are first come, first served.'),
      h('Badlands Weather'),
      img('https://weather.labs.trlibrary.com/images/social.png', 'Current weather and three-day forecast for Medora, North Dakota', 'https://trlibrary.com/weather/', 'Live from the National Weather Service. Tap for the full forecast.'),
      h('Make a Day of It'),
      p(`Plan about three and a half hours for the galleries, then walk the one-mile boardwalk or the rooftop prairie. Many visitors pair the Library with the national park: drive the South Unit's scenic loop in the morning, when wildlife is most active, and spend the afternoon here. Salt+Scoria serves breakfast and lunch, and it is quieter before or after the noon rush.`),
      img(`${IMG}video-qrwdZmqFO5A-teaser.gif`, 'Watch how it works: Your Journey Starts Here, The Trailblazer (1:21)', VID('qrwdZmqFO5A'), 'Watch: how your Trailblazer works (1:21). A link to set yours up arrives the day before your visit.'),
      p(`Check the <a href="${SITE}/visit/hours">hours</a> and, in winter, <a href="https://travel.dot.nd.gov/">North Dakota road conditions</a> before you leave. Need a wheelchair, help from the lot or anything arranged ahead? Write to ${HELLO}.`),
      btn('Everything to Know', `${SITE}/visit/faq`),
      footer,
    ],
  },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

if (PHOTOS) {
  const pg = await browser.newPage();
  await pg.goto('https://newsletter.labs.trlibrary.com/header.html');
  await pg.waitForFunction(() => window.HDR);
  for (const [slug, hd] of Object.entries(HEADERS)) {
    const b64 = fs.readFileSync(PHOTOS + '/' + hd.photo).toString('base64');
    const data = await pg.evaluate(async ({ b64, opts }) => {
      await HDR.setImage('data:image/jpeg;base64,' + b64);
      await HDR.setOptions(Object.assign({ zoom: 1, panX: 0, panY: 0, dim: 0, scale: 0.78, yoff: 0 }, opts));
      return await HDR.exportDataURL({ format: 'jpeg' });
    }, { b64, opts: hd.opts });
    fs.writeFileSync(`${OUT}/img/${slug}-header.jpg`, Buffer.from(data.split(',')[1], 'base64'));
  }
  await pg.close();
}

const pg = await browser.newPage();
await pg.goto('https://newsletter.labs.trlibrary.com/');
await pg.waitForFunction(() => window.NB && NB.version && NB.version.startsWith('2.'));
for (const e of emails) {
  const out = await pg.evaluate(({ title, subject, preheader, blocks }) => {
    NB.setState({ title, subject, preheader, fromName: 'Theodore Roosevelt Presidential Library', blocks });
    // Headers are relative preview paths until uploaded to the Constant Contact library.
    const issues = NB.checkExport().filter(i => i.level === 'error' && !/image/i.test(i.message));
    return { issues, html: NB.exportHTML({ strict: false }), sheet: NB.exportBuildSheet(), json: NB.toJSON() };
  }, e);
  if (out.issues.length) throw new Error(e.slug + ': ' + JSON.stringify(out.issues));
  if (/\[#|\$\{|<@/.test(out.html)) throw new Error('forbidden sequence in ' + e.slug);
  fs.writeFileSync(`${OUT}/${e.slug}.html`, out.html);
  fs.writeFileSync(`${OUT}/${e.slug}.buildsheet.txt`, out.sheet);
  fs.writeFileSync(`${OUT}/${e.slug}.json`, JSON.stringify(out.json, null, 2));
  console.log(e.slug, out.html.length);
}
await browser.close();
