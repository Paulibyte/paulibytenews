// First-run setup: admin account, sections, and (optionally) demo content.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, DATA_DIR } = require('../db');
const { uniqueSlug } = require('../lib/helpers');

const CATEGORIES = [
  ['Phones & Tablets', '#2F6BFF', 'Smartphones, tablets and everything in your pocket.'],
  ['Laptops & PCs', '#06B6D4', 'Laptops, desktops, components and productivity machines.'],
  ['AI', '#8B5CF6', 'Artificial intelligence, models, tools and what they mean for you.'],
  ['Gadgets', '#FF5A1F', 'Wearables, audio, smart home and the gear we love.'],
  ['Gaming', '#E5484D', 'Consoles, PC gaming, mobile games and esports.'],
  ['Apps & Software', '#0EA371', 'Apps, operating systems, updates and developer news.'],
  ['Startups', '#F5B301', 'African and global tech startups, funding and founders.'],
  ['Internet & Telecom', '#EC4899', 'Broadband, 5G, data plans and digital policy.'],
];

function bootstrap() {
  if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
    const email = (process.env.ADMIN_EMAIL || 'admin@paulibytenews.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    db.prepare(`INSERT INTO users (name, email, password_hash, role, bio) VALUES (?,?,?,?,?)`)
      .run(process.env.ADMIN_NAME || 'PaulibyteNews Desk', email, bcrypt.hashSync(password, 10), 'admin', 'News, reviews and analysis from the PaulibyteNews team.');
    const note = `PaulibyteNews first login\n  URL:      /admin/login\n  Email:    ${email}\n  Password: ${password}\nChange this password from "My profile" after signing in, then delete this file.\n`;
    fs.writeFileSync(path.join(DATA_DIR, 'FIRST_LOGIN.txt'), note);
    console.log('\n' + note);
  }
  if (!db.prepare('SELECT COUNT(*) n FROM categories').get().n) {
    const ins = db.prepare('INSERT INTO categories (name, slug, color, description, sort) VALUES (?,?,?,?,?)');
    CATEGORIES.forEach(([n, c, d], i) => ins.run(n, uniqueSlug('categories', n), c, d, i));
  }
  if (process.env.SEED_DEMO !== '0' && !db.prepare('SELECT COUNT(*) n FROM posts').get().n && !db.prepare("SELECT value FROM settings WHERE key='demo_seeded'").get()) {
    require('./demo').seed().then(() => console.log('Demo content added (remove with: npm run clear-demo)')).catch(e => console.error('Demo seed failed', e));
  }
}

module.exports = { bootstrap };
