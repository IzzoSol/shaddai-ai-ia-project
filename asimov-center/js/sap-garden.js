/* SAP Garden — a cozy neon match-3 "tend" loop for your SAP plot.
   Responsible-play rules (from the retention research, binding):
   - Levels are 2–3 minutes. Energy = Watering Cans (max 5, +1 every 20 min). The first 3 levels are free.
   - Streak: one cleared level a day. At most 2 Frost Shields. Earn-back: clear 3 levels within 24 h.
   - Rewards are ITEMS (seeds, compost) and Tend points (cosmetic plot growth). Play never creates Sparks.
   - No paid continues, no loot boxes, no near-miss paywalls. A gentle nudge after 25 minutes of play. */
(function () {
  'use strict';
  const LS = 'sap.garden.v1', N = 8, TYPES = 6, MAXCANS = 5, REFILL = 20 * 60e3;
  const TILES = [
    { g: '🌱', c1: '#7dffb2', c2: '#118a4b', name: 'Sprouts' },
    { g: '💧', c1: '#8ff3ff', c2: '#0b6f8f', name: 'Water' },
    { g: '🍃', c1: '#d8ff7a', c2: '#4f8a12', name: 'Leaves' },
    { g: '🌸', c1: '#ffb3e6', c2: '#a3247a', name: 'Blossoms' },
    { g: '🍄', c1: '#ffd29a', c2: '#8a4b16', name: 'Compost' },
    { g: '☀️', c1: '#fff1a6', c2: '#b88a00', name: 'Sunlight' },
  ];
  const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
  const S = Object.assign({ level: 1, tend: 0, cans: MAXCANS, canAt: Date.now(), streak: 0, lastDay: '', shields: 1, clearsToday: [], best: {}, drops: {}, played: 0, sessionStart: 0 }, (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (_) { return {}; } })());
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) {} };
  function refill() { const now = Date.now(); while (S.cans < MAXCANS && now - S.canAt >= REFILL) { S.cans++; S.canAt += REFILL; } if (S.cans >= MAXCANS) S.canAt = now; }
  function streakTick() {   // missed days consume Frost Shields; out of shields → streak resets
    const today = day(); if (!S.lastDay || S.lastDay === today) return;
    const gap = Math.round((Date.parse(today) - Date.parse(S.lastDay)) / 864e5) - 1;
    if (gap > 0) { const use = Math.min(gap, S.shields); S.shields -= use; if (gap > use) S.streak = 0; }
  }

  /* Level design: 2–3 easy → harder → breather; every 10th is a Grove Boss with weeds. */
  function levelSpec(n) {
    const boss = n % 10 === 0, breather = n % 10 === 4 || n % 10 === 7;
    const tier = Math.floor((n - 1) / 10), base = 12 + tier * 4 + (n % 10) * 1.6;
    const a = (n * 7) % TYPES, b = (n * 3 + 1) % TYPES === a ? (a + 2) % TYPES : (n * 3 + 1) % TYPES;
    const goals = boss ? { [a]: Math.round(base * 1.4), [b]: Math.round(base * 1.2), weeds: 6 + tier * 2 }
      : breather ? { [a]: Math.round(base * .7) } : { [a]: Math.round(base), [b]: Math.round(base * .7) };
    return { n, boss, moves: boss ? 26 : breather ? 22 : 20 + (n < 4 ? 4 : 0), goals, free: n <= 3 };
  }

  let G = null, cv, ctx, plotCv, pctx, raf = 0, busy = false, sel = null, parts = [], drag = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rnd = n => Math.floor(Math.random() * n);

  function newBoard(spec) {
    const g = [];
    for (let r = 0; r < N; r++) { g[r] = []; for (let c = 0; c < N; c++) { let t; do { t = rnd(TYPES); } while ((c > 1 && g[r][c - 1].t === t && g[r][c - 2].t === t) || (r > 1 && g[r - 1][c].t === t && g[r - 2][c].t === t)); g[r][c] = { t, s: 0, y: -N + r, sc: 1 }; } }
    if (spec.goals.weeds) { let w = spec.goals.weeds; while (w > 0) { const r = 3 + rnd(N - 3), c = rnd(N); if (!g[r][c].weed) { g[r][c].weed = 1; w--; } } }
    return g;
  }
  function start(n) {
    refill(); streakTick();
    const spec = levelSpec(n || S.level);
    if (!spec.free && S.cans <= 0) { toast('Out of Watering Cans — they refill on their own (1 every 20 min). Come back soon; your garden will wait.'); return; }
    if (!S.sessionStart || Date.now() - S.sessionStart > 3 * 3600e3) S.sessionStart = Date.now();
    G = { spec, grid: newBoard(spec), moves: spec.moves, got: {}, score: 0, combo: 0, over: false };
    Object.keys(spec.goals).forEach(k => G.got[k] = 0);
    sel = null; busy = false; renderHud(); save();
  }

  function findMatches(g) {
    const m = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N;) { const t = g[r][c].t; let k = c + 1; while (k < N && g[r][k].t === t) k++; if (k - c >= 3) m.push({ cells: [...Array(k - c)].map((_, i) => [r, c + i]), dir: 'h' }); c = k; }
    for (let c = 0; c < N; c++) for (let r = 0; r < N;) { const t = g[r][c].t; let k = r + 1; while (k < N && g[k][c].t === t) k++; if (k - r >= 3) m.push({ cells: [...Array(k - r)].map((_, i) => [r + i, c]), dir: 'v' }); r = k; }
    return m;
  }
  async function resolve(swapAt) {
    G.combo = 0;
    for (;;) {
      const ms = findMatches(G.grid); if (!ms.length) break;
      G.combo++;
      const clear = new Set(), make = [];
      ms.forEach(m => {
        m.cells.forEach(([r, c]) => clear.add(r * N + c));
        if (m.cells.length >= 4) {   // where the special lands: the swapped cell if it's in the run, else the middle
          const at = swapAt && m.cells.find(([r, c]) => swapAt.some(([a, b]) => a === r && b === c)) || m.cells[m.cells.length >> 1];
          make.push({ at, t: G.grid[at[0]][at[1]].t, s: m.cells.length >= 5 ? 3 : m.dir === 'h' ? 2 : 1 });
        }
      });
      // specials caught in a clear fire: sprouts clear a line, lightning clears a colour
      let grew = true;
      while (grew) { grew = false; for (const k of [...clear]) { const r = k / N | 0, c = k % N, cell = G.grid[r][c]; if (cell.s && !cell.fired) { cell.fired = 1; grew = true;
        if (cell.s === 1) for (let i = 0; i < N; i++) clear.add(i * N + c);
        if (cell.s === 2) for (let i = 0; i < N; i++) clear.add(r * N + i);
        if (cell.s === 3) for (let i = 0; i < N * N; i++) if (G.grid[i / N | 0][i % N].t === cell.t) clear.add(i); } } }
      // tally goals + weeds under cleared cells, spawn particles
      clear.forEach(k => { const r = k / N | 0, c = k % N, cell = G.grid[r][c];
        if (G.got[cell.t] != null) G.got[cell.t]++;
        if (cell.weed && G.got.weeds != null) G.got.weeds++;
        G.score += 10 * G.combo; burst(c, r, TILES[cell.t].c1, cell.s ? 18 : 7); cell.dead = 1; });
      make.forEach(mk => { const [r, c] = mk.at, cell = G.grid[r][c]; cell.dead = 0; cell.s = mk.s; cell.t = mk.t; cell.fired = 0; cell.weed = 0; cell.sc = 1.5; });
      renderHud(); await sleep(170);
      // gravity
      for (let c = 0; c < N; c++) {
        const col = []; for (let r = N - 1; r >= 0; r--) if (!G.grid[r][c].dead) col.push(G.grid[r][c]);
        for (let r = N - 1, i = 0; r >= 0; r--, i++) {
          if (i < col.length) { const cell = col[i]; G.grid[r][c] = cell; }
          else { G.grid[r][c] = { t: rnd(TYPES), s: 0, y: -1 - (i - col.length), sc: 1 }; }
        }
      }
      await sleep(230);
      swapAt = null;
    }
    if (G.combo >= 3) toast(['Nice cascade!', 'Canopy combo!', 'The grove approves.'][Math.min(2, G.combo - 3)] + ' ×' + G.combo, 900);
  }
  async function trySwap(a, b) {
    if (busy || G.over) return; busy = true;
    const [r1, c1] = a, [r2, c2] = b, g = G.grid;
    [g[r1][c1], g[r2][c2]] = [g[r2][c2], g[r1][c1]];
    // two specials swapped together = a bloom that clears both lines
    if (g[r1][c1].s && g[r2][c2].s) { g[r1][c1].fired = 0; g[r2][c2].fired = 0; g[r1][c1].s = g[r1][c1].s === 3 ? 3 : 1; g[r2][c2].s = 2; const t = g[r1][c1].t; g[r2][c2].t = t; g[r1][c1].t = t; }
    if (!findMatches(g).length && !(g[r1][c1].s === 3 || g[r2][c2].s === 3)) { await sleep(140); [g[r1][c1], g[r2][c2]] = [g[r2][c2], g[r1][c1]]; busy = false; return; }
    if (g[r1][c1].s === 3 || g[r2][c2].s === 3) { const L = g[r1][c1].s === 3 ? [r1, c1] : [r2, c2], O = L === a ? b : a; g[L[0]][L[1]].t = g[O[0]][O[1]].t; g[O[0]][O[1]].t = g[L[0]][L[1]].t; g[L[0]][L[1]].dead = 0;
      for (let i = 0; i < N * N; i++) if (g[i / N | 0][i % N].t === g[O[0]][O[1]].t) { const c = g[i / N | 0][i % N]; if (G.got[c.t] != null) G.got[c.t]++; burst(i % N, i / N | 0, '#fff', 6); c.t = rnd(TYPES); } g[L[0]][L[1]].s = 0; }
    G.moves--; await resolve([a, b]); busy = false; check();
  }
  function goalsMet() { return Object.entries(G.spec.goals).every(([k, v]) => (G.got[k] || 0) >= v); }
  function check() {
    renderHud();
    if (goalsMet()) return finish(true);
    if (G.moves <= 0) return finish(false);
  }
  async function finish(win) {
    G.over = true; S.played++;
    if (win) {
      const bonus = G.moves * 25; G.score += bonus;
      // Forest Bloom: leftover moves pop as a finale
      for (let i = 0; i < Math.min(G.moves, 12); i++) { burst(rnd(N), rnd(N), '#7dffb2', 12); await sleep(70); }
      S.tend += Math.round(G.score / 10);
      S.best[G.spec.n] = Math.max(S.best[G.spec.n] || 0, G.score);
      const today = day(); S.clearsToday = (S.clearsToday || []).filter(t => Date.now() - t < 864e5); S.clearsToday.push(Date.now());
      if (S.lastDay !== today) { S.streak = (S.lastDay ? S.streak : 0) + 1; S.lastDay = today; if (S.streak % 7 === 0 && S.shields < 2) S.shields++; }
      if (S.clearsToday.length >= 3 && S.shields < 2 && S.streak > 0) S.shields = Math.min(2, S.shields); // earn-back keeps shields topped (never above 2)
      const drop = dropFor(G.spec); S.drops[drop] = (S.drops[drop] || 0) + 1; awardDrop(drop);
      if (G.spec.n === S.level) S.level++;
      save(); modal(`<div class="cap">${G.spec.boss ? 'Grove Boss cleared' : 'Level ' + G.spec.n + ' cleared'}</div><h2>Your plot grew 🌿</h2>
        <p>+${Math.round(G.score / 10)} Tend · ${G.moves} moves left bloomed for +${bonus}.<br>Found: <b>${itemName(drop)}</b> (in your inventory — tradeable in the Market).</p>
        <p class="mut sm">Streak ${S.streak} day${S.streak === 1 ? '' : 's'} · Frost Shields ${S.shields}/2</p>
        <div class="btns"><button class="btn" data-next>Next level →</button><button class="btn ghost" data-close>Rest</button></div>`);
    } else {
      if (!G.spec.free) { S.cans = Math.max(0, S.cans - 1); if (S.cans < MAXCANS && S.canAt > Date.now() - 1) S.canAt = Date.now(); }
      save(); modal(`<div class="cap">Out of moves</div><h2>So close.</h2><p>${G.spec.free ? 'Early levels are free — try again.' : 'That used one Watering Can. They refill by themselves, 1 every 20 minutes.'}</p>
        <p class="mut sm">No paid continues here, ever. The garden is patient.</p>
        <div class="btns"><button class="btn" data-retry>Try again</button><button class="btn ghost" data-close>Rest</button></div>`);
    }
    if (S.sessionStart && Date.now() - S.sessionStart > 25 * 60e3) { toast('You have been tending for 25 minutes. A real plant would like some water too. 🌱', 5000); S.sessionStart = Date.now(); save(); }
    renderPlot();
  }
  function dropFor(spec) { const pool = spec.boss ? ['seed-black-mangrove', 'tool-watering-can', 'decor-lantern'] : ['seed-red-mangrove', 'compost', 'seed-plane-tree', 'compost']; return pool[(spec.n + S.played) % pool.length]; }
  const NAMES = { 'seed-red-mangrove': 'Red Mangrove Propagule', 'seed-black-mangrove': 'Black Mangrove Seed', 'seed-plane-tree': 'London Plane Seed', compost: 'Compost', 'tool-watering-can': 'Brass Watering Can', 'decor-lantern': 'Firefly Lantern' };
  const itemName = id => NAMES[id] || id;
  function awardDrop(id) {
    window.dispatchEvent(new CustomEvent('sapdrop', { detail: { itemId: id, qty: 1 } }));
    if (window.SAPCFG && SAPCFG.cfg.apiBase) SAPCFG.api('/api/sap/market/drop', { method: 'POST', body: { itemId: id, qty: 1, idempotencyKey: 'drop-' + SAPCFG.cfg.userId + '-' + S.played } }).catch(() => {});
  }

  /* ── rendering ───────────────────────────────────────── */
  function burst(c, r, col, n) { const cs = cell(); for (let i = 0; i < n; i++) parts.push({ x: (c + .5) * cs, y: (r + .5) * cs, vx: (Math.random() - .5) * 6, vy: (Math.random() - .8) * 6, life: 1, col }); }
  const cell = () => cv.width / N / (window.devicePixelRatio > 1 ? Math.min(2, devicePixelRatio) : 1);
  function size() {
    const dpr = Math.min(2, devicePixelRatio || 1), w = Math.min(560, cv.parentElement.clientWidth - 4);
    cv.style.width = cv.style.height = w + 'px'; cv.width = cv.height = Math.round(w * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (plotCv) { const pw = plotCv.parentElement.clientWidth; plotCv.style.width = pw + 'px'; plotCv.style.height = Math.round(pw * .62) + 'px'; plotCv.width = pw * dpr; plotCv.height = Math.round(pw * .62) * dpr; pctx.setTransform(dpr, 0, 0, dpr, 0, 0); renderPlot(); }
  }
  function draw(t) {
    raf = requestAnimationFrame(draw);
    if (!G || !document.getElementById('v-garden').classList.contains('active')) return;
    const cs = cell(), W = cs * N;
    ctx.clearRect(0, 0, W, W);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      ctx.fillStyle = (r + c) % 2 ? 'rgba(77,255,154,.045)' : 'rgba(77,255,154,.08)'; ctx.fillRect(c * cs, r * cs, cs, cs);
      const k = G.grid[r][c]; if (!k) continue;
      if (k.y < r) k.y = Math.min(r, k.y + 0.32); else k.y = r;           // falling
      k.sc += (1 - k.sc) * .2;
      const x = (c + .5) * cs, y = (k.y + .5) * cs, rad = cs * .38 * k.sc, T = TILES[k.t];
      if (k.weed) { ctx.fillStyle = 'rgba(120,70,40,.55)'; ctx.fillRect(c * cs + 2, r * cs + 2, cs - 4, cs - 4); }
      const gr = ctx.createRadialGradient(x - rad * .35, y - rad * .4, rad * .1, x, y, rad);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(.25, T.c1); gr.addColorStop(1, T.c2);
      ctx.shadowColor = T.c1; ctx.shadowBlur = k.s ? 18 + Math.sin(t / 150) * 6 : 8;
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      ctx.font = `${cs * .4}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(T.g, x, y + 1);
      if (k.s) { ctx.strokeStyle = k.s === 3 ? '#fff' : '#eafff4'; ctx.lineWidth = 2; ctx.setLineDash(k.s === 3 ? [3, 3] : []); ctx.beginPath();
        if (k.s === 1) { ctx.moveTo(x, y - rad - 3); ctx.lineTo(x, y + rad + 3); } else if (k.s === 2) { ctx.moveTo(x - rad - 3, y); ctx.lineTo(x + rad + 3, y); } else ctx.arc(x, y, rad + 4, t / 300, t / 300 + 5);
        ctx.stroke(); ctx.setLineDash([]); }
      if (sel && sel[0] === r && sel[1] === c) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, rad + 5, 0, 7); ctx.stroke(); }
    }
    parts = parts.filter(p => (p.life -= .03) > 0);
    parts.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .25; ctx.globalAlpha = p.life; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 * p.life + 1, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1;
  }
  function renderPlot() {
    if (!pctx) return; const W = plotCv.clientWidth, H = plotCv.clientHeight; pctx.clearRect(0, 0, W, H);
    const sky = pctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#071c24'); sky.addColorStop(1, '#03100c'); pctx.fillStyle = sky; pctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { pctx.fillStyle = `rgba(160,255,220,${(i * 37 % 10) / 30})`; pctx.fillRect((i * 97) % W, (i * 53) % (H * .4), 1.5, 1.5); }
    // isometric plot
    const cx = W / 2, cy = H * .62, a = W * .38, b = a * .45;
    pctx.fillStyle = '#123d2a'; pctx.beginPath(); pctx.moveTo(cx, cy - b); pctx.lineTo(cx + a, cy); pctx.lineTo(cx, cy + b); pctx.lineTo(cx - a, cy); pctx.closePath(); pctx.fill();
    pctx.strokeStyle = 'rgba(77,255,154,.6)'; pctx.lineWidth = 1.5; pctx.stroke();
    pctx.fillStyle = '#0b2a1d'; pctx.beginPath(); pctx.moveTo(cx - a, cy); pctx.lineTo(cx, cy + b); pctx.lineTo(cx, cy + b + 14); pctx.lineTo(cx - a, cy + 14); pctx.fill();
    pctx.fillStyle = '#082016'; pctx.beginPath(); pctx.moveTo(cx + a, cy); pctx.lineTo(cx, cy + b); pctx.lineTo(cx, cy + b + 14); pctx.lineTo(cx + a, cy + 14); pctx.fill();
    // channel
    pctx.strokeStyle = 'rgba(62,240,224,.55)'; pctx.lineWidth = 5; pctx.beginPath(); pctx.moveTo(cx - a * .7, cy + b * .3); pctx.quadraticCurveTo(cx, cy - b * .2, cx + a * .7, cy + b * .25); pctx.stroke();
    const n = Math.min(28, 1 + Math.floor(S.tend / 120)), grow = Math.min(1, .35 + S.tend / 4000);
    const pts = []; for (let i = 0; i < n; i++) { const u = ((i * 0.618) % 1) * 2 - 1, v = ((i * 0.381 + .17) % 1) * 2 - 1; if (Math.abs(u) + Math.abs(v) > .92) continue; pts.push([cx + u * a * .85, cy + v * b * .85]); }
    pts.sort((p, q) => p[1] - q[1]).forEach(([x, y], i) => {
      const h = (18 + (i % 4) * 5) * grow, r = (9 + (i % 3) * 3) * grow;
      pctx.strokeStyle = '#4a3527'; pctx.lineWidth = 2; pctx.beginPath(); pctx.moveTo(x, y); pctx.lineTo(x, y - h); pctx.stroke();
      for (let k = -2; k <= 2; k++) { pctx.beginPath(); pctx.moveTo(x, y - h * .3); pctx.quadraticCurveTo(x + k * 4, y - h * .2, x + k * 5, y + 1); pctx.stroke(); }  // prop roots
      const g = pctx.createRadialGradient(x - r * .3, y - h - r * .3, 1, x, y - h, r * 1.2); g.addColorStop(0, '#9dffbf'); g.addColorStop(1, '#1d7a3c');
      pctx.fillStyle = g; pctx.beginPath(); pctx.ellipse(x, y - h, r * 1.2, r * .8, 0, 0, 7); pctx.fill();
    });
    if (S.drops['decor-lantern']) { pctx.fillStyle = '#fff3b0'; pctx.shadowColor = '#ffe27a'; pctx.shadowBlur = 14; pctx.beginPath(); pctx.arc(cx + a * .55, cy - b * .1, 3.5, 0, 7); pctx.fill(); pctx.shadowBlur = 0; }
    pctx.fillStyle = '#cfeee0'; pctx.font = '600 12px "Cascadia Code",Consolas,monospace'; pctx.fillText(`YOUR SAP PLOT · ${n} trees · Tend ${S.tend}`, 12, 20);
    pctx.fillStyle = 'rgba(255,194,77,.85)'; pctx.font = '11px "Segoe UI",sans-serif'; pctx.fillText('Game growth is not a real tree — real planting comes with a receipt.', 12, H - 10);
  }
  function renderHud() {
    const h = document.getElementById('gHud'); if (!h || !G) return; refill();
    const goal = Object.entries(G.spec.goals).map(([k, v]) => { const got = Math.min(v, G.got[k] || 0), T = k === 'weeds' ? { g: '🌿', name: 'Weeds cleared' } : TILES[k];
      return `<div class="goal ${got >= v ? 'done' : ''}"><span class="gi">${T.g}</span><div><b>${got}/${v}</b><small>${T.name}</small><i style="width:${got / v * 100}%"></i></div></div>`; }).join('');
    const next = S.cans < MAXCANS ? Math.max(0, Math.ceil((REFILL - (Date.now() - S.canAt)) / 60e3)) + ' min' : 'full';
    h.innerHTML = `<div class="ghead"><div><div class="cap">${G.spec.boss ? '🌳 Grove Boss' : 'Level ' + G.spec.n}${G.spec.free ? ' · free' : ''}</div><div class="big">${G.moves}<small> moves</small></div></div>
      <div class="gstats"><span title="Watering Cans">💧 ${S.cans}/${MAXCANS}<small>${next}</small></span><span title="Daily streak">🔥 ${S.streak}<small>streak</small></span><span title="Frost Shields (max 2)">❄ ${S.shields}/2<small>shields</small></span><span>✨ ${G.score}<small>score</small></span></div></div>
      <div class="goals">${goal}</div>`;
  }
  function toast(msg, ms) { const t = document.getElementById('gToast'); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, ms || 2600); }
  function modal(html) {
    const m = document.getElementById('gModal'); m.innerHTML = `<div class="gmbox glass">${html}</div>`; m.hidden = false;
    m.querySelectorAll('[data-close]').forEach(b => b.onclick = () => m.hidden = true);
    m.querySelectorAll('[data-next]').forEach(b => b.onclick = () => { m.hidden = true; start(S.level); });
    m.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => { m.hidden = true; start(G.spec.n); });
  }

  function mount() {
    const root = document.getElementById('garden-root'); if (!root || root.dataset.ready) return; root.dataset.ready = 1;
    root.innerHTML = `
    <div class="pagehead"><div><div class="cap">SAP · the garden game</div><h1>Tend your plot</h1><p class="mut">Match three to water, feed and grow. Clear a level a day to keep your streak. Two to three minutes a round.</p></div>
      <div class="btns"><a class="btn" href="https://asimovrobocat.onrender.com/grove/" style="text-decoration:none;background:linear-gradient(180deg,#E0A040,#b9792a);color:#2a1a08;border-color:#E0A040">Play Asimov Grove (3D farm) →</a><button class="btn" id="gNew">▶ Play level <b id="gLvl"></b></button><button class="btn ghost" id="gHow">How it works</button></div></div>
    <div class="ggrid">
      <div class="glass card gboard"><div id="gHud"></div><div class="gcanvas"><canvas id="gCv" aria-label="Match-3 board"></canvas><div id="gToast" class="gtoast" hidden></div></div>
        <p class="mut xs" style="margin:8px 0 0">Tap a tile, then a neighbour — or swipe. Match 4 → Sprout (clears a line). Match 5 → Lightning Grove (clears a colour).</p></div>
      <div class="col">
        <div class="glass card"><h3>Your plot <span class="pill g">GROWS AS YOU TEND</span></h3><div><canvas id="gPlot"></canvas></div></div>
        <div class="glass card"><h3>Finds this season</h3><div id="gDrops" class="chips"></div><p class="mut xs" style="margin-top:8px">Items from play are tradeable in the Market. Play never creates Sparks.</p>
          <div class="btns" style="margin-top:8px"><button class="btn sm" onclick="go('market')">Open Market →</button></div></div>
        <div class="glass card"><h3>Play fair</h3><ul class="fair"><li>No loot boxes. No paid continues. No near-miss paywalls.</li><li>Watering Cans refill by themselves. First 3 levels are free.</li><li>Streak shields: max 2. Clear 3 levels in a day to earn one back.</li><li>Garden growth ≠ a planted tree. Real planting gets a receipt from a verified planting partner.</li></ul></div>
      </div>
    </div><div id="gModal" class="gmodal" hidden></div>`;
    cv = document.getElementById('gCv'); ctx = cv.getContext('2d'); plotCv = document.getElementById('gPlot'); pctx = plotCv.getContext('2d');
    document.getElementById('gNew').onclick = () => start(S.level);
    document.getElementById('gHow').onclick = () => modal(`<div class="cap">How the garden works</div><h2>Tend · grow · trade</h2><p>Each level asks you to gather what a plot needs — water, sunlight, compost. Clearing a level grows your plot and finds you an item: seeds, compost, sometimes a tool or a lantern.</p><p>Items can be kept, planted or sold to other players in the Market at a price you set. Rare seeds and Genesis plots are limited, so their prices are set by players.</p><p class="mut sm">Sparks are closed-loop game credit with no cash value. Nothing here is an investment.</p><div class="btns"><button class="btn" data-close>Got it</button></div>`);
    const pos = e => { const r = cv.getBoundingClientRect(), cs = r.width / N; return [Math.floor((e.clientY - r.top) / cs), Math.floor((e.clientX - r.left) / cs)]; };
    cv.addEventListener('pointerdown', e => { if (!G || busy || G.over) return; drag = { p: pos(e), x: e.clientX, y: e.clientY }; });
    cv.addEventListener('pointerup', e => {
      if (!drag || !G) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y, p = drag.p; drag = null;
      if (Math.hypot(dx, dy) > 18) { const q = Math.abs(dx) > Math.abs(dy) ? [p[0], p[1] + Math.sign(dx)] : [p[0] + Math.sign(dy), p[1]]; if (q[0] >= 0 && q[0] < N && q[1] >= 0 && q[1] < N) { sel = null; trySwap(p, q); } return; }
      if (sel && Math.abs(sel[0] - p[0]) + Math.abs(sel[1] - p[1]) === 1) { const a = sel; sel = null; trySwap(a, p); } else sel = p;
    });
    addEventListener('resize', () => { if (document.getElementById('v-garden').classList.contains('active')) size(); });
    window.addEventListener('sapdrop', drops);
    size(); start(S.level); drops(); cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
  }
  function drops() {
    const d = document.getElementById('gDrops'); if (!d) return; document.getElementById('gLvl').textContent = S.level;
    const e = Object.entries(S.drops); d.innerHTML = e.length ? e.map(([k, v]) => `<span class="chip" aria-pressed="true">${itemName(k)} ×${v}</span>`).join('') : '<span class="mut sm">Clear a level to find your first seed.</span>';
  }
  window.addEventListener('sapview', e => { if (e.detail === 'garden') { mount(); requestAnimationFrame(() => { size(); renderHud(); drops(); }); } });
  if (document.getElementById('v-garden').classList.contains('active')) mount();
  window.SAPGarden = { state: S, start };
})();
