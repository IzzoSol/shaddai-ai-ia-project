'use strict';
/**
 * SHADDAI Treasury Service — the money-settlement LEDGER for real revenue events.
 *
 * Records a RevenueSettlement for every real money event (produced by the reward
 * engine) and accrues per-pool balances: treasury, ownerPayouts, referrer, eco
 * reserve, partner, asimov liquidity.
 *
 * PHASE LINE — record everything, cash-out nothing (yet):
 *   Settlements are stored with status 'pending' and pools accrue what is OWED.
 *   There is intentionally NO payout / withdraw / transfer method here. Actual
 *   cash movement (Stripe payouts, USDC transfers, refund/fraud windows, tax) is
 *   a separate, later, separately-reviewed sub-project. Keeping cash-out out of
 *   this module makes it impossible for a bug here to send real money anywhere.
 *
 * Amounts are integer CENTS — except credits-denominated fee allocations, which
 * use integer CREDIT UNITS in their own collection and never touch the cents
 * pools (see the CREDITS-DENOMINATED FEES section below). Idempotent on
 * attributionId (one settlement per attribution) so a replayed event never
 * double-accrues.
 *
 * Persistence: atomic JsonStore at backend/data/treasury.json.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SAP GREEN-INITIATIVE EXTENSION (2026-11-04)
 * ─────────────────────────────────────────────────────────────────────────────
 * Three additive capabilities, none of which change existing behaviour:
 *
 *  1. asimovLiquidity POOL — a slice of every fee can be earmarked for
 *     deepening $ASIMOV liquidity. This is an ACCOUNTING BUCKET, not a market.
 *     Nothing here trades, and the pool cannot be withdrawn from; it becomes a
 *     queue of on-chain intents (see 2).
 *
 *  2. ON-CHAIN SETTLEMENT INTENTS — the treasury records an INTENT to move
 *     money on-chain (Solana liquidity leg, Hyperliquid USDC leg, Treegens
 *     tree-fund leg). It never moves the money itself. A settler (a separate,
 *     separately-reviewed component) drains the queue once the chain-side
 *     credentials exist. This is the same "record, don't cash out" rule that
 *     governs the rest of this module, applied to the on-chain leg.
 *
 *  3. TREE PAYMENTS — a payment for real planting work, split across a tree
 *     fund (Treegens), $ASIMOV liquidity, and platform. Because it is a
 *     payment for services already rendered (planting + verification), it is
 *     structured to stay OUT of securities territory: see TREE_PAYMENT_NOTE.
 *
 * COMPLIANCE NOTE (why the on-chain leg is intent-only):
 *   Hyperliquid geoblocks US residents; token-linked rewards attract a Howey
 *   securities analysis; and routing a project's own users' flow through its
 *   own pool to manufacture TVL is wash-trading-shaped. Every one of those is
 *   a reason this ledger records INTENT and lets a human-reviewed settler
 *   decide what actually executes. See docs/SAP_TREASURY.md.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CREDITS-DENOMINATED FEES (2026-11-05)
 * ─────────────────────────────────────────────────────────────────────────────
 * The x402 marketplace fee is denominated in SHAD-Credits — a CLOSED-LOOP soft
 * currency, not real money. The x402 rail mints 100 free demo credits for
 * every new wallet, so a credits balance can have NO money behind it at all.
 *
 * Writing a credits fee into the cents pools would therefore inflate the
 * real-money totals (treasury / eco / asimovLiquidity / ...) with soft currency
 * and corrupt every downstream reading of them. So credits fees get:
 *   - their OWN collection (`creditFeeAllocations`),
 *   - their OWN unit label ('SHAD-Credits', scaled by CREDIT_UNIT_SCALE),
 *   - their OWN totals in the transparency report (`creditFeeRouting`),
 * and they NEVER touch `pools`, `settlements` or `treePayments`.
 *
 * There is NO credits->USD conversion rate anywhere in this codebase, so no
 * real-money value is ever computed for a credits fee. See CREDITS_NOTE.
 */

const path = require('path');
const { JsonStore } = require('../lib/json-store');

const POOLS = ['treasury', 'owner', 'referrer', 'eco', 'partner', 'asimovLiquidity'];

const EMPTY = {
  settlements: [],   // RevenueSettlement[] — REAL MONEY (integer cents)
  pools: { treasury: 0, owner: 0, referrer: 0, eco: 0, partner: 0, asimovLiquidity: 0 }, // cents accrued (owed)
  ownerPayouts: {},  // ownerUserId -> cents owed (pending)
  treePayments: [],  // TreePayment[] — payments for real planting work (cents)
  creditFeeAllocations: [], // CreditFeeAllocation[] — CLOSED-LOOP credits (NOT cents)
  onchainIntents: [],// OnchainIntent[] — recorded intent to move money on-chain
  _seq: 0,
};

/**
 * Attached to every tree payment. The distinction matters legally: this is a
 * payment for planting and verification work already performed, NOT a
 * distribution of a token in exchange for a promise of future value.
 */
const TREE_PAYMENT_NOTE =
  'Payment for planting and verification services already rendered. Not an investment, '
  + 'not a promise of appreciation, and not redeemable for fiat.';

/**
 * Attached to every credits-denominated fee allocation. SHAD-Credits are a
 * closed-loop soft currency: they are not cents, not USD and not USDC, and no
 * conversion rate to real money exists in this codebase — so a credits fee
 * carries no real-money value and is excluded from every cents total here.
 */
const CREDITS_NOTE =
  'Denominated in SHAD-Credits, a closed-loop soft currency. NOT cents, NOT USD, NOT USDC. '
  + 'No real-money value is implied: this codebase has no SHAD-Credits -> USD/USDC conversion rate, '
  + 'so no real-money amount is derived from it and it is excluded from every real-money (cents) '
  + 'total in this ledger.';

/**
 * 1 SHAD-Credit = 100 credit units. The x402 rail rounds credits to two
 * decimal places, so integer credit units give an EXACT policy split with no
 * unit created or lost — the same guarantee cents get from integer division.
 */
const CREDIT_UNIT_SCALE = 100;

/** Where the three policy slices of a credits fee are earmarked. */
const CREDIT_FEE_DESTINATIONS = {
  treeFund: 'Treegens — real mangrove planting and Proof-of-Tree verification',
  asimovLiquidity: '$ASIMOV liquidity on Solana (accounting bucket; settlement is a queued on-chain intent)',
  platform: 'SHADDAI platform operations',
};

class TreasuryError extends Error {
  constructor(message, code) { super(message); this.name = 'TreasuryError'; this.code = code || 'TREASURY_ERROR'; }
}

function assertCents(n, label) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)) {
    throw new TreasuryError(`${label} must be a non-negative integer (cents)`, 'VALIDATION');
  }
}

/** Credit units are NOT cents — same integer discipline, different unit. */
function assertCreditUnits(n, label) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)) {
    throw new TreasuryError(`${label} must be a non-negative integer (credit units)`, 'VALIDATION');
  }
}

class TreasuryService {
  constructor(opts = {}) {
    const file = opts.filePath || path.join(__dirname, '..', 'data', 'treasury.json');
    this.store = opts.store || new JsonStore(file, EMPTY);
  }

  /**
   * Older ledgers on disk predate the asimovLiquidity pool and the two new
   * collections. JsonStore's template merge restores missing TOP-LEVEL keys,
   * but a pre-existing `pools` object is assigned wholesale, so the new pool
   * key has to be backfilled explicitly. Without this, `db.pools.x += n`
   * would produce NaN and silently poison the ledger.
   */
  _normalize(db) {
    if (!db.pools || typeof db.pools !== 'object') db.pools = {};
    for (const p of POOLS) {
      if (typeof db.pools[p] !== 'number' || !Number.isFinite(db.pools[p])) db.pools[p] = 0;
    }
    if (!Array.isArray(db.settlements)) db.settlements = [];
    if (!Array.isArray(db.treePayments)) db.treePayments = [];
    if (!Array.isArray(db.creditFeeAllocations)) db.creditFeeAllocations = [];
    if (!Array.isArray(db.onchainIntents)) db.onchainIntents = [];
    if (!db.ownerPayouts || typeof db.ownerPayouts !== 'object') db.ownerPayouts = {};
    if (typeof db._seq !== 'number') db._seq = 0;
    return db;
  }

  /**
   * Record a real-money settlement and accrue pool balances. Idempotent on
   * attributionId. NEVER moves money out — only records what is owed.
   *
   * @param {object} s
   * @param {string} s.attributionId  one settlement per attribution
   * @param {string} s.sourceType     event type (paid_signup, hire, x402_purchase, ...)
   * @param {number} s.grossAmount    integer cents (must equal sum of split)
   * @param {string} s.currency       'USD' | 'USDC'
   * @param {object} s.split          { treasury, owner, referrer, eco, partner, asimovLiquidity } in cents
   * @param {string|null} [s.ownerUserId] owner credited the `owner` pool slice
   * @returns {Promise<object>} the persisted RevenueSettlement
   */
  async recordSettlement(s) {
    if (!s || !s.attributionId) throw new TreasuryError('attributionId required', 'VALIDATION');
    assertCents(s.grossAmount, 'grossAmount');
    const split = s.split || {};
    for (const p of POOLS) assertCents(split[p] || 0, `split.${p}`);

    // Money invariant: the split MUST sum to gross — no cent created or lost.
    const sum = POOLS.reduce((acc, p) => acc + (split[p] || 0), 0);
    if (sum !== s.grossAmount) {
      throw new TreasuryError(`split sum ${sum} != gross ${s.grossAmount}`, 'SPLIT_MISMATCH');
    }

    return this.store.withLock(async (db) => {
      this._normalize(db);
      const prior = db.settlements.find((x) => x.attributionId === s.attributionId);
      if (prior) return { ...prior, replayed: true };

      db._seq = (db._seq || 0) + 1;
      const settlement = {
        id: `set_${Date.now().toString(36)}_${db._seq}`,
        attributionId: s.attributionId,
        sourceType: s.sourceType || 'unknown',
        grossAmount: s.grossAmount,
        currency: s.currency === 'USDC' ? 'USDC' : 'USD',
        treasuryAmount: split.treasury || 0,
        ownerPayoutAmount: split.owner || 0,
        referrerAmount: split.referrer || 0,
        ecoReserveAmount: split.eco || 0,
        partnerAmount: split.partner || 0,
        asimovLiquidityAmount: split.asimovLiquidity || 0,
        ownerUserId: s.ownerUserId || null,
        status: 'pending',   // record only — NEVER auto-settled to real accounts here
        createdAt: new Date().toISOString(),
        settledAt: null,
      };
      db.settlements.push(settlement);

      // Accrue pool balances (what is OWED, not what is paid).
      db.pools.treasury += settlement.treasuryAmount;
      db.pools.owner    += settlement.ownerPayoutAmount;
      db.pools.referrer += settlement.referrerAmount;
      db.pools.eco      += settlement.ecoReserveAmount;
      db.pools.partner  += settlement.partnerAmount;
      db.pools.asimovLiquidity += settlement.asimovLiquidityAmount;

      if (settlement.ownerUserId && settlement.ownerPayoutAmount > 0) {
        db.ownerPayouts[settlement.ownerUserId] =
          (db.ownerPayouts[settlement.ownerUserId] || 0) + settlement.ownerPayoutAmount;
      }

      return { ...settlement, replayed: false };
    });
  }

  /**
   * Record a payment for real planting work (Treegens).
   *
   * The allocation is split across three destinations that the SAP initiative
   * promises to the payer:
   *   treeFund          -> the `eco` pool           (paid to Treegens for planting)
   *   asimovLiquidity   -> the `asimovLiquidity` pool (deepens $ASIMOV liquidity)
   *   platform          -> the `treasury` pool      (runs the platform)
   *
   * The three MUST sum to `amount`. The same split is ALSO recorded on the
   * settlement so the money flows through exactly one accounting path.
   *
   * @param {object} p
   * @param {string} p.paymentId          idempotency key for this payment
   * @param {string} p.payerUserId        who paid
   * @param {string} [p.plotId]           Treegens plot id
   * @param {number} [p.stems]            number of trees funded
   * @param {number} p.amount             integer cents
   * @param {string} [p.currency]         'USD' | 'USDC'
   * @param {object} p.allocation         { treeFund, asimovLiquidity, platform } cents
   * @param {string} [p.treegensProof]    Proof-of-Tree evidence reference
   * @param {string} [p.serviceType]      what service was paid for
   * @returns {Promise<object>} the persisted TreePayment
   */
  async recordTreePayment(p) {
    if (!p || !p.paymentId) throw new TreasuryError('paymentId required', 'VALIDATION');
    if (!p.payerUserId) throw new TreasuryError('payerUserId required', 'VALIDATION');
    assertCents(p.amount, 'amount');

    const alloc = p.allocation || {};
    for (const k of ['treeFund', 'asimovLiquidity', 'platform']) {
      assertCents(alloc[k] || 0, `allocation.${k}`);
    }
    const allocSum = (alloc.treeFund || 0) + (alloc.asimovLiquidity || 0) + (alloc.platform || 0);
    if (allocSum !== p.amount) {
      throw new TreasuryError(`allocation sum ${allocSum} != amount ${p.amount}`, 'SPLIT_MISMATCH');
    }

    return this.store.withLock(async (db) => {
      this._normalize(db);
      const prior = db.treePayments.find((x) => x.paymentId === p.paymentId);
      if (prior) return { ...prior, replayed: true };

      db._seq = (db._seq || 0) + 1;
      const currency = p.currency === 'USDC' ? 'USDC' : 'USD';
      const payment = {
        id: `pay_${Date.now().toString(36)}_${db._seq}`,
        paymentId: p.paymentId,
        payerUserId: p.payerUserId,
        plotId: p.plotId || null,
        stems: Number.isInteger(p.stems) ? p.stems : null,
        amount: p.amount,
        currency,
        allocation: {
          treeFund: alloc.treeFund || 0,
          asimovLiquidity: alloc.asimovLiquidity || 0,
          platform: alloc.platform || 0,
        },
        treegensProof: p.treegensProof || null,
        serviceType: p.serviceType || 'tree_planting',
        note: TREE_PAYMENT_NOTE,
        status: 'pending',
        createdAt: new Date().toISOString(),
        settledAt: null,
      };
      db.treePayments.push(payment);

      // One settlement, so the money appears in the pools exactly once and
      // through the same invariant as every other revenue event.
      db._seq = (db._seq || 0) + 1;
      const settlement = {
        id: `set_${Date.now().toString(36)}_${db._seq}`,
        attributionId: `tree:${p.paymentId}`,
        sourceType: 'tree_payment',
        grossAmount: p.amount,
        currency,
        treasuryAmount: payment.allocation.platform,
        ownerPayoutAmount: 0,
        referrerAmount: 0,
        ecoReserveAmount: payment.allocation.treeFund,
        partnerAmount: 0,
        asimovLiquidityAmount: payment.allocation.asimovLiquidity,
        ownerUserId: null,
        status: 'pending',
        createdAt: payment.createdAt,
        settledAt: null,
        treePaymentId: payment.id,
      };
      db.settlements.push(settlement);

      db.pools.treasury += settlement.treasuryAmount;
      db.pools.eco += settlement.ecoReserveAmount;
      db.pools.asimovLiquidity += settlement.asimovLiquidityAmount;

      return { ...payment, settlementId: settlement.id, replayed: false };
    });
  }

  /**
   * Record a CREDITS-denominated fee allocation — e.g. the x402 marketplace fee
   * split by the SAP fee-routing policy (treeFund / asimovLiquidity / platform).
   *
   * THIS NEVER TOUCHES THE REAL-MONEY LEDGER:
   *   - `db.pools` is untouched (those are USD/USDC cents owed)
   *   - `db.settlements` is untouched (those are cents-denominated)
   *   - `db.treePayments` is untouched (those are cents-denominated)
   * The credits allocation lives in its own collection, carries its own unit
   * label, and shows up in the transparency report under `creditFeeRouting`.
   *
   * Amounts are integer CREDIT UNITS (1 SHAD-Credit = CREDIT_UNIT_SCALE units),
   * so the policy split is exact: no unit is created or lost.
   *
   * @param {object} a
   * @param {string} a.allocationId        idempotency key for this allocation
   * @param {string} a.source               event type (x402_fee, ...)
   * @param {string} [a.refId]              link back to the originating event
   * @param {number} a.grossCreditUnits     positive integer credit units
   * @param {object} a.allocation           { treeFund, asimovLiquidity, platform } credit units
   * @param {object} a.policy               { treeFundBps, asimovLiquidityBps, platformBps }
   * @returns {Promise<object>} the persisted CreditFeeAllocation
   */
  async recordCreditFeeAllocation(a) {
    if (!a || !a.allocationId) throw new TreasuryError('allocationId required', 'VALIDATION');
    if (!a.source) throw new TreasuryError('source required', 'VALIDATION');
    assertCreditUnits(a.grossCreditUnits, 'grossCreditUnits');
    if (a.grossCreditUnits <= 0) {
      throw new TreasuryError('grossCreditUnits must be a positive integer', 'VALIDATION');
    }

    const alloc = a.allocation || {};
    for (const k of ['treeFund', 'asimovLiquidity', 'platform']) {
      assertCreditUnits(alloc[k] || 0, `allocation.${k}`);
    }
    const allocSum = (alloc.treeFund || 0) + (alloc.asimovLiquidity || 0) + (alloc.platform || 0);
    if (allocSum !== a.grossCreditUnits) {
      throw new TreasuryError(`allocation sum ${allocSum} != grossCreditUnits ${a.grossCreditUnits}`, 'SPLIT_MISMATCH');
    }

    // The policy that produced the split must itself be a complete 10000 bps
    // policy — a partial policy would mean credits went missing between the
    // three buckets.
    const policy = a.policy || {};
    const bpsKeys = ['treeFundBps', 'asimovLiquidityBps', 'platformBps'];
    for (const k of bpsKeys) assertCreditUnits(policy[k], `policy.${k}`);
    const bpsSum = bpsKeys.reduce((acc, k) => acc + policy[k], 0);
    if (bpsSum !== 10000) {
      throw new TreasuryError(`policy must sum to 10000 bps (got ${bpsSum})`, 'BAD_POLICY');
    }

    return this.store.withLock(async (db) => {
      this._normalize(db);
      const prior = db.creditFeeAllocations.find((x) => x.allocationId === a.allocationId);
      if (prior) return { ...prior, replayed: true };

      db._seq = (db._seq || 0) + 1;
      const toCredits = (u) => Math.round(u) / CREDIT_UNIT_SCALE;
      const allocation = {
        treeFund: alloc.treeFund || 0,
        asimovLiquidity: alloc.asimovLiquidity || 0,
        platform: alloc.platform || 0,
      };
      const entry = {
        id: `cfa_${Date.now().toString(36)}_${db._seq}`,
        allocationId: a.allocationId,
        source: a.source,
        refId: a.refId || null,
        // ── unit labelling: unambiguous at every level ──────────────────
        unit: 'SHAD-Credits',
        currency: 'SHAD-Credits',
        creditUnitScale: CREDIT_UNIT_SCALE,
        grossCreditUnits: a.grossCreditUnits,
        grossCredits: toCredits(a.grossCreditUnits),
        allocation,                              // credit units
        allocationCredits: {                     // credits
          treeFund: toCredits(allocation.treeFund),
          asimovLiquidity: toCredits(allocation.asimovLiquidity),
          platform: toCredits(allocation.platform),
        },
        destinations: { ...CREDIT_FEE_DESTINATIONS },
        policy: {
          treeFundBps: policy.treeFundBps,
          asimovLiquidityBps: policy.asimovLiquidityBps,
          platformBps: policy.platformBps,
        },
        // The treeFund slice is a payment for planting and verification
        // services already rendered — the same securities-safe framing every
        // Treegens tree payment carries. It is NOT a token purchase and NOT a
        // donation. It is NOT recorded as a cents treePayment: no real money
        // changed hands, so the cents tree-payment ledger must stay clean.
        treeFundPayment: {
          serviceType: 'tree_planting',
          amountCreditUnits: allocation.treeFund,
          amountCredits: toCredits(allocation.treeFund),
          note: TREE_PAYMENT_NOTE,
          status: 'pending',
        },
        // No USD/USDC value is derived: there is no conversion rate to use.
        realMoneyValue: null,
        onchainIntentId: null,
        settlement: 'not_applicable',
        settlementNote: 'Closed-loop credits — no on-chain settlement and no USD/USDC conversion rate exists.',
        note: CREDITS_NOTE,
        status: 'pending',
        createdAt: new Date().toISOString(),
        settledAt: null,
      };
      db.creditFeeAllocations.push(entry);
      return { ...entry, replayed: false };
    });
  }

  /**
   * Record an INTENT to move money on-chain. The treasury never executes it.
   *
   * @param {object} i
   * @param {string} i.intentId         idempotency key
   * @param {string} i.chain            'solana' | 'hyperliquid' | 'treegens'
   * @param {string} i.kind             'asimov_liquidity' | 'tree_fund' | 'treasury_usdc'
   * @param {number} i.amount           integer minor units (cents / base units)
   * @param {string} i.currency         'USD' | 'USDC' | 'ASIMOV'
   * @param {string} [i.destination]    target address or wallet
   * @param {string} [i.refId]          link back to a settlement / payment id
   * @param {string} [i.memo]           human-readable note
   * @returns {Promise<object>} the persisted OnchainIntent
   */
  async queueOnchainIntent(i) {
    if (!i || !i.intentId) throw new TreasuryError('intentId required', 'VALIDATION');
    if (!i.chain) throw new TreasuryError('chain required', 'VALIDATION');
    if (!i.kind) throw new TreasuryError('kind required', 'VALIDATION');
    if (!Number.isInteger(i.amount) || i.amount <= 0) {
      throw new TreasuryError('amount must be a positive integer (minor units)', 'VALIDATION');
    }

    return this.store.withLock(async (db) => {
      this._normalize(db);
      const prior = db.onchainIntents.find((x) => x.intentId === i.intentId);
      if (prior) return { ...prior, replayed: true };

      db._seq = (db._seq || 0) + 1;
      const intent = {
        id: `ix_${Date.now().toString(36)}_${db._seq}`,
        intentId: i.intentId,
        chain: i.chain,
        kind: i.kind,
        amount: i.amount,
        currency: i.currency || 'USDC',
        destination: i.destination || null,
        refId: i.refId || null,
        memo: i.memo || null,
        status: 'pending',      // pending -> submitted -> confirmed | failed
        txId: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };
      db.onchainIntents.push(intent);
      return { ...intent, replayed: false };
    });
  }

  /**
   * Move an intent along its lifecycle. Only the status and the chain receipt
   * change — this records what the settler observed, it does not move money.
   *
   * @param {string} intentId
   * @param {string} status 'submitted' | 'confirmed' | 'failed'
   * @param {object} [detail] { txId, error }
   */
  async markOnchainIntent(intentId, status, detail = {}) {
    const allowed = ['pending', 'submitted', 'confirmed', 'failed'];
    if (!allowed.includes(status)) {
      throw new TreasuryError(`status must be one of ${allowed.join(', ')}`, 'VALIDATION');
    }
    return this.store.withLock(async (db) => {
      this._normalize(db);
      const intent = db.onchainIntents.find((x) => x.intentId === intentId);
      if (!intent) throw new TreasuryError(`unknown intentId ${intentId}`, 'NOT_FOUND');
      if (intent.status === 'confirmed') {
        throw new TreasuryError('intent is already confirmed and is immutable', 'CONFLICT');
      }
      intent.status = status;
      intent.txId = detail.txId || intent.txId;
      intent.error = detail.error || null;
      intent.updatedAt = new Date().toISOString();
      return { ...intent };
    });
  }

  /** List on-chain intents, newest first, optionally filtered. */
  async listOnchainIntents(filter = {}) {
    const db = this._normalize(await this.store.read());
    let list = db.onchainIntents;
    if (filter.status) list = list.filter((x) => x.status === filter.status);
    if (filter.chain) list = list.filter((x) => x.chain === filter.chain);
    if (filter.kind) list = list.filter((x) => x.kind === filter.kind);
    return list.slice().reverse().map((x) => ({ ...x }));
  }

  /** List tree payments, newest first, optionally filtered by payer. */
  async listTreePayments(filter = {}) {
    const db = this._normalize(await this.store.read());
    let list = db.treePayments;
    if (filter.payerUserId) list = list.filter((x) => x.payerUserId === filter.payerUserId);
    if (filter.plotId) list = list.filter((x) => x.plotId === filter.plotId);
    return list.slice().reverse().map((x) => ({ ...x }));
  }

  /**
   * List credits-denominated fee allocations, newest first. These are NOT
   * cents — see CREDITS_NOTE — and they are never mixed into the pools.
   */
  async listCreditFeeAllocations(filter = {}) {
    const db = this._normalize(await this.store.read());
    let list = db.creditFeeAllocations;
    if (filter.source) list = list.filter((x) => x.source === filter.source);
    if (filter.allocationId) list = list.filter((x) => x.allocationId === filter.allocationId);
    return list.slice().reverse().map((x) => ({ ...x }));
  }

  /** Pool balances snapshot (cents owed per pool) — for the admin treasury dashboard. */
  async getPools() {
    const db = this._normalize(await this.store.read());
    const out = {};
    for (const p of POOLS) out[p] = db.pools[p] || 0;
    return out;
  }

  /** Pending payout owed to a specific owner (cents). */
  async getOwnerOwed(ownerUserId) {
    const db = this._normalize(await this.store.read());
    return db.ownerPayouts[ownerUserId] || 0;
  }

  /** Full settlement list (admin). */
  async listSettlements() {
    const db = this._normalize(await this.store.read());
    return db.settlements.map((x) => ({ ...x }));
  }

  /**
   * The transparency report — the public-facing answer to "where does the fee
   * actually go?". This is the artifact that makes the fee-routing claim
   * checkable instead of marketing copy.
   */
  async getTransparencyReport() {
    const db = this._normalize(await this.store.read());
    const byStatus = { pending: 0, submitted: 0, confirmed: 0, failed: 0 };
    const byKind = {};
    for (const ix of db.onchainIntents) {
      byStatus[ix.status] = (byStatus[ix.status] || 0) + 1;
      byKind[ix.kind] = (byKind[ix.kind] || 0) + ix.amount;
    }
    let treeTotal = 0;
    let treeFundTotal = 0;
    let liquidityTotal = 0;
    for (const tp of db.treePayments) {
      treeTotal += tp.amount;
      treeFundTotal += tp.allocation.treeFund;
      liquidityTotal += tp.allocation.asimovLiquidity;
    }
    // Credits-denominated fee allocations — counted entirely separately from
    // every cents total above. Never added into pools/settlements/treePayments.
    let cfaCount = 0;
    let cfaGross = 0;
    let cfaTree = 0;
    let cfaLiquidity = 0;
    let cfaPlatform = 0;
    const cfaBySource = {};
    for (const c of db.creditFeeAllocations) {
      cfaCount += 1;
      cfaGross += c.grossCreditUnits || 0;
      cfaTree += (c.allocation && c.allocation.treeFund) || 0;
      cfaLiquidity += (c.allocation && c.allocation.asimovLiquidity) || 0;
      cfaPlatform += (c.allocation && c.allocation.platform) || 0;
      cfaBySource[c.source] = (cfaBySource[c.source] || 0) + (c.grossCreditUnits || 0);
    }
    return {
      generatedAt: new Date().toISOString(),
      currency: 'cents',
      currencies: {
        realMoney: 'cents (USD / USDC)',
        creditFeeRouting: 'SHAD-Credits (closed-loop soft currency — NOT cents, NOT USD, NOT USDC)',
      },
      pools: { ...db.pools },
      poolMeanings: {
        treasury: 'platform operating revenue',
        owner: 'owed to the agent/asset owner',
        referrer: 'owed to the referrer',
        eco: 'green initiative reserve — paid out to Treegens for real planting',
        partner: 'owed to a partner',
        asimovLiquidity: 'earmarked for deepening $ASIMOV liquidity (accounting bucket; settlement is a queued on-chain intent)',
      },
      treePayments: {
        count: db.treePayments.length,
        totalCents: treeTotal,
        treeFundCents: treeFundTotal,
        asimovLiquidityCents: liquidityTotal,
      },
      creditFeeRouting: {
        unit: 'SHAD-Credits',
        currency: 'SHAD-Credits',
        creditUnitScale: CREDIT_UNIT_SCALE,
        count: cfaCount,
        grossCredits: cfaGross / CREDIT_UNIT_SCALE,
        treeFundCredits: cfaTree / CREDIT_UNIT_SCALE,
        asimovLiquidityCredits: cfaLiquidity / CREDIT_UNIT_SCALE,
        platformCredits: cfaPlatform / CREDIT_UNIT_SCALE,
        bySourceCredits: Object.fromEntries(
          Object.entries(cfaBySource).map(([k, v]) => [k, v / CREDIT_UNIT_SCALE])
        ),
        // Machine-readable, not just prose: a reader (or a script) can tell
        // these numbers apart from the cents totals without reading a caveat.
        excludedFromRealMoneyTotals: true,
        realMoneyValue: null,
        note: CREDITS_NOTE,
        entries: db.creditFeeAllocations.slice(-50).reverse().map((x) => ({
          id: x.id,
          allocationId: x.allocationId,
          source: x.source,
          refId: x.refId,
          unit: x.unit,
          creditUnitScale: x.creditUnitScale,
          grossCredits: x.grossCredits,
          allocationCredits: x.allocationCredits,
          policy: x.policy,
          treeFundNote: x.treeFundPayment ? x.treeFundPayment.note : null,
          status: x.status,
          createdAt: x.createdAt,
        })),
      },
      onchainIntents: {
        total: db.onchainIntents.length,
        byStatus,
        byKind,
      },
      settlements: {
        total: db.settlements.length,
        pending: db.settlements.filter((s) => s.status === 'pending').length,
      },
      caveats: [
        'Amounts are what the platform OWES, not what has been paid out.',
        'This ledger records settlement INTENT for on-chain transfers; it does not move money.',
        'Illustrative averages, not site-specific predictions.',
        'Tree payments are payment for planting and verification services already rendered.',
        'creditFeeRouting totals are SHAD-Credits (closed-loop soft currency), NOT cents — they are excluded from pools, settlements and treePayments totals.',
        'No SHAD-Credits -> USD/USDC conversion rate exists in this codebase, so no real-money value is derived from a credits fee.',
      ],
    };
  }

  // NOTE: There is intentionally NO payout(), withdraw(), transfer(), or
  // settleToAccount() method. Cash-out is a separate, later sub-project.
}

module.exports = {
  TreasuryService,
  TreasuryError,
  POOLS,
  TREE_PAYMENT_NOTE,
  CREDITS_NOTE,
  CREDIT_UNIT_SCALE,
  CREDIT_FEE_DESTINATIONS,
};
