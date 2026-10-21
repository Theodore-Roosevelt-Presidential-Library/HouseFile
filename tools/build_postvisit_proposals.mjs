// Builds the proposed POST-VISIT emails with the Newsletter Builder v2 API (window.NB) and
// Header Studio (window.HDR), like build_visit_proposals.mjs.
// Usage (from the repo root): node tools/build_postvisit_proposals.mjs docs/proposals [<photo-dir>]
//   <photo-dir> holds the header photos named in HEADERS (from trlibrary.com, <= 2400 px wide);
//   omit it to keep the existing header JPGs. Then: python collect_automations.py --offline
// Facts come from trlibrary.com (newsletter, /tr, /quiz, Good Citizen, private events, special
// events, membership) and shop.trlibrary.com, checked 2026-10-20. Proposals only: nothing here
// goes into Constant Contact.
import { chromium } from 'playwright';
import fs from 'fs';

const OUT = process.argv[2];
const PHOTOS = process.argv[3];
const IMG = 'proposals/img/';
const SITE = 'https://www.trlibrary.com';
const SHOP = 'https://shop.trlibrary.com';
const NEWSLETTER = `${SITE}/newsletter`;
const HELLO = '<a href="mailto:hello@trlibrary.com">hello@trlibrary.com</a>';
const GREET = 'Hello [[FIRSTNAME OR "Friend"]],';
const NOTE = 'You are receiving this email because you visited the Theodore Roosevelt Presidential Library.';

// Header Studio banners (approved pairings only).
const HEADERS = {
  'visit-t-plus-2-thank-you':      { photo: 'painted-canyon.jpg', opts: { pairing: 'gray-sky-black', panY: 300 } },                  // Badlands sky over the canyon
  'visit-t-plus-7-keep-exploring': { photo: 'Roof.jpeg', opts: { pairing: 'bright-forest-black' } },                                 // the planted roof
  'visit-t-plus-14-shop':          { photo: 'Theodore_Roosevelt_Presidential_Library-088_half-size.jpg', opts: { pairing: 'sand-black' } }, // the Library Shop
  'visit-t-plus-30-host-an-event': { photo: 'building-clean-june.jpg', opts: { pairing: 'night-sky-white', zoom: 1.6, panX: -600 } }, // the Library on the prairie
  'visit-t-plus-60-come-back':     { photo: 'TRPL-Roof_Threefold-006.jpg', opts: { pairing: 'deep-orange-black' } },               // a couple on the planted roof
};
// Checked by eye: the wordmark covers no one's face and none of the building's main lines.
// Real photos only: no architectural renderings (the Snohetta / Plomp images) in any email.

// ---- blocks ----
const header = slug => ({ type: 'header', props: { src: IMG + slug + '-header.jpg', alt: 'Theodore Roosevelt Presidential Library', href: SITE } });
const footer = { type: 'footer', props: { note: NOTE, contactLabel: 'Questions', contactUrl: 'mailto:hello@trlibrary.com' } };
const h = text => ({ type: 'heading', props: { text, align: 'center' } });
const p = (html, align = 'left') => ({ type: 'text', props: { html, align } });
const btn = (label, href) => ({ type: 'button', props: { label, href } });
const img = (src, alt, href = '', caption = '') => ({ type: 'image', props: { src, alt, href, caption } });
const div = { type: 'divider', props: {} };
const cols = (a, b) => ({ type: 'columns', props: { cols: [a, b] } });
const table = props => ({ type: 'table', props: Object.assign({ rowLabels: false, highlight: null, style: 'standard', note: '', intro: '' }, props) });

// Member or not: Acme - Is Active Member (active / new = member). In Constant Contact the
// path splits on the Active Members segment and each branch gets its own HTML variant.
const MEMBER = { tag: 'custom.acme_-_is_active_member', field: 'Acme - Is Active Member', label: 'Membership', other: 'Not a member' };
let G = 0;
const clone = b => JSON.parse(JSON.stringify(b));
const memberRows = (memberBlocks, otherBlocks) => {
  const group = 'p' + (++G);
  return [
    ...memberBlocks.map(b => Object.assign(clone(b), { cond: Object.assign({ group, kind: 'if', is: ['active', 'new'] }, MEMBER) })),
    ...otherBlocks.map(b => Object.assign(clone(b), { cond: Object.assign({ group, kind: 'else', is: [] }, MEMBER) })),
  ];
};
const memberOnly = (...blocks) => memberRows(blocks, []);

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
  note: 'Every level adds the member line, early ticket access, invitations to member events, and 10% off in the Library Shop and at Salt+Scoria. Save 10% more with auto-renew or two years.',
});
const MEMBERSHIP_BTN = btn('See Membership Levels', `${SITE}/membership`);
// Gift memberships: the same join page the website's "Gift Memberships" button opens.
const GIFT_URL = 'https://access.trlibrary.com/membership/613/join';
const GIFT = [
  p('<b>Know someone who would love it here?</b> As a member you take 10% off gift memberships.', 'center'),
  btn('Give a Membership', GIFT_URL),
];
// Reviews (listing IDs match the review dashboard, Reviews repo): Google place, TripAdvisor d34391224, Yelp.
const REVIEW_GOOGLE = 'https://search.google.com/local/writereview?placeid=ChIJbynQegDrJVMRSCAxmOeViVg';
const REVIEW_TRIPADVISOR = 'https://www.tripadvisor.com/UserReviewEdit-g60973-d34391224-Theodore_Roosevelt_Presidential_Library-Medora_North_Dakota.html';
const REVIEW_YELP = 'https://www.yelp.com/biz/theodore-roosevelt-presidential-library-medora-2';
// Social profiles: the trlibrary.com site footer, checked 2026-10-21.
const YOUTUBE = 'https://www.youtube.com/channel/UCPOPdzgpO4liPSWkk7VqS5A';
const SOCIAL = [
  ['Facebook', 'https://www.facebook.com/TRPresidentialLibrary'],
  ['Instagram', 'https://www.instagram.com/trlibrary'],
  ['YouTube', YOUTUBE],
  ['LinkedIn', 'https://www.linkedin.com/company/trlibrary/'],
  ['X', 'https://x.com/TRPresLibrary'],
  ['Bluesky', 'https://bsky.app/profile/trpl.bsky.social'],
];
const SOCIAL_LINKS = SOCIAL.map(([n, u]) => `<a href="${u}">${n}</a>`).join(' &nbsp;·&nbsp; ');
const FOLLOW_LINE = p(`<b>Follow the Library</b><br>${SOCIAL_LINKS}`, 'center');
const JOIN_US = `${SITE}/join-us`;

const COMING_BACK = p(`<b>Coming back?</b> A membership covers a full year of visits for you and your guests. <a href="${SITE}/membership">See the levels</a>.`, 'center');

const emails = [
  // ------------------------------------------------------------------ T+2
  {
    slug: 'visit-t-plus-2-thank-you',
    title: 'VISIT: T+2 Thank You',
    subject: 'Thank you for coming to the Badlands',
    preheader: 'Pick what you want to hear about next, from the archive to the prairie.',
    blocks: [
      header('visit-t-plus-2-thank-you'),
      h('Thank You for Coming'),
      p(`${GREET}<br><br>Thank you for spending a day at the Theodore Roosevelt Presidential Library. If you carried a Trailblazer through the galleries, your journal and photos arrived in a separate email. They stay online for 30 days, so save the ones you want to keep.`),
      ...memberOnly(p('<b>Thank you for visiting as a member.</b> Your membership covers every visit until it renews, so come back whenever the Badlands call.')),
      div,
      h('How Was Your Visit?'),
      p("A few words from you help the next traveler decide to make the drive to Medora. The Library reads every review, and a short one counts just as much as a long one."),
      btn('Review on Google', REVIEW_GOOGLE),
      p(`Or share it on <a href="${REVIEW_TRIPADVISOR}">TripAdvisor</a> or <a href="${REVIEW_YELP}">Yelp</a>.`, 'center'),
      div,
      h('Tell Us What to Send You'),
      p("The Library's newsletter, <i>Mail from the Badlands</i>, comes in topics. Pick the ones you care about, and those are the only ones you will get."),
      table({
        columns: ['Topic', 'What arrives'],
        rowLabels: true,
        rows: [
          ['From the Archive', "One story a month from the collection: a page of T.R.'s diary, a letter home from the Badlands, an object with a history."],
          ['The Badlands', "A monthly look at the landscape that shaped T.R., and at the native prairie being restored across the Library's 93 acres."],
          ['Events & Programs', 'Talks, family days, festivals and evening programs, sent while seats are still open.'],
          ['Library News & History', 'Exhibition openings, building news and stories from the collection. The one to pick if you pick only one.'],
          ['Conservation & Sustainability', 'How the building works and what the land is doing, plus the Native Plant Project.'],
          ['Salt+Scoria', "Seasonal menus, special dinners and reservation windows at the Library's restaurant."],
          ['The Shop', 'New arrivals, seasonal sales and small-batch goods from the Library Shop.'],
          ['Educators & Homeschool', 'Primary sources, field trip booking windows and professional development, five or six emails a year.'],
        ],
      }),
      btn('Choose Your Topics', NEWSLETTER),
      ...memberRows(GIFT, [
        div,
        h('Come Back as a Member'),
        p('Admission is $26 for adults and $16 for youth. A membership covers a full year of visits, and Individual and Dual pay for themselves on your second trip.'),
        MEMBERSHIP_TABLE,
        MEMBERSHIP_BTN,
      ]),
      div,
      h('Follow Along'),
      p("On-this-day stories from T.R.'s life, the Badlands through the seasons and the latest from the Library, every week on social media."),
      p(SOCIAL_LINKS, 'center'),
      div,
      p(`Something to tell the Library about your day? Write to ${HELLO}.`, 'center'),
      footer,
    ],
  },
  // ------------------------------------------------------------------ T+7
  {
    slug: 'visit-t-plus-7-keep-exploring',
    title: 'VISIT: T+7 Keep Exploring',
    subject: "The rest of T.R.'s story, from home",
    preheader: 'Six chapters of his life, quizzes for every level and a podcast recorded at the Library.',
    blocks: [
      header('visit-t-plus-7-keep-exploring'),
      h('The Story Keeps Going'),
      p(`${GREET}<br><br>The galleries cover a lot of ground in one visit. The rest of Theodore Roosevelt's life is online, told in six chapters, from a Manhattan childhood to an unmapped river in the Amazon.`),
      cols(
        { src: IMG + 'pv-tr-badlands.jpg', alt: 'Theodore Roosevelt in buckskin standing guard with his rifle', heading: 'The Badlands',
          text: 'He came to Dakota to hunt a bison and stayed to run cattle on the Little Missouri. Read how the Badlands gave him a new life.', label: 'Read the Chapter', href: `${SITE}/tr/badlands` },
        { src: IMG + 'pv-tr-conservation.jpg', alt: 'Yosemite Valley with El Capitan and Half Dome', heading: 'Conservation',
          text: 'Parks, forests, monuments and bird reserves: roughly 230 million acres protected, and how he did it.', label: 'Explore', href: `${SITE}/tr/presidency/conservation` }),
      btn("Explore T.R.'s Life", `${SITE}/tr`),
      div,
      h('Test What You Learned'),
      cols(
        { src: IMG + 'pv-quiz-myths.jpg', alt: 'Clifford Berryman 1902 cartoon Drawing the Line in Mississippi', heading: 'Fact or Fiction',
          text: 'Fifteen questions separating the famous stories from the record.', label: 'Take the Quiz', href: `${SITE}/quiz/myths` },
        { src: IMG + 'pv-quiz-family.jpg', alt: 'A grassy coulee opening onto badlands country', heading: 'Animals of the Badlands',
          text: 'A family edition: nine short questions on what T.R. watched from the saddle, and what is still out there.', label: 'Play Together', href: `${SITE}/quiz/badlands-wildlife-family` }),
      p(`Dozens more, from family editions to expert level, at <a href="${SITE}/quiz">trlibrary.com/quiz</a>.`, 'center'),
      div,
      h('Watch and Tune In Live'),
      p("Book talks with authors, curator talks from the collection and Taste of History stream live on the Library's YouTube channel at 5:30 p.m. MT. Subscribe, like the videos you enjoy and turn on notifications to be the first to know when the next virtual event goes live."),
      cols(
        { src: IMG + 'pv-watch-youtube.jpg', alt: 'Book Talk title card for a virtual program streamed by the Library', heading: 'Live on YouTube',
          text: 'Virtual events stream on the Library channel. Subscribe so the next one lands in your feed.', label: 'Subscribe', href: `${YOUTUBE}?sub_confirmation=1` },
        { src: IMG + 'pv-watch-videos.jpg', alt: 'Curator Talk title card from the Library video collection', heading: 'The Video Library',
          text: 'Every past talk, film and program, sorted into series, at trlibrary.com/video.', label: 'Start Watching', href: `${SITE}/video` }),
      div,
      h('Listen: Good Citizen'),
      p('Ted Roosevelt V hosts conversations with people who step into the arena to build up the country and protect the planet. The <i>Live from the TRPL</i> series is recorded at the Library, beginning with presidential historian Doris Kearns Goodwin. Good Citizen was a 2024 Webby Award Honoree.'),
      p('<a href="https://podcasts.apple.com/us/podcast/good-citizen/id1713230937">Apple Podcasts</a> &nbsp;·&nbsp; <a href="https://open.spotify.com/show/7ywQA9wJGztUPmedmG6BSe">Spotify</a> &nbsp;·&nbsp; <a href="https://www.youtube.com/playlist?list=PL-sck-PjBiFcxu6QSF_0u7aDB9EJ5mLe_">YouTube</a>', 'center'),
      btn('Listen to Good Citizen', `${SITE}/podcast/good-citizen`),
      ...memberRows(GIFT, [COMING_BACK]),
      div,
      FOLLOW_LINE,
      footer,
    ],
  },
  // ------------------------------------------------------------------ T+14
  {
    slug: 'visit-t-plus-14-shop',
    title: 'VISIT: T+14 From the Shop',
    subject: 'Bring a piece of the Badlands home',
    preheader: "The Library Shop is open online, with pieces you won't find in Medora.",
    blocks: [
      header('visit-t-plus-14-shop'),
      h('From the Library Shop'),
      p(`${GREET}<br><br>The Library Shop is open online, and some pieces are sold only there. Every purchase helps support the Library.`),
      ...memberRows(
        [p('<b>Your member discount works here too.</b> As a [[custom.acme_-_membership_level OR "Library"]] member, you take 10% off every order, online and in the Library Shop in Medora.')],
        [p('<b>Members take 10% off every order</b>, online and in the Library Shop in Medora, on top of a full year of free admission.')]),
      cols(
        { src: IMG + 'pv-shop-backpack.jpg', alt: 'Special Edition Filson Olive All-Weather Backpack', heading: 'Filson All-Weather Backpack',
          text: "A special edition of Filson's all-weather pack, in olive or slate.", label: 'Shop Bags', href: `${SHOP}/collections/luggage-bags` },
        { src: IMG + 'pv-shop-bully-hat.jpg', alt: 'Authentic Bully! hat in navy', heading: 'The Bully! Hat',
          text: "T.R.'s famous exclamation, on a navy cap.", label: 'Shop Hats', href: `${SHOP}/collections/hats` }),
      cols(
        { src: IMG + 'pv-shop-arena-tee.jpg', alt: 'Ice blue Arena quote T-shirt', heading: 'Arena Quote T-shirt',
          text: 'The man in the arena, on an ice blue tee.', label: 'Shop Apparel', href: `${SHOP}/collections/apparel-accessories` },
        { src: IMG + 'pv-shop-journal.jpg', alt: 'TRPL Bella Luna journal and pen set', heading: 'Journal and Pen Set',
          text: 'A Bella Luna journal and pen for your own field notes.', label: 'Shop Gifts', href: `${SHOP}/collections/all` }),
      btn('Shop Online', SHOP),
      p(`Hear about new arrivals and seasonal sales first: add <a href="${NEWSLETTER}">The Shop</a> to your newsletter topics.`, 'center'),
      ...memberRows(GIFT, [
        div,
        h('Save 10% as a Member'),
        p('A membership pays you back twice: 10% off in the shop, online and in Medora, and free admission for a full year. Individual and Dual pay for themselves on your second visit.'),
        MEMBERSHIP_TABLE,
        MEMBERSHIP_BTN,
      ]),
      div,
      FOLLOW_LINE,
      footer,
    ],
  },
  // ------------------------------------------------------------------ T+30
  {
    slug: 'visit-t-plus-30-host-an-event',
    title: 'VISIT: T+30 Host an Event',
    subject: 'Host your next gathering above the Badlands',
    preheader: 'Weddings, retreats, private dinners and reunions at the Library.',
    blocks: [
      header('visit-t-plus-30-host-an-event'),
      h('Host Your Event at the Library'),
      p(`${GREET}<br><br>You have seen the galleries by day. After hours, the Library hosts weddings, leadership retreats, private dinners and family reunions, with sunset over the Badlands as the backdrop.`),
      img(IMG + 'pv-events-overlook-wide.jpg', 'Two people on the Library boardwalk looking out over the Badlands'),
      table({
        columns: ['Event', 'At the Library'],
        rowLabels: true,
        rows: [
          ['Weddings and celebrations', 'Indoor and outdoor ceremonies, terraces above the Little Missouri, and receptions in spaces most guests see only once.'],
          ['Corporate gatherings', 'Board retreats, offsites, client trips and launches, with private conference space.'],
          ['Private dinners', 'Seated dinners for 12 to 60, or cocktails on a terrace as the light drops.'],
          ['Nonprofit and association events', 'Conferences, galas and convenings in a nonpartisan setting.'],
        ],
      }),
      p("Every event includes the Library's events team and its list of regional caterers and partners. Add curator-led tours or after-hours access to the galleries."),
      cols(
        { src: IMG + 'pv-events-galleries.jpg', alt: 'The Library galleries', heading: 'The Spaces',
          text: 'The auditorium, classroom, lobby, terraces and restaurant, in one look book.', label: 'See the Spaces', href: `${SITE}/private-events/spaces` },
        { src: IMG + 'pv-events-terrace.jpg', alt: 'A family on the Library terrace', heading: 'Terraces and Catering',
          text: 'Terraces above the Badlands, and menus for receptions, seated dinners and everything in between.', label: 'See Catering', href: `${SITE}/private-events/catering` }),
      btn('Start an Inquiry', `${SITE}/private-events/inquiry`),
      p("Planning something that doesn't fit a category? Ask anyway.", 'center'),
      div,
      FOLLOW_LINE,
      footer,
    ],
  },
  // ------------------------------------------------------------------ T+60
  {
    slug: 'visit-t-plus-60-come-back',
    title: 'VISIT: T+60 Reasons to Come Back',
    subject: "What's next at the Library",
    preheader: 'Talks, screenings, family days and evening programs on the butte.',
    blocks: [
      header('visit-t-plus-60-come-back'),
      h('Come Back to the Badlands'),
      p(`${GREET}<br><br>No two visits to the Library have to look alike. Special events change with the seasons: talks with historians and authors, film screenings in the auditorium, family days, festivals and evening programs on the butte.`),
      cols(
        { src: IMG + 'pv-come-back-events.jpg', alt: 'A family under the stars at the Elkhorn campfire in the galleries', heading: 'Special Events',
          text: 'Talks, screenings, festivals and evening programs, each with its own date and ticket.', label: 'See Special Events', href: `${SITE}/calendar/special-event` },
        { src: IMG + 'pv-come-back-tours.jpg', alt: 'Visitors hearing the story of the Elkhorn Ranch cabin', heading: 'Specialty Tours',
          text: 'Tours built around a single subject, offered on select days.', label: 'See Tours', href: `${SITE}/calendar/specialty-tour` }),
      p(`Hear about events while seats are still open: add <a href="${NEWSLETTER}">Events &amp; Programs</a> to your newsletter topics.`, 'center'),
      ...memberRows(
        [p('<b>As a member</b>, you get early ticket access and invitations to member events, and your free admission covers every visit until your membership renews.')],
        [div, h('Make It a Membership'), p('A membership covers a full year of visits, and Individual and Dual pay for themselves on your second trip.'), MEMBERSHIP_TABLE, MEMBERSHIP_BTN]),
      div,
      h('Carry the Story Forward'),
      p("The Library is a nonprofit, and it runs on people who believe T.R.'s story still has something to teach. If your visit stayed with you, help carry it forward."),
      p('<b>MISSION</b><br>Explore TR’s life, legacy, and enduring relevance.<br><br><b>VISION</b><br>Inspire action and fearless participation in the arena.<br><br><b>VALUES</b><br>Dare Greatly | Think Boldly | Live Passionately | Care Deeply', 'center'),
      btn('Join Us in the Arena', JOIN_US),
      p(`Planning another trip? <a href="${SITE}/visit">Start here</a>.`, 'center'),
      div,
      FOLLOW_LINE,
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
    // Images are relative preview paths until uploaded to the Constant Contact library.
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
