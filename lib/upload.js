const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('../db');
let sharp = null;
try { sharp = require('sharp'); } catch { /* optional */ }

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
const OK = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, OK.includes(file.mimetype)),
});

async function saveImage(file, userId, maxWidth = 1800) {
  if (!file) return null;
  const now = new Date();
  const sub = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(UPLOAD_ROOT, sub);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.parse(file.originalname).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'image';
  const id = crypto.randomBytes(4).toString('hex');
  let buf = file.buffer, ext = path.extname(file.originalname).toLowerCase() || '.jpg', width = null, height = null;
  if (sharp && file.mimetype !== 'image/gif') {
    const img = sharp(file.buffer).rotate().resize({ width: maxWidth, withoutEnlargement: true });
    const out = await img.webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    buf = out.data; ext = '.webp'; width = out.info.width; height = out.info.height;
  }
  const name = `${base}-${id}${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  const url = `/uploads/${sub}/${name}`;
  db.prepare('INSERT INTO media (url, original, mime, size, width, height, uploader_id) VALUES (?,?,?,?,?,?,?)')
    .run(url, file.originalname, ext === '.webp' ? 'image/webp' : file.mimetype, buf.length, width, height, userId || null);
  return url;
}

module.exports = { upload, saveImage, UPLOAD_ROOT };
