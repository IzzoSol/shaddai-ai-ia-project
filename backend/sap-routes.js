'use strict';
/**
 * sap-routes.js — the Shaddai Asimov Project (SAP) green-initiative API.
 *
 * Exposes the SAP stack:
 *   - the fee-routing POLICY (what happens to every fee, in plain numbers)
 *   - the treasury TRANSPARENCY REPORT (what actually happened, in cents)
 *   - TREE PAYMENTS (pay for real planting; a receipt with a full breakdown)
 *   - HYPERLIQUID READS (markets, spot prices, fee tiers, account snapshots)
 *   - the HIP-1 DEPLOYMENT PLAN (so the token is ready when the auction is)
 *
 * DESIGN RULE — THE CHAIN NEVER MOVES MONEY FROM HERE.
 *   Every route in this file either RECORDS an intent or READS the chain.
 *   There is no route that places an order, signs a transaction, or transfers
 *   a token. Trading lives behind lib/hyperliquid.js's four-key gate and is
 *   not reachable from HTTP at all.
 */

const express = require('express');
const router = express.Router();
const json = express.json();

const { softAuth } = require('./auth-guard');
const { TreegensService, TreegensError, splitByPolicy, readPolicyFromEnv } = require('./services/treegens-service');
const { TreasuryError } = require('./services/treasury-service');
const HL = require('./lib/hyperliquid');
const HIP1 = require('./lib/hip1-deploy');

let _treegens = null;
function treegens() {
  if (!_treegens) _treegens = new TreegensService({});
  return _treegens;
}

let _economy = null;
function economy() {
  if (!_economy) {
    try { _economy = require('./economy-service').getDefault(); } catch (e) { _economy = null; }
  }
  return _economy;
}

const CAVEAT = 'Illustrative averages, not site-specific predictions.';

// ── HIP-1 deployment defaults ──────────────────────────────────────────────
//
// DEFAULT MAX SUPPLY for a SAP-native HIP-1 token: 1e17 wei, which at the
// default 8 weiDecimals is 1e9 whole tokens.
const DEFAULT_MAX_SUPPLY_WEI = '100000000000000000';

// The system address of a Core spot token, per the HyperCore <-> HyperEVM
// transfers doc: "the address with first byte 0x20 and the remaining bytes
// all zeros, except for the token index encoded in big-endian format."
// Index 200 -> 0x20000000000000000000000000000000000000c8.
function systemAddressForTokenIndex(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 0xffffffff) return null;
  return '0x20' + i.toString(16).padStart(38, '0');
}

// Used only when neither an explicit genesis address nor a configured
// deployer address is available. It is the canonical burn sink, so the
// failure mode of a plan that was executed without replacing it is
// "tokens burned", not "tokens sent to a stranger".
const PLACEHOLDER_GENESIS_ADDRESS = '0x000000000000000000000000000000000000dEaD';

// The next FREE Core spot token index, read from live spot metadata. Spot
// token indices are SPARSE (0..1308 with only 511 in use), so "next" is
// max+1, not length. Returns null when the metadata cannot be read, so the
// caller can degrade to a documented fallback instead of failing.
async function nextFreeSpotTokenIndex() {
  try {
    const meta = await HL.getSpotMeta({ timeoutMs: 3000 });
    const tokens = (meta && meta.tokens) || [];
    let max = -1;
    for (const t of tokens) {
      const i = Number(t && t.index);
      if (Number.isInteger(i) && i > max) max = i;
    }
    return max + 1;
  } catch (e) {
    return null;
  }
}

function fail(res, e) {
  const status = e instanceof TreegensError || e instanceof TreasuryError
    ? (e.code === 'NOT_FOUND' ? 404 : (e.code === 'VALIDATION' || e.code === 'BAD_POLICY' ? 400 : 422))
    : 500;
  return res.status(status).json({
    ok: false,
    error: e && e.message,
    code: e && e.code,
  });
}

// ─────────────────────────────── health ────────────────────────────────────

router.get('/api/sap/health', async (req, res) => {
  const hl = await HL.health();
  let policy = null;
  let policyError = null;
  try {
    policy = treegens().getPolicy();
  } catch (e) {
    policyError = e.message;
  }
  res.json({
    ok: true,
    project: 'S.A.P. — Shaddai Asimov Project',
    agent: 'Asimov (first sub-agent under QUILL — writing & education)',
    caveat: CAVEAT,
    hyperliquid: hl,
    policy: policy || null,
    policyError,
    notes: [
      'The treasury records settlement INTENT; it never moves money.',
      'Hyperliquid trading is gated behind four independent conditions and is not reachable from HTTP.',
    ],
  });
});

// ─────────────────────────────── policy ────────────────────────────────────

router.get('/api/sap/policy', (req, res) => {
  try {
    res.json({ ok: true, policy: treegens().getPolicy(), caveat: CAVEAT });
  } catch (e) { return fail(res, e); }
});

/** Preview how a given fee would be split, without recording anything. */
router.get('/api/sap/policy/preview', (req, res) => {
  try {
    const cents = Number(req.query.amountCents);
    if (!Number.isInteger(cents) || cents < 0) {
      return res.status(400).json({ ok: false, error: 'amountCents must be a non-negative integer' });
    }
    const policy = treegens().policy;
    res.json({ ok: true, amountCents: cents, split: splitByPolicy(cents, policy), policy: treegens().getPolicy() });
  } catch (e) { return fail(res, e); }
});

// ────────────────────────────── treasury ───────────────────────────────────

router.get('/api/sap/treasury/report', async (req, res) => {
  try {
    res.json({ ok: true, report: await treegens().getTransparencyReport(), caveat: CAVEAT });
  } catch (e) { return fail(res, e); }
});

router.get('/api/sap/treasury/pools', async (req, res) => {
  try {
    res.json({ ok: true, pools: await treegens().treasury.getPools(), caveat: CAVEAT });
  } catch (e) { return fail(res, e); }
});

// ───────────────────────────── treegens ────────────────────────────────────

router.get('/api/sap/treegens/plots', (req, res) => {
  try {
    res.json({ ok: true, plots: treegens().listPlots(), caveat: CAVEAT });
  } catch (e) { return fail(res, e); }
});

router.post('/api/sap/treegens/pay', softAuth, json, async (req, res) => {
  try {
    const body = req.body || {};
    // Anti-drain, same shape as /api/x402/charge: a signed-in caller can only
    // pay from their OWN account; body.user is the unauthenticated demo path.
    const payerUserId = req.userId ? String(req.userId) : String(body.user || '');
    if (!payerUserId) {
      return res.status(400).json({ ok: false, error: 'payerUserId required' });
    }
    const paymentId = String(body.paymentId || body.nonce || '');
    if (!paymentId) {
      return res.status(400).json({ ok: false, error: 'paymentId (idempotency key) required' });
    }
    const receipt = await treegens().payForTrees({
      paymentId,
      payerUserId,
      plotId: body.plotId ? String(body.plotId) : undefined,
      stems: Number.isInteger(body.stems) ? body.stems : undefined,
      amountCents: Number.isInteger(body.amountCents) ? body.amountCents : undefined,
      currency: body.currency === 'USDC' ? 'USDC' : 'USD',
      sparksAmount: Number.isInteger(body.sparksAmount) ? body.sparksAmount : undefined,
      treegensProof: body.treegensProof ? String(body.treegensProof) : undefined,
    }, { economy: economy() });
    res.json(receipt);
  } catch (e) { return fail(res, e); }
});

router.get('/api/sap/treegens/payments', softAuth, async (req, res) => {
  try {
    const payerUserId = req.userId ? String(req.userId) : String(req.query.user || '');
    if (!payerUserId) return res.status(400).json({ ok: false, error: 'payerUserId required' });
    const payments = await treegens().treasury.listTreePayments({ payerUserId });
    res.json({ ok: true, payerUserId, payments, caveat: CAVEAT });
  } catch (e) { return fail(res, e); }
});

// ─────────────────────────── hyperliquid ───────────────────────────────────

router.get('/api/sap/hyperliquid/markets', async (req, res) => {
  try {
    const [perps, mids] = await Promise.all([HL.getPerpMeta(), HL.getAllMids()]);
    const perpsWithMid = perps.map((p) => ({
      name: p.name,
      szDecimals: p.szDecimals,
      pxDecimals: p.pxDecimals,
      maxLeverage: p.maxLeverage,
      midPx: mids ? mids[p.name] : null,
    }));
    res.json({
      ok: true,
      network: HL.isTestnet() ? 'testnet' : 'mainnet',
      perpMarkets: perpsWithMid,
      count: perpsWithMid.length,
      caveat: CAVEAT,
    });
  } catch (e) { return fail(res, e); }
});

/**
 * Spot token lookup. This is the endpoint that answers the key question:
 * "is $ASIMOV listable here?" — currently it is NOT on Hyperliquid spot.
 */
router.get('/api/sap/hyperliquid/spot', async (req, res) => {
  try {
    const token = req.query.token ? String(req.query.token) : null;
    if (token) {
      const found = await HL.getSpotPrice(token);
      return res.json({
        ok: true,
        network: HL.isTestnet() ? 'testnet' : 'mainnet',
        token: found,
        listed: !!found,
        caveat: CAVEAT,
      });
    }
    const tokens = await HL.getSpotTokens();
    res.json({
      ok: true,
      network: HL.isTestnet() ? 'testnet' : 'mainnet',
      count: tokens.length,
      tokens: tokens.slice(0, Number(req.query.limit) || 100),
      caveat: CAVEAT,
    });
  } catch (e) { return fail(res, e); }
});

/** Account snapshot — READ ONLY. No key, no signing, no orders. */
router.get('/api/sap/hyperliquid/account/:address', async (req, res) => {
  try {
    const address = req.params.address;
    const [perp, spot, role] = await Promise.all([
      HL.getClearinghouseState(address).catch(() => null),
      HL.getSpotClearinghouseState(address).catch(() => null),
      HL.getUserRole(address).catch(() => 'unknown'),
    ]);
    res.json({ ok: true, address, role, perp, spot, readOnly: true, caveat: CAVEAT });
  } catch (e) { return fail(res, e); }
});

/** The address's ACTUAL Hyperliquid fee tier — used to quote real costs. */
router.get('/api/sap/hyperliquid/fees/:address', async (req, res) => {
  try {
    const fees = await HL.getUserFees(req.params.address);
    res.json({ ok: true, address: req.params.address, fees, caveat: CAVEAT });
  } catch (e) { return fail(res, e); }
});

// ───────────────────────────── HIP-1 plan ──────────────────────────────────

/**
 * Preview the HIP-1 + HIP-2 deployment plan for a SAP-native token.
 * Plans and validates; it never signs or broadcasts.
 */
router.get('/api/sap/hip1/plan', async (req, res) => {
  try {
    // HIP-1 caps the token NAME at 6 alphanumeric characters. The previous
    // default was "SAPCOIN" (7), so this route 400'd on every call that did
    // not override the name. "ASIMOV" is exactly 6 and is the project's own
    // name, so the route now works with no query string at all.
    const name = String(req.query.name || 'ASIMOV');
    const szDecimals = Number(req.query.szDecimals || 2);
    const weiDecimals = Number(req.query.weiDecimals || 8);

    // ── The supply / genesis invariant ────────────────────────────────────
    //
    // lib/hip1-deploy.js enforces ONE hard rule, and it is deliberately NOT
    // relaxed here:
    //
    //     maxSupplyWei === total(user-genesis allocation)
    //
    // The route's defaults used to disagree with it -- maxSupplyWei defaulted
    // to 1e17 while the genesis list defaulted to EMPTY -- so every call
    // without parameters 400'd with HIP1_SUPPLY_MISMATCH.
    //
    // The two are two views of ONE number, so whichever the caller states is
    // authoritative and the other is derived from it. Stating BOTH with
    // different values is a genuine conflict and still 400s, which is right.
    const requestedMaxSupply = req.query.maxSupplyWei ? String(req.query.maxSupplyWei) : null;
    const requestedGenesisWei = req.query.genesisWei ? String(req.query.genesisWei) : null;
    const genesisWei = requestedGenesisWei || requestedMaxSupply || DEFAULT_MAX_SUPPLY_WEI;
    const maxSupplyWei = requestedMaxSupply || genesisWei;

    // ── The genesis address default ───────────────────────────────────────
    //
    // HIP-1's own documentation names the simplest setup: "For the simplest
    // setup, during the genesis step, the deployer can put the max supply
    // ... in the system address."
    //
    //   -- HIP-1: Native token standard
    //
    // and the system address of a Core spot token is "the address with first
    // byte 0x20 and the remaining bytes all zeros, except for the token
    // index encoded in big-endian format" (e.g. index 200 ->
    // 0x20000000000000000000000000000000000000c8).
    //
    //   -- HyperCore <-> HyperEVM transfers
    //
    // Precedence: an explicit ?genesisAddress= always wins; then a configured
    // HYPERLIQUID_ACCOUNT_ADDRESS (a concrete, operator-chosen holder); then
    // the system address of the next free spot token index (protocol-canonical
    // but PROVISIONAL, because the index is only assigned when step 1 lands).
    const warnings = [];
    let genesisAddress = req.query.genesisAddress ? String(req.query.genesisAddress) : null;
    if (!genesisAddress) {
      const configured = process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
      if (configured) {
        genesisAddress = String(configured);
        warnings.push(
          `genesis defaults to HYPERLIQUID_ACCOUNT_ADDRESS (${genesisAddress}) -- the max supply lands there. ` +
          `Pass ?genesisAddress= to allocate it elsewhere, including the token's system address.`
        );
      } else {
        const nextIndex = await nextFreeSpotTokenIndex();
        if (nextIndex != null) {
          genesisAddress = systemAddressForTokenIndex(nextIndex);
          warnings.push(
            `genesis defaults to the SYSTEM ADDRESS of spot token index ${nextIndex} (${genesisAddress}) -- ` +
            `HIP-1's documented "simplest setup". The index is PROVISIONAL: it is assigned when step 1 ` +
            `(registerToken2) lands, so re-derive this address from the step-1 response before executing.`
          );
        } else {
          genesisAddress = PLACEHOLDER_GENESIS_ADDRESS;
          warnings.push(
            'REPLACE THIS GENESIS ADDRESS BEFORE EXECUTING: spot metadata was unreachable and ' +
            'HYPERLIQUID_ACCOUNT_ADDRESS is unset, so the plan fell back to a placeholder burn address.'
          );
        }
      }
    }
    const genesisUsers = [[genesisAddress, genesisWei]];

    const plan = HIP1.buildDeployPlan({
      token: { name, szDecimals, weiDecimals },
      maxSupplyWei,
      genesisUsers,
      quoteTokenIndex: Number(req.query.quoteTokenIndex || 0),
      startPx: req.query.startPx || '1.0',
      orderSz: req.query.orderSz || '100',
      nOrders: Number(req.query.nOrders || 20),
      nSeededLevels: Number(req.query.nSeededLevels || 5),
      fullName: req.query.fullName || 'Shaddai Asimov Project',
    });
    res.json({ ok: true, plan, warnings, feeSideMatrix: HIP1.FEE_SIDE_MATRIX, caveat: CAVEAT });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e && e.message, code: e && e.code, details: e && e.details });
  }
});

/** Live spot-pair deployment auction (31-hour Dutch auction, 500 HYPE floor). */
router.get('/api/sap/hip1/auction', async (req, res) => {
  try {
    const [spot, perp] = await Promise.all([
      HL.getSpotAuctionStatus().catch(() => null),
      HL.getPerpAuctionStatus().catch(() => null),
    ]);
    res.json({
      ok: true,
      network: HL.isTestnet() ? 'testnet' : 'mainnet',
      spotAuction: spot,
      perpAuction: perp,
      model: {
        durationSeconds: HIP1.AUCTION_DURATION_SECONDS,
        durationHours: HIP1.AUCTION_DURATION_SECONDS / 3600,
        floorHype: HIP1.AUCTION_FLOOR_HYPE,
      },
      caveat: CAVEAT,
    });
  } catch (e) { return fail(res, e); }
});

module.exports = router;
module.exports.router = router;
