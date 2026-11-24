/* PaulibyteNews rich article editor (Quill 2) */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const CSRF = $('meta[name=csrf]').content;
  const DATA = JSON.parse($('#post-data').textContent);
  let postId = DATA.id, status = DATA.status, slug = DATA.slug, dirty = false, saving = false;

  /* ---------- Custom blots ---------- */
  const Block = Quill.import('blots/block');
  const BlockEmbed = Quill.import('blots/block/embed');
  class Callout extends Block { static blotName = 'callout'; static tagName = 'ASIDE'; static className = 'callout'; }
  class Divider extends BlockEmbed { static blotName = 'divider'; static tagName = 'HR'; }
  Quill.register(Callout); Quill.register(Divider);
  const Icons = Quill.import('ui/icons');
  Icons.undo = $('.ql-undo').innerHTML; Icons.redo = $('.ql-redo').innerHTML;
  ['callout', 'divider', 'gallery', 'table', 'source', 'fullscreen'].forEach(k => { Icons[k] = $('.ql-' + k).innerHTML; });

  const toast = (msg, bad) => { const t = $('[data-toast]'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2600); };

  async function uploadFile(file) {
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/admin/media/upload', { method: 'POST', headers: { 'x-csrf-token': CSRF, 'Accept': 'application/json' }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed');
    return j.url;
  }
  function insertImage(url, alt) {
    const range = quill.getSelection(true) || { index: quill.getLength() };
    quill.insertEmbed(range.index, 'image', url, 'user');
    if (alt) quill.formatText(range.index, 1, 'alt', alt);
    quill.insertText(range.index + 1, '\n', 'user');
    quill.setSelection(range.index + 2, 0, 'silent');
  }
  function toEmbedUrl(u) {
    let m;
    if ((m = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/))) return 'https://www.youtube-nocookie.com/embed/' + m[1];
    if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return 'https://player.vimeo.com/video/' + m[1];
    if ((m = u.match(/tiktok\.com\/.*video\/(\d+)/))) return 'https://www.tiktok.com/embed/v2/' + m[1];
    if ((m = u.match(/open\.spotify\.com\/(track|episode|show|playlist|album)\/(\w+)/))) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
    return null;
  }

  /* ---------- Quill ---------- */
  const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: 'Start writing your story…',
    modules: {
      table: true,
      history: { delay: 800, maxStack: 300, userOnly: true },
      toolbar: {
        container: '#toolbar',
        handlers: {
          undo() { quill.history.undo(); },
          redo() { quill.history.redo(); },
          divider() { const r = quill.getSelection(true); quill.insertEmbed(r.index, 'divider', true, 'user'); quill.setSelection(r.index + 1, 0, 'silent'); },
          image() {
            const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = async () => {
              const f = inp.files[0]; if (!f) return;
              toast('Uploading image…');
              try { const url = await uploadFile(f); insertImage(url, prompt('Describe the image (alt text for accessibility & SEO):', '') || ''); toast('Image added'); } catch (e) { toast(e.message, true); }
            };
            inp.click();
          },
          gallery() { openLibrary(url => insertImage(url, '')); },
          video() {
            const u = prompt('Paste a YouTube, Vimeo, TikTok or Spotify link:'); if (!u) return;
            const e = toEmbedUrl(u.trim()); if (!e) return toast('That link is not a supported video/audio URL', true);
            const r = quill.getSelection(true); quill.insertEmbed(r.index, 'video', e, 'user'); quill.setSelection(r.index + 1, 0, 'silent');
          },
          table() {
            const t = quill.getModule('table');
            if (t.getTable()[0]) return toast('Already inside a table — use the table tools above');
            const rows = parseInt(prompt('How many rows?', '3')) || 3, cols = parseInt(prompt('How many columns?', '3')) || 3;
            t.insertTable(Math.min(rows, 30), Math.min(cols, 10));
          },
          source: toggleSource,
          fullscreen() { document.body.classList.toggle('ed-fullscreen'); },
          link(value) {
            if (!value) return quill.format('link', false);
            const range = quill.getSelection();
            if (!range || !range.length) return toast('Select some text first, then add the link', true);
            let url = prompt('Link URL (https://…, /article/…, or mailto:):', 'https://'); if (!url || url === 'https://') return;
            if (!/^(https?:|mailto:|tel:|\/|#)/.test(url)) url = 'https://' + url;
            quill.format('link', url, 'user');
          },
        },
      },
      uploader: {
        mimetypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        async handler(range, files) {
          for (const f of files) { toast('Uploading ' + f.name + '…'); try { quill.setSelection(range.index, 0); insertImage(await uploadFile(f), ''); } catch (e) { toast(e.message, true); } }
        },
      },
      keyboard: {
        bindings: {
          save: { key: 's', shortKey: true, handler() { save('save'); return false; } },
          link: { key: 'k', shortKey: true, handler() { quill.getModule('toolbar').handlers.link.call(null, true); return false; } },
        },
      },
    },
  });
  window._quill = quill;

  // Table tools
  const tt = $('[data-tabletools]');
  quill.on('editor-change', () => {
    const r = quill.getSelection();
    tt.hidden = !(r && quill.getModule('table').getTable(r)[0]);
  });
  $$('[data-t]', tt).forEach(b => b.addEventListener('click', e => { e.preventDefault(); quill.getModule('table')[b.dataset.t](); quill.focus(); }));

  // HTML source mode
  const src = $('[data-source]');
  function toggleSource() {
    const on = src.hidden;
    if (on) { src.value = prettyHtml(quill.root.innerHTML); src.hidden = false; quill.container.hidden = true; src.focus(); }
    else { quill.setContents(quill.clipboard.convert({ html: src.value }), 'user'); src.hidden = true; quill.container.hidden = false; }
    $('.ql-source').classList.toggle('ql-active', on);
  }
  const prettyHtml = h => h.replace(/(<\/(p|h\d|li|ol|ul|blockquote|aside|table|tr|pre|div)>)/g, '$1\n');

  /* ---------- Stats ---------- */
  const counts = $('[data-counts]');
  function updateCounts() {
    const text = quill.getText().trim();
    const words = text ? text.split(/\s+/).length : 0;
    counts.textContent = `${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 220))} min read · ${quill.root.querySelectorAll('img').length} images`;
  }
  quill.on('text-change', (d, o, source) => { if (source === 'user') markDirty(); updateCounts(); });
  updateCounts();

  // Auto-grow title
  const title = $('#f-title');
  const grow = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  title.addEventListener('input', grow); grow();
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#f-subtitle').focus(); } });

  /* ---------- Review panel ---------- */
  const rows = { scores: DATA.review.scores, specs: DATA.review.specs, buy: DATA.review.buy };
  const ROW_TPL = {
    scores: r => `<input data-k="label" placeholder="Category" value="${esc(r.label)}"><input data-k="value" type="number" min="0" max="10" step="0.1" placeholder="0–10" value="${esc(r.value)}">`,
    specs: r => `<input data-k="label" placeholder="Spec (e.g. Display)" value="${esc(r.label)}"><input data-k="value" placeholder="Value (e.g. 6.7in AMOLED, 120Hz)" value="${esc(r.value)}">`,
    buy: r => `<input data-k="label" placeholder="Store (e.g. Jumia)" value="${esc(r.label)}"><input data-k="price" placeholder="Price" value="${esc(r.price)}"><input data-k="url" placeholder="https://… (affiliate link)" value="${esc(r.url)}">`,
  };
  function esc(v) { return String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function renderRows(k) {
    const box = $(`[data-rows="${k}"]`);
    box.innerHTML = rows[k].map((r, i) => `<div class="ed-line ed-line-${k}" data-i="${i}">${ROW_TPL[k](r)}<button type="button" class="a-x" data-del aria-label="Remove">×</button></div>`).join('');
  }
  function readRows(k) { return $$(`[data-rows="${k}"] .ed-line`).map(l => Object.fromEntries($$('input', l).map(i => [i.dataset.k, i.value.trim()]))); }
  Object.keys(rows).forEach(renderRows);
  $$('[data-add-row]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.addRow; rows[k] = readRows(k); rows[k].push({}); renderRows(k); markDirty(); $(`[data-rows="${k}"] .ed-line:last-child input`).focus(); }));
  $('[data-review-panel]').addEventListener('click', e => { if (e.target.matches('[data-del]')) { e.target.closest('.ed-line').remove(); markDirty(); updateRing(); } });
  $('[data-spec-preset]').addEventListener('click', () => {
    const k = 'specs'; rows[k] = readRows(k).filter(r => r.label);
    ['Display', 'Processor', 'RAM / Storage', 'Rear cameras', 'Front camera', 'Battery', 'Charging', 'OS', 'Dimensions / weight', 'Connectivity'].forEach(label => { if (!rows[k].some(r => r.label === label)) rows[k].push({ label, value: '' }); });
    renderRows(k); markDirty();
  });
  const scoreInp = $('#r-score'), ring = $('[data-ring]');
  function updateRing() { const v = parseFloat(scoreInp.value); ring.textContent = isNaN(v) ? '–' : v.toFixed(1); ring.style.setProperty('--p', isNaN(v) ? 0 : v * 10); }
  scoreInp.addEventListener('input', updateRing); updateRing();
  $('[data-avg]').addEventListener('click', () => {
    const vals = readRows('scores').map(r => parseFloat(r.value)).filter(v => !isNaN(v));
    if (!vals.length) return toast('Add some breakdown scores first', true);
    scoreInp.value = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1); updateRing(); markDirty();
  });
  const typeSel = $('#f-type');
  typeSel.addEventListener('change', () => { $('[data-review-panel]').hidden = typeSel.value !== 'review'; });

  /* ---------- Cover & media library ---------- */
  const cover = $('#f-cover'), coverBox = $('[data-cover]');
  function setCover(url) { cover.value = url; coverBox.innerHTML = url ? `<img src="${url}" alt="">` : '<span>No cover image</span>'; markDirty(); }
  $('[data-cover-upload]').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; toast('Uploading cover…'); try { setCover(await uploadFile(f)); toast('Cover set'); } catch (er) { toast(er.message, true); } e.target.value = ''; });
  $('[data-cover-library]').addEventListener('click', () => openLibrary(setCover));
  $('[data-cover-remove]').addEventListener('click', () => setCover(''));

  const modal = $('[data-modal]'), grid = $('[data-modal-grid]');
  let pick = null;
  async function openLibrary(cb) {
    pick = cb; modal.hidden = false; grid.innerHTML = '<p>Loading…</p>';
    const items = await fetch('/admin/media?format=json').then(r => r.json());
    grid.innerHTML = items.length ? items.map(i => `<button data-url="${i.url}" title="${esc(i.original)}"><img src="${i.url}" loading="lazy" alt=""></button>`).join('') : '<p>No images yet — upload one.</p>';
  }
  grid.addEventListener('click', e => { const b = e.target.closest('[data-url]'); if (b) { modal.hidden = true; pick && pick(b.dataset.url); } });
  $('[data-modal-close]').addEventListener('click', () => modal.hidden = true);
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
  $('[data-modal-upload]').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const url = await uploadFile(f); modal.hidden = true; pick && pick(url); } catch (er) { toast(er.message, true); } e.target.value = ''; });

  /* ---------- Sponsored, counters, SERP ---------- */
  $('#f-sponsored').addEventListener('change', e => { $('#f-sponsor').hidden = !e.target.checked; });
  const serp = () => {
    $('[data-serp-title]').textContent = ($('#f-seo-title').value || title.value || 'Your headline') + ' | PaulibyteNews';
    $('[data-serp-desc]').textContent = $('#f-seo-desc').value || $('#f-excerpt').value || quill.getText().slice(0, 155) || 'Your description will appear here.';
    $('[data-serp-slug]').textContent = ($('#f-slug') && $('#f-slug').value) || slug || 'auto-slug';
    $$('[data-count-for]').forEach(s => { const el = $('#' + s.dataset.countFor); const ideal = { 'f-seo-title': 60, 'f-seo-desc': 155, 'f-excerpt': 170 }[el.id]; s.textContent = `${el.value.length}/${ideal}`; s.classList.toggle('over', el.value.length > ideal); });
  };
  ['#f-seo-title', '#f-seo-desc', '#f-excerpt', '#f-title', '#f-slug'].forEach(s => $(s) && $(s).addEventListener('input', serp)); serp();

  /* ---------- Dirty tracking ---------- */
  const stateEl = $('[data-save-state]');
  function markDirty() { dirty = true; stateEl.textContent = 'Unsaved changes'; stateEl.classList.add('dirty'); backupLocal(); }
  $('[data-editor-root]').addEventListener('input', e => { if (!e.target.closest('.ql-editor')) markDirty(); });
  $('[data-editor-root]').addEventListener('change', e => { if (!e.target.closest('.ql-editor')) markDirty(); });
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  const LKEY = 'pbn-draft-' + (postId || 'new');
  function backupLocal() { try { localStorage.setItem(LKEY, JSON.stringify({ t: Date.now(), title: title.value, html: quill.root.innerHTML })); } catch (e) {} }
  try {
    const b = JSON.parse(localStorage.getItem(LKEY) || 'null');
    if (b && b.html && b.html !== quill.root.innerHTML && Date.now() - b.t < 7 * 864e5 && b.html.length > 20) {
      if (confirm('There is an unsaved local copy of this article from ' + new Date(b.t).toLocaleString() + '. Restore it?')) { title.value = b.title; grow(); quill.root.innerHTML = b.html; markDirty(); }
      else localStorage.removeItem(LKEY);
    }
  } catch (e) {}

  /* ---------- Save ---------- */
  function collect(action) {
    if (!src.hidden) toggleSource();
    const v = id => { const el = $('#' + id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; };
    const lines = id => v(id).split('\n').map(s => s.trim()).filter(Boolean);
    return {
      id: postId, action, title: v('f-title'), subtitle: v('f-subtitle'), content: quill.root.innerHTML === '<p><br></p>' ? '' : quill.root.innerHTML,
      type: v('f-type'), category_id: v('f-category'), product_id: v('f-product'), tags: v('f-tags'), slug: v('f-slug'),
      cover_image: v('f-cover'), cover_caption: v('f-caption'), excerpt: v('f-excerpt'),
      is_featured: v('f-featured'), is_breaking: v('f-breaking'), allow_comments: v('f-comments'), is_sponsored: v('f-sponsored'), sponsor_name: v('f-sponsor'),
      seo_title: v('f-seo-title'), seo_description: v('f-seo-desc'), publish_at: v('f-publish-at'),
      review: v('f-type') === 'review' ? {
        product: v('r-product'), brand: v('r-brand'), kind: v('r-kind'), price: v('r-price'), tested_for: v('r-tested'), award: v('r-award'),
        score: v('r-score'), verdict_short: v('r-verdict-short'), verdict: v('r-verdict'), pros: lines('r-pros'), cons: lines('r-cons'),
        scores: readRows('scores'), specs: readRows('specs'), buy: readRows('buy'),
      } : null,
    };
  }
  async function save(action, extra = {}) {
    if (saving) return false;
    if (action === 'publish' && !title.value.trim()) { toast('Add a headline before publishing', true); return false; }
    if (action === 'publish' && !$('#f-category').value && !confirm('No category selected. Publish anyway?')) return false;
    saving = true; stateEl.textContent = action === 'autosave' ? 'Autosaving…' : 'Saving…';
    try {
      const r = await fetch('/admin/posts/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF }, body: JSON.stringify({ ...collect(action), ...extra }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Save failed');
      const isNew = !postId; postId = j.id; slug = j.slug; status = j.status;
      dirty = false; stateEl.classList.remove('dirty');
      stateEl.textContent = j.message + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const pill = $('[data-status-pill]'); pill.textContent = j.scheduled ? 'scheduled' : j.status; pill.className = 'a-pill s-' + (j.scheduled ? 'scheduled' : j.status);
      try { localStorage.removeItem(LKEY); } catch (e) {}
      if (isNew) history.replaceState(null, '', `/admin/posts/${postId}/edit`);
      if (action !== 'autosave') toast(j.message);
      serp();
      if (['publish', 'unpublish', 'submit', 'reject'].includes(action) || (isNew && action !== 'autosave')) setTimeout(() => location.href = `/admin/posts/${postId}/edit`, 700);
      return true;
    } catch (e) { stateEl.textContent = 'Not saved — ' + e.message; toast(e.message, true); return false; }
    finally { saving = false; }
  }
  $$('[data-act]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'reject') { const note = prompt('What should the writer fix? (they will see this note)'); if (note === null) return; return save('reject', { editor_note: note }); }
    if (act === 'unpublish' && !confirm('Take this article off the site and move it back to drafts?')) return;
    save(act);
  }));
  $('[data-preview]').addEventListener('click', async () => {
    const w = window.open('about:blank', '_blank');
    if (dirty || !postId) { if (!(await save(status === 'published' ? 'save' : 'save'))) { w && w.close(); return; } }
    if (w) w.location = `/article/${slug}?preview=1`;
  });
  // Autosave drafts only (never silently changes a live article)
  setInterval(() => { if (dirty && status !== 'published' && (postId || title.value.trim())) save('autosave'); }, 30000);

  /* ---------- Revisions ---------- */
  $$('[data-rev]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Load this revision into the editor? Your current text will be replaced (you can undo with Ctrl+Z, and nothing is saved until you click Save).')) return;
    const r = await fetch('/admin/posts/revision/' + b.dataset.rev).then(r => r.json());
    if (r.content !== undefined) { quill.setContents(quill.clipboard.convert({ html: r.content }), 'user'); title.value = r.title; grow(); markDirty(); toast('Revision loaded — click Save to keep it'); }
  }));
})();
