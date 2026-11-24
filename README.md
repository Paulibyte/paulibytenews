# PaulibyteNews

A tech news and reviews publishing app for **paulibytenews.com**. It runs on Node.js with SQLite, so there is no separate database server to set up. It runs on your Hostinger VPS alongside Engineeria Africa and your other apps.

## What's inside

**Public site (works on mobile and desktop)**
- Homepage with a featured hero, a breaking-news ticker, latest stories, fresh reviews and one block per section.
- **Review Lab** (`/lab`): shows readers the products you are testing right now, with a progress bar, tester, start date, review due date and test checklist. It also has a live test log, a "vote for what we test next" queue and a list of products already reviewed. Each product has its own page at `/lab/<product>`.
- **Review articles**: a score ring, an award badge, the price, pros and cons, a score breakdown, a specs table and "where to buy" affiliate buttons. Affiliate clicks are tracked. Each review also outputs Google review-snippet data (JSON-LD).
- **Reviews hub** (`/reviews`): filter by product type and sort by newest or highest score.
- Sections, tags, search, author pages, related stories, previous/next links, moderated comments, share buttons (WhatsApp, X, Facebook, LinkedIn, copy link), a reading-progress bar, dark mode and a newsletter signup.
- SEO: page titles, descriptions, Open Graph images, `sitemap.xml`, an RSS feed (`/feed.xml`), `robots.txt` and `ads.txt`.
- Installable as an app on phones (PWA) and shows a basic offline page.

**Advertising**
- 10 ad zones: header leaderboard, homepage in-feed, sidebar box, sticky sidebar, in-article (repeats every N paragraphs), end of article, review sponsor slot, Review Lab page, footer, and a mobile sticky bottom bar the reader can close.
- Two kinds of ad: an image banner (with an optional separate mobile image) or HTML code, which covers Google AdSense units.
- Per ad: start and end dates, desktop/mobile only, rotation weight, and impression, click and CTR counts.
- Empty zones show an "Advertise here" box that links to the **Advertise page**. That page has your rate card and an enquiry form, and enquiries arrive in the dashboard.
- Settings for your AdSense publisher ID (ads.txt is generated from it automatically), plus sponsored-post labels.

**Newsroom dashboard (`/admin`)**
- Three roles, as in Engineeria Africa: **Admin**, **Editor-in-Chief** and **Contributor**. Contributors write and submit articles. Editors publish, schedule or return articles to the writer with a note.
- **Rich editor**: headings, text sizes, bold/italic/underline/strike, sub/superscript, text colour and highlight, numbered, bullet and check lists, indent, alignment, quotes, callout/tip boxes, code blocks, divider lines, links, image upload (also by paste or drag-and-drop), the media library, YouTube/Vimeo/TikTok/Spotify embeds, tables (add or remove rows and columns), an HTML source view, focus mode, undo/redo and Markdown-style shortcuts.
- The editor also gives you live word count and reading time, autosave for drafts, a local backup if your browser crashes, revision history with restore, a preview, scheduled publishing, an SEO panel with a Google preview, the cover image and caption, and tags.
- A review box builder: product, price, award, overall score (or the average of the breakdown), pros and cons, specs (with a phone preset) and buy links.
- Review Lab manager: a board of products, a test checklist, progress that updates itself from the checklist, lab notes with photos, and a "Write review" button that pre-fills the review.
- Media library (images are converted to WebP automatically), sections, comment moderation, newsletter subscribers (CSV export), team management, your own profile and site settings.

## Run it locally

```bash
npm install
cp .env.example .env      # then edit SESSION_SECRET
npm start                 # http://localhost:3010
```

On the first start, the app creates your admin account. It prints the login details and saves them to `data/FIRST_LOGIN.txt`. Sign in at `/admin/login`, change the password under **My profile**, then delete that file.

The site also starts with **demo articles and lab products** (fictional brands) so you can see every layout. Remove them all when you're ready with:

```bash
npm run clear-demo
```

To start with an empty site instead, set `SEED_DEMO=0` in `.env` before the first start.

## Deploy to the Hostinger VPS

These steps match how Engineeria Africa is deployed: `/var/www`, PM2, Nginx and certbot.

1. **DNS**: in Hostinger, point an `A` record for `paulibytenews.com` and `www` to the VPS IP.
2. **Upload and install**
   ```bash
   cd /var/www && git clone <your repo> paulibytenews   # or upload the zip and unzip it here
   cd paulibytenews
   npm install --omit=dev
   cp .env.example .env && nano .env    # set SESSION_SECRET, ADMIN_EMAIL, and a free PORT
   ```
   Use a port your other apps are not using. Check with `sudo ss -tlnp`.
3. **Start with PM2**
   ```bash
   pm2 start server.js --name paulibytenews
   pm2 save
   cat data/FIRST_LOGIN.txt     # your admin login
   ```
4. **Nginx** (`/etc/nginx/sites-available/paulibytenews`):
   ```nginx
   server {
     server_name paulibytenews.com www.paulibytenews.com;
     client_max_body_size 12M;
     location /uploads/ { alias /var/www/paulibytenews/public/uploads/; expires 30d; access_log off; }
     location / {
       proxy_pass http://127.0.0.1:3010;   # your PORT
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   ```bash
   sudo ln -s /etc/nginx/sites-available/paulibytenews /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d paulibytenews.com -d www.paulibytenews.com
   ```
5. In the dashboard, go to **Settings** and check the Site URL (`https://paulibytenews.com`), your contact emails, your social links and, once approved, your AdSense ID.

**Updating later:** `git pull && npm install --omit=dev && pm2 restart paulibytenews`. Your database (`data/`) and uploads (`public/uploads/`) are not tracked by git, so updates never overwrite them.

**Backups:** copy `data/paulibytenews.db` and `public/uploads/` regularly, for example with a nightly `tar` to another location.

## Using AdSense
1. Apply at Google AdSense with paulibytenews.com.
2. Paste your publisher ID (`ca-pub-…`) into **Settings → Monetisation**. The AdSense script and `/ads.txt` are then added automatically.
3. Create ad units in AdSense. In **Advertising → New ad**, choose "HTML / AdSense code", paste the `<ins class="adsbygoogle" …>` unit and pick a zone.
4. Direct-sold banners can go in the same zones. Use rotation weights to share a zone between AdSense and paying advertisers.
