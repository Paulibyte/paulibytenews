const crypto = require('crypto');
const slugifyLib = require('slugify');
const sanitizeHtml = require('sanitize-html');
const session = require('express-session');
const { db } = require('../db');

function slugify(s) {
  return slugifyLib(String(s || ''), { lower: true, strict: true, trim: true }).slice(0, 90) || 'item';
}
function uniqueSlug(table, base, ignoreId) {
  let slug = slugify(base), i = 2;
  const q = db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`);
  while (q.get(slug, ignoreId || 0)) slug = `${slugify(base)}-${i++}`;
  return slug;
}
function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function readingTime(html) {
  const words = stripTags(html).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
function excerptOf(html, n = 170) {
  const t = stripTags(html);
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
}

const ALLOWED_IFRAME_HOSTS = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com', 'www.tiktok.com', 'open.spotify.com', 'w.soundcloud.com'];
function sanitizeContent(html) {
  return sanitizeHtml(html || '', {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'a',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'img', 'figure', 'figcaption', 'iframe', 'aside', 'div',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'mark', 'small'],
    allowedAttributes: {
      '*': ['class', 'style', 'data-list', 'data-row', 'data-language', 'id'],
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'allow', 'class'],
      td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
    },
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i],
        'text-align': [/^(left|right|center|justify)$/],
        width: [/^\d+(px|%)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowedIframeHostnames: ALLOWED_IFRAME_HOSTS,
    transformTags: {
      a: (tag, attribs) => {
        if (attribs.href && /^https?:\/\//.test(attribs.href) && !/paulibytenews\.com/.test(attribs.href)) {
          attribs.target = '_blank';
          attribs.rel = attribs.rel || 'noopener noreferrer';
        }
        return { tagName: 'a', attribs };
      },
      img: (tag, attribs) => ({ tagName: 'img', attribs: { ...attribs, loading: 'lazy' } }),
    },
  });
}

/* ---------- Ads ---------- */
const AD_ZONES = {
  header: { label: 'Header leaderboard', size: '728×90 (mobile 320×100)' },
  home_feed: { label: 'Homepage in-feed', size: '970×250 / responsive' },
  sidebar_top: { label: 'Sidebar top (MPU)', size: '300×250' },
  sidebar_sticky: { label: 'Sidebar sticky half-page', size: '300×600' },
  in_article: { label: 'In-article (inside body)', size: 'Responsive, ~728×90 or 300×250' },
  article_end: { label: 'End of article', size: '728×90 / responsive' },
  review_box: { label: 'Review "where to buy" sponsor', size: '300×100 / responsive' },
  lab: { label: 'Review Lab page', size: '970×250 / responsive' },
  footer: { label: 'Footer banner', size: '970×90 / responsive' },
  mobile_anchor: { label: 'Mobile sticky anchor', size: '320×50' },
};
const pickAdsStmt = db.prepare(`SELECT * FROM ads WHERE zone = ? AND active = 1
  AND (start_at IS NULL OR start_at = '' OR start_at <= datetime('now'))
  AND (end_at IS NULL OR end_at = '' OR end_at >= datetime('now'))`);
const impStmt = db.prepare('UPDATE ads SET impressions = impressions + 1 WHERE id = ?');
function pickAd(zone, exclude = []) {
  const list = pickAdsStmt.all(zone).filter(a => !exclude.includes(a.id));
  if (!list.length) return null;
  const total = list.reduce((s, a) => s + Math.max(1, a.weight), 0);
  let r = Math.random() * total;
  for (const a of list) { r -= Math.max(1, a.weight); if (r <= 0) { impStmt.run(a.id); return a; } }
  impStmt.run(list[0].id); return list[0];
}
function adHtml(ad, zone, opts = {}) {
  const label = '<span class="ad-label">Advertisement</span>';
  if (!ad) {
    if (!opts.placeholder) return '';
    const z = AD_ZONES[zone] || {};
    return `<div class="ad ad-${zone} ad-empty">${label}<a href="/advertise" class="ad-placeholder"><strong>Advertise here</strong><span>${z.size || ''}</span></a></div>`;
  }
  const dev = ad.device !== 'all' ? ` only-${ad.device}` : '';
  if (ad.type === 'html') return `<div class="ad ad-${zone}${dev}">${label}<div class="ad-html">${ad.html}</div></div>`;
  const pic = ad.image_mobile
    ? `<picture><source media="(max-width: 640px)" srcset="${ad.image_mobile}"><img src="${ad.image}" alt="${escapeHtml(ad.alt || ad.name)}" loading="lazy"></picture>`
    : `<img src="${ad.image}" alt="${escapeHtml(ad.alt || ad.name)}" loading="lazy">`;
  return `<div class="ad ad-${zone}${dev}">${label}<a href="/ad/${ad.id}/click" rel="sponsored noopener" target="_blank">${pic}</a></div>`;
}
function renderZone(zone, opts) { return adHtml(pickAd(zone), zone, opts); }

function injectInArticleAds(html, after = 3, every = 6) {
  const parts = html.split(/(?<=<\/p>)/i);
  if (parts.length <= after) return html;
  const used = [];
  let out = '', count = 0;
  for (const p of parts) {
    out += p;
    if (/<\/p>$/i.test(p)) {
      count++;
      if (count === after || (count > after && every > 0 && (count - after) % every === 0 && count < parts.length - 1)) {
        const ad = pickAd('in_article', used);
        if (ad) { used.push(ad.id); out += adHtml(ad, 'in_article'); }
        else if (count === after) out += adHtml(null, 'in_article', { placeholder: true });
      }
    }
  }
  return out;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(d, withTime) {
  if (!d) return '';
  const dt = new Date(d.replace(' ', 'T') + (d.includes('Z') || d.includes('+') ? '' : 'Z'));
  const o = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' };
  if (withTime) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
  return dt.toLocaleString('en-GB', o);
}
function timeAgo(d) {
  if (!d) return '';
  const dt = new Date(d.replace(' ', 'T') + 'Z');
  const s = (Date.now() - dt) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return fmtDate(d);
}
function parseJSON(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

function scoreLabel(score) {
  if (score >= 9) return 'Outstanding';
  if (score >= 8) return 'Excellent';
  if (score >= 7) return 'Very good';
  if (score >= 6) return 'Good';
  if (score >= 5) return 'Average';
  return 'Poor';
}

/* ---------- Sessions in SQLite ---------- */
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.g = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
    this.s = db.prepare('INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires');
    this.d = db.prepare('DELETE FROM sessions WHERE sid = ?');
    setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600e3).unref();
  }
  get(sid, cb) {
    const r = this.g.get(sid);
    if (!r || r.expires < Date.now()) return cb(null, null);
    cb(null, JSON.parse(r.data));
  }
  set(sid, sess, cb) {
    const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 864e5;
    this.s.run(sid, JSON.stringify(sess), exp); cb && cb(null);
  }
  destroy(sid, cb) { this.d.run(sid); cb && cb(null); }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

/* ---------- CSRF ---------- */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const t = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token');
    if (t !== req.session.csrf) return res.status(403).send('Invalid or expired form token. Go back, refresh the page and try again.');
  }
  next();
}

module.exports = {
  slugify, uniqueSlug, stripTags, readingTime, excerptOf, sanitizeContent,
  AD_ZONES, pickAd, adHtml, renderZone, injectInArticleAds,
  escapeHtml, fmtDate, timeAgo, parseJSON, scoreLabel, SqliteStore, csrf,
};
