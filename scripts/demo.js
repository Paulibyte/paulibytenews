// Demo content so the site isn't empty on first run. Everything here is fictional placeholder
// content (fictional brands and products). Remove it all with: npm run clear-demo
const fs = require('fs');
const path = require('path');
const { db, setSetting } = require('../db');
const { uniqueSlug } = require('../lib/helpers');
const { cover } = require('./art');

const DIR = path.join(__dirname, '..', 'public', 'uploads', 'demo');
const ago = h => new Date(Date.now() - h * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
const day = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

const P = t => `<p>${t}</p>`;
function body(intro, sections) {
  let html = P(intro);
  for (const s of sections) {
    if (s.h) html += `<h2>${s.h}</h2>`;
    for (const p of s.p || []) html += P(p);
    if (s.list) html += `<ol>${s.list.map(i => `<li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>${i}</li>`).join('')}</ol>`;
    if (s.quote) html += `<blockquote>${s.quote}</blockquote>`;
    if (s.callout) html += `<aside class="callout"><strong>Tip:</strong> ${s.callout}</aside>`;
    if (s.table) html += `<table><tbody>${s.table.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  return html;
}
const filler = [
  'This is demo copy that shows how a full PaulibyteNews article looks — headings, lists, quotes, tables and in-article ad slots included. Replace it with your own reporting from the admin dashboard.',
  'Strong tech journalism explains not only what changed, but why it matters to readers in Lagos, Owerri, Abuja and beyond: price, availability, network support and how a product holds up in daily use.',
  'Use the rich editor to add images, embed YouTube videos, insert comparison tables, and highlight key advice in a callout box. Every article automatically gets reading time, share buttons, related stories and SEO tags.',
];

async function seed() {
  fs.mkdirSync(DIR, { recursive: true });
  const admin = db.prepare(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`).get();
  const cat = n => db.prepare('SELECT id FROM categories WHERE name = ?').get(n)?.id || null;
  const img = async (name, shape, pal) => { const f = path.join(DIR, name + '.webp'); if (!fs.existsSync(f)) await cover(f, shape, pal); return `/uploads/demo/${name}.webp`; };

  /* ---- Lab products ---- */
  const products = [
    { name: 'Nova X5', brand: 'Novatek', kind: 'Smartphone', price: '₦489,000', status: 'published', progress: 100, shape: 'phone', pal: 0, votes: 0, summary: 'A 6.7-inch mid-ranger promising two-day battery life.' },
    { name: 'Aero 14 Pro', brand: 'Aerobook', kind: 'Laptop', price: '₦1,250,000', status: 'testing', progress: 64, shape: 'laptop', pal: 4, summary: 'A 14-inch creator laptop with an OLED screen — we are stress-testing thermals and battery.' },
    { name: 'Pulse Buds 3', brand: 'Pulse Audio', kind: 'Earbuds', price: '₦89,000', status: 'testing', progress: 30, shape: 'buds', pal: 1, summary: 'Budget ANC earbuds. Testing noise cancelling on BRT buses and in open offices.' },
    { name: 'Orbit Watch S', brand: 'Orbit', kind: 'Smartwatch', price: '₦210,000', status: 'queued', progress: 0, shape: 'watch', pal: 2, votes: 48, summary: 'Fitness-first smartwatch with offline maps.' },
    { name: 'Volt Max 20K', brand: 'Voltcell', kind: 'Power bank', price: '₦32,500', status: 'queued', progress: 0, shape: 'chip', pal: 5, votes: 31, summary: '20,000mAh power bank with 65W laptop charging.' },
    { name: 'Mesh One Router', brand: 'Linkhive', kind: 'Router', price: '₦145,000', status: 'queued', progress: 0, shape: 'router', pal: 3, votes: 12, summary: 'Wi-Fi 6 mesh kit aimed at multi-room homes and small offices.' },
  ];
  const tests = done => ['Unboxing & build quality', 'Display', 'Performance benchmarks', 'Battery life', 'Camera / mics', 'Software & updates', 'Value for money'].map((label, i) => ({ label, done: i < done }));
  const pid = {};
  for (const [i, p] of products.entries()) {
    const image = await img('product-' + i, p.shape, p.pal);
    pid[p.name] = db.prepare(`INSERT INTO products (name, slug, brand, kind, image, price, status, progress, test_days, started_at, expected_at, tester_id, summary, specs_json, tests_json, votes, sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.name, uniqueSlug('products', p.name), p.brand, p.kind, image, p.price, p.status, p.progress, 14,
      p.status === 'queued' ? null : day(-9), p.status === 'queued' ? null : day(5), admin.id, p.summary,
      JSON.stringify([{ label: 'Type', value: p.kind }, { label: 'Price', value: p.price }]), JSON.stringify(tests(Math.round(p.progress / 100 * 7))), p.votes || 0, i).lastInsertRowid;
  }
  const notes = [['Aero 14 Pro', 'Day 1: unboxed. Solid aluminium chassis, 1.4 kg, the OLED panel is gorgeous out of the box.', 200], ['Aero 14 Pro', 'Day 5: ran our 4K export test — fans get loud after 8 minutes, but no throttling yet. Battery test starts tomorrow.', 70], ['Pulse Buds 3', 'Day 2: noise cancelling handles bus engine hum well; voices still leak through. Call quality test next.', 20], ['Aero 14 Pro', 'Day 9: battery rundown done — 8h 12m of mixed work at 150 nits. Writing the review now.', 3]];
  for (const [n, note, h] of notes) db.prepare('INSERT INTO lab_updates (product_id, user_id, note, created_at) VALUES (?,?,?,?)').run(pid[n], admin.id, note, ago(h));

  /* ---- Articles ---- */
  const posts = [
    { t: 'Nova X5 review: a two-day battery champion held back by slow charging', type: 'review', cat: 'Phones & Tablets', shape: 'phone', pal: 0, h: 5, featured: 1, product: 'Nova X5',
      sub: 'Sample review — fictional phone used to show the full review layout.',
      review: { product: 'Nova X5', brand: 'Novatek', kind: 'Smartphone', price: '₦489,000', tested_for: '3 weeks', award: "Editor's Choice", score: 8.4,
        verdict_short: 'Outstanding stamina and a lovely screen make this the mid-ranger to beat — if you can live with 33W charging.',
        verdict: 'The Nova X5 gets the fundamentals right: the battery comfortably lasts two days, the 120Hz display is bright enough for afternoon sun, and the main camera is reliable. Slow charging and only two years of OS updates hold it back from a perfect score, but at this price it is easy to recommend.',
        scores: [{ label: 'Design', value: 8 }, { label: 'Display', value: 8.8 }, { label: 'Performance', value: 7.9 }, { label: 'Battery', value: 9.5 }, { label: 'Camera', value: 7.8 }, { label: 'Value', value: 8.6 }],
        pros: ['Two-day battery life', 'Bright 120Hz AMOLED display', 'Clean software, no bloat', 'Great value'], cons: ['33W charging feels slow', 'Only two OS upgrades promised', 'Average ultra-wide camera'],
        specs: [{ label: 'Display', value: '6.7" AMOLED, 120Hz' }, { label: 'Processor', value: 'Octa-core 4nm' }, { label: 'RAM / Storage', value: '8GB / 256GB' }, { label: 'Battery', value: '6,000mAh' }, { label: 'Charging', value: '33W wired' }, { label: 'Cameras', value: '50MP + 8MP ultra-wide' }],
        buy: [{ label: 'Store A', price: '₦489,000', url: 'https://example.com/nova-x5' }, { label: 'Store B', price: '₦495,500', url: 'https://example.com/nova-x5-b' }] } },
    { t: 'African AI startups raised more in 2026 than the previous two years combined', type: 'news', cat: 'Startups', shape: 'rocket', pal: 3, h: 2, featured: 1, breaking: 1 },
    { t: 'What on-device AI actually means for your next phone', type: 'feature', cat: 'AI', shape: 'chip', pal: 1, h: 9, featured: 1 },
    { t: 'How to extend your laptop battery life: 9 settings that really work', type: 'howto', cat: 'Laptops & PCs', shape: 'laptop', pal: 4, h: 14, featured: 1 },
    { t: '5G rollout reaches 12 more cities — here is what it costs you', type: 'news', cat: 'Internet & Telecom', shape: 'router', pal: 0, h: 20, breaking: 1 },
    { t: 'Kite Tab 11 long-term review: six months with a budget tablet', type: 'review', cat: 'Phones & Tablets', shape: 'phone', pal: 2, h: 30,
      review: { product: 'Kite Tab 11', brand: 'Kite', kind: 'Tablet', price: '₦265,000', tested_for: '6 months', award: 'Best Value', score: 7.6, verdict_short: 'A dependable family tablet that punches above its price.',
        scores: [{ label: 'Design', value: 7 }, { label: 'Display', value: 7.5 }, { label: 'Performance', value: 7 }, { label: 'Battery', value: 8.5 }, { label: 'Value', value: 9 }],
        pros: ['Excellent battery', 'Great price', 'Quad speakers'], cons: ['Slow charging', 'Plastic back scratches'], specs: [{ label: 'Display', value: '11" LCD, 90Hz' }, { label: 'Battery', value: '8,000mAh' }], buy: [{ label: 'Store A', price: '₦265,000', url: 'https://example.com/kite' }] } },
    { t: 'The best budget earbuds we are testing right now', type: 'feature', cat: 'Gadgets', shape: 'buds', pal: 1, h: 40 },
    { t: 'Cloud gaming is finally usable on Nigerian broadband — mostly', type: 'opinion', cat: 'Gaming', shape: 'game', pal: 1, h: 52 },
    { t: 'Five free apps every small business owner should install this year', type: 'howto', cat: 'Apps & Software', shape: 'chip', pal: 2, h: 70 },
    { t: 'Smartwatch buying guide: features that matter and gimmicks to skip', type: 'feature', cat: 'Gadgets', shape: 'watch', pal: 2, h: 90 },
    { t: 'Handheld gaming PCs: are they worth it in 2026?', type: 'news', cat: 'Gaming', shape: 'game', pal: 5, h: 110 },
    { t: 'Open-source AI models close the gap with paid assistants', type: 'news', cat: 'AI', shape: 'chip', pal: 0, h: 130 },
  ];
  const ins = db.prepare(`INSERT INTO posts (title, slug, subtitle, excerpt, content, cover_image, cover_caption, type, category_id, author_id, product_id, status, is_featured, is_breaking, tags, review_json, views, published_at, created_at, updated_at)
    VALUES (@title, @slug, @subtitle, @excerpt, @content, @cover_image, @cover_caption, @type, @category_id, @author_id, @product_id, 'published', @is_featured, @is_breaking, @tags, @review_json, @views, @published_at, @published_at, @published_at)`);
  for (const [i, p] of posts.entries()) {
    const content = body(filler[0], [
      { h: 'Why it matters', p: [filler[1]], list: ['Clear, fact-checked reporting', 'Local pricing and availability', 'Hands-on testing in our Review Lab'] },
      { h: 'The details', p: [filler[2], 'Paragraph four — in-article ads appear automatically after the paragraph number you choose in Settings, and again at the interval you set.'], quote: 'Good technology coverage helps readers spend their money wisely.' },
      { h: 'At a glance', table: [['Item', 'Detail'], ['Availability', 'Nationwide'], ['Price', p.review ? p.review.price : 'Varies'], ['Our take', 'Worth watching']], callout: 'Use the callout button in the editor to highlight advice like this.' },
      { h: 'Bottom line', p: ['Wrap up with a clear takeaway. This closing paragraph is also demo text — edit or delete this article in the dashboard whenever you are ready.'] },
    ]);
    const prodId = p.product ? pid[p.product] : null;
    const id = ins.run({
      title: p.t, slug: uniqueSlug('posts', p.t), subtitle: p.sub || '', excerpt: '', content,
      cover_image: await img('cover-' + i, p.shape, p.pal), cover_caption: 'Illustration: PaulibyteNews (demo artwork)',
      type: p.type, category_id: cat(p.cat), author_id: admin.id, product_id: prodId, is_featured: p.featured || 0, is_breaking: p.breaking || 0,
      tags: [p.cat.split(' ')[0].toLowerCase(), p.type, 'demo'].join(', '), review_json: p.review ? JSON.stringify(p.review) : '', views: 1200 - i * 80, published_at: ago(p.h),
    }).lastInsertRowid;
    if (prodId) db.prepare('UPDATE products SET post_id = ? WHERE id = ?').run(id, prodId);
  }
  setSetting('demo_seeded', '1');
}

function clear() {
  db.prepare(`DELETE FROM posts WHERE (',' || replace(tags,', ',',') || ',') LIKE '%,demo,%'`).run();
  db.prepare(`DELETE FROM products WHERE image LIKE '/uploads/demo/%'`).run();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('Demo articles, lab products and artwork removed.');
}

module.exports = { seed, clear };
if (require.main === module && process.argv[2] === 'clear') clear();
