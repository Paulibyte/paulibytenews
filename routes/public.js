const express = require('express');
const { db, settings } = require('../db');
const H = require('../lib/helpers');
const router = express.Router();

const BASE = `SELECT p.*, c.name AS cat_name, c.slug AS cat_slug, c.color AS cat_color,
  u.name AS author_name, u.avatar AS author_avatar
  FROM posts p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN users u ON u.id = p.author_id`;
const LIVE = `p.status = 'published' AND p.published_at <= datetime('now')`;

function decorate(p) {
  if (!p) return p;
  p.review = H.parseJSON(p.review_json, null);
  p.minutes = H.readingTime(p.content);
  p.url = `/article/${p.slug}`;
  p.summary = p.excerpt || H.excerptOf(p.content);
  return p;
}
const list = (sql, ...args) => db.prepare(sql).all(...args).map(decorate);

// Shared sidebar/nav data
router.use((req, res, next) => {
  res.locals.navCats = db.prepare('SELECT * FROM categories ORDER BY sort, name').all();
  res.locals.breaking = list(`${BASE} WHERE ${LIVE} AND p.is_breaking = 1 ORDER BY p.published_at DESC LIMIT 5`);
  res.locals.sideTrending = () => list(`${BASE} WHERE ${LIVE} AND p.published_at >= datetime('now','-45 days') ORDER BY p.views DESC LIMIT 5`);
  res.locals.sideLab = () => db.prepare(`SELECT * FROM products WHERE status IN ('testing','queued') ORDER BY CASE status WHEN 'testing' THEN 0 ELSE 1 END, sort, id DESC LIMIT 4`).all();
  next();
});

/* ---------- Home ---------- */
router.get('/', (req, res) => {
  const featured = list(`${BASE} WHERE ${LIVE} AND p.is_featured = 1 ORDER BY p.published_at DESC LIMIT 5`);
  const exclude = featured.map(p => p.id).join(',') || '0';
  const latest = list(`${BASE} WHERE ${LIVE} AND p.id NOT IN (${exclude}) ORDER BY p.published_at DESC LIMIT 12`);
  const reviews = list(`${BASE} WHERE ${LIVE} AND p.type = 'review' ORDER BY p.published_at DESC LIMIT 4`);
  const bench = db.prepare(`SELECT pr.*, u.name AS tester_name FROM products pr LEFT JOIN users u ON u.id = pr.tester_id
    WHERE pr.status IN ('testing','queued') ORDER BY CASE pr.status WHEN 'testing' THEN 0 ELSE 1 END, pr.sort, pr.id DESC LIMIT 8`).all();
  const catBlocks = res.locals.navCats.slice(0, 4).map(c => ({
    cat: c, posts: list(`${BASE} WHERE ${LIVE} AND p.category_id = ? ORDER BY p.published_at DESC LIMIT 4`, c.id),
  })).filter(b => b.posts.length);
  const fallbackHero = featured.length ? featured : latest.splice(0, 3);
  res.render('index', { title: null, featured: fallbackHero, latest, reviews, bench, catBlocks });
});

/* ---------- Article ---------- */
router.get('/article/:slug', (req, res, next) => {
  const preview = req.query.preview && res.locals.me;
  const p = decorate(db.prepare(`${BASE} WHERE p.slug = ? ${preview ? '' : 'AND ' + LIVE}`).get(req.params.slug));
  if (!p) return next();
  if (!preview) db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(p.id);
  const s = res.locals.s;
  p.body = H.injectInArticleAds(p.content, parseInt(s.in_article_ad_after) || 3, parseInt(s.in_article_ad_every) || 0);
  const author = db.prepare('SELECT id, name, bio, avatar, twitter, role FROM users WHERE id = ?').get(p.author_id);
  const related = list(`${BASE} WHERE ${LIVE} AND p.id != ? AND (p.category_id = ? OR p.type = ?) ORDER BY p.published_at DESC LIMIT 4`, p.id, p.category_id, p.type);
  const comments = db.prepare(`SELECT * FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at`).all(p.id);
  const product = p.product_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(p.product_id) : null;
  const prev = db.prepare(`SELECT title, slug FROM posts p WHERE ${LIVE} AND published_at < ? ORDER BY published_at DESC LIMIT 1`).get(p.published_at || '');
  const next_ = db.prepare(`SELECT title, slug FROM posts p WHERE ${LIVE} AND published_at > ? ORDER BY published_at ASC LIMIT 1`).get(p.published_at || '');
  res.render('article', {
    title: p.seo_title || p.title, description: p.seo_description || p.summary, ogImage: p.cover_image, ogType: 'article',
    p, author, related, comments, product, prev, next: next_, preview,
    commentOk: req.query.c === '1',
  });
});

router.post('/article/:slug/comment', (req, res) => {
  const p = db.prepare(`SELECT id, slug, allow_comments FROM posts p WHERE slug = ? AND ${LIVE}`).get(req.params.slug);
  if (!p || !p.allow_comments) return res.redirect('/');
  const { name, email, body, website } = req.body;
  if (website) return res.redirect(`/article/${p.slug}`); // honeypot
  if (name && body && body.length <= 3000) {
    db.prepare('INSERT INTO comments (post_id, name, email, body) VALUES (?,?,?,?)').run(p.id, name.slice(0, 80), (email || '').slice(0, 120), body.trim());
  }
  res.redirect(`/article/${p.slug}?c=1#comments`);
});

/* ---------- Listings ---------- */
function paged(req, res, view, where, args, extra) {
  const per = parseInt(res.locals.s.posts_per_page) || 12;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const total = db.prepare(`SELECT COUNT(*) n FROM posts p LEFT JOIN categories c ON c.id = p.category_id WHERE ${LIVE} AND ${where}`).get(...args).n;
  const posts = list(`${BASE} WHERE ${LIVE} AND ${where} ORDER BY ${extra.order || 'p.published_at DESC'} LIMIT ${per} OFFSET ${(page - 1) * per}`, ...args);
  res.render(view, { ...extra, posts, page, pages: Math.max(1, Math.ceil(total / per)), total });
}

router.get('/category/:slug', (req, res, next) => {
  const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!cat) return next();
  paged(req, res, 'listing', 'p.category_id = ?', [cat.id], { title: cat.name, heading: cat.name, sub: cat.description, accent: cat.color, description: cat.description });
});
router.get('/tag/:tag', (req, res) => {
  const t = req.params.tag.toLowerCase();
  paged(req, res, 'listing', `(',' || lower(replace(p.tags,', ',',')) || ',') LIKE ?`, [`%,${t},%`], { title: `#${t}`, heading: `#${t}`, sub: 'Stories tagged ' + t });
});
const TYPES = { news: 'News', feature: 'Features', howto: 'How-To Guides', opinion: 'Opinion' };
router.get('/type/:type', (req, res, next) => {
  if (!TYPES[req.params.type]) return next();
  paged(req, res, 'listing', 'p.type = ?', [req.params.type], { title: TYPES[req.params.type], heading: TYPES[req.params.type] });
});
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (!q) return res.render('listing', { title: 'Search', heading: 'Search', sub: '', posts: [], page: 1, pages: 1, total: 0, q });
  const like = `%${q}%`;
  paged(req, res, 'listing', '(p.title LIKE ? OR p.excerpt LIKE ? OR p.tags LIKE ? OR p.content LIKE ?)', [like, like, like, like],
    { title: `Search: ${q}`, heading: `Results for “${q}”`, q });
});
router.get('/author/:id', (req, res, next) => {
  const a = db.prepare('SELECT id, name, bio, avatar, twitter, role FROM users WHERE id = ?').get(req.params.id);
  if (!a) return next();
  paged(req, res, 'listing', 'p.author_id = ?', [a.id], { title: a.name, heading: a.name, sub: a.bio, author: a });
});

/* ---------- Reviews hub ---------- */
router.get('/reviews', (req, res) => {
  const sort = req.query.sort === 'score' ? 'score' : 'new';
  const kind = String(req.query.kind || '');
  let posts = list(`${BASE} WHERE ${LIVE} AND p.type = 'review' ORDER BY p.published_at DESC`);
  const kinds = [...new Set(posts.map(p => p.review && p.review.kind).filter(Boolean))].sort();
  if (kind) posts = posts.filter(p => p.review && p.review.kind === kind);
  if (sort === 'score') posts.sort((a, b) => ((b.review && b.review.score) || 0) - ((a.review && a.review.score) || 0));
  const choice = posts.filter(p => p.review && p.review.award).slice(0, 3);
  res.render('reviews', { title: 'Reviews', description: 'Hands-on, lab-tested tech product reviews.', posts, kinds, kind, sort, choice });
});

/* ---------- Review Lab ---------- */
router.get('/lab', (req, res) => {
  const all = db.prepare(`SELECT pr.*, u.name AS tester_name, u.avatar AS tester_avatar, po.slug AS post_slug, po.review_json
    FROM products pr LEFT JOIN users u ON u.id = pr.tester_id LEFT JOIN posts po ON po.id = pr.post_id
    ORDER BY pr.sort, pr.id DESC`).all();
  for (const p of all) { p.tests = H.parseJSON(p.tests_json, []); p.rv = H.parseJSON(p.review_json, null); }
  const updates = db.prepare(`SELECT l.*, pr.name AS product_name, pr.slug AS product_slug, u.name AS user_name
    FROM lab_updates l JOIN products pr ON pr.id = l.product_id LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 8`).all();
  res.render('lab', {
    title: 'Review Lab — what we are testing now',
    description: 'See the tech products currently on the PaulibyteNews test bench, what is queued next, and vote for what we review.',
    testing: all.filter(p => p.status === 'testing'),
    queued: all.filter(p => p.status === 'queued').sort((a, b) => b.votes - a.votes),
    done: all.filter(p => p.status === 'published' || p.status === 'longterm'),
    updates, voted: (req.cookies.pbn_votes || '').split('.'),
  });
});
router.get('/lab/:slug', (req, res, next) => {
  const pr = db.prepare(`SELECT pr.*, u.name AS tester_name, u.avatar AS tester_avatar, u.id AS tester_uid, po.slug AS post_slug, po.title AS post_title, po.review_json
    FROM products pr LEFT JOIN users u ON u.id = pr.tester_id LEFT JOIN posts po ON po.id = pr.post_id AND po.status='published' WHERE pr.slug = ?`).get(req.params.slug);
  if (!pr) return next();
  pr.specs = H.parseJSON(pr.specs_json, []); pr.tests = H.parseJSON(pr.tests_json, []); pr.rv = H.parseJSON(pr.review_json, null);
  const updates = db.prepare(`SELECT l.*, u.name AS user_name FROM lab_updates l LEFT JOIN users u ON u.id = l.user_id WHERE product_id = ? ORDER BY created_at DESC`).all(pr.id);
  const coverage = list(`${BASE} WHERE ${LIVE} AND p.product_id = ? ORDER BY p.published_at DESC`, pr.id);
  res.render('lab-product', { title: `${pr.name} — in the Review Lab`, description: pr.summary, ogImage: pr.image, pr, updates, coverage,
    voted: (req.cookies.pbn_votes || '').split('.').includes(String(pr.id)) });
});
router.post('/lab/:id/vote', (req, res) => {
  const id = String(parseInt(req.params.id));
  const voted = (req.cookies.pbn_votes || '').split('.').filter(Boolean);
  if (!voted.includes(id)) {
    db.prepare(`UPDATE products SET votes = votes + 1 WHERE id = ? AND status = 'queued'`).run(id);
    voted.push(id);
    res.cookie('pbn_votes', voted.slice(-200).join('.'), { maxAge: 365 * 864e5, httpOnly: true, sameSite: 'lax' });
  }
  try {
    const u = new URL(req.get('referer') || '');
    if (u.host === req.get('host')) return res.redirect(u.pathname + u.search + '#p' + id);
  } catch { /* fall through */ }
  res.redirect('/lab');
});

/* ---------- Advertise / pages ---------- */
router.get('/advertise', (req, res) => {
  const rates = (res.locals.s.rate_card || '').split('\n').filter(Boolean).map(l => l.split('|'));
  res.render('advertise', { title: 'Advertise with us', rates, sent: req.query.sent === '1' });
});
router.post('/advertise', (req, res) => {
  const { name, company, email, phone, package: pkg, message, website } = req.body;
  if (!website && name && email) {
    db.prepare('INSERT INTO ad_inquiries (name, company, email, phone, package, message) VALUES (?,?,?,?,?,?)')
      .run(name, company || '', email, phone || '', pkg || '', (message || '').slice(0, 4000));
  }
  res.redirect('/advertise?sent=1#enquire');
});
router.get('/about', (req, res) => {
  const team = db.prepare(`SELECT id, name, bio, avatar, role FROM users WHERE active = 1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name`).all();
  res.render('about', { title: 'About us', team });
});
router.post('/subscribe', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  if (req.get('accept') && req.get('accept').includes('application/json')) return res.json({ ok: true });
  req.session.flash = 'Thanks — you are subscribed to the PaulibyteNews newsletter.';
  let back = '/';
  try { const u = new URL(req.get('referer') || ''); if (u.host === req.get('host')) back = u.pathname + u.search; } catch { /* home */ }
  res.redirect(back + '#newsletter');
});

/* ---------- Tracking redirects ---------- */
router.get('/ad/:id/click', (req, res) => {
  const ad = db.prepare('SELECT id, link FROM ads WHERE id = ?').get(req.params.id);
  if (!ad || !ad.link) return res.redirect('/');
  db.prepare('UPDATE ads SET clicks = clicks + 1 WHERE id = ?').run(ad.id);
  res.redirect(ad.link);
});
router.get('/go/:postId/:i', (req, res) => {
  const p = db.prepare('SELECT id, review_json FROM posts WHERE id = ?').get(req.params.postId);
  const r = p && H.parseJSON(p.review_json, null);
  const link = r && r.buy && r.buy[parseInt(req.params.i)];
  if (!link || !/^https?:\/\//.test(link.url)) return res.redirect('/');
  db.prepare('INSERT INTO affiliate_clicks (post_id, label, url) VALUES (?,?,?)').run(p.id, link.label || '', link.url);
  res.redirect(link.url);
});

/* ---------- Feeds, SEO, PWA ---------- */
router.get('/feed.xml', (req, res) => {
  const s = res.locals.s;
  const posts = list(`${BASE} WHERE ${LIVE} ORDER BY p.published_at DESC LIMIT 30`);
  const x = H.escapeHtml;
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${x(s.site_name)}</title><link>${s.site_url}</link><description>${x(s.tagline)}</description>
<atom:link href="${s.site_url}/feed.xml" rel="self" type="application/rss+xml"/>
${posts.map(p => `<item><title>${x(p.title)}</title><link>${s.site_url}${p.url}</link><guid>${s.site_url}${p.url}</guid>
<pubDate>${new Date(p.published_at + 'Z').toUTCString()}</pubDate><category>${x(p.cat_name || '')}</category>
<description>${x(p.summary)}</description></item>`).join('\n')}
</channel></rss>`);
});
router.get('/sitemap.xml', (req, res) => {
  const s = res.locals.s;
  const posts = db.prepare(`SELECT slug, updated_at FROM posts p WHERE ${LIVE} ORDER BY published_at DESC`).all();
  const cats = db.prepare('SELECT slug FROM categories').all();
  const prods = db.prepare('SELECT slug FROM products').all();
  const u = (loc, mod) => `<url><loc>${s.site_url}${loc}</loc>${mod ? `<lastmod>${mod.slice(0, 10)}</lastmod>` : ''}</url>`;
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[u('/'), u('/reviews'), u('/lab'), u('/about'), u('/advertise'), ...cats.map(c => u('/category/' + c.slug)), ...prods.map(p => u('/lab/' + p.slug)), ...posts.map(p => u('/article/' + p.slug, p.updated_at))].join('\n')}
</urlset>`);
});
router.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nAllow: /\nSitemap: ${res.locals.s.site_url}/sitemap.xml\n`));
router.get('/ads.txt', (req, res) => {
  const s = res.locals.s;
  let txt = s.ads_txt || '';
  if (!txt && s.adsense_client) txt = `google.com, ${s.adsense_client.replace('ca-', '')}, DIRECT, f08c47fec0942fa0`;
  res.type('text/plain').send(txt + '\n');
});
router.get('/manifest.webmanifest', (req, res) => {
  const s = res.locals.s;
  res.type('application/manifest+json').send(JSON.stringify({
    name: s.site_name, short_name: s.site_name, description: s.tagline, start_url: '/', display: 'standalone',
    background_color: '#0A0E1A', theme_color: '#0A0E1A',
    icons: [{ src: '/img/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  }));
});

module.exports = router;
