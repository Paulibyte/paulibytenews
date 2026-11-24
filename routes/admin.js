const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { db, settings, setSetting } = require('../db');
const H = require('../lib/helpers');
const { upload, saveImage } = require('../lib/upload');
const router = express.Router();

const ROLE_RANK = { contributor: 1, editor: 2, admin: 3 };
const ROLE_NAME = { admin: 'Admin', editor: 'Editor-in-Chief', contributor: 'Contributor' };
const at = (me, role) => me && ROLE_RANK[me.role] >= ROLE_RANK[role];

function nowSql() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function toSql(local) { // "2026-11-24T09:30" (Lagos local) -> UTC sql
  if (!local) return null;
  const d = new Date(local + ':00+01:00');
  return isNaN(d) ? null : d.toISOString().replace('T', ' ').slice(0, 19);
}
function toLocalInput(sql) { // UTC sql -> "YYYY-MM-DDTHH:MM" in Lagos time
  if (!sql) return '';
  const d = new Date(sql.replace(' ', 'T') + 'Z');
  return new Date(d.getTime() + 3600e3).toISOString().slice(0, 16);
}
function flash(req, msg) { req.session.flash = msg; }

/* ---------- Auth ---------- */
const attempts = new Map();
router.get('/login', (req, res) => {
  if (res.locals.me) return res.redirect('/admin');
  res.render('admin/login', { error: null, email: '' });
});
router.post('/login', (req, res) => {
  const ip = req.ip, a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 8) return res.status(429).render('admin/login', { error: 'Too many attempts. Try again in 15 minutes.', email: '' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!u || !u.active || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    a.n++; attempts.set(ip, a);
    return res.render('admin/login', { error: 'Wrong email or password.', email });
  }
  attempts.delete(ip);
  req.session.regenerate(() => {
    req.session.userId = u.id;
    res.redirect(req.query.next && req.query.next.startsWith('/admin') ? req.query.next : '/admin');
  });
});
router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

router.use((req, res, next) => {
  if (!res.locals.me) return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  res.locals.at = role => at(res.locals.me, role);
  res.locals.ROLE_NAME = ROLE_NAME;
  res.locals.counts = {
    pending: db.prepare(`SELECT COUNT(*) n FROM posts WHERE status = 'pending'`).get().n,
    comments: db.prepare(`SELECT COUNT(*) n FROM comments WHERE status = 'pending'`).get().n,
    inquiries: db.prepare(`SELECT COUNT(*) n FROM ad_inquiries WHERE handled = 0`).get().n,
  };
  res.locals.toLocalInput = toLocalInput;
  res.locals.path = req.path;
  next();
});
const need = role => (req, res, next) => at(res.locals.me, role) ? next() : res.status(403).render('admin/denied', { title: 'No access' });

/* ---------- Dashboard ---------- */
router.get('/', (req, res) => {
  const me = res.locals.me;
  const q = sql => db.prepare(sql).get().n;
  const stats = {
    published: q(`SELECT COUNT(*) n FROM posts WHERE status='published'`),
    drafts: q(`SELECT COUNT(*) n FROM posts WHERE status='draft'`),
    views: q(`SELECT COALESCE(SUM(views),0) n FROM posts`),
    subscribers: q(`SELECT COUNT(*) n FROM subscribers`),
    testing: q(`SELECT COUNT(*) n FROM products WHERE status='testing'`),
    impressions: q(`SELECT COALESCE(SUM(impressions),0) n FROM ads`),
    clicks: q(`SELECT COALESCE(SUM(clicks),0) n FROM ads`),
    affiliate: q(`SELECT COUNT(*) n FROM affiliate_clicks WHERE created_at >= datetime('now','-30 days')`),
  };
  const top = db.prepare(`SELECT id, title, slug, views, type FROM posts WHERE status='published' ORDER BY views DESC LIMIT 6`).all();
  const pending = db.prepare(`SELECT p.id, p.title, p.updated_at, u.name author FROM posts p LEFT JOIN users u ON u.id=p.author_id WHERE p.status='pending' ORDER BY p.updated_at DESC LIMIT 8`).all();
  const mine = db.prepare(`SELECT id, title, status, updated_at, editor_note FROM posts WHERE author_id = ? AND status != 'published' ORDER BY updated_at DESC LIMIT 6`).all(me.id);
  const lab = db.prepare(`SELECT id, name, status, progress FROM products WHERE status IN ('testing','queued') ORDER BY CASE status WHEN 'testing' THEN 0 ELSE 1 END, id DESC LIMIT 6`).all();
  const scheduled = db.prepare(`SELECT id, title, published_at FROM posts WHERE status='published' AND published_at > datetime('now') ORDER BY published_at LIMIT 6`).all();
  res.render('admin/dashboard', { title: 'Dashboard', stats, top, pending, mine, lab, scheduled });
});

/* ---------- Posts ---------- */
router.get('/posts', (req, res) => {
  const me = res.locals.me;
  const { status = '', type = '', q = '', mine = '' } = req.query;
  const where = ['1=1'], args = [];
  if (!at(me, 'editor') || mine) { where.push('p.author_id = ?'); args.push(me.id); }
  if (status === 'scheduled') where.push(`p.status='published' AND p.published_at > datetime('now')`);
  else if (status) { where.push('p.status = ?'); args.push(status); }
  if (type) { where.push('p.type = ?'); args.push(type); }
  if (q) { where.push('(p.title LIKE ? OR p.tags LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const posts = db.prepare(`SELECT p.id, p.title, p.slug, p.status, p.type, p.views, p.published_at, p.updated_at, p.is_featured, p.is_breaking, p.is_sponsored,
    c.name cat_name, u.name author FROM posts p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN users u ON u.id=p.author_id
    WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 300`).all(...args);
  res.render('admin/posts', { title: 'Articles', posts, f: { status, type, q, mine } });
});

function canEdit(me, post) {
  if (!post) return true;
  if (at(me, 'editor')) return true;
  return post.author_id === me.id && post.status !== 'published';
}
function editorData(res, post) {
  return {
    categories: db.prepare('SELECT id, name FROM categories ORDER BY sort, name').all(),
    products: db.prepare('SELECT id, name, status FROM products ORDER BY id DESC').all(),
    revisions: post ? db.prepare(`SELECT r.id, r.created_at, u.name FROM revisions r LEFT JOIN users u ON u.id=r.user_id WHERE post_id = ? ORDER BY r.id DESC LIMIT 25`).all(post.id) : [],
  };
}
router.get('/posts/new', (req, res) => {
  const type = ['news', 'review', 'feature', 'howto', 'opinion'].includes(req.query.type) ? req.query.type : 'news';
  const post = { id: 0, title: '', subtitle: '', content: '', type, status: 'draft', tags: '', review: {}, allow_comments: 1, product_id: req.query.product ? parseInt(req.query.product) : null };
  if (post.product_id) {
    const pr = db.prepare('SELECT * FROM products WHERE id = ?').get(post.product_id);
    if (pr) post.review = { product: pr.name, brand: pr.brand, kind: pr.kind, price: pr.price, specs: H.parseJSON(pr.specs_json, []), tested_for: pr.test_days ? pr.test_days + ' days' : '' };
  }
  res.render('admin/post-edit', { title: 'New article', post, ...editorData(res, null) });
});
router.get('/posts/:id/edit', (req, res, next) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return next();
  if (!canEdit(res.locals.me, post)) { flash(req, 'You can no longer edit this article — ask an editor.'); return res.redirect('/admin/posts'); }
  post.review = H.parseJSON(post.review_json, {});
  res.render('admin/post-edit', { title: 'Edit: ' + post.title, post, ...editorData(res, post) });
});

router.post('/posts/save', (req, res) => {
  const me = res.locals.me, b = req.body;
  const id = parseInt(b.id) || 0;
  const existing = id ? db.prepare('SELECT * FROM posts WHERE id = ?').get(id) : null;
  if (id && !existing) return res.status(404).json({ ok: false, error: 'Article not found' });
  if (!canEdit(me, existing)) return res.status(403).json({ ok: false, error: 'You cannot edit this article.' });
  const action = b.action || 'save';
  const isEditor = at(me, 'editor');
  if (['publish', 'unpublish', 'reject'].includes(action) && !isEditor) return res.status(403).json({ ok: false, error: 'Only editors can do that.' });

  const title = String(b.title || '').trim() || 'Untitled draft';
  const content = H.sanitizeContent(b.content || '');
  const review = b.type === 'review' && b.review ? b.review : null;
  if (review) {
    review.score = review.score === '' || review.score == null ? null : Math.max(0, Math.min(10, parseFloat(review.score)));
    for (const k of ['pros', 'cons']) review[k] = (review[k] || []).map(s => String(s).trim()).filter(Boolean);
    for (const k of ['scores', 'specs', 'buy']) review[k] = (review[k] || []).filter(x => x && (x.label || x.value || x.url));
    review.buy = review.buy.filter(x => !x.url || /^https?:\/\//.test(x.url));
  }
  let status = existing ? existing.status : 'draft';
  let published_at = existing ? existing.published_at : null;
  let editor_note = existing ? existing.editor_note : '';
  if (action === 'submit') { status = 'pending'; editor_note = ''; }
  if (action === 'publish') { status = 'published'; published_at = toSql(b.publish_at) || (existing && existing.status === 'published' ? existing.published_at : nowSql()); editor_note = ''; }
  if (action === 'unpublish') status = 'draft';
  if (action === 'reject') { status = 'rejected'; editor_note = String(b.editor_note || '').slice(0, 1000); }
  if (action === 'save' && status === 'published' && isEditor && b.publish_at) published_at = toSql(b.publish_at) || published_at;

  const slug = isEditor && b.slug ? H.uniqueSlug('posts', b.slug, id) : (existing && existing.status === 'published' ? existing.slug : H.uniqueSlug('posts', title, id));
  const row = {
    title, slug, subtitle: String(b.subtitle || '').slice(0, 300), excerpt: String(b.excerpt || '').slice(0, 400),
    content, cover_image: String(b.cover_image || ''), cover_caption: String(b.cover_caption || '').slice(0, 300),
    type: ['news', 'review', 'feature', 'howto', 'opinion'].includes(b.type) ? b.type : 'news',
    category_id: parseInt(b.category_id) || null, product_id: parseInt(b.product_id) || null,
    status, is_featured: isEditor ? (b.is_featured ? 1 : 0) : (existing ? existing.is_featured : 0),
    is_breaking: isEditor ? (b.is_breaking ? 1 : 0) : (existing ? existing.is_breaking : 0),
    is_sponsored: b.is_sponsored ? 1 : 0, sponsor_name: String(b.sponsor_name || ''), allow_comments: b.allow_comments ? 1 : 0,
    tags: String(b.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 15).join(', '),
    review_json: review ? JSON.stringify(review) : '', seo_title: String(b.seo_title || '').slice(0, 120), seo_description: String(b.seo_description || '').slice(0, 300),
    editor_note, published_at, updated_at: nowSql(),
  };
  let pid = id;
  if (existing) {
    db.prepare(`UPDATE posts SET ${Object.keys(row).map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...row, id });
  } else {
    pid = db.prepare(`INSERT INTO posts (${Object.keys(row).join(', ')}, author_id) VALUES (${Object.keys(row).map(k => '@' + k).join(', ')}, @author_id)`).run({ ...row, author_id: me.id }).lastInsertRowid;
  }
  if (action !== 'autosave') {
    const last = db.prepare('SELECT content, title FROM revisions WHERE post_id = ? ORDER BY id DESC LIMIT 1').get(pid);
    if (!last || last.content !== content || last.title !== title) db.prepare('INSERT INTO revisions (post_id, user_id, title, content) VALUES (?,?,?,?)').run(pid, me.id, title, content);
    db.prepare('DELETE FROM revisions WHERE post_id = ? AND id NOT IN (SELECT id FROM revisions WHERE post_id = ? ORDER BY id DESC LIMIT 40)').run(pid, pid);
  }
  // link product <-> review
  if (row.product_id && row.type === 'review' && status === 'published') {
    db.prepare(`UPDATE products SET post_id = ?, status = CASE WHEN status='longterm' THEN 'longterm' ELSE 'published' END, progress = 100 WHERE id = ?`).run(pid, row.product_id);
  }
  const msgs = { save: 'Saved', autosave: 'Autosaved', submit: 'Submitted for review', publish: published_at > nowSql() ? 'Scheduled' : 'Published', unpublish: 'Moved back to drafts', reject: 'Returned to writer' };
  res.json({ ok: true, id: pid, slug, status, published_at, scheduled: status === 'published' && published_at > nowSql(), message: msgs[action] || 'Saved' });
});
router.get('/posts/revision/:rid', (req, res) => {
  const r = db.prepare('SELECT r.*, p.author_id FROM revisions r JOIN posts p ON p.id = r.post_id WHERE r.id = ?').get(req.params.rid);
  if (!r || !(at(res.locals.me, 'editor') || r.author_id === res.locals.me.id)) return res.status(404).json({});
  res.json({ title: r.title, content: r.content });
});
router.post('/posts/:id/delete', (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (p && (at(res.locals.me, 'editor') || (p.author_id === res.locals.me.id && p.status !== 'published'))) {
    db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
    db.prepare('UPDATE products SET post_id = NULL WHERE post_id = ?').run(p.id);
    flash(req, `Deleted “${p.title}”.`);
  }
  res.redirect('/admin/posts');
});

/* ---------- Media ---------- */
router.get('/media', (req, res) => {
  const items = db.prepare('SELECT m.*, u.name uploader FROM media m LEFT JOIN users u ON u.id = m.uploader_id ORDER BY m.id DESC LIMIT 400').all();
  if (req.query.format === 'json') return res.json(items.map(i => ({ id: i.id, url: i.url, original: i.original })));
  res.render('admin/media', { title: 'Media library', items });
});
router.post('/media/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Please choose a JPG, PNG, WebP or GIF image under 8 MB.' });
    const url = await saveImage(req.file, res.locals.me.id);
    if (req.get('accept') && req.get('accept').includes('json')) return res.json({ ok: true, url });
    flash(req, 'Image uploaded.'); res.redirect('/admin/media');
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: 'Upload failed' }); }
});
router.post('/media/:id/delete', need('editor'), (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (m) {
    const file = path.join(__dirname, '..', 'public', m.url);
    if (m.url.startsWith('/uploads/') && fs.existsSync(file)) fs.unlinkSync(file);
    db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
  }
  res.redirect('/admin/media');
});

/* ---------- Categories ---------- */
router.get('/categories', need('editor'), (req, res) => {
  const cats = db.prepare('SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id) n FROM categories c ORDER BY sort, name').all();
  res.render('admin/categories', { title: 'Categories', cats });
});
router.post('/categories', need('editor'), (req, res) => {
  const { id, name, description, color, sort } = req.body;
  if (name) {
    if (id) db.prepare('UPDATE categories SET name=?, slug=?, description=?, color=?, sort=? WHERE id=?').run(name, H.uniqueSlug('categories', name, id), description || '', color || '#2F6BFF', parseInt(sort) || 0, id);
    else db.prepare('INSERT INTO categories (name, slug, description, color, sort) VALUES (?,?,?,?,?)').run(name, H.uniqueSlug('categories', name), description || '', color || '#2F6BFF', parseInt(sort) || 0);
  }
  res.redirect('/admin/categories');
});
router.post('/categories/:id/delete', need('editor'), (req, res) => { db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id); res.redirect('/admin/categories'); });

/* ---------- Review Lab (products) ---------- */
router.get('/lab', (req, res) => {
  const products = db.prepare(`SELECT pr.*, u.name tester, (SELECT COUNT(*) FROM lab_updates l WHERE l.product_id = pr.id) notes
    FROM products pr LEFT JOIN users u ON u.id = pr.tester_id ORDER BY CASE pr.status WHEN 'testing' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, pr.sort, pr.id DESC`).all();
  res.render('admin/lab', { title: 'Review Lab', products });
});
function productForm(req, res, pr) {
  const users = db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name').all();
  const updates = pr.id ? db.prepare('SELECT l.*, u.name user_name FROM lab_updates l LEFT JOIN users u ON u.id = l.user_id WHERE product_id = ? ORDER BY id DESC').all(pr.id) : [];
  const reviews = pr.id ? db.prepare('SELECT id, title, status FROM posts WHERE product_id = ?').all(pr.id) : [];
  pr.specs = H.parseJSON(pr.specs_json, []); pr.tests = H.parseJSON(pr.tests_json, []);
  res.render('admin/lab-edit', { title: pr.id ? pr.name : 'Add product to the lab', pr, users, updates, reviews });
}
router.get('/lab/new', need('editor'), (req, res) => productForm(req, res, { id: 0, name: '', status: 'queued', progress: 0, test_days: 14, specs_json: '[]', tests_json: JSON.stringify(['Unboxing & build quality', 'Display', 'Performance benchmarks', 'Battery life', 'Camera', 'Software & updates', 'Value for money'].map(label => ({ label, done: false }))) }));
router.get('/lab/:id', (req, res, next) => {
  const pr = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!pr) return next();
  productForm(req, res, pr);
});
router.post('/lab/save', need('editor'), upload.single('image'), async (req, res) => {
  const b = req.body, id = parseInt(b.id) || 0;
  let image = b.image_url || '';
  if (req.file) image = await saveImage(req.file, res.locals.me.id, 1400);
  const rows = (labels, values) => [].concat(labels || []).map((l, i) => ({ label: String(l).trim(), value: String([].concat(values || [])[i] || '').trim() })).filter(r => r.label);
  const specs = rows(b.spec_label, b.spec_value);
  const tests = [].concat(b.test_label || []).map((l, i) => ({ label: String(l).trim(), done: [].concat(b.test_done || []).includes(String(i)) })).filter(t => t.label);
  const row = {
    name: b.name || 'Untitled product', brand: b.brand || '', kind: b.kind || '', image, price: b.price || '',
    status: ['queued', 'testing', 'published', 'longterm'].includes(b.status) ? b.status : 'queued',
    progress: Math.max(0, Math.min(100, parseInt(b.progress) || 0)), test_days: parseInt(b.test_days) || 0,
    started_at: b.started_at || null, expected_at: b.expected_at || null, tester_id: parseInt(b.tester_id) || null,
    summary: b.summary || '', specs_json: JSON.stringify(specs), tests_json: JSON.stringify(tests), sort: parseInt(b.sort) || 0,
  };
  if (b.auto_progress && tests.length) row.progress = Math.round(tests.filter(t => t.done).length / tests.length * 100);
  let pid = id;
  if (id) db.prepare(`UPDATE products SET ${Object.keys(row).map(k => `${k}=@${k}`).join(', ')}, slug=@slug WHERE id=@id`).run({ ...row, slug: H.uniqueSlug('products', row.name, id), id });
  else pid = db.prepare(`INSERT INTO products (${Object.keys(row).join(',')}, slug) VALUES (${Object.keys(row).map(k => '@' + k).join(',')}, @slug)`).run({ ...row, slug: H.uniqueSlug('products', row.name) }).lastInsertRowid;
  flash(req, 'Product saved.');
  res.redirect('/admin/lab/' + pid);
});
router.post('/lab/:id/update', upload.single('image'), async (req, res) => {
  const pr = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!pr) return res.redirect('/admin/lab');
  if (!(at(res.locals.me, 'editor') || pr.tester_id === res.locals.me.id)) { flash(req, 'Only the assigned tester or an editor can post lab notes.'); return res.redirect('/admin/lab/' + pr.id); }
  const image = req.file ? await saveImage(req.file, res.locals.me.id, 1400) : '';
  if (req.body.note) db.prepare('INSERT INTO lab_updates (product_id, user_id, note, image) VALUES (?,?,?,?)').run(pr.id, res.locals.me.id, req.body.note.slice(0, 2000), image);
  if (req.body.progress !== undefined && req.body.progress !== '') db.prepare('UPDATE products SET progress = ? WHERE id = ?').run(Math.max(0, Math.min(100, parseInt(req.body.progress) || 0)), pr.id);
  flash(req, 'Lab note posted.');
  res.redirect('/admin/lab/' + pr.id);
});
router.post('/lab/update/:uid/delete', need('editor'), (req, res) => {
  const u = db.prepare('SELECT product_id FROM lab_updates WHERE id = ?').get(req.params.uid);
  db.prepare('DELETE FROM lab_updates WHERE id = ?').run(req.params.uid);
  res.redirect('/admin/lab/' + (u ? u.product_id : ''));
});
router.post('/lab/:id/delete', need('editor'), (req, res) => { db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id); flash(req, 'Product removed from the lab.'); res.redirect('/admin/lab'); });

/* ---------- Comments ---------- */
router.get('/comments', need('editor'), (req, res) => {
  const status = ['pending', 'approved', 'spam'].includes(req.query.status) ? req.query.status : 'pending';
  const comments = db.prepare(`SELECT c.*, p.title, p.slug FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.status = ? ORDER BY c.id DESC LIMIT 300`).all(status);
  res.render('admin/comments', { title: 'Comments', comments, status });
});
router.post('/comments/:id/:act', need('editor'), (req, res) => {
  const { id, act } = req.params;
  if (act === 'delete') db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  else if (['approved', 'spam', 'pending'].includes(act)) db.prepare('UPDATE comments SET status = ? WHERE id = ?').run(act, id);
  res.redirect('/admin/comments' + (req.get('referer') && req.get('referer').includes('status=') ? '?status=' + req.get('referer').split('status=')[1].split('&')[0] : ''));
});

/* ---------- Ads ---------- */
router.get('/ads', need('admin'), (req, res) => {
  const ads = db.prepare('SELECT * FROM ads ORDER BY active DESC, zone, id DESC').all();
  const inquiries = db.prepare('SELECT * FROM ad_inquiries ORDER BY handled, id DESC LIMIT 100').all();
  const affiliate = db.prepare(`SELECT a.label, a.post_id, p.title, COUNT(*) n FROM affiliate_clicks a LEFT JOIN posts p ON p.id = a.post_id
    WHERE a.created_at >= datetime('now','-30 days') GROUP BY a.post_id, a.label ORDER BY n DESC LIMIT 15`).all();
  res.render('admin/ads', { title: 'Advertising', ads, inquiries, affiliate, zones: H.AD_ZONES });
});
router.get('/ads/new', need('admin'), (req, res) => res.render('admin/ad-edit', { title: 'New ad', ad: { id: 0, zone: req.query.zone || 'header', type: 'image', device: 'all', weight: 1, active: 1 }, zones: H.AD_ZONES }));
router.get('/ads/:id', need('admin'), (req, res, next) => {
  const ad = db.prepare('SELECT * FROM ads WHERE id = ?').get(req.params.id);
  if (!ad) return next();
  res.render('admin/ad-edit', { title: 'Edit ad', ad, zones: H.AD_ZONES });
});
router.post('/ads/save', need('admin'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'image_mobile', maxCount: 1 }]), async (req, res) => {
  const b = req.body, id = parseInt(b.id) || 0;
  const old = id ? db.prepare('SELECT * FROM ads WHERE id = ?').get(id) : {};
  const img = req.files && req.files.image ? await saveImage(req.files.image[0], res.locals.me.id, 1940) : (b.remove_image ? '' : (old.image || ''));
  const imgM = req.files && req.files.image_mobile ? await saveImage(req.files.image_mobile[0], res.locals.me.id, 900) : (b.remove_image_mobile ? '' : (old.image_mobile || ''));
  const row = {
    name: b.name || 'Ad', advertiser: b.advertiser || '', zone: H.AD_ZONES[b.zone] ? b.zone : 'header', type: b.type === 'html' ? 'html' : 'image',
    image: img, image_mobile: imgM, link: /^https?:\/\//.test(b.link || '') ? b.link : '', alt: b.alt || '', html: b.html || '',
    device: ['all', 'desktop', 'mobile'].includes(b.device) ? b.device : 'all', start_at: toSql(b.start_at), end_at: toSql(b.end_at),
    weight: Math.max(1, parseInt(b.weight) || 1), active: b.active ? 1 : 0,
  };
  if (id) db.prepare(`UPDATE ads SET ${Object.keys(row).map(k => `${k}=@${k}`).join(', ')} WHERE id=@id`).run({ ...row, id });
  else db.prepare(`INSERT INTO ads (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(k => '@' + k).join(',')})`).run(row);
  flash(req, 'Ad saved.');
  res.redirect('/admin/ads');
});
router.post('/ads/:id/toggle', need('admin'), (req, res) => { db.prepare('UPDATE ads SET active = 1 - active WHERE id = ?').run(req.params.id); res.redirect('/admin/ads'); });
router.post('/ads/:id/reset', need('admin'), (req, res) => { db.prepare('UPDATE ads SET impressions = 0, clicks = 0 WHERE id = ?').run(req.params.id); res.redirect('/admin/ads'); });
router.post('/ads/:id/delete', need('admin'), (req, res) => { db.prepare('DELETE FROM ads WHERE id = ?').run(req.params.id); res.redirect('/admin/ads'); });
router.post('/inquiries/:id/handled', need('admin'), (req, res) => { db.prepare('UPDATE ad_inquiries SET handled = 1 - handled WHERE id = ?').run(req.params.id); res.redirect('/admin/ads#inquiries'); });

/* ---------- Subscribers ---------- */
router.get('/subscribers', need('editor'), (req, res) => {
  if (req.query.format === 'csv') {
    const rows = db.prepare('SELECT email, created_at FROM subscribers ORDER BY id').all();
    res.set('Content-Disposition', 'attachment; filename="paulibytenews-subscribers.csv"');
    return res.type('text/csv').send('email,subscribed_at\n' + rows.map(r => `${r.email},${r.created_at}`).join('\n'));
  }
  res.render('admin/subscribers', { title: 'Newsletter subscribers', subs: db.prepare('SELECT * FROM subscribers ORDER BY id DESC').all() });
});
router.post('/subscribers/:id/delete', need('editor'), (req, res) => { db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id); res.redirect('/admin/subscribers'); });

/* ---------- Users ---------- */
router.get('/users', need('admin'), (req, res) => {
  const users = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.status='published') n FROM users u ORDER BY active DESC, CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, name`).all();
  res.render('admin/users', { title: 'Team', users });
});
router.post('/users', need('admin'), (req, res) => {
  const { id, name, email, role, password, active } = req.body;
  const r = ROLE_RANK[role] ? role : 'contributor';
  try {
    if (id) {
      if (parseInt(id) === res.locals.me.id && r !== 'admin') { flash(req, 'You cannot remove your own admin role.'); return res.redirect('/admin/users'); }
      db.prepare('UPDATE users SET name=?, email=?, role=?, active=? WHERE id=?').run(name, email.toLowerCase(), r, active ? 1 : 0, id);
      if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), id);
      flash(req, 'Team member updated.');
    } else {
      if (!password || password.length < 8) { flash(req, 'Password must be at least 8 characters.'); return res.redirect('/admin/users'); }
      db.prepare('INSERT INTO users (name, email, role, password_hash) VALUES (?,?,?,?)').run(name, email.toLowerCase(), r, bcrypt.hashSync(password, 10));
      flash(req, `Added ${name} as ${ROLE_NAME[r]}. Share their email and password with them privately.`);
    }
  } catch (e) { flash(req, 'That email is already in use.'); }
  res.redirect('/admin/users');
});

/* ---------- Profile ---------- */
router.get('/profile', (req, res) => res.render('admin/profile', { title: 'My profile', u: db.prepare('SELECT * FROM users WHERE id = ?').get(res.locals.me.id) }));
router.post('/profile', upload.single('avatar'), async (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(res.locals.me.id);
  const { name, bio, twitter, current, password } = req.body;
  const avatar = req.file ? await saveImage(req.file, me.id, 400) : me.avatar;
  db.prepare('UPDATE users SET name=?, bio=?, twitter=?, avatar=? WHERE id=?').run(name || me.name, bio || '', twitter || '', avatar, me.id);
  if (password) {
    if (!bcrypt.compareSync(current || '', me.password_hash)) { flash(req, 'Current password is wrong — password not changed.'); return res.redirect('/admin/profile'); }
    if (password.length < 8) { flash(req, 'New password must be at least 8 characters.'); return res.redirect('/admin/profile'); }
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), me.id);
  }
  flash(req, 'Profile saved.');
  res.redirect('/admin/profile');
});

/* ---------- Settings ---------- */
const SETTING_KEYS = ['site_name', 'tagline', 'site_url', 'contact_email', 'ads_email', 'about_html', 'adsense_client', 'ads_txt', 'head_code',
  'social_x', 'social_facebook', 'social_instagram', 'social_youtube', 'social_linkedin', 'social_tiktok', 'in_article_ad_after', 'in_article_ad_every', 'posts_per_page', 'advertise_html', 'rate_card'];
router.get('/settings', need('admin'), (req, res) => res.render('admin/settings', { title: 'Site settings' }));
router.post('/settings', need('admin'), (req, res) => {
  for (const k of SETTING_KEYS) if (req.body[k] !== undefined) setSetting(k, String(req.body[k]).trim());
  flash(req, 'Settings saved.');
  res.redirect('/admin/settings');
});

module.exports = router;
