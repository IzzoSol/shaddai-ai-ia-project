/* SAP Market — player-priced garden items, limited plots and seeds, and the fee flywheel.
   LIVE mode: the S.A.P. backend (Settings → Backend URL). DEMO mode: a local market with
   demo Sparks and simulated players, so the mechanics can be explored with nothing at stake.
   Sparks are closed-loop game credit with no cash value. Nothing here is an investment. */
(function () {
  'use strict';
  const LS = 'sap.market.demo.v1', FEE_BPS = 500, POLICY = { treeFund: 4000, asimovLiquidity: 4000, platform: 2000 };
  const CAT = [
    ['plot-genesis', 'plot', 'Genesis Plot', 'genesis', 100, 2500], ['plot-grove', 'plot', 'Grove Plot', 'rare', 900, 900],
    ['seed-red-mangrove', 'seed', 'Red Mangrove Propagule', 'common', null, null], ['seed-black-mangrove', 'seed', 'Black Mangrove Seed', 'common', null, null],
    ['seed-plane-tree', 'seed', 'London Plane Seed', 'common', null, null], ['seed-sundari', 'seed', 'Sundari Seed', 'rare', 2000, 120],
    ['seed-ghost-orchid', 'seed', 'Ghost Orchid Spore', 'legendary', 150, 600], ['tool-watering-can', 'tool', 'Brass Watering Can', 'common', null, null],
    ['tool-uv-lamp', 'tool', 'UV Grow Lamp', 'rare', 1500, 200], ['tool-pruning-drone', 'tool', 'Nexus Pruning Drone', 'legendary', 250, 750],
    ['decor-holo-fountain', 'decor', 'Holo Fountain', 'rare', 1200, 180], ['decor-lantern', 'decor', 'Firefly Lantern', 'common', null, null], ['compost', 'material', 'Compost', 'common', null, null],
  ].map(([id, kind, name, rarity, cap, launch]) => ({ id, kind, name, rarity, cap, launch }));
  const ICON = { plot: '⬢', seed: '🌱', tool: '🛠', decor: '✨', material: '🍂' };
  const RC = { common: '#9fd8bd', rare: '#3ef0e0', legendary: '#ffc24d', genesis: '#4dff9a' };
  const BASE = { 'seed-red-mangrove': 12, 'seed-black-mangrove': 14, 'seed-plane-tree': 10, 'tool-watering-can': 40, 'decor-lantern': 25, compost: 4 };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
  const split = fee => { const t = Math.floor(fee * POLICY.treeFund / 1e4), l = Math.floor(fee * POLICY.asimovLiquidity / 1e4); return { treeFund: t, asimovLiquidity: l, platform: fee - t - l }; };

  /* ── demo engine (mirrors backend/services/market-service.js rules) ─────────── */
  let D = (() => { try { return JSON.parse(localStorage.getItem(LS)); } catch (_) { return null; } })();
  function seedDemo() {
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const d = { sparks: 1000, inv: { 'seed-red-mangrove': 3, 'seed-plane-tree': 1, 'decor-lantern': 1, compost: 2 }, listings: [], trades: [], minted: {}, fees: [], seq: 0, at: Date.now() };
    CAT.forEach(it => {
      if (it.cap) d.minted[it.id] = Math.round(it.cap * (it.rarity === 'genesis' ? .62 : it.rarity === 'legendary' ? .4 : .3));
      const base = it.launch || BASE[it.id] || 20, scarcity = it.cap ? 1 + (d.minted[it.id] / it.cap) * .9 : 1;
      let p = base * scarcity;
      for (let i = 0; i < 24; i++) { p = Math.max(1, Math.round(p * (0.96 + r() * 0.1))); d.trades.push({ itemId: it.id, price: p, qty: 1, at: Date.now() - (24 - i) * 36e5 * (1 + r()) }); }
      for (let i = 0; i < 3 + (r() * 4 | 0); i++) d.listings.push({ id: 'N' + (++d.seq), sellerId: 'npc-' + (r() * 90 | 0), itemId: it.id, qty: 1 + (r() * (it.cap ? 2 : 8) | 0), price: Math.round(p * (1.02 + r() * .25)), status: 'open' });
    });
    return d;
  }
  if (!D) D = seedDemo();
  const saveD = () => { try { localStorage.setItem(LS, JSON.stringify(D)); } catch (_) {} };
  window.addEventListener('sapdrop', e => { D.inv[e.detail.itemId] = (D.inv[e.detail.itemId] || 0) + e.detail.qty; saveD(); if (active()) render(); });

  const live = () => !!(window.SAPCFG && SAPCFG.cfg.apiBase);
  const me = () => (window.SAPCFG ? SAPCFG.cfg.userId : 'me');
  const active = () => document.getElementById('v-market').classList.contains('active');

  function demoBoard() {
    return CAT.map(it => { const open = D.listings.filter(l => l.status === 'open' && l.itemId === it.id), tr = D.trades.filter(t => t.itemId === it.id), since = Date.now() - 864e5;
      return { ...it, minted: D.minted[it.id] || 0, remainingPrimary: it.cap == null ? null : Math.max(0, it.cap - (D.minted[it.id] || 0)), floor: open.length ? Math.min(...open.map(l => l.price)) : null, last: tr.length ? tr[tr.length - 1].price : null, volume24h: tr.filter(t => t.at >= since).reduce((s, t) => s + t.qty, 0), listings: open.length, history: tr.slice(-30).map(t => [t.at, t.price]) }; });
  }
  function demoFees() { const tot = { fees: 0, treeFund: 0, asimovLiquidity: 0, platform: 0 }; D.fees.forEach(f => { tot.fees += f.fee; ['treeFund', 'asimovLiquidity', 'platform'].forEach(k => tot[k] += f.split[k]); }); return tot; }
  function demoBuy(listingId, qty) {
    const l = D.listings.find(x => x.id === listingId); if (!l || l.status !== 'open') throw new Error('Listing is gone.');
    if (l.sellerId === me()) throw new Error('That is your own listing.');
    const total = l.price * qty; if (total > D.sparks) throw new Error('Not enough demo Sparks.');
    const fee = Math.floor(total * FEE_BPS / 1e4); D.sparks -= total; l.qty -= qty; if (!l.qty) l.status = 'filled';
    D.inv[l.itemId] = (D.inv[l.itemId] || 0) + qty; D.trades.push({ itemId: l.itemId, price: l.price, qty, at: Date.now() }); D.fees.push({ fee, split: split(fee) }); saveD();
    return { total, fee };
  }
  function demoPrimary(itemId) {
    const it = CAT.find(i => i.id === itemId); if (!it.cap || !it.launch) throw new Error('Not a primary item.');
    if ((D.minted[itemId] || 0) >= it.cap) throw new Error(`${it.name} is sold out — all ${it.cap} exist. Buy one from a player instead.`);
    if (it.launch > D.sparks) throw new Error('Not enough demo Sparks.');
    D.sparks -= it.launch; D.minted[itemId] = (D.minted[itemId] || 0) + 1; D.inv[itemId] = (D.inv[itemId] || 0) + 1;
    D.trades.push({ itemId, price: it.launch, qty: 1, at: Date.now() }); D.fees.push({ fee: it.launch, split: split(it.launch) }); saveD();
  }
  function demoList(itemId, qty, price) {
    if ((D.inv[itemId] || 0) < qty) throw new Error('You do not have that many.');
    D.inv[itemId] -= qty; if (!D.inv[itemId]) delete D.inv[itemId];
    D.listings.push({ id: 'U' + (++D.seq), sellerId: me(), itemId, qty, price, status: 'open', at: Date.now() }); saveD();
  }
  function demoCancel(id) { const l = D.listings.find(x => x.id === id && x.sellerId === me() && x.status === 'open'); if (!l) return; l.status = 'cancelled'; D.inv[l.itemId] = (D.inv[l.itemId] || 0) + l.qty; saveD(); }
  /* simulated players: they buy your listing if it is at or under the going rate */
  setInterval(() => {
    if (live()) return; const mine = D.listings.filter(l => l.sellerId === me() && l.status === 'open'); if (!mine.length) return;
    const l = mine[Math.random() * mine.length | 0], ref = (D.trades.filter(t => t.itemId === l.itemId).slice(-5).reduce((s, t, _, a) => s + t.price / a.length, 0)) || l.price;
    if (l.price <= ref * (1.05 + Math.random() * .15)) {
      const fee = Math.floor(l.price * FEE_BPS / 1e4); l.qty--; if (!l.qty) l.status = 'filled'; D.sparks += l.price - fee;
      D.trades.push({ itemId: l.itemId, price: l.price, qty: 1, at: Date.now() }); D.fees.push({ fee, split: split(fee) }); saveD();
      note(`A player bought your ${name(l.itemId)} for ${l.price} Sparks (−${fee} fee).`); if (active()) render();
    }
  }, 9000);
  const name = id => (CAT.find(i => i.id === id) || { name: id }).name;

  /* ── data layer: live or demo ───────────────────────────── */
  async function load() {
    if (live()) {
      try {
        const [b, m, f, l] = await Promise.all([SAPCFG.api('/api/sap/market/board'), SAPCFG.api('/api/sap/market/me').catch(() => ({ sparks: null, inventory: {} })), SAPCFG.api('/api/sap/market/fees'), SAPCFG.api('/api/sap/market/listings')]);
        return { mode: 'live', board: b.items, sparks: m.sparks, inv: m.inventory || {}, fees: f.totals, listings: l.listings, paused: b.paused };
      } catch (e) { note('Backend unreachable — showing the demo market. (' + e.message + ')'); }
    }
    return { mode: 'demo', board: demoBoard(), sparks: D.sparks, inv: D.inv, fees: demoFees(), listings: D.listings.filter(l => l.status === 'open') };
  }
  const key = () => 'k-' + me() + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  async function act(kind, a) {
    try {
      if (live()) {
        if (kind === 'buy') await SAPCFG.api('/api/sap/market/buy', { method: 'POST', body: { listingId: a.id, qty: a.qty, idempotencyKey: key() } });
        if (kind === 'primary') await SAPCFG.api('/api/sap/market/primary', { method: 'POST', body: { itemId: a.id, qty: 1, idempotencyKey: key() } });
        if (kind === 'list') await SAPCFG.api('/api/sap/market/list', { method: 'POST', body: { itemId: a.id, qty: a.qty, price: a.price, idempotencyKey: key() } });
        if (kind === 'cancel') await SAPCFG.api('/api/sap/market/cancel', { method: 'POST', body: { listingId: a.id } });
      } else {
        if (kind === 'buy') { const r = demoBuy(a.id, a.qty); note(`Bought for ${r.total} Sparks · fee ${r.fee} → split 40/40/20.`); }
        if (kind === 'primary') { demoPrimary(a.id); note(`Minted 1 ${name(a.id)} at launch price — proceeds split by the fee policy.`); }
        if (kind === 'list') { demoList(a.id, a.qty, a.price); note('Listed. Players buy when your price is at or under the going rate.'); }
        if (kind === 'cancel') demoCancel(a.id);
      }
    } catch (e) { note('✗ ' + e.message); }
    render();
  }
  function note(t) { const n = document.getElementById('mNote'); if (!n) return; n.textContent = t; n.classList.add('show'); clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove('show'), 4200); }

  function spark(hist, w = 110, h = 30, col = '#4dff9a') {
    if (!hist || hist.length < 2) return '<svg width="' + w + '" height="' + h + '"></svg>';
    const ps = hist.map(x => x[1]), lo = Math.min(...ps), hi = Math.max(...ps), sp = hi - lo || 1;
    const pts = ps.map((p, i) => `${(i / (ps.length - 1) * w).toFixed(1)},${(h - 3 - (p - lo) / sp * (h - 6)).toFixed(1)}`).join(' ');
    const up = ps[ps.length - 1] >= ps[0];
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${up ? col : '#ff6b7a'}" stroke-width="1.6" points="${pts}"/></svg>`;
  }
  function donut(f) {
    const tot = f.treeFund + f.asimovLiquidity + f.platform || 1; let a0 = -Math.PI / 2, o = ''; const R = 46, cx = 60, cy = 60;
    [['treeFund', '#4dff9a'], ['asimovLiquidity', '#3ef0e0'], ['platform', '#a78bfa']].forEach(([k, c]) => { const fr = (f[k] || 0) / tot || 1 / 3, a1 = a0 + fr * Math.PI * 2;
      o += `<path d="M${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)}A${R} ${R} 0 ${fr > .5 ? 1 : 0} 1 ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)}" stroke="${c}" stroke-width="16" fill="none"/>`; a0 = a1; });
    return `<svg width="120" height="120" viewBox="0 0 120 120">${o}<text x="60" y="58" text-anchor="middle" fill="#e3fbef" font-size="15" font-weight="600">${fmt(f.fees)}</text><text x="60" y="74" text-anchor="middle" fill="#8fb8a6" font-size="9">SPARKS IN FEES</text></svg>`;
  }

  let filter = 'all';
  async function render() {
    const root = document.getElementById('market-root'); if (!root) return;
    const S = await load();
    const items = S.board.filter(b => filter === 'all' || b.kind === filter || (filter === 'limited' && b.cap));
    const inv = Object.entries(S.inv || {});
    const mine = (S.listings || []).filter(l => l.sellerId === me());
    root.innerHTML = `
    <div class="pagehead"><div><div class="cap">SAP · garden marketplace</div><h1>Market</h1><p class="mut">Players set the prices. Limited plots and seeds can only ever exist up to their cap, so what they cost is up to the people who hold them.</p></div>
      <div class="mstats"><span class="pill ${S.mode === 'live' ? 'cy' : 'am'}">${S.mode === 'live' ? 'LIVE · shared market' : 'DEMO · nothing at stake'}</span>
      <div><b>${fmt(S.sparks)}</b><small>${S.mode === 'live' ? 'Sparks' : 'demo Sparks'}</small></div><div><b>${inv.reduce((s, [, v]) => s + v, 0)}</b><small>items</small></div><div><b>${(S.listings || []).length}</b><small>open listings</small></div></div></div>
    <div id="mNote" class="mnote"></div>
    <div class="mgrid">
      <div class="col">
        <div class="chips">${[['all', 'All'], ['limited', 'Limited'], ['plot', 'Plots'], ['seed', 'Seeds'], ['tool', 'Tools'], ['decor', 'Decor'], ['material', 'Materials']].map(([k, t]) => `<span class="chip" data-mf="${k}" aria-pressed="${filter === k}">${t}</span>`).join('')}</div>
        <div class="mcards">${items.map(b => {
          const pct = b.cap ? Math.round(b.minted / b.cap * 100) : null, floorL = (S.listings || []).filter(l => l.itemId === b.id && l.sellerId !== me()).sort((x, y) => x.price - y.price)[0];
          return `<div class="mcard glass" style="--rc:${RC[b.rarity]}">
            <div class="mtop"><span class="mic">${ICON[b.kind]}</span><div><b>${esc(b.name)}</b><small style="color:${RC[b.rarity]}">${b.rarity.toUpperCase()}${b.cap ? ' · ' + fmt(b.cap) + ' ever' : ''}</small></div></div>
            ${b.cap ? `<div class="supply"><i style="width:${pct}%"></i></div><div class="mut xs">${fmt(b.minted)} / ${fmt(b.cap)} exist · ${fmt(b.remainingPrimary)} left at launch</div>` : '<div class="mut xs">Uncapped · made by play</div>'}
            <div class="mrow"><div><small>Floor</small><b>${fmt(b.floor)}</b></div><div><small>Last</small><b>${fmt(b.last)}</b></div><div><small>24h vol</small><b>${fmt(b.volume24h)}</b></div></div>
            <div class="msp">${spark(b.history)}</div>
            <div class="btns">${floorL ? `<button class="btn sm" data-buy="${floorL.id}">Buy at ${fmt(floorL.price)}</button>` : '<button class="btn sm" disabled>No sellers</button>'}
              ${b.cap && b.launch && b.remainingPrimary > 0 ? `<button class="btn sm ghost" data-prim="${b.id}">Mint · ${fmt(b.launch)}</button>` : b.cap ? '<span class="pill rd">SOLD OUT</span>' : ''}</div>
          </div>`; }).join('')}</div>
      </div>
      <div class="col">
        <div class="glass card"><h3>Your inventory</h3>${inv.length ? inv.map(([k, v]) => `<div class="irow"><span>${ICON[(CAT.find(c => c.id === k) || {}).kind] || '•'} ${esc(name(k))} <b>×${v}</b></span>
          <span class="ilist"><input type="number" min="1" value="${(S.board.find(b => b.id === k) || {}).last || 10}" data-pr="${k}" aria-label="price"><button class="btn sm" data-list="${k}">List</button></span></div>`).join('') : '<p class="mut sm">Play the Garden to find items.</p>'}
          ${mine.length ? '<h3 style="margin-top:14px">Your listings</h3>' + mine.map(l => `<div class="irow"><span>${esc(name(l.itemId))} ×${l.qty} @ ${fmt(l.price)}</span><button class="btn sm ghost" data-cancel="${l.id}">Cancel</button></div>`).join('') : ''}
        </div>
        <div class="glass card"><h3>Where the fees go <span class="pill g">${FEE_BPS / 100}% PER SALE</span></h3>
          <div class="flyw">${donut(S.fees)}<div>
            <div class="frow"><i style="background:#4dff9a"></i>Tree fund 40% <b>${fmt(S.fees.treeFund)}</b></div>
            <div class="frow"><i style="background:#3ef0e0"></i>Liquidity reserve 40% <b>${fmt(S.fees.asimovLiquidity)}</b></div>
            <div class="frow"><i style="background:#a78bfa"></i>Platform 20% <b>${fmt(S.fees.platform)}</b></div></div></div>
          <p class="mut xs">Recorded as intents in Sparks — not money, not a payout. Real planting is paid separately, in real currency, with a receipt from a verified planting partner. Ideas like buybacks, locks or holder rewards are <b>not live</b>: they need an owner decision and legal review first.</p>
        </div>
        <div class="glass card"><h3>Rules of the market</h3><ul class="fair"><li>You set your price. Buyers pay the ask.</li><li>Daily spending cap. No loot boxes. No odds-based items.</li><li>Sparks have no cash value and cannot be withdrawn.</li><li>Limited items: supply is fixed forever at the cap.</li></ul></div>
      </div>
    </div>`;
    root.querySelectorAll('[data-mf]').forEach(c => c.onclick = () => { filter = c.dataset.mf; render(); });
    root.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => act('buy', { id: b.dataset.buy, qty: 1 }));
    root.querySelectorAll('[data-prim]').forEach(b => b.onclick = () => act('primary', { id: b.dataset.prim }));
    root.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => act('cancel', { id: b.dataset.cancel }));
    root.querySelectorAll('[data-list]').forEach(b => b.onclick = () => { const p = Math.round(+root.querySelector(`[data-pr="${b.dataset.list}"]`).value); if (p > 0) act('list', { id: b.dataset.list, qty: 1, price: p }); });
  }
  window.addEventListener('sapview', e => { if (e.detail === 'market') render(); });
  window.addEventListener('sapcfg', () => { if (active()) render(); });
  if (active()) render();
})();
