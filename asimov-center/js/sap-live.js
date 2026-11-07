/* SAP Live — real cities, live conditions, and an uptime board for every API we lean on.
   Sources (free, keyless): Open-Meteo forecast + air quality + geocoding, OpenStreetMap Overpass.
   Live readings are measurements from those services; anything we derive is labelled. */
(function () {
  'use strict';
  const EXTRA = [
    ['tokyo', 'Tokyo', 'Japan', 35.68, 139.69], ['lagos', 'Lagos', 'Nigeria', 6.52, 3.38], ['saopaulo', 'São Paulo', 'Brazil', -23.55, -46.63],
    ['mumbai', 'Mumbai', 'India', 19.08, 72.88], ['cairo', 'Cairo', 'Egypt', 30.04, 31.24], ['mexico', 'Mexico City', 'Mexico', 19.43, -99.13],
    ['jakarta', 'Jakarta', 'Indonesia', -6.2, 106.85], ['nairobi', 'Nairobi', 'Kenya', -1.29, 36.82], ['la', 'Los Angeles', 'USA', 34.05, -118.24], ['london', 'London', 'UK', 51.51, -0.13],
  ].map(([k, n, c, lat, lon]) => ({ k, n, c, lat, lon, t: 'city' }));
  const WMO = { 0: ['☀️', 'Clear'], 1: ['🌤', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'], 45: ['🌫', 'Fog'], 48: ['🌫', 'Rime fog'], 51: ['🌦', 'Drizzle'], 53: ['🌦', 'Drizzle'], 55: ['🌧', 'Heavy drizzle'], 61: ['🌧', 'Rain'], 63: ['🌧', 'Rain'], 65: ['🌧', 'Heavy rain'], 71: ['🌨', 'Snow'], 73: ['🌨', 'Snow'], 75: ['❄️', 'Heavy snow'], 80: ['🌦', 'Showers'], 81: ['🌧', 'Showers'], 82: ['⛈', 'Violent showers'], 95: ['⛈', 'Thunderstorm'], 96: ['⛈', 'Storm + hail'], 99: ['⛈', 'Storm + hail'] };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const aqiBand = v => v == null ? ['—', '#557567'] : v <= 50 ? ['Good', '#4dff9a'] : v <= 100 ? ['Moderate', '#d8ff7a'] : v <= 150 ? ['Unhealthy (sensitive)', '#ffc24d'] : v <= 200 ? ['Unhealthy', '#ff8a5c'] : ['Very unhealthy', '#ff6b7a'];
  const tempCol = t => t == null ? '#8fb8a6' : `hsl(${Math.max(0, Math.min(220, 200 - (t + 5) * 5))},85%,65%)`;

  let CITIES = [], DATA = {}, sel = null, gl = null, gctx, raf = 0, rot = 0, uptime = {}, fetchedAt = 0, custom = [];
  function cities() { return [...(window.SAP ? SAP.SITES.map(s => ({ k: s.k, n: s.n, c: s.c, lat: s.lat, lon: s.lon, t: s.t, f: s.f })) : []), ...EXTRA, ...custom]; }

  async function timed(name, url, opts) {
    const t0 = performance.now();
    try { const r = await fetch(url, opts); const ms = Math.round(performance.now() - t0), ok = r.ok || r.type === 'opaque'; rec(name, ok, ms, ok ? '' : 'HTTP ' + r.status); if (!ok) throw new Error('HTTP ' + r.status); return r; }
    catch (e) { rec(name, false, Math.round(performance.now() - t0), e.message); throw e; }
  }
  function rec(name, ok, ms, err) { const u = uptime[name] || (uptime[name] = { hist: [], ok: 0, n: 0 }); u.n++; if (ok) u.ok++; u.last = { ok, ms, err, at: Date.now() }; u.hist.push(ok ? ms : -1); if (u.hist.length > 24) u.hist.shift(); }

  async function loadAll() {
    CITIES = cities();
    const lat = CITIES.map(c => c.lat.toFixed(3)).join(','), lon = CITIES.map(c => c.lon.toFixed(3)).join(',');
    const W = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day,uv_index,precipitation&timezone=auto`;
    const A = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5,pm10`;
    const [w, a] = await Promise.allSettled([timed('Open-Meteo forecast', W).then(r => r.json()), timed('Open-Meteo air quality', A).then(r => r.json())]);
    const wa = w.status === 'fulfilled' ? [].concat(w.value) : [], aa = a.status === 'fulfilled' ? [].concat(a.value) : [];
    CITIES.forEach((c, i) => { DATA[c.k] = { w: wa[i] && wa[i].current, tz: wa[i] && wa[i].timezone, a: aa[i] && aa[i].current }; });
    fetchedAt = Date.now();
  }
  async function green(c) {
    if (DATA[c.k] && DATA[c.k].green != null) return;
    const q = `[out:json][timeout:20];(way["leisure"="park"](around:2500,${c.lat},${c.lon});way["landuse"="forest"](around:2500,${c.lat},${c.lon});way["natural"="wood"](around:2500,${c.lat},${c.lon});way["natural"="wetland"]["wetland"="mangrove"](around:6000,${c.lat},${c.lon}););out count;`;
    try { const r = await timed('OpenStreetMap Overpass', 'https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) }); const j = await r.json(); const t = j.elements && j.elements[0] && j.elements[0].tags; DATA[c.k].green = t ? +t.ways || +t.total || 0 : 0; }
    catch (_) { DATA[c.k].green = -1; }
  }
  async function pingAll() {
    const tasks = [
      ['Open-Meteo forecast', 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m'],
      ['Open-Meteo air quality', 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=0&longitude=0&current=pm2_5'],
      ['Open-Meteo geocoding', 'https://geocoding-api.open-meteo.com/v1/search?name=Paris&count=1'],
      ['OpenStreetMap Overpass', 'https://overpass-api.de/api/status'],
      ['three.js CDN (unpkg)', 'https://unpkg.com/three@0.160.0/package.json'],
      ['Coastlines (world-atlas)', 'https://unpkg.com/world-atlas@2/package.json'],
    ];
    if (window.SAPCFG && SAPCFG.cfg.apiBase) tasks.push(['S.A.P. backend', SAPCFG.cfg.apiBase + '/api/health']);
    tasks.push(['Local Ollama', 'http://127.0.0.1:11434/api/tags']);
    await Promise.allSettled(tasks.map(([n, u]) => timed(n, u, { cache: 'no-store', mode: u.includes('overpass-api.de/api/status') ? 'no-cors' : 'cors' })));
    renderUptime();
  }

  async function search(q) {
    const r = await timed('Open-Meteo geocoding', `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en`); const j = await r.json();
    return (j.results || []).map(x => ({ k: 'g' + x.id, n: x.name, c: [x.admin1, x.country].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude, t: 'city' }));
  }

  /* ── globe ─────────────────────────────────────────────── */
  function drawGlobe(t) {
    raf = requestAnimationFrame(drawGlobe);
    if (!document.getElementById('v-live').classList.contains('active') || !gl) return;
    const W = gl.clientWidth, H = gl.clientHeight; if (gl.width !== W * 2) { gl.width = W * 2; gl.height = H * 2; gctx.setTransform(2, 0, 0, 2, 0, 0); }
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * .42, D = Math.PI / 180;
    const target = sel ? sel.lon : rot; if (sel) { const d = ((target - rot + 540) % 360) - 180; rot += d * .05; } else rot += .08;
    const l0 = rot * D, p0 = (sel ? sel.lat * .5 : 12) * D;
    gctx.clearRect(0, 0, W, H);
    const halo = gctx.createRadialGradient(cx, cy, R * .8, cx, cy, R * 1.35); halo.addColorStop(0, 'rgba(62,240,224,.18)'); halo.addColorStop(1, 'rgba(62,240,224,0)'); gctx.fillStyle = halo; gctx.fillRect(0, 0, W, H);
    const body = gctx.createRadialGradient(cx - R * .3, cy - R * .35, R * .1, cx, cy, R); body.addColorStop(0, '#0f3d48'); body.addColorStop(1, '#03141a'); gctx.fillStyle = body; gctx.beginPath(); gctx.arc(cx, cy, R, 0, 7); gctx.fill();
    const P = (lo, la) => { const L = lo * D - l0, A = la * D, c = Math.sin(p0) * Math.sin(A) + Math.cos(p0) * Math.cos(A) * Math.cos(L); return [cx + R * Math.cos(A) * Math.sin(L), cy - R * (Math.cos(p0) * Math.sin(A) - Math.sin(p0) * Math.cos(A) * Math.cos(L)), c]; };
    gctx.strokeStyle = 'rgba(94,255,170,.09)'; gctx.lineWidth = 1;
    for (let la = -60; la <= 60; la += 30) { gctx.beginPath(); let pen = 0; for (let lo = -180; lo <= 180; lo += 5) { const [x, y, c] = P(lo, la); if (c > 0) { pen ? gctx.lineTo(x, y) : gctx.moveTo(x, y); pen = 1; } else pen = 0; } gctx.stroke(); }
    const dots = window.SAP && SAP.landDots; if (dots) for (const [lo, la] of dots) { const [x, y, c] = P(lo, la); if (c <= 0) continue; gctx.fillStyle = `rgba(110,255,180,${.18 + c * .6})`; const s = .8 + c * 1.6; gctx.fillRect(x - s / 2, y - s / 2, s, s); }
    // terminator shading (approximate sun position from UTC time)
    const now = new Date(), sunLon = 180 - (now.getUTCHours() + now.getUTCMinutes() / 60) * 15;
    const [sx, sy, sc] = P(sunLon, 0); const sh = gctx.createRadialGradient(sx, sy, R * .2, sx, sy, R * 2); sh.addColorStop(0, 'rgba(255,240,180,.10)'); sh.addColorStop(.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.45)');
    gctx.save(); gctx.beginPath(); gctx.arc(cx, cy, R, 0, 7); gctx.clip(); gctx.fillStyle = sh; gctx.fillRect(0, 0, W, H); gctx.restore();
    CITIES.forEach(c => { const [x, y, z] = P(c.lon, c.lat); if (z <= 0) return; const d = DATA[c.k] && DATA[c.k].w, col = c.t === 'mangrove' ? '#4dff9a' : c.t === 'urban' ? '#3ef0e0' : '#ffd27a', on = sel && sel.k === c.k;
      if (on) { const k = (t / 1200) % 1; gctx.strokeStyle = col; gctx.globalAlpha = 1 - k; gctx.lineWidth = 2; gctx.beginPath(); gctx.arc(x, y, 6 + k * 26, 0, 7); gctx.stroke(); gctx.globalAlpha = 1; }
      gctx.fillStyle = col; gctx.shadowColor = col; gctx.shadowBlur = on ? 16 : 8; gctx.beginPath(); gctx.arc(x, y, on ? 5 : 3, 0, 7); gctx.fill(); gctx.shadowBlur = 0;
      if (on || z > .85) { gctx.font = (on ? '600 12px' : '10px') + ' "Segoe UI",sans-serif'; gctx.fillStyle = on ? '#fff' : 'rgba(220,255,240,.75)'; gctx.fillText(c.n + (d ? ` ${Math.round(d.temperature_2m)}°` : ''), x + 8, y - 6); } });
    gctx.strokeStyle = 'rgba(127,255,240,.6)'; gctx.lineWidth = 1.5; gctx.beginPath(); gctx.arc(cx, cy, R + 8, t / 2000 % 6.28, t / 2000 % 6.28 + 1.2); gctx.stroke();
  }

  /* ── views ─────────────────────────────────────────────── */
  function cityCard(c) {
    const d = DATA[c.k] || {}, w = d.w, a = d.a, wx = w ? (WMO[w.weather_code] || ['•', 'Code ' + w.weather_code]) : ['…', 'loading'], [band, bc] = aqiBand(a && a.us_aqi);
    const local = d.tz ? new Date().toLocaleTimeString('en-US', { timeZone: d.tz, hour: '2-digit', minute: '2-digit' }) : '';
    return `<button class="ccard glass ${sel && sel.k === c.k ? 'on' : ''}" data-city="${c.k}" style="--tc:${tempCol(w && w.temperature_2m)}">
      <div class="ctop"><span class="cwx">${wx[0]}</span><span class="ctag ${c.t}">${c.t === 'mangrove' ? 'MANGROVE' : c.t === 'urban' ? 'URBAN FOREST' : 'CITY'}</span></div>
      <b>${esc(c.n)}</b><small>${esc(c.c)}${local ? ' · ' + local : ''}</small>
      <div class="ctemp">${w ? Math.round(w.temperature_2m) + '°' : '—'}<small>${w ? wx[1] : ''}</small></div>
      <div class="caq"><i style="background:${bc}"></i>AQI ${a && a.us_aqi != null ? a.us_aqi : '—'} · ${band}</div></button>`;
  }
  async function hero() {
    const h = document.getElementById('lHero'); if (!h || !sel) return;
    const c = sel, d = DATA[c.k] || {}, w = d.w || {}, a = d.a || {}, wx = WMO[w.weather_code] || ['•', ''], [band, bc] = aqiBand(a.us_aqi);
    const shade = w.temperature_2m != null ? Math.max(0, Math.min(6, (w.apparent_temperature - 20) * .35)).toFixed(1) : null;
    h.innerHTML = `<div class="hhead"><div><div class="cap">${c.t === 'mangrove' ? 'Mangrove coast' : c.t === 'urban' ? 'Urban forest' : 'City'} · ${Math.abs(c.lat).toFixed(2)}°${c.lat >= 0 ? 'N' : 'S'} ${Math.abs(c.lon).toFixed(2)}°${c.lon >= 0 ? 'E' : 'W'}</div><h2>${esc(c.n)} <span class="mut">${esc(c.c)}</span></h2></div>
      <div class="hwx">${wx[0]}</div></div>
      <div class="hstats">
        <div><small>Temperature</small><b style="color:${tempCol(w.temperature_2m)}">${w.temperature_2m != null ? w.temperature_2m.toFixed(1) + '°C' : '—'}</b><span>feels ${w.apparent_temperature != null ? w.apparent_temperature.toFixed(1) + '°' : '—'}</span></div>
        <div><small>Air quality (US AQI)</small><b style="color:${bc}">${a.us_aqi != null ? a.us_aqi : '—'}</b><span>${band} · PM2.5 ${a.pm2_5 != null ? a.pm2_5 : '—'}</span></div>
        <div><small>Humidity · wind</small><b>${w.relative_humidity_2m != null ? w.relative_humidity_2m + '%' : '—'}</b><span>${w.wind_speed_10m != null ? w.wind_speed_10m + ' km/h' : ''}</span></div>
        <div><small>UV index</small><b>${w.uv_index != null ? w.uv_index.toFixed(1) : '—'}</b><span>${w.is_day ? 'daytime' : 'night'}</span></div>
        <div><small>Green spaces nearby (OSM)</small><b id="lGreen">${d.green == null ? '…' : d.green < 0 ? 'n/a' : d.green}</b><span>parks, woods${c.t === 'mangrove' ? ', mangroves' : ''} mapped within 2.5 km</span></div>
        <div><small>Shade could cut felt heat by</small><b class="g">${shade != null ? '~' + shade + '°C' : '—'}</b><span>illustrative estimate, not a measurement</span></div>
      </div>
      ${c.f ? `<p class="hfact">${esc(c.f)}</p>` : ''}
      <div class="btns">${c.t !== 'city' ? `<button class="btn sm" id="lUse">Load as twin template →</button>` : ''}<button class="btn sm ghost" id="lAsk">Ask Asimov about ${esc(c.n)}</button></div>
      <p class="mut xs">Live: Open-Meteo (weather, air quality) · OpenStreetMap contributors (green spaces). Updated ${fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : '—'}.</p>`;
    const u = document.getElementById('lUse'); if (u) u.onclick = () => { window.useSite && useSite(c.k, true); window.go && go('sim'); };
    document.getElementById('lAsk').onclick = () => { go('sim'); const i = document.getElementById('chatIn'); i.value = `What would more tree canopy do for ${c.n} right now? It is ${w.temperature_2m != null ? w.temperature_2m.toFixed(0) + '°C' : 'unknown temperature'} with an AQI of ${a.us_aqi != null ? a.us_aqi : 'unknown'}.`; document.getElementById('chatForm').requestSubmit(); };
    if (d.green == null) { await green(c); const g = document.getElementById('lGreen'); if (g && sel === c) g.textContent = DATA[c.k].green < 0 ? 'n/a' : DATA[c.k].green; renderUptime(); }
  }
  function renderUptime() {
    const u = document.getElementById('lUp'); if (!u) return;
    u.innerHTML = Object.entries(uptime).map(([n, x]) => { const L = x.last || {}, pct = x.n ? Math.round(x.ok / x.n * 100) : 0, local = n === 'Local Ollama';
      return `<div class="uprow"><span class="dot ${L.ok ? '' : local ? 'off' : 'red'}"></span><b>${esc(n)}</b>
        <span class="ubars">${x.hist.map(v => `<i style="height:${v < 0 ? 100 : Math.min(100, 12 + v / 12)}%;background:${v < 0 ? (local ? '#2a3a34' : '#ff6b7a') : v < 400 ? '#4dff9a' : v < 1200 ? '#ffc24d' : '#ff8a5c'}"></i>`).join('')}</span>
        <span class="mono">${L.ok ? L.ms + ' ms' : local ? 'not running' : esc(L.err || 'down')}</span><span class="mono mut">${pct}%</span></div>`; }).join('') || '<p class="mut sm">Checking…</p>';
  }
  function render() {
    const root = document.getElementById('live-root'); if (!root) return;
    const list = CITIES.length ? CITIES : cities();
    root.innerHTML = `
    <div class="pagehead"><div><div class="cap">SAP · live planet</div><h1>Live cities</h1><p class="mut">Real conditions in real places, right now — where canopy matters most.</p></div>
      <form class="lsearch" id="lSearch"><input id="lQ" placeholder="Search any city…" autocomplete="off"><button class="btn sm">Search</button><div id="lRes" class="lres"></div></form></div>
    <div class="lgrid">
      <div class="glass card lglobe"><canvas id="lGlobe"></canvas><div class="lleg"><span><i style="background:#4dff9a"></i>Mangrove coasts</span><span><i style="background:#3ef0e0"></i>Urban forests</span><span><i style="background:#ffd27a"></i>Cities</span></div></div>
      <div class="glass card" id="lHero"><p class="mut">Pick a city on the globe or below.</p></div>
    </div>
    <div class="chips" style="margin:14px 0 10px"><span class="chip" data-lf="all" aria-pressed="true">All</span><span class="chip" data-lf="mangrove" aria-pressed="false">Mangrove coasts</span><span class="chip" data-lf="urban" aria-pressed="false">Urban forests</span><span class="chip" data-lf="city" aria-pressed="false">Cities</span><span class="chip" data-lf="hot" aria-pressed="false">Hottest now</span><span class="chip" data-lf="air" aria-pressed="false">Worst air now</span></div>
    <div class="cgrid" id="lCards">${list.map(cityCard).join('')}</div>
    <div class="glass card" style="margin-top:14px"><h3>API uptime <span class="pill cy">CHECKED FROM YOUR BROWSER</span><button class="btn sm" id="lPing" style="margin-left:auto">Re-check</button></h3><div id="lUp"></div>
      <p class="mut xs">Each bar is one check (taller = slower). Local Ollama only shows when it runs on this machine.</p></div>`;
    gl = document.getElementById('lGlobe'); gctx = gl.getContext('2d');
    gl.onclick = e => { const r = gl.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, W = r.width, H = r.height, R = Math.min(W, H) * .42, D = Math.PI / 180, l0 = rot * D, p0 = (sel ? sel.lat * .5 : 12) * D; let best = null, bd = 16;
      CITIES.forEach(c => { const L = c.lon * D - l0, A = c.lat * D, z = Math.sin(p0) * Math.sin(A) + Math.cos(p0) * Math.cos(A) * Math.cos(L); if (z <= 0) return; const x = W / 2 + R * Math.cos(A) * Math.sin(L), y = H / 2 - R * (Math.cos(p0) * Math.sin(A) - Math.sin(p0) * Math.cos(A) * Math.cos(L)), d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = c; } });
      if (best) pick(best); };
    let lf = 'all';
    root.querySelectorAll('[data-lf]').forEach(ch => ch.onclick = () => { lf = ch.dataset.lf; root.querySelectorAll('[data-lf]').forEach(x => x.setAttribute('aria-pressed', x === ch)); cards(lf); });
    root.querySelectorAll('#lCards [data-city]').forEach(bindCard);
    document.getElementById('lPing').onclick = pingAll;
    document.getElementById('lSearch').onsubmit = async e => { e.preventDefault(); const q = document.getElementById('lQ').value.trim(); if (!q) return; const box = document.getElementById('lRes'); box.innerHTML = '<span class="mut sm">searching…</span>';
      try { const rs = await search(q); box.innerHTML = rs.map(x => `<button type="button" data-g="${x.k}">${esc(x.n)} <small>${esc(x.c)}</small></button>`).join('') || '<span class="mut sm">No match.</span>';
        box.querySelectorAll('[data-g]').forEach(b => b.onclick = async () => { const x = rs.find(y => y.k === b.dataset.g); if (!custom.find(c => c.k === x.k)) custom.push(x); box.innerHTML = ''; await loadAll(); render(); pick(CITIES.find(c => c.k === x.k)); }); }
      catch (err) { box.innerHTML = '<span class="mut sm">Search unavailable.</span>'; } };
    renderUptime(); if (sel) hero();
  }
  function cards(lf) {
    let list = CITIES.slice();
    if (lf === 'hot') list.sort((a, b) => ((DATA[b.k] || {}).w || {}).temperature_2m - ((DATA[a.k] || {}).w || {}).temperature_2m);
    else if (lf === 'air') list.sort((a, b) => (((DATA[b.k] || {}).a || {}).us_aqi || 0) - (((DATA[a.k] || {}).a || {}).us_aqi || 0));
    else if (lf !== 'all') list = list.filter(c => c.t === lf);
    const el = document.getElementById('lCards'); el.innerHTML = list.map(cityCard).join(''); el.querySelectorAll('[data-city]').forEach(bindCard);
  }
  function bindCard(b) { b.onclick = () => pick(CITIES.find(c => c.k === b.dataset.city)); }
  function pick(c) { if (!c) return; sel = c; document.querySelectorAll('#lCards [data-city]').forEach(b => b.classList.toggle('on', b.dataset.city === c.k)); hero(); }

  let started = false;
  async function enter() {
    render(); cancelAnimationFrame(raf); raf = requestAnimationFrame(drawGlobe);
    if (!started || Date.now() - fetchedAt > 10 * 60e3) { started = true; await loadAll(); render(); if (!sel) pick(CITIES.find(c => c.k === (window.SAP && SAP.P.site)) || CITIES[0]); pingAll(); }
  }
  window.addEventListener('sapview', e => { if (e.detail === 'live') enter(); });
  if (document.getElementById('v-live').classList.contains('active')) enter();
})();
