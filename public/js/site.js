(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const today = $('[data-today]');
  if (today) today.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Theme
  $$('[data-theme-toggle]').forEach(b => b.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('pbn-theme', dark ? 'dark' : 'light'); } catch (e) {}
  }));

  // Search
  const sb = $('.searchbar');
  $$('[data-search-toggle]').forEach(b => b.addEventListener('click', () => {
    sb.hidden = !sb.hidden; if (!sb.hidden) $('input', sb).focus();
  }));

  // Drawer
  const drawer = $('[data-drawer]');
  const setDrawer = open => { drawer.classList.toggle('open', open); drawer.setAttribute('aria-hidden', !open); document.body.style.overflow = open ? 'hidden' : ''; };
  $$('[data-open-drawer]').forEach(b => b.addEventListener('click', () => setDrawer(true)));
  $$('[data-close-drawer]').forEach(b => b.addEventListener('click', () => setDrawer(false)));
  drawer && drawer.addEventListener('click', e => { if (e.target === drawer) setDrawer(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setDrawer(false); });

  // Reading progress
  const bar = $('[data-progress]'), body = $('.art-body');
  if (bar && body) {
    const upd = () => {
      const r = body.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (r.height + innerHeight * 0.5)));
      bar.style.width = (p * 100) + '%';
    };
    addEventListener('scroll', upd, { passive: true }); upd();
  }

  // Share / copy
  $$('[data-share]').forEach(box => {
    const btn = $('[data-copy]', box);
    btn && btn.addEventListener('click', async () => {
      const url = box.dataset.url, title = box.dataset.title;
      if (navigator.share && matchMedia('(max-width: 640px)').matches) { try { await navigator.share({ title, url }); return; } catch (e) {} }
      try { await navigator.clipboard.writeText(url); btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy link', 1800); } catch (e) { prompt('Copy this link', url); }
    });
  });

  // Mobile anchor ad
  const anchor = $('[data-anchor]');
  if (anchor) {
    try { if (sessionStorage.getItem('pbn-anchor-x')) anchor.remove(); } catch (e) {}
    const x = $('[data-close-anchor]', anchor);
    x && x.addEventListener('click', () => { anchor.remove(); try { sessionStorage.setItem('pbn-anchor-x', '1'); } catch (e) {} });
  }

  // Newsletter without reload
  $$('[data-subscribe]').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await fetch(f.action, { method: 'POST', headers: { 'Accept': 'application/json' }, body: new URLSearchParams(new FormData(f)) });
    f.innerHTML = r.ok ? '<p style="font-weight:700;margin:0">You’re subscribed — thanks! 🎉</p>' : '<p>Something went wrong. Please try again.</p>';
  }));

  // AdSense slots
  $$('ins.adsbygoogle').forEach(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {} });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
