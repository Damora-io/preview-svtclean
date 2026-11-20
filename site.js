/* SVT Clean: the page's own small interactions (the film itself is film-engine.js; leads, prices and the calculator are
   svt.js). Built on the Damora Scroll Film starter site.js. Each part runs only if its markup is on the page. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // theme toggle: follows the phone until the visitor picks
  $$('.theme').forEach((t) => t.addEventListener('click', () => {
    const r = document.documentElement;
    const cur = r.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'light' ? 'dark' : 'light';
    r.setAttribute('data-theme', next);
    try { localStorage.setItem('sf-theme', next); } catch (e) {}
  }));

  // header: clear over the hero, solid once the hero lets go (film pages only; secondary pages ship it solid)
  const top = $('.top');
  if (top && $('[data-film]')) {
    let heroEnd = (window.ScrollFilm && window.ScrollFilm.heroEnd) || innerHeight;
    const ui = () => top.classList.toggle('solid', scrollY > heroEnd - 40);
    addEventListener('scrollfilm', (e) => { heroEnd = e.detail.heroEnd; ui(); });
    addEventListener('scroll', ui, { passive: true }); ui();
  }

  // services dropdown: closes on a click outside or Escape
  const dd = $('.nav details');
  if (dd) {
    document.addEventListener('click', (e) => { if (dd.open && !dd.contains(e.target)) dd.open = false; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dd.open) { dd.open = false; $('summary', dd).focus(); } });
  }

  // phone menu: a full-screen panel; focus goes in, Escape and the close button bring it back
  const mb = $('.menu-btn'), mn = $('.mnav');
  if (mb && mn) {
    const close = () => { mn.hidden = true; mb.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; mb.focus(); };
    mb.addEventListener('click', () => { mn.hidden = false; mb.setAttribute('aria-expanded', 'true'); document.body.style.overflow = 'hidden'; const f = $('a, button', mn); if (f) f.focus(); });
    $$('[data-close], a', mn).forEach((a) => a.addEventListener('click', (e) => { if (a.matches('[data-close]')) e.preventDefault(); mn.hidden = true; mb.setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mn.hidden) close(); });
  }

  // reveals: one short move per block, finished while it is on screen
  const els = $$('.reveal');
  if (reduce || !('IntersectionObserver' in window)) els.forEach((e) => e.classList.add('in'));
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    els.forEach((e) => io.observe(e));
  }

  // review marks on the local build only: lines that wait on the owner's OK get a dotted underline, and the footer counts
  // them. tools/claims_check.py fails the publish while any data-claim="pending" is left.
  const RH = (window.SVT_CONFIG && window.SVT_CONFIG.reviewHosts) || [];
  if ((/^(127\.0\.0\.1|localhost)$/.test(location.hostname) || RH.includes(location.hostname)) && !/[?&]clean\b/.test(location.search)) {
    document.body.classList.add('review');
    const n = $$('[data-claim="pending"]').length, p = $('.review-pill');
    if (p) p.textContent = n ? `Preview: ${n} dotted line${n === 1 ? '' : 's'} wait on Jay's OK` : 'Preview: no lines waiting';
  }
})();
