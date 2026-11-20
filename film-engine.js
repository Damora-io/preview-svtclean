/* Damora Scroll Film engine (scope: core). One painted or filmed film behind the whole page, driven by the scroll.
   Method page: references/web/scroll-film.md (source of truth). Proven on Ends United v2, 2026-11-14
   (https://endsunited.damoradigital.com/): scroll-hero, motion-timing, site-check, flick, jumps, reduced motion, rotate,
   portrait tablet all PASS, three-lens review with skeptics, 18 findings fixed.

   Copy this file next to the site's pages as-is (never edit the copy; change it here, then copy again:
   `python -I scripts/scrollfilm/scrollfilm.py sync <site folder>`). Load it before the site's own script.

   MARKUP CONTRACT (everything is read from the page, nothing site-specific lives in here):
   <div class="film" data-film
        data-src="film/v1/{set}/f{n}.webp"   frame URL; {set} = m (phones, portrait tablets) or d (desk); {n} = 1-based, 4 digits
        data-n="408"                          total frames
        data-clips="0-119,120-167,..."        0-based frame range of each clip, in film order; clip 1 = the hero clip
        data-hero-film="0.85"                 optional: share of the hero's scroll span the hero clip plays over
        data-hero-rate="90"                   optional: max frames a second going FORWARD through the hero clip
        data-phone="(max-width: 760px), (max-aspect-ratio: 1/1)"  optional: which screens get the m set
        data-push="0.045">                    optional: slow push-in on holds (0 = off)
     <picture><source media="(same as data-phone)" srcset="film/v1/m/f0001.webp"><img class="poster" src="film/v1/d/f0001.webp" alt="describe the film"></picture>
     <canvas aria-hidden="true"></canvas>
     <div class="shade" aria-hidden="true"></div>
   </div>
   <section data-film-hero>               tall section (e.g. 300svh) with a sticky 100svh stage inside; its height = the hero's span
     ... data-film-out ...               first words: get class "out" once the playhead passes data-out-at (frames, default 7)
     ... data-film-in data-in-at="0.7"   payoff words: get class "in" once the playhead passes 70% of the hero clip
     ... data-film-meter ...             optional progress bar: transform scaleY(0..1) by hero scroll progress
   </section>
   <div data-tr="2"> ... </div>            a chapter: clip 2 plays while this block rises (from 85% of a screen before its
                                         top reaches the top, until its bottom reaches the bottom). Between chapters the
                                         film holds on the last frame of the previous clip while content scrolls over it.

   EVENTS: window 'scrollfilm' (CustomEvent, detail { heroEnd, cur, target, n }) on every scroll and measure, so the
   site's own code can turn its header solid after the hero (heroEnd = scrollY where the hero lets go).
   window.ScrollFilm = { heroEnd, cur, target, n } is kept current too.

   BEHAVIOUR (each line was a real bug or a review finding, see the method page "Bugs met"):
   - the playhead chases the scroll target; forward through the hero it is capped (90 fps: 120 frames never in under
     ~1.3 s on a hard flick); any other jump over 60 frames cuts to 12 frames before the target, then arrives;
   - the browser placing the page (reload, back, a link from another page, an in-page #anchor) seeds the playhead at
     the target instead of playing the film in between;
   - neighbour frames crossfade; holds push in slowly, eased out as the next clip starts (continuous, no jumps);
   - compressed frames kept for the whole film, decoded bitmaps only near the playhead (24 phone / 18 desk), decode
     queue nearest-first, 2 at a time; loading order: every clip's end still, then the hero clip coarse to fine
     (every 16th, 8th, 4th, 2nd, rest), then each clip in film order; 6 fetches at a time; the scroll's landing frames first;
   - a rotate or window change across data-phone swaps the frame set without a flash;
   - reduced motion: stills only (the film swaps paintings at chapter midpoints, nothing plays), payoff words shown at once.
*/
(() => {
  const film = document.querySelector('[data-film]');
  if (!film) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

  const canvas = film.querySelector('canvas'), ctx = canvas.getContext('2d', { alpha: false });
  const N = +film.dataset.n;
  const clips = film.dataset.clips.split(',').map((s) => s.split('-').map(Number));
  const SRC = film.dataset.src || 'film/{set}/f{n}.webp';
  const HERO_END = clips[0][1];
  const STILLS = [0].concat(clips.map((c) => c[1]));
  const HERO_FILM = num(film.dataset.heroFilm, 0.85);
  const HERO_RATE = num(film.dataset.heroRate, 90);
  const MIN_RATE = 90;
  const PUSH = num(film.dataset.push, 0.045);
  const mq = matchMedia(film.dataset.phone || '(max-width: 760px), (max-aspect-ratio: 1/1)');
  let phone = mq.matches, gen = 0;
  const src = (i) => SRC.replace('{set}', phone ? 'm' : 'd').replace('{n}', String(i + 1).padStart(4, '0'));

  const hero = document.querySelector('[data-film-hero]');
  const outEls = hero ? $$('[data-film-out]', hero) : [];
  const inEls = hero ? $$('[data-film-in]', hero) : [];
  const meter = hero && hero.querySelector('[data-film-meter]');
  const docTop = (el) => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y; };

  let blobs = new Array(N);
  const cache = new Map(), pending = new Set(), fetching = new Set();
  const MAX_DECODED = () => (phone ? 24 : 18);
  let cur = 0, target = 0, cw = 0, ch = 0, drawnKey = '', heroEnd = innerHeight;
  let sDisp = 1, sTarget = 1;
  const api = window.ScrollFilm = { heroEnd, cur, target, n: N };
  const announce = () => {
    api.heroEnd = heroEnd; api.cur = cur; api.target = target;
    dispatchEvent(new CustomEvent('scrollfilm', { detail: { heroEnd, cur, target, n: N } }));
  };

  // hero words follow the painting, not the scroll (they change when the picture does, even on a hard flick)
  const heroCopy = () => {
    if (!hero || reduce) return;
    outEls.forEach((el) => el.classList.toggle('out', cur > num(el.dataset.outAt, 7)));
    inEls.forEach((el) => el.classList.toggle('in', cur > HERO_END * num(el.dataset.inAt, 0.7)));
  };
  if (hero && reduce) inEls.forEach((el) => el.classList.add('in'));
  const heroMeter = () => {
    if (!meter || !hero) return;
    const span = Math.max(1, hero.offsetHeight - innerHeight);
    const p = Math.min(1, Math.max(0, (scrollY - docTop(hero)) / span));
    meter.style.transform = 'scaleY(' + p.toFixed(3) + ')';
  };

  // scroll position -> film frame. Keys come from the page: the hero, then every [data-tr] chapter
  let keys = [[0, 0]];
  const measure = () => {
    const vh = innerHeight;
    keys = [];
    if (hero) {
      const hTop = docTop(hero), span = Math.max(1, hero.offsetHeight - vh);
      heroEnd = hTop + span;
      if (reduce) keys.push([0, HERO_END]);
      else keys.push([hTop, 0], [hTop + span * HERO_FILM, HERO_END]);
    } else { keys.push([0, 0]); heroEnd = 0; }
    $$('[data-tr]').forEach((el) => {
      const c = clips[+el.dataset.tr - 1]; if (!c) return;
      const t = docTop(el), a = t - vh * 0.85, b = Math.max(a + 1, t + el.offsetHeight - vh);
      keys.push([a, c[0]], [b, c[1]]);
    });
    keys.sort((p, q) => p[0] - q[0]);
  };
  const seg = (y) => {
    if (y <= keys[0][0]) return { f: keys[0][1], hold: true, t: 0, i: 0 };
    for (let i = 1; i < keys.length; i++) {
      const [y1, f1] = keys[i];
      if (y <= y1) {
        const [y0, f0] = keys[i - 1];
        const t = Math.min(1, Math.max(0, (y - y0) / Math.max(1, y1 - y0)));
        const hold = Math.abs(f1 - f0) <= 1.5;
        let f = f0 + (f1 - f0) * t;
        if (reduce) f = hold ? f0 : (t < 0.5 ? f0 : f1);
        return { f, hold, t, i };
      }
    }
    return { f: keys[keys.length - 1][1], hold: true, t: 1, i: keys.length };
  };

  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(film.clientWidth * dpr), h = Math.round(film.clientHeight * dpr);
    if (!w || !h || (w === cw && h === ch)) return false;
    cw = canvas.width = w; ch = canvas.height = h; drawnKey = ''; return true;
  };
  const trim = () => {
    while (cache.size > MAX_DECODED()) {
      let far = -1, fd = -1;
      cache.forEach((_, k) => { const d = Math.min(Math.abs(k - cur), Math.abs(k - target) + 2); if (d > fd) { fd = d; far = k; } });
      const bm = cache.get(far); cache.delete(far); if (bm && bm.close) bm.close();
    }
  };
  const wantQ = new Set(); let inflight = 0;
  const pumpDecode = () => {
    while (inflight < 2 && wantQ.size) {
      let best = -1, bd = 1e9;
      wantQ.forEach((i) => {
        const d = Math.min(Math.abs(i - cur), Math.abs(i - target));
        if (d > 12 || cache.has(i) || pending.has(i) || !blobs[i]) wantQ.delete(i);
        else if (Math.abs(i - cur) < bd) { bd = Math.abs(i - cur); best = i; }
      });
      if (best < 0) return;
      wantQ.delete(best); pending.add(best); inflight++;
      const g = gen, k = best;
      createImageBitmap(blobs[k]).then((bm) => {
        if (g !== gen) { if (bm.close) bm.close(); return; }
        cache.set(k, bm); trim(); drawnKey = ''; kick();
      }).catch(() => {}).finally(() => { pending.delete(k); inflight--; pumpDecode(); });
    }
  };
  const ensure = (i) => {
    if (i < 0 || i >= N || cache.has(i) || pending.has(i) || !blobs[i]) return;
    wantQ.add(i); pumpDecode();
  };
  const nearestDecoded = (t) => {
    let best = -1, bd = 1e9;
    cache.forEach((_, k) => { const d = Math.abs(k - t); if (d < bd) { bd = d; best = k; } });
    return best;
  };
  const cover = (bm, s) => {
    const sc = Math.max(cw / bm.width, ch / bm.height) * s;
    const dw = bm.width * sc, dh = bm.height * sc;
    ctx.drawImage(bm, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  };
  const draw = () => {
    const i0 = Math.max(0, Math.min(N - 1, Math.floor(cur))), dir = target >= cur ? 1 : -1;
    for (let k = -1; k <= 5; k++) ensure(i0 + k * dir);
    if (reduce && !cache.has(i0)) return;
    const a = cache.has(i0) ? i0 : nearestDecoded(cur);
    if (a < 0 || !cw) return;
    const i1 = Math.min(N - 1, i0 + 1), fr = cur - i0;
    const b = a === i0 && fr > 0.04 && cache.has(i1) ? i1 : -1;
    const key = a + '|' + b + '|' + (b >= 0 ? fr.toFixed(2) : '') + '|' + sDisp.toFixed(4) + '|' + cw + 'x' + ch;
    if (key === drawnKey) return;
    cover(cache.get(a), sDisp);
    if (b >= 0) { ctx.globalAlpha = fr; cover(cache.get(b), sDisp); ctx.globalAlpha = 1; }
    drawnKey = key;
    if (!canvas.classList.contains('on')) canvas.classList.add('on');
  };

  let raf = 0, last = 0;
  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.064, (now - last) / 1000) : 1 / 60; last = now;
    const diff = target - cur;
    if (Math.abs(diff) > 0.002) {
      if (reduce) cur = target;
      else {
        const fwdHero = cur < HERO_END && diff > 0;
        if (!fwdHero && Math.abs(diff) > 60) cur = target - Math.sign(diff) * 12;
        const d2 = target - cur;
        const rate = fwdHero ? HERO_RATE : Math.max(MIN_RATE, Math.abs(d2) * 3.2);
        cur += Math.sign(d2) * Math.min(Math.abs(d2), rate * dt);
      }
    } else cur = target;
    heroCopy();
    sDisp += (sTarget - sDisp) * Math.min(1, dt * 6);
    if (reduce) sDisp = 1;
    draw();
    api.cur = cur;
    if (Math.abs(target - cur) > 0.002 || Math.abs(sTarget - sDisp) > 0.0004) raf = requestAnimationFrame(tick);
    else last = 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  const fetchFrame = (i) => {
    if (i < 0 || i >= N || blobs[i] || fetching.has(i)) return Promise.resolve();
    fetching.add(i); const g = gen;
    return fetch(src(i)).then((r) => (r.ok ? r.blob() : null)).then((bl) => {
      if (!bl || g !== gen) return;
      blobs[i] = bl;
      if (Math.abs(i - cur) <= 6 || Math.abs(i - target) <= 6 || !canvas.classList.contains('on')) ensure(i);
    }).catch(() => {}).finally(() => fetching.delete(i));
  };
  let order = [], q = 0;
  const buildOrder = () => {
    const seen = new Set(); order = []; q = 0;
    const add = (i) => { if (i >= 0 && i < N && !seen.has(i)) { seen.add(i); order.push(i); } };
    STILLS.forEach(add);
    clips.forEach(([a, b]) => { [16, 8, 4, 2, 1].forEach((st) => { for (let i = a; i <= b; i += st) add(i); }); });
  };
  const pump = (g) => { if (g !== gen || q >= order.length) return; const i = order[q++]; fetchFrame(i).finally(() => pump(g)); };
  const startLoading = () => { const g = gen; for (let k = 0; k < 6; k++) pump(g); };
  const near = () => { const t = Math.round(target); for (let k = -2; k <= 8; k++) fetchFrame(t + k); };

  let userMoved = false, seedNext = true;
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((ev) => addEventListener(ev, () => { userMoved = true; }, { passive: true, capture: true }));
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href*="#"]'); if (a && a.pathname === location.pathname) seedNext = true; }, true);
  const HERO_SEG = hero && !reduce ? 1 : -1;
  const onScroll = () => {
    const s = seg(scrollY);
    target = Math.max(0, Math.min(N - 1, s.f));
    let u;
    if (s.i === HERO_SEG) u = s.t;
    else if (s.hold) u = (HERO_SEG > 0 && s.i === HERO_SEG + 1) ? 1 : s.t;
    else u = Math.max(0, 1 - s.t / 0.3);
    sTarget = reduce ? 1 : 1 + PUSH * u;
    if (seedNext || !userMoved) { cur = target; sDisp = sTarget; seedNext = false; drawnKey = ''; }
    near(); kick(); heroMeter(); heroCopy(); announce();
  };
  addEventListener('pageshow', () => { seedNext = true; onScroll(); });
  addEventListener('hashchange', () => { seedNext = true; onScroll(); });

  const resetFrames = () => {
    gen++; phone = mq.matches; blobs = new Array(N);
    cache.forEach((bm) => bm.close && bm.close()); cache.clear(); pending.clear(); wantQ.clear(); fetching.clear();
    drawnKey = ''; buildOrder(); near(); startLoading();
  };
  let rz = 0;
  const remeasure = () => {
    if (mq.matches !== phone) {
      let snap = null;
      if (cw && ch && canvas.classList.contains('on')) { snap = document.createElement('canvas'); snap.width = cw; snap.height = ch; snap.getContext('2d').drawImage(canvas, 0, 0); }
      resetFrames(); size();
      if (snap) { const s = Math.max(cw / snap.width, ch / snap.height); ctx.drawImage(snap, (cw - snap.width * s) / 2, (ch - snap.height * s) / 2, snap.width * s, snap.height * s); }
    } else if (size()) drawnKey = '';
    measure(); onScroll();
  };
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(remeasure, 60); });
  if (mq.addEventListener) mq.addEventListener('change', remeasure);
  if ('ResizeObserver' in window) new ResizeObserver(() => { measure(); onScroll(); }).observe(document.body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); onScroll(); });

  size(); measure(); buildOrder();
  addEventListener('scroll', onScroll, { passive: true });
  fetchFrame(0).then(() => ensure(0)); STILLS.slice(1, 3).forEach(fetchFrame);
  if (document.readyState === 'complete') startLoading(); else addEventListener('load', startLoading, { once: true });
  onScroll();
})();
