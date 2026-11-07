'use strict';
/**
 * market-service.js — the S.A.P. garden marketplace (seeds, plants, tools, decor, plots).
 *
 * WHAT IT IS
 *   A closed-loop player market priced in Sparks. Players list garden items at prices
 *   they choose; buyers pay the ask; a market fee is taken and split by the ONE fee
 *   policy (splitByPolicy from treegens-service.js — R4, never copied). Items with a
 *   supply cap (Genesis plots, rare seeds) can only ever exist up to that cap, so
 *   their prices are set by what players ask and pay, not by us.
 *
 * WHAT IT IS NOT (binding — see AGENTS.md R1–R7 and docs/SAP_MARKET.md)
 *   - Not money. Sparks move ONLY through economy-service (grant/spend). This module
 *     never writes the Sparks ledger directly and has no withdraw/cash-out path.
 *   - Not an emission. No Sparks are created to pay rewards. Sales move existing
 *     Sparks from buyer to seller; the fee is recorded, not minted.
 *   - Not a settlement. Fee allocations are recorded in SPARKS in their own collection
 *     (`feeAllocations`). They never enter the cents ledger (R3). Real tree funding
 *     only happens through POST /api/sap/treegens/pay with a real payment id.
 *   - Not a buyback. Nothing here buys any token. (R7 — see docs/SAP_MARKET.md for
 *     the owner/counsel decision memo on buybacks, locks and NFT revenue ideas.)
 *
 * CONSISTENCY
 *   Every mutating call takes an idempotencyKey. A buy runs under the market lock:
 *   validate → economy.spend(buyer) → economy.grant(seller) → move items → persist.
 *   spend/grant are idempotent on derived keys, so a retry after a crash between
 *   them completes the sale without double-charging or double-paying.
 */

const path = require('path');
const { JsonStore } = require('../lib/json-store');
const { splitByPolicy, readPolicyFromEnv } = require('./treegens-service');

const BPS = 10000;

class MarketError extends Error {
  constructor(message, code, status) { super(message); this.name = 'MarketError'; this.code = code || 'MARKET_ERROR'; this.status = status || 400; }
}

/* The garden catalog. `cap` = maximum units that can ever exist (null = uncapped,
   produced by play). `launch` = primary price in Sparks for capped items the
   garden releases; primary proceeds go entirely through the fee policy. */
const CATALOG = [
  { id: 'plot-genesis',    kind: 'plot',  name: 'Genesis Plot',            rarity: 'genesis',   cap: 100,  launch: 2500, desc: 'One of the first 100 SAP garden squares. A plot unlocks upgrades (greenhouse, weather station, equipment).' },
  { id: 'plot-grove',      kind: 'plot',  name: 'Grove Plot',              rarity: 'rare',      cap: 900,  launch: 900,  desc: 'A standard SAP garden square.' },
  { id: 'seed-red-mangrove',   kind: 'seed', name: 'Red Mangrove Propagule',   rarity: 'common',    cap: null, desc: 'Rhizophora mangle. Stilt roots, salt tolerant.' },
  { id: 'seed-black-mangrove', kind: 'seed', name: 'Black Mangrove Seed',      rarity: 'common',    cap: null, desc: 'Avicennia germinans. Pencil-root breather.' },
  { id: 'seed-plane-tree',     kind: 'seed', name: 'London Plane Seed',        rarity: 'common',    cap: null, desc: 'The street tree of a hundred cities.' },
  { id: 'seed-sundari',        kind: 'seed', name: 'Sundari Seed',             rarity: 'rare',      cap: 2000, launch: 120,  desc: 'Heritiera fomes, the tree the Sundarbans is named after.' },
  { id: 'seed-ghost-orchid',   kind: 'seed', name: 'Ghost Orchid Spore',       rarity: 'legendary', cap: 150,  launch: 600,  desc: 'Everglades epiphyte. Almost impossible to grow. Almost.' },
  { id: 'tool-watering-can',   kind: 'tool', name: 'Brass Watering Can',       rarity: 'common',    cap: null, desc: '+1 Watering Can capacity.' },
  { id: 'tool-uv-lamp',        kind: 'tool', name: 'UV Grow Lamp',             rarity: 'rare',      cap: 1500, launch: 200,  desc: 'Night growth. Also scares pests.' },
  { id: 'tool-pruning-drone',  kind: 'tool', name: 'Nexus Pruning Drone',      rarity: 'legendary', cap: 250,  launch: 750,  desc: 'Illustrative field unit. Cosmetic + combo bonus.' },
  { id: 'decor-holo-fountain', kind: 'decor', name: 'Holo Fountain',           rarity: 'rare',      cap: 1200, launch: 180,  desc: 'A small hologram core for your plot.' },
  { id: 'decor-lantern',       kind: 'decor', name: 'Firefly Lantern',         rarity: 'common',    cap: null, desc: 'Glows at dusk.' },
  { id: 'compost',             kind: 'material', name: 'Compost',              rarity: 'common',    cap: null, desc: 'Dropped by tending. Feeds boosters.' },
];
const BY_ID = Object.fromEntries(CATALOG.map(i => [i.id, i]));
const STARTER = [['seed-red-mangrove', 3], ['seed-plane-tree', 1], ['decor-lantern', 1], ['compost', 2]];

const EMPTY = {
  inventory: {},        // userId -> { itemId: qty }  (garden items; Sparks live in economy-service)
  listings: [],         // { id, sellerId, itemId, qty, price, createdAt, status }
  trades: [],           // { id, listingId|null, itemId, qty, price, buyerId, sellerId, fee, at }
  minted: {},           // itemId -> units ever created (enforces caps)
  feeAllocations: [],   // { tradeId, unit:'sparks', fee, split:{treeFund,asimovLiquidity,platform}, at }
  spendByDay: {},       // `${userId}|${YYYY-MM-DD}` -> Sparks spent
  idem: {},             // idempotencyKey -> stored result
  seq: 0,
};

function int(n, name, min, max) {
  if (!Number.isInteger(n) || n < min || n > max) throw new MarketError(`${name} must be an integer in [${min}, ${max}]`, 'VALIDATION');
  return n;
}
function str(s, name) { if (typeof s !== 'string' || !s.trim() || s.length > 128) throw new MarketError(`${name} required`, 'VALIDATION'); return s.trim(); }
const today = (now) => new Date(now).toISOString().slice(0, 10);

class MarketService {
  /**
   * @param {object} opts
   * @param {object} opts.economy   EconomyService instance (grant/spend). Required for buys.
   * @param {string} [opts.filePath]
   * @param {object} [opts.env]
   * @param {Function} [opts.now]
   */
  constructor(opts = {}) {
    this.env = opts.env || process.env;
    this.economy = opts.economy || null;
    this.policy = opts.policy || readPolicyFromEnv(this.env);
    this.feeBps = Number(this.env.SAP_MARKET_FEE_BPS || 500);           // 5% default
    if (!Number.isInteger(this.feeBps) || this.feeBps < 0 || this.feeBps > 2000) throw new MarketError('SAP_MARKET_FEE_BPS must be 0..2000', 'BAD_CONFIG');
    this.dailyCap = Number(this.env.SAP_MARKET_DAILY_SPEND_CAP || 5000);  // responsible-play spend cap (Sparks/day)
    this.now = opts.now || (() => Date.now());
    this.store = new JsonStore(opts.filePath || path.join(__dirname, '..', 'data', 'sap-market.json'), EMPTY);
  }

  paused() { return String(this.env.SAP_PAUSED || '') === '1'; }
  _assertOpen() { if (this.paused()) throw new MarketError('SAP market is paused (SAP_PAUSED=1)', 'PAUSED', 503); }

  catalog() { return CATALOG.map(i => ({ ...i })); }

  /** Market board: per item supply, floor ask, last trade, 24h volume, open listings. */
  async board() {
    const db = await this.store.read();
    const since = this.now() - 864e5;
    return CATALOG.map(i => {
      const open = db.listings.filter(l => l.status === 'open' && l.itemId === i.id);
      const tr = db.trades.filter(t => t.itemId === i.id);
      const last = tr[tr.length - 1];
      const vol24 = tr.filter(t => t.at >= since).reduce((s, t) => s + t.qty, 0);
      const minted = db.minted[i.id] || 0;
      return {
        id: i.id, name: i.name, kind: i.kind, rarity: i.rarity, desc: i.desc,
        cap: i.cap, minted, remainingPrimary: i.cap == null ? null : Math.max(0, i.cap - minted),
        launch: i.launch || null,
        floor: open.length ? Math.min(...open.map(l => l.price)) : null,
        last: last ? last.price : null,
        volume24h: vol24,
        listings: open.length,
        history: tr.slice(-30).map(t => [t.at, t.price]),
      };
    });
  }

  async inventory(userId) { str(userId, 'userId'); const db = await this.store.read(); return { ...(db.inventory[userId] || {}) }; }
  async listings(itemId) { const db = await this.store.read(); return db.listings.filter(l => l.status === 'open' && (!itemId || l.itemId === itemId)).sort((a, b) => a.price - b.price); }
  async feeReport() {
    const db = await this.store.read();
    const tot = { treeFund: 0, asimovLiquidity: 0, platform: 0, fees: 0 };
    db.feeAllocations.forEach(f => { tot.fees += f.fee; for (const k of ['treeFund', 'asimovLiquidity', 'platform']) tot[k] += f.split[k]; });
    return { unit: 'sparks', note: 'Closed-loop Sparks allocations. Not money, not a settlement, never in the cents ledger (R3).', policy: this.policy, feeBps: this.feeBps, totals: tot, count: db.feeAllocations.length };
  }

  _idem(db, key, fn) {
    if (db.idem[key]) return db.idem[key];
    const r = fn(); db.idem[key] = r; return r;
  }
  _give(db, userId, itemId, qty) {
    const inv = db.inventory[userId] || (db.inventory[userId] = {});
    inv[itemId] = (inv[itemId] || 0) + qty;
  }
  _take(db, userId, itemId, qty) {
    const inv = db.inventory[userId] || {};
    if ((inv[itemId] || 0) < qty) throw new MarketError(`not enough ${itemId}`, 'INSUFFICIENT_ITEMS');
    inv[itemId] -= qty; if (!inv[itemId]) delete inv[itemId];
  }
  _mint(db, itemId, qty) {
    const it = BY_ID[itemId];
    const m = db.minted[itemId] || 0;
    if (it.cap != null && m + qty > it.cap) throw new MarketError(`${it.name} is capped at ${it.cap}`, 'SUPPLY_CAP');
    db.minted[itemId] = m + qty;
  }

  /** One-time starter pack (items only — no Sparks are created). */
  async claimStarter(userId) {
    str(userId, 'userId'); this._assertOpen();
    return this.store.withLock(db => this._idem(db, `starter:${userId}`, () => {
      STARTER.forEach(([id, q]) => { this._mint(db, id, q); this._give(db, userId, id, q); });
      return { ok: true, granted: Object.fromEntries(STARTER) };
    }));
  }

  /** Items earned by play (tend loop / pest battle). Uncapped play items only. */
  async awardPlayDrop({ userId, itemId, qty, idempotencyKey }) {
    str(userId, 'userId'); str(idempotencyKey, 'idempotencyKey'); int(qty, 'qty', 1, 10); this._assertOpen();
    const it = BY_ID[itemId]; if (!it) throw new MarketError('unknown item', 'NOT_FOUND', 404);
    if (it.cap != null) throw new MarketError('capped items cannot drop from play', 'CAPPED');
    const maxDrops = Number(this.env.SAP_MARKET_DAILY_DROPS || 20);
    return this.store.withLock(db => this._idem(db, `drop:${idempotencyKey}`, () => {
      const k = `drops|${userId}|${today(this.now())}`, n = db.spendByDay[k] || 0;   // play drops are rate-limited per day
      if (n + qty > maxDrops) throw new MarketError(`daily play-drop limit reached (${maxDrops})`, 'DROP_CAP', 429);
      db.spendByDay[k] = n + qty;
      this._mint(db, itemId, qty); this._give(db, userId, itemId, qty); return { ok: true, itemId, qty };
    }));
  }

  /** Create a listing: items move from the seller into escrow at a price THEY choose. */
  async list({ userId, itemId, qty, price, idempotencyKey }) {
    str(userId, 'userId'); str(idempotencyKey, 'idempotencyKey'); int(qty, 'qty', 1, 1000); int(price, 'price', 1, 1000000); this._assertOpen();
    if (!BY_ID[itemId]) throw new MarketError('unknown item', 'NOT_FOUND', 404);
    return this.store.withLock(db => this._idem(db, `list:${idempotencyKey}`, () => {
      this._take(db, userId, itemId, qty);
      const l = { id: `L${++db.seq}`, sellerId: userId, itemId, qty, price, createdAt: this.now(), status: 'open' };
      db.listings.push(l); return { ok: true, listing: l };
    }));
  }

  async cancel({ userId, listingId }) {
    str(userId, 'userId'); str(listingId, 'listingId');
    return this.store.withLock(db => {
      const l = db.listings.find(x => x.id === listingId);
      if (!l || l.status !== 'open') throw new MarketError('listing not open', 'NOT_FOUND', 404);
      if (l.sellerId !== userId) throw new MarketError('not your listing', 'FORBIDDEN', 403);
      l.status = 'cancelled'; this._give(db, userId, l.itemId, l.qty); return { ok: true };
    });
  }

  _fee(db, tradeId, fee) {
    const split = splitByPolicy(fee, this.policy);
    db.feeAllocations.push({ tradeId, unit: 'sparks', fee, split, at: this.now() });
    return split;
  }
  _capCheck(db, userId, total) {
    const k = `${userId}|${today(this.now())}`, spent = db.spendByDay[k] || 0;
    if (spent + total > this.dailyCap) throw new MarketError(`daily spend cap reached (${this.dailyCap} Sparks)`, 'SPEND_CAP', 429);
    return () => { db.spendByDay[k] = spent + total; };
  }

  /** Buy from a player listing. Fee = feeBps of the total, split by the one policy. */
  async buy({ buyerId, listingId, qty, idempotencyKey }) {
    str(buyerId, 'buyerId'); str(listingId, 'listingId'); str(idempotencyKey, 'idempotencyKey'); int(qty, 'qty', 1, 1000); this._assertOpen();
    if (!this.economy) throw new MarketError('economy not configured', 'BAD_CONFIG', 500);
    return this.store.withLock(async db => {
      if (db.idem[`buy:${idempotencyKey}`]) return db.idem[`buy:${idempotencyKey}`];
      const l = db.listings.find(x => x.id === listingId);
      if (!l || l.status !== 'open') throw new MarketError('listing not open', 'NOT_FOUND', 404);
      if (l.sellerId === buyerId) throw new MarketError('cannot buy your own listing', 'SELF_TRADE');
      if (qty > l.qty) throw new MarketError('not enough quantity listed', 'VALIDATION');
      const total = l.price * qty, fee = Math.floor(total * this.feeBps / BPS), proceeds = total - fee;
      const commitCap = this._capCheck(db, buyerId, total);
      await this.economy.spend(buyerId, total, `market:buy:${l.itemId}`, `mkt:${idempotencyKey}:buy`, { refId: l.id });
      if (proceeds > 0) await this.economy.grant(l.sellerId, proceeds, `market:sale:${l.itemId}`, `mkt:${idempotencyKey}:sale`, { refId: l.id });
      commitCap();
      l.qty -= qty; if (!l.qty) l.status = 'filled';
      this._give(db, buyerId, l.itemId, qty);
      const t = { id: `T${++db.seq}`, listingId: l.id, itemId: l.itemId, qty, price: l.price, buyerId, sellerId: l.sellerId, fee, at: this.now() };
      db.trades.push(t); if (db.trades.length > 5000) db.trades.splice(0, db.trades.length - 5000);
      const split = fee > 0 ? this._fee(db, t.id, fee) : null;
      const r = { ok: true, trade: t, total, fee, proceeds, split };
      db.idem[`buy:${idempotencyKey}`] = r; return r;
    });
  }

  /** Primary release of a capped item at its launch price. All proceeds go through the policy. */
  async buyPrimary({ buyerId, itemId, qty, idempotencyKey }) {
    str(buyerId, 'buyerId'); str(idempotencyKey, 'idempotencyKey'); int(qty, 'qty', 1, 5); this._assertOpen();
    const it = BY_ID[itemId]; if (!it || it.cap == null || !it.launch) throw new MarketError('not a primary item', 'NOT_FOUND', 404);
    if (!this.economy) throw new MarketError('economy not configured', 'BAD_CONFIG', 500);
    return this.store.withLock(async db => {
      if (db.idem[`prim:${idempotencyKey}`]) return db.idem[`prim:${idempotencyKey}`];
      const total = it.launch * qty;
      const commitCap = this._capCheck(db, buyerId, total);
      this._mint(db, itemId, qty);                         // throws SUPPLY_CAP before any spend
      await this.economy.spend(buyerId, total, `market:primary:${itemId}`, `mkt:${idempotencyKey}:prim`);
      commitCap();
      this._give(db, buyerId, itemId, qty);
      const t = { id: `T${++db.seq}`, listingId: null, itemId, qty, price: it.launch, buyerId, sellerId: 'garden', fee: total, at: this.now() };
      db.trades.push(t);
      const split = this._fee(db, t.id, total);
      const r = { ok: true, trade: t, total, split, remaining: it.cap - db.minted[itemId] };
      db.idem[`prim:${idempotencyKey}`] = r; return r;
    });
  }
}

module.exports = { MarketService, MarketError, CATALOG };
