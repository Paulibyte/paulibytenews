require('./lib/env');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { db, settings } = require('./db');
const H = require('./lib/helpers');
const { bootstrap } = require('./scripts/bootstrap');

bootstrap();

const app = express();
const PORT = process.env.PORT || 3010;
const PROD = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use('/vendor/quill', express.static(path.join(__dirname, 'node_modules/quill/dist'), { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '7d' : 0 }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());
app.use(session({
  store: new H.SqliteStore(),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-env',
  resave: false,
  saveUninitialized: false,
  name: 'pbn.sid',
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD && process.env.COOKIE_SECURE !== '0', maxAge: 14 * 864e5 },
}));

// Locals available to every view
app.use((req, res, next) => {
  const s = settings();
  res.locals.s = s;
  res.locals.H = H;
  res.locals.path = req.path;
  res.locals.me = req.session.userId
    ? db.prepare('SELECT id, name, email, role, avatar FROM users WHERE id = ? AND active = 1').get(req.session.userId)
    : null;
  res.locals.flash = req.session.flash; delete req.session.flash;
  res.locals.zone = (zone, opts) => H.renderZone(zone, opts);
  next();
});
app.use(H.csrf);

app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/public'));

app.use((req, res) => res.status(404).render('404', { title: 'Page not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(PROD ? 'Something went wrong.' : `<pre>${H.escapeHtml(err.stack)}</pre>`);
});

app.listen(PORT, () => console.log(`PaulibyteNews running on http://localhost:${PORT}`));
