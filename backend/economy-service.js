'use strict';
/**
 * SHADDAI Economy Service — the ONLY module permitted to write the Sparks
 * money tables. Correctness-critical: this is a ledger, bugs = lost value.
 *
 * Currency: "Sparks" (soft currency). Closed-loop, one-directional.
 * There is NO withdraw / cash-out / redeem-for-fiat / transfer-out API here,
 * by design, and none may be added — that keeps SHADDAI out of
 * money-transmitter territory.
 *
 * Store abstraction:
 *   - If process.env.DATABASE_URL is set  -> Postgres store (via `pg`),
 *     using a real DB transaction with `SELECT ... FOR UPDATE` row locking so
 *     the ledger insert and the balance update commit atomically.
 *   - Else                                -> DEV file store with ATOMIC writes
 *     (write temp file, then fs.renameSync over the real file — rename is
 *     atomic on the same filesystem, so a crash mid-write never corrupts the
 *     ledger). Concurrent calls are serialized through a single in-process
 *     async lock, so read-modify-write races can't lose updates.
 *
 * Both stores expose the SAME async interface (see StoreInterface below), so
 * the public API is identical regardless of backend.
 *
 * All amounts are integer Sparks (BIGINT). No floats. Ever.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
class EconomyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'EconomyError';
    this.code = code || 'ECONOMY_ERROR';
  }
}
class InsufficientFundsError extends EconomyError {
  constructor(message) {
    super(message || 'Insufficient Sparks balance', 'INSUFFICIENT_FUNDS');
    this.name = 'InsufficientFundsError';
  }
}
class ValidationError extends EconomyError {
  constructor(message) {
    super(message || 'Invalid input', 'VALIDATION');
    this.name = 'ValidationError';
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function assertUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '' || userId.length > 256) {
    throw new ValidationError('userId must be a non-empty string (<=256 chars)');
  }
}
function assertPositiveIntAmount(amount) {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new ValidationError('amount must be an integer (no floats)');
  }
  if (amount <= 0) {
    throw new ValidationError('amount must be a positive integer');
  }
  if (!Number.isSafeInteger(amount)) {
    throw new ValidationError('amount exceeds safe integer range');
  }
}
function assertPositiveIntQty(qty) {
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= 0 || !Number.isSafeInteger(qty)) {
    throw new ValidationError('qty must be a positive integer');
  }
}
function assertIdempotencyKey(key) {
  if (typeof key !== 'string' || key.trim() === '' || key.length > 256) {
    throw new ValidationError('idempotencyKey must be a non-empty string (<=256 chars)');
  }
}
function assertReason(reason) {
  if (typeof reason !== 'string' || reason.length > 512) {
    throw new ValidationError('reason must be a string (<=512 chars)');
  }
}
function assertCatalogId(catalogId) {
  if (typeof catalogId !== 'string' || catalogId.trim() === '' || catalogId.length > 256) {
    throw new ValidationError('catalogId must be a non-empty string (<=256 chars)');
  }
}

// ===========================================================================
// DEV FILE STORE (atomic writes + in-process serialization lock)
// ===========================================================================
class DevFileStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(__dirname, 'data', 'economy.json');
    this.tmpPath = this.filePath + '.tmp';
    // Serialize ALL mutating operations through a single promise chain so
    // read-modify-write sequences never interleave and lose updates.
    this._lock = Promise.resolve();
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this._writeAtomic(this._empty());
    }
  }

  _empty() {
    return {
      economy_accounts: {},      // user_id -> { user_id, sparks_balance, updated_at }
      spark_transactions: [],    // append-only
      inventory_items: [],       // append-on-acquire
      catalog_items: {},         // id -> item
      subscriptions: {},         // user_id -> sub
      _seq: 0                    // monotonic id source
    };
  }

  _read() {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return this._empty();
      throw e;
    }
    if (!raw || raw.trim() === '') return this._empty();
    const db = JSON.parse(raw);
    // Defensive: ensure all shapes exist.
    const base = this._empty();
    return Object.assign(base, db);
  }

  // Atomic write: serialize to temp file, fsync, then rename over the target.
  // rename(2) is atomic on POSIX; on Windows fs.renameSync replaces atomically
  // for same-volume renames. A crash leaves either the old or new file intact,
  // never a half-written ledger.
  _writeAtomic(db) {
    const json = JSON.stringify(db);
    const fd = fs.openSync(this.tmpPath, 'w');
    try {
      fs.writeFileSync(fd, json);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(this.tmpPath, this.filePath);
  }

  // Run `fn(db)` under the serialization lock. fn may mutate db and return a
  // value; the db is written atomically after fn returns. Errors thrown by fn
  // abort the write (no partial state persisted).
  _withLock(fn) {
    const run = async () => {
      const db = this._read();
      const result = await fn(db);
      return { db, result };
    };
    // Chain onto the lock; capture next so callers await THIS op specifically.
    const next = this._lock.then(run, run); // run even if a prior op rejected
    // Keep the lock chain alive but swallow rejection so it doesn't poison the chain.
    this._lock = next.then(() => undefined, () => undefined);
    return next.then(({ db, result }) => {
      // Only persist on success.
      this._writeAtomic(db);
      return result;
    });
  }

  _nextId(db) {
    db._seq = (db._seq || 0) + 1;
    return db._seq;
  }

  _account(db, userId) {
    if (!db.economy_accounts[userId]) {
      db.economy_accounts[userId] = {
        user_id: userId,
        sparks_balance: 0,
        updated_at: new Date().toISOString()
      };
    }
    return db.economy_accounts[userId];
  }

  // --- Interface methods ---

  async getBalance(userId) {
    // Read-only; still go through lock for a consistent snapshot.
    return this._withLock(async (db) => {
      const acct = db.economy_accounts[userId];
      return acct ? acct.sparks_balance : 0;
    });
  }

  async getInventory(userId) {
    return this._withLock(async (db) => {
      return db.inventory_items
        .filter((it) => it.user_id === userId)
        .map((it) => ({ ...it }));
    });
  }

  // applyTransaction handles grant (amount>0) and spend (amount<0).
  // Idempotent on idempotency_key. Enforces non-negative balance for spends.
  async applyTransaction({ userId, amount, reason, refId, idempotencyKey }) {
    return this._withLock(async (db) => {
      // Idempotency: if this key already applied, return the prior result.
      const prior = db.spark_transactions.find((t) => t.idempotency_key === idempotencyKey);
      if (prior) {
        const acct = db.economy_accounts[userId] || { sparks_balance: 0 };
        return { replayed: true, transaction: { ...prior }, balance: acct.sparks_balance };
      }

      const acct = this._account(db, userId);
      const newBalance = acct.sparks_balance + amount;
      if (newBalance < 0) {
        throw new InsufficientFundsError(
          `Insufficient Sparks: balance ${acct.sparks_balance}, needed ${-amount}`
        );
      }

      const tx = {
        id: this._nextId(db),
        user_id: userId,
        amount: amount,
        reason: reason || '',
        ref_id: refId != null ? refId : null,
        idempotency_key: idempotencyKey,
        created_at: new Date().toISOString()
      };
      // Ledger insert + balance update in the same locked write == atomic.
      db.spark_transactions.push(tx);
      acct.sparks_balance = newBalance;
      acct.updated_at = tx.created_at;

      return { replayed: false, transaction: { ...tx }, balance: newBalance };
    });
  }

  async addInventoryItem({ userId, catalogId, qty, idempotencyKey, placedWhere }) {
    return this._withLock(async (db) => {
      const prior = db.inventory_items.find((it) => it.idempotency_key === idempotencyKey);
      if (prior) {
        return { replayed: true, item: { ...prior } };
      }
      const item = {
        id: this._nextId(db),
        user_id: userId,
        catalog_id: catalogId,
        qty: qty,
        placed_where: placedWhere != null ? placedWhere : null,
        acquired_at: new Date().toISOString(),
        idempotency_key: idempotencyKey
      };
      db.inventory_items.push(item);
      return { replayed: false, item: { ...item } };
    });
  }

  async getCatalogItem(catalogId) {
    return this._withLock(async (db) => {
      const item = db.catalog_items[catalogId];
      return item ? { ...item } : null;
    });
  }

  // Read-only: list ACTIVE catalog items. No money mutation.
  async listCatalog() {
    return this._withLock(async (db) => {
      return Object.keys(db.catalog_items)
        .map((k) => db.catalog_items[k])
        .filter((it) => it && it.active !== false)
        .map((it) => ({ ...it }));
    });
  }

  // Test/seed helper (not part of the money-write API surface).
  async upsertCatalogItem(item) {
    return this._withLock(async (db) => {
      db.catalog_items[item.id] = { ...item };
      return { ...item };
    });
  }
}

// ===========================================================================
// POSTGRES STORE (real DB transactions, SELECT ... FOR UPDATE)
// ===========================================================================
class PostgresStore {
  constructor(connectionString) {
    // Lazily require pg so the dev store / tests run without pg installed.
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString });
  }

  async _tx(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  }

  async getBalance(userId) {
    const r = await this.pool.query(
      'SELECT sparks_balance FROM economy_accounts WHERE user_id = $1',
      [userId]
    );
    return r.rows.length ? Number(r.rows[0].sparks_balance) : 0;
  }

  async getInventory(userId) {
    const r = await this.pool.query(
      'SELECT id, user_id, catalog_id, qty, placed_where, acquired_at FROM inventory_items WHERE user_id = $1 ORDER BY id',
      [userId]
    );
    return r.rows.map((row) => ({
      id: Number(row.id),
      user_id: row.user_id,
      catalog_id: row.catalog_id,
      qty: Number(row.qty),
      placed_where: row.placed_where,
      acquired_at: row.acquired_at
    }));
  }

  async applyTransaction({ userId, amount, reason, refId, idempotencyKey }) {
    return this._tx(async (client) => {
      // Idempotency check first (unique constraint is the ultimate guard).
      const priorR = await client.query(
        'SELECT id, user_id, amount, reason, ref_id, idempotency_key, created_at FROM spark_transactions WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      if (priorR.rows.length) {
        const prior = priorR.rows[0];
        const balR = await client.query(
          'SELECT sparks_balance FROM economy_accounts WHERE user_id = $1',
          [userId]
        );
        const bal = balR.rows.length ? Number(balR.rows[0].sparks_balance) : 0;
        return {
          replayed: true,
          transaction: { ...prior, id: Number(prior.id), amount: Number(prior.amount) },
          balance: bal
        };
      }

      // Lock (or create) the account row to serialize concurrent mutations.
      await client.query(
        `INSERT INTO economy_accounts (user_id, sparks_balance)
         VALUES ($1, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
      const lockR = await client.query(
        'SELECT sparks_balance FROM economy_accounts WHERE user_id = $1 FOR UPDATE',
        [userId]
      );
      const current = Number(lockR.rows[0].sparks_balance);
      const newBalance = current + amount;
      if (newBalance < 0) {
        throw new InsufficientFundsError(
          `Insufficient Sparks: balance ${current}, needed ${-amount}`
        );
      }

      let txRow;
      try {
        const insR = await client.query(
          `INSERT INTO spark_transactions (user_id, amount, reason, ref_id, idempotency_key)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, user_id, amount, reason, ref_id, idempotency_key, created_at`,
          [userId, amount, reason || '', refId != null ? refId : null, idempotencyKey]
        );
        txRow = insR.rows[0];
      } catch (e) {
        // Unique violation on idempotency_key => a concurrent duplicate won the
        // race. Treat as replay.
        if (e && e.code === '23505') {
          const rr = await client.query(
            'SELECT id, user_id, amount, reason, ref_id, idempotency_key, created_at FROM spark_transactions WHERE idempotency_key = $1',
            [idempotencyKey]
          );
          const prior = rr.rows[0];
          return {
            replayed: true,
            transaction: { ...prior, id: Number(prior.id), amount: Number(prior.amount) },
            balance: current
          };
        }
        throw e;
      }

      await client.query(
        'UPDATE economy_accounts SET sparks_balance = $1, updated_at = now() WHERE user_id = $2',
        [newBalance, userId]
      );

      return {
        replayed: false,
        transaction: { ...txRow, id: Number(txRow.id), amount: Number(txRow.amount) },
        balance: newBalance
      };
    });
  }

  async addInventoryItem({ userId, catalogId, qty, idempotencyKey, placedWhere }) {
    return this._tx(async (client) => {
      const priorR = await client.query(
        'SELECT id, user_id, catalog_id, qty, placed_where, acquired_at, idempotency_key FROM inventory_items WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      if (priorR.rows.length) {
        const p = priorR.rows[0];
        return { replayed: true, item: { ...p, id: Number(p.id), qty: Number(p.qty) } };
      }
      let row;
      try {
        const r = await client.query(
          `INSERT INTO inventory_items (user_id, catalog_id, qty, placed_where, idempotency_key)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, user_id, catalog_id, qty, placed_where, acquired_at, idempotency_key`,
          [userId, catalogId, qty, placedWhere != null ? placedWhere : null, idempotencyKey]
        );
        row = r.rows[0];
      } catch (e) {
        if (e && e.code === '23505') {
          const rr = await client.query(
            'SELECT id, user_id, catalog_id, qty, placed_where, acquired_at, idempotency_key FROM inventory_items WHERE idempotency_key = $1',
            [idempotencyKey]
          );
          const p = rr.rows[0];
          return { replayed: true, item: { ...p, id: Number(p.id), qty: Number(p.qty) } };
        }
        throw e;
      }
      return { replayed: false, item: { ...row, id: Number(row.id), qty: Number(row.qty) } };
    });
  }

  async getCatalogItem(catalogId) {
    const r = await this.pool.query(
      'SELECT id, name, kind, sparks_price, usd_price_cents, rarity, active FROM catalog_items WHERE id = $1',
      [catalogId]
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      sparks_price: Number(row.sparks_price),
      usd_price_cents: Number(row.usd_price_cents),
      rarity: row.rarity,
      active: row.active
    };
  }

  // Read-only: list ACTIVE catalog items. Selects * so any optional columns
  // (description, category) flow through if the schema has them.
  async listCatalog() {
    const r = await this.pool.query(
      'SELECT * FROM catalog_items WHERE active = true ORDER BY id'
    );
    return r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      sparks_price: row.sparks_price == null ? null : Number(row.sparks_price),
      usd_price_cents: row.usd_price_cents == null ? null : Number(row.usd_price_cents),
      rarity: row.rarity,
      description: row.description != null ? row.description : null,
      category: row.category != null ? row.category : null,
      active: row.active
    }));
  }

  async upsertCatalogItem(item) {
    await this.pool.query(
      `INSERT INTO catalog_items (id, name, kind, sparks_price, usd_price_cents, rarity, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, kind=EXCLUDED.kind, sparks_price=EXCLUDED.sparks_price,
         usd_price_cents=EXCLUDED.usd_price_cents, rarity=EXCLUDED.rarity, active=EXCLUDED.active`,
      [item.id, item.name, item.kind, item.sparks_price || 0, item.usd_price_cents || 0,
       item.rarity != null ? item.rarity : null, item.active !== false]
    );
    return { ...item };
  }

  async close() {
    await this.pool.end();
  }
}

// ===========================================================================
// PUBLIC SERVICE — the only exported writer of money tables.
// ===========================================================================
class EconomyService {
  /**
   * @param {object} [opts]
   * @param {object} [opts.store] inject a store (for tests); else auto-select.
   * @param {string} [opts.filePath] dev-store file path override.
   */
  constructor(opts = {}) {
    if (opts.store) {
      this.store = opts.store;
    } else if (process.env.DATABASE_URL) {
      this.store = new PostgresStore(process.env.DATABASE_URL);
    } else {
      this.store = new DevFileStore(opts.filePath);
    }
  }

  /**
   * grant — credit Sparks. Positive integer only. Idempotent on idempotencyKey.
   * Replaying the same key returns the prior result and does NOT double-credit.
   */
  async grant(userId, amount, reason, idempotencyKey, opts = {}) {
    assertUserId(userId);
    assertPositiveIntAmount(amount);
    assertReason(reason);
    assertIdempotencyKey(idempotencyKey);
    return this.store.applyTransaction({
      userId,
      amount: amount,           // positive
      reason,
      refId: opts.refId,
      idempotencyKey
    });
  }

  /**
   * spend — debit Sparks. Positive integer `amount` requested; stored as a
   * negative transaction. Rejects with InsufficientFundsError if balance <
   * amount. Idempotent on idempotencyKey.
   */
  async spend(userId, amount, reason, idempotencyKey, opts = {}) {
    assertUserId(userId);
    assertPositiveIntAmount(amount);
    assertReason(reason);
    assertIdempotencyKey(idempotencyKey);
    return this.store.applyTransaction({
      userId,
      amount: -amount,          // negative
      reason,
      refId: opts.refId,
      idempotencyKey
    });
  }

  async getBalance(userId) {
    assertUserId(userId);
    return this.store.getBalance(userId);
  }

  async getInventory(userId) {
    assertUserId(userId);
    return this.store.getInventory(userId);
  }

  /**
   * grantItem — add an item to a user's inventory. Idempotent on idempotencyKey.
   */
  async grantItem(userId, catalogId, qty, idempotencyKey, opts = {}) {
    assertUserId(userId);
    assertCatalogId(catalogId);
    assertPositiveIntQty(qty);
    assertIdempotencyKey(idempotencyKey);
    return this.store.addInventoryItem({
      userId,
      catalogId,
      qty,
      idempotencyKey,
      placedWhere: opts.placedWhere
    });
  }

  // --- catalog helpers (read + seed only; no value can leave the system) ---
  async getCatalogItem(catalogId) {
    assertCatalogId(catalogId);
    return this.store.getCatalogItem(catalogId);
  }
  // Read-only listing of ACTIVE catalog items. No money mutation; safe to
  // expose publicly. Returns [] on an empty catalog (never throws on empty).
  async listCatalog() {
    if (typeof this.store.listCatalog === 'function') {
      return this.store.listCatalog();
    }
    return [];
  }
  async upsertCatalogItem(item) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) {
      throw new ValidationError('catalog item requires a string id');
    }
    return this.store.upsertCatalogItem(item);
  }

  // NOTE: There is intentionally NO withdraw(), cashOut(), redeem(),
  // transfer(), or payout() method. Sparks are closed-loop and one-directional.

  async close() {
    if (this.store && typeof this.store.close === 'function') {
      await this.store.close();
    }
  }
}

// Singleton for route wiring; tests construct their own instances.
let _default = null;
function getDefault() {
  if (!_default) _default = new EconomyService();
  return _default;
}

module.exports = {
  EconomyService,
  DevFileStore,
  PostgresStore,
  EconomyError,
  InsufficientFundsError,
  ValidationError,
  getDefault
};
