'use strict';
/**
 * treegens-service.js — the SAP green-initiative orchestration layer.
 *
 * This is the piece that turns "a user paid for a tree" into three things that
 * can be audited:
 *
 *   1. a TREASURY RECORD   — the money is split into a tree fund, an $ASIMOV
 *                            liquidity bucket, and platform revenue, and all
 *                            three land in the treasury ledger's pools.
 *   2. an ON-CHAIN INTENT  — a queued instruction for the settler to move the
 *                            tree fund to the Treegens treasury wallet and the
 *                            liquidity slice to the $ASIMOV pool on Solana.
 *   3. a RECEIPT           — the payer gets a human-readable breakdown, with
 *                            the caveat that the on-chain legs are pending.
 *
 * WHY THE ON-CHAIN LEG IS AN INTENT AND NOT A TRANSFER
 *   Three concrete reasons, not caution for its own sake:
 *     - Hyperliquid geoblocks US residents, so the venue cannot be assumed
 *       available to this project's users.
 *     - Token-linked rewards invite a Howey securities analysis; routing fees
 *       into a project's own token liquidity is exactly the shape regulators
 *       look at.
 *     - Routing a project's own users' flow through its own pool to build TVL
 *       is wash-trading-shaped. The Hyperliquid-native answer (HIP-1 base-side
 *       deployer fee share + HIP-2 Hyperliquidity) is protocol-recognised and
 *       does not have that problem — but it costs a 500 HYPE auction floor and
 *       only applies to a token deployed on HyperCore.
 *   So the ledger records, a reviewed settler decides, and nothing pretends to
 *   have moved money that has not.
 *
 * WHERE $ASIMOV ACTUALLY LIVES
 *   $ASIMOV is a Solana Token-2022 mint
 *   (DaFB3rooEtLMoQh9P8xAkSUeJ8utuh3VBfwnZAaysCXC), 6 decimals, supply
 *   999,798,654.675747, mint authority revoked, ~44 holders, ~$1.6K liquidity
 *   as of 2026-11-04. It is NOT listed on Hyperliquid spot. Therefore the
 *   liquidity leg routes to a Solana venue, and Hyperliquid is the USDC
 *   treasury rail plus a future HIP-1 venue for a SAP-native token.
 */

const path = require('path');
const fs = require('fs');
const { TreasuryService, TreasuryError } = require('./treasury-service');

const BPS = 10000;

/**
 * Default fee-routing policy. Basis points of every fee that lands in the
 * SAP green initiative.
 *
 *   treeFund         40% -> Treegens, for real planting and verification
 *   asimovLiquidity  40% -> $ASIMOV liquidity on Solana
 *   platform         20% -> runs the platform
 *
 * Overridable via env (must sum to exactly 10000):
 *   SAP_TREE_FUND_BPS, SAP_ASIMOV_LIQUIDITY_BPS, SAP_PLATFORM_BPS
 */
const DEFAULT_POLICY = { treeFundBps: 4000, asimovLiquidityBps: 4000, platformBps: 2000 };

class TreegensError extends Error {
  constructor(message, code) { super(message); this.name = 'TreegensError'; this.code = code || 'TREEGENS_ERROR'; }
}

function readPolicyFromEnv(env = process.env) {
  // An empty-string env var (a common artefact of a .env line like `SAP_TREE_FUND_BPS=`)
  // must be treated as UNSET, not as 0 bps. `??` does not fire on the empty
  // string, so the guard is explicit.
  const raw = (key, fallback) => {
    const v = env[key];
    if (v === undefined || v === null) return fallback;
    const s = String(v).trim();
    if (s === '') return fallback;
    return Number(s);
  };
  const p = {
    treeFundBps: raw('SAP_TREE_FUND_BPS', DEFAULT_POLICY.treeFundBps),
    asimovLiquidityBps: raw('SAP_ASIMOV_LIQUIDITY_BPS', DEFAULT_POLICY.asimovLiquidityBps),
    platformBps: raw('SAP_PLATFORM_BPS', DEFAULT_POLICY.platformBps),
  };
  for (const k of Object.keys(p)) {
    if (!Number.isInteger(p[k]) || p[k] < 0) {
      throw new TreegensError(`${k} must be a non-negative integer (bps)`, 'BAD_POLICY');
    }
  }
  if (p.treeFundBps + p.asimovLiquidityBps + p.platformBps !== BPS) {
    throw new TreegensError(
      `policy must sum to ${BPS} bps (got ${p.treeFundBps + p.asimovLiquidityBps + p.platformBps})`,
      'BAD_POLICY'
    );
  }
  return p;
}

/**
 * Split an integer cent amount by a bps policy with NO lost or invented cents.
 * Remainder (at most a couple of cents, from integer division) goes to the
 * platform bucket so the three parts always sum exactly to `amount`.
 */
function splitByPolicy(amountCents, policy) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new TreegensError('amountCents must be a non-negative integer', 'VALIDATION');
  }
  const treeFund = Math.floor((amountCents * policy.treeFundBps) / BPS);
  const liquidity = Math.floor((amountCents * policy.asimovLiquidityBps) / BPS);
  const platform = amountCents - treeFund - liquidity;
  return { treeFund, asimovLiquidity: liquidity, platform };
}

class TreegensService {
  /**
   * @param {object} opts
   * @param {TreasuryService} [opts.treasury]
   * @param {string} [opts.plotsFile]      local plot registry
   * @param {object} [opts.policy]
   * @param {object} [opts.env]
   */
  constructor(opts = {}) {
    this.env = opts.env || process.env;
    this.policy = opts.policy || readPolicyFromEnv(this.env);
    this.treasury = opts.treasury || new TreasuryService({ filePath: opts.treasuryFile });
    this.plotsFile = opts.plotsFile || path.join(__dirname, '..', 'data', 'sap-plots.json');
    this._plots = null;
  }

  /** Local plot registry. Seeded with Treegens-style mangrove restoration plots. */
  listPlots() {
    if (this._plots) return this._plots.slice();
    let raw = [];
    try {
      raw = JSON.parse(fs.readFileSync(this.plotsFile, 'utf8'));
    } catch (e) {
      raw = [];
    }
    const plots = Array.isArray(raw) ? raw : (raw.plots || []);
    this._plots = plots.map((p) => ({
      plotId: p.plotId || p.id,
      name: p.name || p.plotId || p.id,
      region: p.region || null,
      ecosystem: p.ecosystem || 'mangrove',
      areaHa: p.areaHa != null ? p.areaHa : null,
      stemsAvailable: p.stemsAvailable != null ? p.stemsAvailable : null,
      priceCentsPerStem: p.priceCentsPerStem != null ? p.priceCentsPerStem : 240,
      verification: p.verification || 'Treegens Proof of Tree (before/after video, GPS, community check)',
      status: p.status || 'open',
      source: p.source || 'treegens-adapter',
    }));
    return this._plots.slice();
  }

  getPlot(plotId) {
    return this.listPlots().find((p) => p.plotId === plotId) || null;
  }

  /** The active allocation policy, in both bps and percent, for transparency. */
  getPolicy() {
    const p = this.policy;
    return {
      treeFundBps: p.treeFundBps,
      asimovLiquidityBps: p.asimovLiquidityBps,
      platformBps: p.platformBps,
      percent: {
        treeFund: p.treeFundBps / 100,
        asimovLiquidity: p.asimovLiquidityBps / 100,
        platform: p.platformBps / 100,
      },
      destinations: {
        treeFund: 'Treegens — real mangrove planting and Proof-of-Tree verification',
        asimovLiquidity: '$ASIMOV liquidity on Solana (mint DaFB3rooEtLMoQh9P8xAkSUeJ8utuh3VBfwnZAaysCXC)',
        platform: 'SHADDAI platform operations',
      },
      caveat: 'Illustrative averages, not site-specific predictions. Allocation is a policy, not a promise of on-chain settlement timing.',
    };
  }

  /**
   * Pay for trees on a plot.
   *
   * @param {object} p
   * @param {string} p.paymentId        idempotency key (required)
   * @param {string} p.payerUserId      who is paying (required)
   * @param {string} [p.plotId]
   * @param {number} [p.stems]
   * @param {number} [p.amountCents]    integer cents; derived from stems when omitted
   * @param {string} [p.currency]       'USD' | 'USDC'
   * @param {number} [p.sparksAmount]   optional integer Sparks to debit as well
   * @param {object} [opts]
   * @param {object} [opts.economy]     economy-service-like {spend}
   * @returns {Promise<object>} receipt
   */
  async payForTrees(p, opts = {}) {
    if (!p || !p.paymentId) throw new TreegensError('paymentId required', 'VALIDATION');
    if (!p.payerUserId) throw new TreegensError('payerUserId required', 'VALIDATION');

    let plot = null;
    let stems = Number.isInteger(p.stems) ? p.stems : null;
    let amountCents = Number.isInteger(p.amountCents) ? p.amountCents : null;

    if (p.plotId) {
      plot = this.getPlot(p.plotId);
      if (!plot) throw new TreegensError(`unknown plotId ${p.plotId}`, 'NOT_FOUND');
      if (plot.status === 'closed') throw new TreegensError(`plot ${p.plotId} is closed`, 'PLOT_CLOSED');
      if (stems == null) stems = 1;
      if (amountCents == null) amountCents = stems * plot.priceCentsPerStem;
    }

    if (amountCents == null) {
      throw new TreegensError('amountCents (or a plotId with stems) is required', 'VALIDATION');
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new TreegensError('amountCents must be a positive integer', 'VALIDATION');
    }

    const allocation = splitByPolicy(amountCents, this.policy);

    // Optional Sparks leg. Sparks are the canonical closed-loop economy, so the
    // debit goes through economy-service — the only module allowed to write
    // money tables. It is idempotent on its own key.
    let sparksCharged = null;
    if (Number.isInteger(p.sparksAmount) && p.sparksAmount > 0) {
      const economy = opts.economy;
      if (!economy || typeof economy.spend !== 'function') {
        throw new TreegensError('a Sparks charge requires an economy service', 'NO_ECONOMY');
      }
      const key = `sap:tree:${p.paymentId}`;
      const out = await economy.spend(p.payerUserId, p.sparksAmount, `tree_payment:${p.plotId || 'unspecified'}`, key);
      sparksCharged = { amount: p.sparksAmount, balance: out.balance, replayed: !!out.replayed };
    }

    // 1) Record the money in the treasury (splits across the pools).
    const payment = await this.treasury.recordTreePayment({
      paymentId: p.paymentId,
      payerUserId: p.payerUserId,
      plotId: p.plotId || null,
      stems,
      amount: amountCents,
      currency: p.currency || 'USD',
      allocation,
      treegensProof: p.treegensProof || (plot ? `pending-proof-of-tree:${plot.plotId}` : null),
      serviceType: p.serviceType || 'tree_planting',
    });

    if (payment.replayed) {
      return this._receipt(payment, [], allocation, sparksCharged, { replayed: true });
    }

    // 2) Queue the on-chain intents. These are RECORDS, not transfers.
    const intents = [];
    const treegensWallet = this.env.TREEGENS_TREASURY_WALLET || null;
    if (allocation.treeFund > 0) {
      intents.push(await this.treasury.queueOnchainIntent({
        intentId: `tree:${p.paymentId}:treegens`,
        chain: 'treegens',
        kind: 'tree_fund',
        amount: allocation.treeFund,
        currency: p.currency || 'USD',
        destination: treegensWallet,
        refId: payment.id,
        memo: treegensWallet
          ? `Tree fund for ${p.plotId || 'unspecified'} (${stems || 0} stems)`
          : 'Tree fund — awaiting TREEGENS_TREASURY_WALLET configuration',
      }));
    }
    const liquidityVenue = this.env.ASIMOV_LIQUIDITY_VENUE || 'solana-amm';
    if (allocation.asimovLiquidity > 0) {
      // The venue constraints travel WITH the intent. A settler reading this
      // record must know HOW the destination may be used and what the
      // non-obvious limits are — otherwise "deepen liquidity" reads like an
      // ordinary add-liquidity call, and on this venue it is not one.
      //
      // `chain` stays the plain rail identifier ('solana-amm') so existing
      // settler-side filters keep matching. The precise venue mechanics live
      // in the route + note, which are carried in the memo.
      const liquidityRoute = this.env.ASIMOV_LIQUIDITY_ROUTE || 'unknown-route';
      const liquidityNote = this.env.ASIMOV_LIQUIDITY_NOTE
        || 'Venue mechanics not configured. Re-verify the destination before settling anything.';
      intents.push(await this.treasury.queueOnchainIntent({
        intentId: `tree:${p.paymentId}:asimov`,
        chain: liquidityVenue,
        kind: 'asimov_liquidity',
        amount: allocation.asimovLiquidity,
        currency: p.currency || 'USD',
        destination: this.env.ASIMOV_LIQUIDITY_POOL || null,
        refId: payment.id,
        memo: [
          `Deepen $ASIMOV liquidity on ${liquidityVenue} via ${liquidityRoute}.`,
          `Venue constraints: ${liquidityNote}`,
          'INTENT ONLY — a human-reviewed settler executes this. No HTTP route may trade or settle.',
        ].join(' '),
      }));
    }

    return this._receipt(payment, intents, allocation, sparksCharged, { replayed: false });
  }

  _receipt(payment, intents, allocation, sparksCharged, meta) {
    return {
      ok: true,
      replayed: !!meta.replayed,
      paymentId: payment.paymentId,
      paymentId_: payment.id,
      amountCents: payment.amount,
      currency: payment.currency,
      allocation: {
        treeFundCents: allocation.treeFund,
        asimovLiquidityCents: allocation.asimovLiquidity,
        platformCents: allocation.platform,
      },
      sparksCharged,
      onchainIntents: intents.map((i) => ({
        intentId: i.intentId,
        chain: i.chain,
        kind: i.kind,
        amount: i.amount,
        currency: i.currency,
        status: i.status,
        destination: i.destination,
      })),
      policy: this.getPolicy(),
      note: 'Illustrative averages, not site-specific predictions.',
      statement: 'Tree fund and liquidity slices are queued for on-chain settlement; they have not moved on-chain yet.',
    };
  }

  /** Transparency report from the treasury, plus the live policy. */
  async getTransparencyReport() {
    const report = await this.treasury.getTransparencyReport();
    return { ...report, policy: this.getPolicy() };
  }
}

module.exports = {
  TreegensService,
  TreegensError,
  DEFAULT_POLICY,
  readPolicyFromEnv,
  splitByPolicy,
  BPS,
};
