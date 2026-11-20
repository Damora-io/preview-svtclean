/* SVT Clean: tracking, consent line, prices from the back end, the pricing calculator and the lead forms.
   Rules this file follows: front-and-back-together (every price is read from the rate rows, never typed into a page),
   no-data-lost (every calculator result and every lead field is saved, never blank, a failed save never loses what was
   typed), client-marketing-setup section 3 (GTM late and only on live hosts, consent default, 90-day attribution sent
   with every lead, hashed user data and a shared event_id). */
(() => {
  const C = window.SVT_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    sget(k, d = null) { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  /* ---------- dataLayer, consent default, late GTM ---------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  const denied = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
  gtag('consent', 'default', Object.assign({}, denied, { region: ['CA-QC', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'], wait_for_update: 500 }));
  gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
  if (store.get('svt-optout')) gtag('consent', 'update', denied);
  const push = (event, data = {}) => window.dataLayer.push(Object.assign({ event }, data));
  if (C.gtmId && !LOCAL) {
    let loaded = false;
    const load = () => {
      if (loaded) return; loaded = true;
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      const s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtm.js?id=' + C.gtmId; document.head.appendChild(s);
    };
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((e) => addEventListener(e, load, { once: true, passive: true }));
    addEventListener('load', () => setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(load) : load()), 2500));
  }

  /* ---------- cookie line and the privacy page's opt-out ---------- */
  const ck = $('.cookie');
  if (ck && !store.get('svt-cookie')) {
    // on the film page the line waits until the hero lets go, so it never sits on the hero words or buttons
    const film = $('[data-film]');
    const show = () => { if (!store.get('svt-cookie')) ck.hidden = false; };
    if (!film) show();
    else {
      const heroEnd = () => (window.ScrollFilm && window.ScrollFilm.heroEnd) || innerHeight * 2;
      const chk = () => { if (scrollY > heroEnd() - innerHeight * 0.2) { show(); removeEventListener('scroll', chk); } };
      addEventListener('scroll', chk, { passive: true }); chk();
    }
    $('button', ck).addEventListener('click', () => { store.set('svt-cookie', 1); ck.hidden = true; });
  }
  $$('[data-optout]').forEach((b) => {
    const show = () => { b.textContent = store.get('svt-optout') ? 'You are opted out. Opt back in' : 'Opt out of ad tracking'; };
    show();
    b.addEventListener('click', () => {
      const out = !store.get('svt-optout'); store.set('svt-optout', out);
      gtag('consent', 'update', out ? denied : { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
      show();
    });
  });

  /* ---------- attribution: first and last touch, kept 90 days, sent with every lead (the commission record) ---------- */
  const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id'];
  const attr = (() => {
    const days = C.attributionDays || 90, now = Date.now();
    let a = store.get('svt-attr');
    if (a && a.exp < now) a = null;
    const q = new URLSearchParams(location.search), t = {};
    KEYS.forEach((k) => { const v = q.get(k); if (v) t[k] = v.slice(0, 200); });
    let ref = '';
    try { if (document.referrer && new URL(document.referrer).hostname !== location.hostname) ref = document.referrer.slice(0, 300); } catch (e) {}
    const touch = Object.assign({ landing_page: (location.pathname + location.search).slice(0, 300), referrer: ref || '(direct)', at: new Date().toISOString() }, t);
    const fresh = Object.keys(t).length || ref;
    if (!a) a = { first: touch, last: touch, exp: now + days * 864e5 };
    else if (fresh) { a.last = touch; a.exp = now + days * 864e5; }
    store.set('svt-attr', a);
    return a;
  })();

  /* ---------- the back end: posts that never swallow a lead ---------- */
  async function send(payload) {
    if (!C.leadEndpoint) return null;                          // preview host: no back end yet
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(C.leadEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal, keepalive: payload.kind === 'calc' });
      const j = await r.json().catch(() => ({}));
      return r.ok && j && j.ok === true ? j : null;            // only a stored row counts, never a bare 200
    } catch (e) { return null; } finally { clearTimeout(tm); }
  }
  const flatAttr = () => {
    const o = {}, f = attr.first || {}, l = attr.last || {};
    KEYS.concat(['landing_page', 'referrer']).forEach((k) => { o[k] = l[k] || ''; o['first_' + k] = f[k] || ''; });
    o.first_touch_at = f.at || ''; o.last_touch_at = l.at || '';
    return o;
  };

  /* ---------- prices: every number on the site comes from the rate rows ---------- */
  let RATES = null;
  const needRates = !!document.querySelector('[data-quote], [data-rate], [data-calc]');   // pages without a price never fetch
  const ratesReady = needRates ? fetch(C.ratesUrl, { cache: 'no-cache' }).then((r) => r.json()).then((j) => { RATES = j; return j; }).catch(() => null) : Promise.resolve(null);
  const row = (s, k) => { const r = RATES && RATES.rows.find((x) => x.service === s && x.key === k && x.active !== false); if (!r) throw new Error('rate row missing ' + s + ':' + k); return r; };
  const money = (n) => '$' + Math.round(n).toLocaleString('en-CA');
  const cents = (n) => '$' + n.toFixed(2);
  const r10 = (n, up) => (up ? Math.ceil(n / 10) * 10 : Math.floor(n / 10) * 10);
  const VPM = 52 / 12;

  function priceOffice(i) {
    const sqft = Math.max(200, Math.min(200000, +i.sqft || 0)), v = +i.visits || 3, vpm = v * VPM;
    const base = row('office', 'base'), vf = row('office', 'visits_' + v).value, tf = row('office', 'type_' + (i.type || 'office')).value;
    const tier = RATES.rows.filter((x) => x.service === 'office' && /^size_/.test(x.key) && x.active !== false).sort((a, b) => a.max_sqft - b.max_sqft).find((x) => sqft <= x.max_sqft);
    let m = vf * tf * (tier ? tier.value : 1);
    if (i.carpet) m *= row('office', 'floor_carpet').value;
    if (i.restock) m *= row('office', 'restock').value;
    let lo = base.low * sqft * m, hi = base.high * sqft * m;
    const xw = Math.max(0, (+i.washrooms || 0) - row('office', 'washrooms_included').value), xk = Math.max(0, (+i.kitchenettes || 0) - row('office', 'kitchenettes_included').value);
    const we = row('office', 'washroom_extra'), ke = row('office', 'kitchenette_extra');
    lo += (xw * we.low + xk * ke.low) * vpm; hi += (xw * we.high + xk * ke.high) * vpm;
    const mv = row('office', 'min_visit'), floored = lo < mv.low * vpm;
    lo = Math.max(lo, mv.low * vpm); hi = Math.max(hi, mv.high * vpm);
    if (i.unsure) { const w = row('office', 'unsure_widen').value; lo *= 1 - w; hi *= 1 + w; lo = Math.max(lo, mv.low * vpm); }
    lo = r10(lo, false); hi = Math.max(r10(hi, true), lo + 20);
    return { low: lo, high: hi, unit: 'a month', per: `About ${money(lo / vpm)} to ${money(hi / vpm)} a visit, ${Math.round(vpm)} visits a month`, floored };
  }
  function pricePost(i) {
    const sqft = Math.max(100, Math.min(500000, +i.sqft || 0));
    const ph = i.phase === 'all' ? ['rough', 'final', 'touchup'] : [i.phase || 'final'];
    let lo = 0, hi = 0, hours = 0;
    ph.forEach((p) => { const r = row('post_construction', p); lo += r.low * sqft; hi += r.high * sqft; hours += sqft / r.pace; });
    if (ph.length === 3) { const f = row('post_construction', 'all_three').value; lo *= f; hi *= f; }
    const w = row('post_construction', 'window'), n = Math.max(0, +i.windows || 0);
    lo += n * w.low; hi += n * w.high; hours += n * 0.1;
    if (i.rush) { const f = row('post_construction', 'rush').value; lo *= f; hi *= f; }
    const mj = row('post_construction', 'min_job');
    lo = r10(Math.max(lo, mj.low), false); hi = Math.max(r10(Math.max(hi, mj.high), true), lo + 20);
    const perVisit = hours / ph.length, crew = Math.max(2, Math.min(6, Math.ceil(perVisit / 7)));
    const onSite = Math.max(2, Math.round((perVisit / crew) * 2) / 2);
    const crewLine = ph.length === 3 ? `Three visits, a crew of ${crew} for about ${onSite} hours each` : `A crew of ${crew} for about ${onSite} hours`;
    return { low: lo, high: hi, unit: 'for the job', per: crewLine };
  }
  function priceKitchen(i) {
    const r = row('kitchen', i.size || 'medium'), f = row('kitchen', 'freq_' + (i.freq || 'once')).value;
    const lo = r10(r.low * f, false), hi = r10(r.high * f, true);
    const per = i.freq === 'monthly' ? 'Per deep clean, booked every month' : i.freq === 'quarterly' ? 'Per deep clean, booked every 3 months' : 'One deep clean';
    return { low: lo, high: hi, unit: 'per deep clean', per };
  }
  const PRICE = { office: priceOffice, post_construction: pricePost, kitchen: priceKitchen };

  // fill every [data-quote] (a worked example) and [data-rate] (one row) on the page
  ratesReady.then(() => {
    if (!RATES) return;
    $$('[data-quote]').forEach((el) => {
      try { const q = JSON.parse(el.dataset.quote), p = PRICE[q.service](q); el.textContent = `${money(p.low)} to ${money(p.high)} ${p.unit}`; } catch (e) {}
    });
    $$('[data-rate]').forEach((el) => {
      try {
        const [s, k] = el.dataset.rate.split(':'), r = row(s, k);
        const f = r.unit.startsWith('per sq ft') ? cents : money;
        el.textContent = r.value != null ? String(r.value) : `${f(r.low)} to ${f(r.high)} ${r.unit}`;
      } catch (e) {}
    });
  });

  /* ---------- the calculator ---------- */
  const LABEL = { office: 'Office and commercial', post_construction: 'Post-construction', kitchen: 'Kitchen deep clean' };
  const INCLUDED = {
    office: ['Desks, counters and touch points wiped', 'Floors vacuumed and mopped', 'Washrooms cleaned and restocked from your supplies', 'Kitchenette and break room', 'Bins emptied, fresh liners'],
    medical: ['Touch points disinfected every visit', 'Waiting room, reception and exam rooms', 'Washrooms cleaned and restocked from your supplies', 'Floors vacuumed and mopped', 'Bins emptied, fresh liners'],
    restaurant: ['Front of house tables, chairs and floors', 'Kitchen floors, walls and equipment outsides', 'Washrooms', 'Bins emptied, fresh liners'],
    post_construction: { rough: ['Debris and bulk dust out', 'Floors swept and vacuumed', 'Ready for the trades to finish'], final: ['Dust off every ledge, sill, frame and fixture', 'Windows cleaned inside', 'Floors vacuumed and washed', 'Washrooms and kitchens detailed'], touchup: ['A last pass before handover or move-in', 'Fingerprints, dust and floors'], all: ['Rough clean after drywall', 'Final detail clean', 'Touch-up before handover'] },
    kitchen: ['Floors, walls and drains degreased', 'Under and behind the cook line', 'Equipment outsides, shelving and prep tables', 'Hood filters washed']
  };
  $$('[data-calc]').forEach((root) => {
    const mini = root.dataset.calc === 'mini';
    let service = (root.querySelector('[role="tab"][aria-selected="true"]') || {}).dataset?.tab || 'office';
    let started = false, reported = {}, sentCalc = {}, deb = 0;
    const out = { big: $('[data-out="big"]', root), per: $('[data-out="per"]', root), list: $('[data-out="list"]', root), crew: $('[data-out="crew"]', root), hood: $('[data-out="hood"]', root), label: $('[data-out="label"]', root) };
    const val = (name) => { const els = $$(`[name="${name}"]`, root); if (!els.length) return undefined; const e = els[0]; if (e.type === 'radio') { const c = els.find((x) => x.checked); return c ? c.value : undefined; } if (e.type === 'checkbox') return e.checked; return e.value; };
    const inputs = () => {
      if (service === 'office') return { type: val('type') || 'office', sqft: +val('sqft') || 5000, unsure: !!root.dataset.unsure, visits: +(val('visits') || 3), washrooms: +(val('washrooms') ?? 2), kitchenettes: +(val('kitchenettes') ?? 1), carpet: val('floor') === 'carpet', restock: !!val('restock') };
      if (service === 'post_construction') return { phase: val('phase') || 'final', sqft: +val('pc_sqft') || 3000, windows: +(val('windows') || 0), rush: !!val('rush') };
      return { size: val('ksize') || 'medium', freq: val('kfreq') || 'once', hood: val('hood') === 'yes' };
    };
    const describe = (i) => {
      if (service === 'office') return `${(root.querySelector(`[name="type"]:checked + span`) || {}).textContent || 'Office'}, ${Number(i.sqft).toLocaleString('en-CA')} sq ft${i.unsure ? ' (a guess)' : ''}, ${i.visits} visit${i.visits > 1 ? 's' : ''} a week`;
      if (service === 'post_construction') return `Post-construction, ${({ rough: 'rough clean', final: 'final clean', touchup: 'touch-up', all: 'all three phases' })[i.phase]}, ${Number(i.sqft).toLocaleString('en-CA')} sq ft${i.windows ? `, ${i.windows} windows` : ''}${i.rush ? ', within 72 hours' : ''}`;
      return `Kitchen deep clean, ${i.size}, ${({ once: 'one time', quarterly: 'every 3 months', monthly: 'every month' })[i.freq]}${i.hood ? ', hood needed' : ''}`;
    };
    const render = (fromUser) => {
      if (!RATES) return;
      const i = inputs(); let p;
      try { p = PRICE[service](i); } catch (e) { if (out.big) out.big.textContent = 'Prices are loading'; return; }
      if (out.big) out.big.textContent = `${money(p.low)} to ${money(p.high)}`;
      if (out.label) out.label.textContent = p.unit === 'a month' ? 'A month, plus HST' : p.unit === 'for the job' ? 'For the job, plus HST' : 'Per deep clean, plus HST';
      if (out.per) out.per.textContent = service === 'post_construction' ? '' : p.per;
      if (out.crew) { out.crew.textContent = service === 'post_construction' ? p.per : ''; out.crew.hidden = service !== 'post_construction'; }
      if (out.hood) out.hood.hidden = !(service === 'kitchen' && i.hood);
      if (out.list) {
        const L = service === 'office' ? INCLUDED[i.type === 'medical' ? 'medical' : i.type === 'restaurant' ? 'restaurant' : 'office'] : service === 'post_construction' ? INCLUDED.post_construction[i.phase] : INCLUDED.kitchen;
        out.list.innerHTML = ''; L.forEach((t) => { const li = document.createElement('li'); li.textContent = t; out.list.appendChild(li); });
      }
      const est = { service, service_label: LABEL[service], summary: describe(i), inputs: i, low: p.low, high: p.high, unit: p.unit, rates_version: RATES.version, at: new Date().toISOString(), page: location.pathname };
      if (fromUser) {
        store.set('svt-calc', est);                                  // locked per visitor: the form sends what they saw
        if (!started) { started = true; push('calc_start', { calc_service: service }); }
        clearTimeout(deb);
        deb = setTimeout(() => {
          push('calc_complete', { calc_service: service, calc_low: p.low, calc_high: p.high, calc_unit: p.unit });
          if (!sentCalc[service]) { sentCalc[service] = 1; send(Object.assign({ kind: 'calc', event_id: uuid(), page: location.pathname, estimate: est, user_agent: navigator.userAgent.slice(0, 200) }, flatAttr())); }
          document.dispatchEvent(new CustomEvent('svt-calc', { detail: est }));
        }, 1200);
      }
    };
    // tabs
    const pick = (t) => {
      service = t.dataset.tab;
      $$('[role="tab"]', root).forEach((x) => { const on = x === t; x.setAttribute('aria-selected', on ? 'true' : 'false'); x.tabIndex = on ? 0 : -1; });
      $$('[data-panel]', root).forEach((p) => { p.hidden = p.dataset.panel !== service; });
    };
    $$('[role="tab"]', root).forEach((t) => t.addEventListener('click', () => { pick(t); render(true); }));
    $$('[role="tab"]', root).forEach((t, k, all) => t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = all[(k + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]; n.focus(); n.click();
    }));
    // size: number box and slider move together; the people helper sets a guessed size and widens the range
    const pair = (num, rng) => {
      if (!num || !rng) return;
      num.addEventListener('input', () => { rng.value = Math.min(+rng.max, Math.max(+rng.min, +num.value || 0)); delete root.dataset.unsure; clearPeople(); render(true); });
      rng.addEventListener('input', () => { num.value = rng.value; delete root.dataset.unsure; clearPeople(); render(true); });
    };
    const clearPeople = () => $$('[name="people"]', root).forEach((x) => { x.checked = false; });
    pair($('[name="sqft"]', root), $('[data-range="sqft"]', root));
    pair($('[name="pc_sqft"]', root), $('[data-range="pc_sqft"]', root));
    $$('[name="people"]', root).forEach((p) => p.addEventListener('change', () => {
      const s = Math.round(+p.value * row('office', 'sqft_per_person').value / 100) * 100;
      $('[name="sqft"]', root).value = s; const rg = $('[data-range="sqft"]', root); if (rg) rg.value = Math.min(+rg.max, s);
      root.dataset.unsure = '1'; render(true);
    }));
    $$('[data-step]', root).forEach((b) => b.addEventListener('click', () => {
      const o = $(`[name="${b.dataset.for}"]`, root), v = Math.max(+o.dataset.min || 0, Math.min(+o.dataset.max || 99, (+o.value || 0) + (+b.dataset.step)));
      o.value = v; o.textContent = v; render(true);
    }));
    root.addEventListener('change', (e) => { if (e.target.matches('input[type="radio"], input[type="checkbox"], select')) render(true); });
    // any other number box (windows) re-prices as it is typed; the size boxes have their own pair handler above
    root.addEventListener('input', (e) => { if (e.target.matches('input[type="number"]') && !['sqft', 'pc_sqft'].includes(e.target.name)) render(true); });
    // a visitor coming back sees the estimate they had (locked per visitor)
    const prev = store.get('svt-calc');
    ratesReady.then(() => {
      if (prev && !mini && PRICE[prev.service]) {
        const t = $(`[role="tab"][data-tab="${prev.service}"]`, root); if (t) pick(t);
        const i = prev.inputs || {}, set = (n, v) => { const els = $$(`[name="${n}"]`, root); els.forEach((e) => { if (e.type === 'radio') e.checked = e.value === String(v); else if (e.type === 'checkbox') e.checked = !!v; else { e.value = v; if (e.tagName === 'OUTPUT') e.textContent = v; } }); };
        if (prev.service === 'office') { set('type', i.type); set('sqft', i.sqft); set('visits', i.visits); set('washrooms', i.washrooms); set('kitchenettes', i.kitchenettes); set('floor', i.carpet ? 'carpet' : 'hard'); set('restock', i.restock); const rg = $('[data-range="sqft"]', root); if (rg) rg.value = Math.min(+rg.max, i.sqft); if (i.unsure) root.dataset.unsure = '1'; }
        if (prev.service === 'post_construction') { set('phase', i.phase); set('pc_sqft', i.sqft); set('windows', i.windows); set('rush', i.rush); const rg = $('[data-range="pc_sqft"]', root); if (rg) rg.value = Math.min(+rg.max, i.sqft); }
        if (prev.service === 'kitchen') { set('ksize', i.size); set('kfreq', i.freq); set('hood', i.hood ? 'yes' : 'no'); }
        service = prev.service;
      }
      render(false);
    });
  });

  /* ---------- lead forms ---------- */
  const fmtPhone = (v) => {
    let d = v.replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); d = d.slice(0, 10);
    return d.length > 6 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
  };
  const sha = async (s) => {
    if (!s || !crypto.subtle) return '';
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  $$('[data-lead-form]').forEach((form) => {
    const kind = form.dataset.kind || 'walkthrough', key = 'svt-draft-' + (form.id || kind);
    const status = $('.form-status', form), done = form.parentElement.querySelector('[data-done]');
    const attach = $('.attach', form);
    const showAttach = () => {
      const est = store.get('svt-calc');
      if (!attach) return;
      if (est && est.low) { attach.hidden = false; $('[data-attach]', attach).textContent = `${est.summary}: ${money(est.low)} to ${money(est.high)} ${est.unit}`; const sv = $('[name="service"]', form); if (sv && !sv.dataset.touched) sv.value = est.service === 'office' && est.inputs && est.inputs.type === 'medical' ? 'clinic' : est.service; }
      else attach.hidden = true;
    };
    showAttach(); document.addEventListener('svt-calc', showAttach);
    // the draft survives a refresh (session only)
    const draft = store.sget(key, {});
    $$('input, select, textarea', form).forEach((e) => {
      if (e.name && draft[e.name] != null && e.type !== 'checkbox' && e.type !== 'hidden' && e.name !== 'website') e.value = draft[e.name];
      e.addEventListener('input', () => { if (e.name === 'service') e.dataset.touched = '1'; if (e.name && e.type !== 'checkbox') { draft[e.name] = e.value; store.sset(key, draft); } });
    });
    $$('input[type="tel"]', form).forEach((p) => p.addEventListener('input', () => { const c = p.selectionStart === p.value.length; p.value = fmtPhone(p.value); if (c) p.setSelectionRange(p.value.length, p.value.length); }));
    const when = $('[name="start_when"]', form), dateBox = $('[data-date]', form);
    if (when && dateBox) { const sync = () => { dateBox.hidden = when.value !== 'date'; }; when.addEventListener('change', sync); sync(); }
    const err = (name, msg) => {
      const e = $(`[name="${name}"]`, form); if (!e) return; const m = e.closest('.field') && e.closest('.field').querySelector('.err');
      e.setAttribute('aria-invalid', msg ? 'true' : 'false'); if (m) m.textContent = msg || '';
    };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = (n) => { const e = $(`[name="${n}"]`, form); return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : ''; };
      const need = (form.dataset.required || '').split(',').filter(Boolean);
      let bad = null;
      need.forEach((n) => { const ok = !!v(n); err(n, ok ? '' : 'Please fill this in.'); if (!ok && !bad) bad = n; });
      if (v('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) { err('email', 'That email looks off. Check it once more.'); bad = bad || 'email'; }
      if (v('phone') && v('phone').replace(/\D/g, '').length !== 10) { err('phone', 'Ten digits, like 416-555-0123.'); bad = bad || 'phone'; }
      if (v('start_when') === 'date' && !v('start_date')) { err('start_date', 'Pick a date, or choose another option.'); bad = bad || 'start_date'; }
      if (bad) { const e = $(`[name="${bad}"]`, form); if (e) e.focus(); if (status) { status.textContent = 'A few fields need a look.'; status.className = 'form-status bad'; } return; }
      const btn = $('button[type="submit"]', form); btn.disabled = true; const label = btn.innerHTML; btn.textContent = 'Sending';
      if (status) { status.textContent = ''; status.className = 'form-status'; }
      const ctext = $('[data-consent-text]', form);
      const est = store.get('svt-calc');
      const nz = (x, d) => (x === '' || x == null ? d : x);           // never blank: a skipped field says so
      const event_id = uuid();
      const startWhen = $('[name="start_when"]', form);
      const payload = Object.assign({
        kind, event_id, form_id: form.id || kind, page: location.pathname, sent_at: new Date().toISOString(),
        name: nz(v('name'), 'Not given'), company: nz(v('company'), 'Not given'), email: nz(v('email'), 'Not given'), phone: nz(v('phone'), 'Not given'),
        address: nz(v('address'), 'Not given'), service: nz(v('service'), 'Not chosen'),
        start_when: startWhen ? nz(startWhen.options[startWhen.selectedIndex] && startWhen.value ? startWhen.options[startWhen.selectedIndex].text : '', 'Not chosen') : 'Not asked',
        start_date: nz(v('start_date'), v('start_when') === 'date' ? 'Not given' : 'Not asked'),
        message: nz(v('message'), 'None'),
        estimate: est || 'No estimate made',
        marketing_consent: !!v('marketing'), marketing_consent_at: v('marketing') ? new Date().toISOString() : 'Not given',
        marketing_consent_text: ctext ? ctext.textContent.trim() : '',
        website: v('website'), user_agent: navigator.userAgent.slice(0, 200)
      }, flatAttr());
      const res = await send(payload);
      btn.disabled = false; btn.innerHTML = label;
      if (!res && !C.leadEndpoint) {
        if (status) { status.textContent = 'This is a preview: forms are not connected yet, so nothing was sent.'; status.className = 'form-status bad'; }
        return;
      }
      if (!res) {
        if (status) { status.textContent = "That didn't go through. Nothing you typed is lost: check your connection and press the button again."; status.className = 'form-status bad'; }
        push('lead_error', { form_id: form.id || kind });
        return;
      }
      store.sset(key, {});
      const em = v('email').toLowerCase(), ph = v('phone').replace(/\D/g, '');
      push('generate_lead', { form_id: form.id || kind, lead_type: kind, lead_service: payload.service, event_id, value: est && est.low ? est.low : undefined, currency: 'CAD',
        user_data: { sha256_email_address: await sha(em), sha256_phone_number: ph ? await sha('+1' + ph) : '' } });
      if (kind === 'walkthrough') push('walkthrough_request', { event_id });
      if (done) {
        form.hidden = true; done.hidden = false;
        const nm = $('[data-name]', done); if (nm) nm.textContent = (v('name').split(' ')[0] || 'there');
        done.setAttribute('tabindex', '-1'); done.focus();
      }
    });
  });
})();
