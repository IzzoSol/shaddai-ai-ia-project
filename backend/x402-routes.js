// x402-routes.js — off-chain credit ledger for SHADDAI World (x402 pay-per-call).
//   Hiring an agent, entering a paid portal, or unlocking premium debits credits here.
//   Off-chain now (USDC on Solana/Base later). 5% marketplace fee → treasury.
//   GET  /api/x402/balance?user=        — current credit balance
//   GET  /api/x402/txns?user=           — recent transactions
//   POST /api/x402/charge {user,amount,reason,payee}  — debit (402 if insufficient)
//   POST /api/x402/grant  {user,amount} — top-up credits (demo / purchase callback)
//
// ── SAP FEE ROUTING (additive, gated, off by default) ────────────────────────
//   With SAP_X402_FEE_ROUTING=1 the 5% marketplace fee is split by the SAME
//   40/40/20 policy the S.A.P. green initiative uses (treeFund 40% /
//   asimovLiquidity 40% / platform 20%) and recorded in the S.A.P. treasury.
//   The policy and the splitter are NOT duplicated here — they are imported
//   from services/treegens-service.js, so there is exactly one place where
//   the numbers live.
//
//   UNITS — the fee is in SHAD-Credits, a closed-loop soft currency. It is NOT
//   cents, NOT USD and NOT USDC, and the x402 rail mints 100 free demo credits
//   per wallet, so a credits balance can have no money behind it at all. There
//   is NO credits->USD conversion rate anywhere in this codebase, so no
//   real-money amount is ever derived from it. The split is therefore recorded
//   as a CREDITS allocation in its own collection with its own unit label, and
//   it never touches the treasury's cents pools. See treasury-service.js.
//
//   NOTHING MOVES. No route here places an order, signs a transaction or
//   transfers funds. The allocation is a bookkeeping record; the Hyperliquid
//   four-key gate (trading flag + private key + account address + SDK) and the
//   treasury's no-custody property are untouched.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const json = express.json();
const { requireAdmin, softAuth } = require('./auth-guard');
const X = require('./x402-security');   // Phase 0 #2: kill-switch / replay / budgets / PII-safe log
let sparksBridge = null; try { sparksBridge = require('./lib/economy-x402-bridge'); } catch (e) { /* bridge unavailable — additive only */ }
// The fee-routing policy and the splitter live with the green initiative that
// owns them. Imported, never copied, so an env override of the bps changes
// both paths at once.
const { splitByPolicy, readPolicyFromEnv } = require('./services/treegens-service');
const { TreasuryService, CREDIT_UNIT_SCALE } = require('./services/treasury-service');

const LEDGER_DEFAULT = path.join(__dirname, 'data', 'x402-ledger.json');
const START_CREDITS = 100;        // every new wallet starts with demo credits
const FEE_RATE = 0.05;            // 5% marketplace fee
const TREASURY = 'SHADDAI_TREASURY';

// SAP_X402_FEE_ROUTING — THE gate for the new behaviour. Default OFF: with the
// flag unset the legacy x402 behaviour below is byte-for-byte unchanged.
const SAP_FEE_ROUTING_FLAG = 'SAP_X402_FEE_ROUTING';

const read = () => { try { return JSON.parse(fs.readFileSync(ledgerPath(), 'utf8')); } catch (e) { return { balances: {}, txns: [] }; } };
const write = (d) => { try { fs.writeFileSync(ledgerPath(), JSON.stringify(d, null, 2)); } catch (e) {} };
const bal = (db, u) => (u in db.balances ? db.balances[u] : (db.balances[u] = START_CREDITS));

// Paths are resolved lazily so an operator (or a test) can point the ledgers
// somewhere else without reloading the module. Defaults are unchanged.
function ledgerPath() { return process.env.X402_LEDGER_FILE || LEDGER_DEFAULT; }

let _sapTreasury = null;
function sapTreasury() {
  if (!_sapTreasury) {
    const filePath = process.env.SAP_TREASURY_FILE;
    _sapTreasury = new TreasuryService(filePath ? { filePath } : {});
  }
  return _sapTreasury;
}

/** Is the SAP fee-routing behaviour switched on? Default OFF. */
function sapFeeRoutingEnabled(env = process.env) {
  const v = env[SAP_FEE_ROUTING_FLAG];
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true';
}

router.get('/api/x402/balance', (req, res) => {
  const user = String(req.query.user || 'guest');
  const db = read(); const balance = bal(db, user); write(db);
  res.json({ ok: true, user, balance, currency: 'SHAD-Credits' });
});

router.get('/api/x402/txns', (req, res) => {
  const user = String(req.query.user || 'guest'); const db = read();
  const txns = db.txns.filter(t => t.user === user || t.payee === user).slice(0, 30);
  res.json({ ok: true, user, txns });
});

// ───────────────────── SAP fee routing (additive + gated) ────────────────────
//
// Build the policy split for a marketplace fee. PURE — no I/O — so the credits
// ledger write below stays a single atomic-ish write and the treasury record
// can never delay or break the charge.
//
// Units: the fee is SHAD-Credits. It is converted to integer CREDIT UNITS
// (1 credit = CREDIT_UNIT_SCALE units) because the shared splitter is integer
// -only (it must never round a fee), and credits are carried to two decimals.
// The split is therefore exact: no unit is created or lost.
function buildSapFeeRouting({ fee, txId }) {
  const feeUnits = Math.round(Number(fee) * CREDIT_UNIT_SCALE);
  if (!Number.isFinite(feeUnits) || feeUnits <= 0) return null;   // nothing to route
  let policy;
  let split;
  try {
    // The SAME policy the green initiative uses — read from the same env vars,
    // validated by the same function. Nothing here re-declares 4000/4000/2000.
    policy = readPolicyFromEnv(process.env);
    split = splitByPolicy(feeUnits, policy);
  } catch (e) {
    // A malformed policy must never break a charge that already succeeded.
    console.warn('[x402] SAP fee routing skipped (invalid policy):', e && e.message);
    return null;
  }
  return {
    allocationId: `x402fee:${txId}:${crypto.randomBytes(6).toString('hex')}`,
    refId: txId,
    source: 'x402_fee',
    unit: 'SHAD-Credits',
    currency: 'SHAD-Credits',
    creditUnitScale: CREDIT_UNIT_SCALE,
    feeCredits: Number(fee),
    feeCreditUnits: feeUnits,
    allocation: {
      treeFund: split.treeFund,
      asimovLiquidity: split.asimovLiquidity,
      platform: split.platform,
    },
    allocationCredits: {
      treeFund: split.treeFund / CREDIT_UNIT_SCALE,
      asimovLiquidity: split.asimovLiquidity / CREDIT_UNIT_SCALE,
      platform: split.platform / CREDIT_UNIT_SCALE,
    },
    policy: {
      treeFundBps: policy.treeFundBps,
      asimovLiquidityBps: policy.asimovLiquidityBps,
      platformBps: policy.platformBps,
    },
  };
}

/**
 * Record the built split in the S.A.P. treasury as a CREDITS allocation.
 *
 * It writes to the treasury's OWN credits collection — never the cents pools,
 * never a cents settlement, never a cents tree payment. There is no
 * credits->USD rate in this codebase, so no real-money amount is derived and
 * no on-chain intent is queued: there is nothing on-chain to settle.
 *
 * Never throws: a treasury failure is reported, it does not fail the charge.
 */
async function recordSapFeeRouting(plan) {
  let treasury = null;
  let treasuryError = null;
  try {
    const rec = await sapTreasury().recordCreditFeeAllocation({
      allocationId: plan.allocationId,
      source: plan.source,
      refId: plan.refId,
      grossCreditUnits: plan.feeCreditUnits,
      allocation: plan.allocation,
      policy: plan.policy,
    });
    treasury = {
      allocationId: rec.allocationId,
      id: rec.id,
      unit: rec.unit,
      creditUnitScale: rec.creditUnitScale,
      status: rec.status,
      realMoneyValue: rec.realMoneyValue,
      onchainIntentId: rec.onchainIntentId,
      settlement: rec.settlement,
    };
  } catch (e) {
    treasuryError = (e && e.message) ? e.message : String(e);
    console.warn('[x402] SAP fee routing record failed (non-fatal):', treasuryError);
  }
  return {
    ...plan,
    treasury,
    treasuryError,
    note: 'Split by the S.A.P. fee-routing policy (treeFund 40% / asimovLiquidity 40% / platform 20%). '
      + 'Denominated in SHAD-Credits — a closed-loop soft currency, NOT cents and NOT real money. '
      + 'No credits->USD conversion rate exists, so no real-money value is derived and nothing moves on-chain.',
  };
}

// chargeCredits / grantCredits (2026-09-11): the actual ledger logic, factored
// out of the route handlers so an IN-PROCESS caller (e.g. hire-routes.js) can
// settle a charge directly instead of making an internal HTTP self-call to
// this same server. That self-call pattern silently lost the caller's real
// identity (no Authorization header is forwarded on a server-to-server
// fetch), so softAuth always saw an anonymous request and every such charge
// landed on the shared 'local' account regardless of who was actually
// paying -- correct now only because the caller passes an already-resolved,
// trusted `user` string straight into these functions, no HTTP hop involved.
async function chargeCredits({ user, amount, reason, payee, nonce }) {
  const amt = Number(amount);
  if (!(amt > 0)) return { status: 400, body: { error: 'amount must be a positive number' } };
  // ── Phase 0 #2 hardening ──
  if (X.isPaused()) return { status: 503, body: { error: 'x402 payments temporarily paused', gated: true } };
  if (nonce) { const rp = X.checkReplay('charge:' + user + ':' + nonce); if (!rp.ok) return { status: 409, body: { error: 'replay detected' } }; }
  const bud = X.checkDailyBudget(user, amt);
  if (!bud.ok) return { status: 402, body: { error: 'daily spend limit reached', x402: { limit: bud.limit, spent: bud.spent, remaining: bud.remaining, currency: 'SHAD-Credits' }, gated: true } };
  const db = read(); const balance = bal(db, user);
  if (balance < amt) {
    return { status: 402, body: { error: 'Insufficient SHAD-Credits.', x402: { required: amt, balance, currency: 'SHAD-Credits', topup: '/api/x402/grant' }, gated: true } };
  }
  const fee = Math.round(amt * FEE_RATE * 100) / 100;
  const net = Math.round((amt - fee) * 100) / 100;
  db.balances[user] = Math.round((balance - amt) * 100) / 100;
  if (payee) db.balances[payee] = Math.round((bal(db, payee) + net) * 100) / 100; // payee receives net
  db.balances[TREASURY] = Math.round((bal(db, TREASURY) + fee) * 100) / 100;       // treasury takes the fee
  const tx = { id: Date.now().toString(36), user, payee: payee || null, amount: amt, fee, net, reason: reason || 'agent call', at: Date.now() };
  db.txns.unshift(tx); db.txns = db.txns.slice(0, 1000);
  // ── SAP fee routing (additive + gated) ──────────────────────────────────
  // OFF by default. With the flag unset this is a no-op and the response body
  // is identical to the legacy shape. With the flag on, the fee is split by
  // the shared 40/40/20 policy and mirrored into the credits ledger as a
  // unit-labelled CREDITS allocation (the credits ledger stays the ledger for
  // credits; the treasury ledger is where the policy allocation is recorded).
  let feeRoutingPlan = null;
  if (sapFeeRoutingEnabled()) feeRoutingPlan = buildSapFeeRouting({ fee, txId: tx.id });
  if (feeRoutingPlan) {
    db.feeAllocations = Array.isArray(db.feeAllocations) ? db.feeAllocations : [];
    db.feeAllocations.unshift({
      id: tx.id,
      at: tx.at,
      source: feeRoutingPlan.source,
      unit: feeRoutingPlan.unit,
      currency: feeRoutingPlan.currency,
      creditUnitScale: feeRoutingPlan.creditUnitScale,
      grossCredits: feeRoutingPlan.feeCredits,
      grossCreditUnits: feeRoutingPlan.feeCreditUnits,
      allocationCredits: feeRoutingPlan.allocationCredits,
      allocationCreditUnits: feeRoutingPlan.allocation,
      policy: feeRoutingPlan.policy,
      note: 'SAP fee-routing policy split of the x402 marketplace fee, denominated in SHAD-Credits.',
    });
    db.feeAllocations = db.feeAllocations.slice(0, 1000);
  }
  write(db);
  X.recordSpend(user, amt);   // count against the daily budget
  // Record the allocation in the S.A.P. treasury. Non-fatal by construction.
  let feeRouting = null;
  if (feeRoutingPlan) feeRouting = await recordSapFeeRouting(feeRoutingPlan);
  // Phase 2: ADDITIVELY settle into the canonical Sparks economy. Off by default
  // (X402_SPARKS_BRIDGE). A failure here is logged and non-fatal — the legacy
  // SHAD-Credits charge above already succeeded and must still be reported.
  let settledInSparks = false;
  if (sparksBridge) {
    try {
      const bridgeResult = await sparksBridge.settleCharge({ user, payee, amount: amt, reason: reason || 'agent call', nonce });
      settledInSparks = !!(bridgeResult && bridgeResult.settledInSparks);
    } catch (e) { /* additive — ignore */ }
  }
  // Phase 2 premium routing: report Sparks balance & insufficiency non-fatally.
  // This is purely informational — the SHAD-Credits charge above already succeeded.
  let sparkBalance = null;
  let sparksInsufficient = false;
  if (sparksBridge && sparksBridge.enabled()) {
    try {
      const eco = require('./economy-service');
      const b = await eco.getDefault().getBalance(user);
      sparkBalance = b != null ? b : null;
      sparksInsufficient = b != null && b < amt;
    } catch (e) { /* non-fatal — never break the charge */ }
  }
  const body = { ok: true, charged: amt, fee, net, balance: db.balances[user], tx, settledInSparks, sparkBalance, sparksInsufficient };
  // `feeRouting` appears ONLY when the new behaviour actually ran, so the
  // flag-off response is exactly the legacy response.
  if (feeRouting) body.feeRouting = feeRouting;
  return { status: 200, body };
}

function grantCredits({ user, amount, reason }) {
  const amt = Number(amount);
  if (!(amt > 0)) return { status: 400, body: { error: 'amount must be a positive number' } };
  const db = read(); db.balances[user] = Math.round((bal(db, user) + amt) * 100) / 100;
  db.txns.unshift({ id: Date.now().toString(36), user, amount: amt, reason: reason || 'top-up', at: Date.now() }); write(db);
  return { status: 200, body: { ok: true, user, balance: db.balances[user], granted: amt } };
}

router.post('/api/x402/charge', softAuth, json, async (req, res) => {
  // Anti-drain: a signed-in caller can ONLY charge their OWN account — never name a
  // victim in the body. body.user is a fallback for the unauthenticated demo world.
  const user = req.userId ? String(req.userId) : String((req.body && req.body.user) || 'guest');
  const { amount, reason, payee, nonce } = req.body || {};
  const result = await chargeCredits({ user, amount, reason, payee, nonce });
  if (result.status === 200) {
    // Phase 0 #3: a successful paid call builds the caller's DID reputation.
    try { if (req.did) require('./services/reputation-service').recordAttestation(req.did, 'x402_success', 'success', { endpoint: '/api/x402/charge', amount: Number(amount), counterpartyDid: payee || null }); } catch (e) {}
  }
  res.status(result.status).json(result.body);
});

// Phase 0 #2: admin kill-switch for x402 (pause/resume all charges).
router.post('/api/x402/pause', requireAdmin, json, (req, res) => {
  const paused = X.setPaused(!!(req.body && req.body.paused));
  res.json({ ok: true, paused });
});

router.post('/api/x402/grant', requireAdmin, json, (req, res) => {
  const { user = 'guest', amount } = req.body || {};
  const result = grantCredits({ user, amount });
  res.status(result.status).json(result.body);
});

// Exposed as properties on the router (not a separate module.exports shape)
// so `require('./x402-routes')` keeps working exactly as before when mounted
// as Express middleware, while also letting an in-process caller like
// hire-routes.js settle a charge directly -- see the comment above
// chargeCredits for why that matters.
router.chargeCredits = chargeCredits;
router.grantCredits = grantCredits;
// The gate is exported so an operator (or a test) can ask "is the new
// behaviour on right now?" without reading process.env by hand.
router.sapFeeRoutingEnabled = sapFeeRoutingEnabled;

module.exports = router;
