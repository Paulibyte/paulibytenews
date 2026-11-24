const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'paulibytenews.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'contributor',   -- admin | editor | contributor
  bio TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  twitter TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#2F6BFF',
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  brand TEXT DEFAULT '',
  kind TEXT DEFAULT '',                 -- Smartphone, Laptop, Earbuds...
  image TEXT DEFAULT '',
  price TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | testing | published | longterm
  progress INTEGER DEFAULT 0,
  test_days INTEGER DEFAULT 14,
  started_at TEXT,
  expected_at TEXT,
  tester_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  summary TEXT DEFAULT '',
  specs_json TEXT DEFAULT '[]',
  tests_json TEXT DEFAULT '[]',          -- checklist [{label, done}]
  post_id INTEGER,
  votes INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lab_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  image TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  subtitle TEXT DEFAULT '',
  excerpt TEXT DEFAULT '',
  content TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',
  cover_caption TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'news',     -- news | review | feature | howto | opinion
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | pending | published | rejected
  is_featured INTEGER DEFAULT 0,
  is_breaking INTEGER DEFAULT 0,
  is_sponsored INTEGER DEFAULT 0,
  sponsor_name TEXT DEFAULT '',
  allow_comments INTEGER DEFAULT 1,
  tags TEXT DEFAULT '',
  review_json TEXT DEFAULT '',
  seo_title TEXT DEFAULT '',
  seo_description TEXT DEFAULT '',
  editor_note TEXT DEFAULT '',
  views INTEGER DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_pub ON posts(status, published_at);

CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER,
  title TEXT,
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | spam
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  advertiser TEXT DEFAULT '',
  zone TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'image',    -- image | html
  image TEXT DEFAULT '',
  image_mobile TEXT DEFAULT '',
  link TEXT DEFAULT '',
  alt TEXT DEFAULT '',
  html TEXT DEFAULT '',
  device TEXT DEFAULT 'all',             -- all | desktop | mobile
  start_at TEXT,
  end_at TEXT,
  weight INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ad_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, company TEXT, email TEXT, phone TEXT, package TEXT, message TEXT,
  handled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER, label TEXT, url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  original TEXT,
  mime TEXT,
  size INTEGER,
  width INTEGER, height INTEGER,
  uploader_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
`);

const DEFAULT_SETTINGS = {
  site_name: 'PaulibyteNews',
  tagline: 'Tech news, honest reviews & the gadgets on our test bench',
  site_url: 'https://paulibytenews.com',
  contact_email: 'hello@paulibytenews.com',
  ads_email: 'ads@paulibytenews.com',
  about_html: '<p>PaulibyteNews covers technology for Africa and the world — breaking tech news, in-depth product reviews, explainers and how-tos. Every product we review is tested hands-on in our lab, and you can follow along live on the <a href="/lab">Review Lab</a> page.</p>',
  adsense_client: '',
  ads_txt: '',
  head_code: '',
  social_x: '', social_facebook: '', social_instagram: '', social_youtube: '', social_linkedin: '', social_tiktok: '',
  in_article_ad_after: '3',
  in_article_ad_every: '6',
  posts_per_page: '12',
  advertise_html: '<p>Reach a focused audience of tech enthusiasts, developers, students and decision-makers. Choose a placement below or ask us for a custom package — sponsored reviews, newsletter takeovers and launch coverage are available.</p>',
  rate_card: 'Leaderboard (header)|728×90 / 320×100|Every page, top\nSidebar MPU|300×250|Articles & listings\nSidebar Half-page|300×600|Sticky beside articles\nIn-article|Responsive|Inside article body\nMobile anchor|320×50|Sticky bottom bar on phones\nSponsored review|Article|Clearly labelled sponsored content',
};
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

function settings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

module.exports = { db, settings, setSetting, getSetting, DATA_DIR };
