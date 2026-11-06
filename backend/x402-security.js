// backend/x402-security.js
// ─────────────────────────────────────────────────────────────────────────
// SHADDAI Phase 0 · Item 2 — x402 payment-rail hardening (self-contained).
//
// Addresses the documented x402 attack classes (replay, binding, mis-auth,
// state-sync) + agent spending safety. Additive & back-compatible: callers
// without a nonce still work; budgets default generous. Wire into x402 routes.
//
//   isPaused() / setPaused(bool)         — admin kill-switch (persisted)
//   checkDailyBudget(user, amount)       — per-user daily spend cap
//   recordSpend(user, amount)            — track spend after a successful debit
//   checkReplay(key)                     — one-time nonce / idempotency guard
//   validateEnvelope(env, {did,endpoint})— signed-envelope binding (on-chain ready)
//   verifySettlement(txHash)             — on-chain settlement hook (never trust a header)
//   safeLogEntry({...})                  — PII-minimized ledger entry
//   TAKE_RATES                           — tiered platform take-rates
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Path is overridable so a test (or an operator with a different data root)
// can point the state file elsewhere. Default is unchanged.
const STATE_PATH = process.env.X402_SECURITY_STATE_FILE || path.join(__dirname, 'data', 'x402-security.json');
const ENVELOPE_TTL_MS = 5 * 60 * 1000;   // 5-min clock-skew / replay window
const DEFAULT_DAILY_LIMIT = 5000;         // SHAD-Credits per user per day (tune later; -1 = unlimited)

// Tiered platform take-rates (config for routes; economics unchanged until wired).
const TAKE_RATES = { firstParty: 1.0, agentHire: 0.12, marketplace: 0.07, portalToll: 0.03 };

function readState() { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (e) { return { paused: false, dailyLimits: {}, spend: {} }; } }
function writeState(s) { try { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch (e) {} }
function todayKey() { return new Date().toISOString().slice(0, 10); }

// ── admin kill-switch ────────────────────────────────────────────────────
function isPaused() { return !!readState().paused; }
function setPaused(v) { const s = readState(); s.paused = !!v; writeState(s); return s.paused; }

// ── per-user daily spending budget ───────────────────────────────────────
function dailyLimitFor(user) { const s = readState(); return (user in s.dailyLimits) ? s.dailyLimits[user] : DEFAULT_DAILY_LIMIT; }
function setDailyLimit(user, limit) { const s = readState(); s.dailyLimits[user] = Number(limit); writeState(s); return s.dailyLimits[user]; }
function spentToday(user) { const s = readState(); const day = s.spend[todayKey()] || {}; return day[user] || 0; }
function checkDailyBudget(user, amount) {
  const limit = dailyLimitFor(user);
  if (limit < 0) return { ok: true, limit, spent: spentToday(user) };   // -1 = unlimited
  const spent = spentToday(user);
  if (spent + Number(amount) > limit) return { ok: false, limit, spent, remaining: Math.max(0, limit - spent) };
  return { ok: true, limit, spent };
}
function recordSpend(user, amount) {
  const s = readState(); const day = todayKey();
  s.spend[day] = s.spend[day] || {};
  s.spend[day][user] = Math.round(((s.spend[day][user] || 0) + Number(amount)) * 100) / 100;
  const days = Object.keys(s.spend).sort(); while (days.length > 7) delete s.spend[days.shift()]; // keep 7 days
  writeState(s);
}

// ── replay / idempotency (in-memory TTL) ─────────────────────────────────
const _seen = new Map();
function _prune() { const now = Date.now(); for (const [k, exp] of _seen) if (now > exp) _seen.delete(k); }
function checkReplay(key, ttlMs = ENVELOPE_TTL_MS) {
  if (!key) return { ok: true, skipped: true };   // no nonce → not enforced (back-compat)
  _prune();
  if (_seen.has(key)) return { ok: false, reason: 'replay' };
  _seen.set(key, Date.now() + ttlMs);
  return { ok: true };
}

// ── signed-envelope validation (agent-to-agent / on-chain phase) ─────────
function validateEnvelope(env = {}, opts = {}) {
  const { expectedDid, expectedEndpoint } = opts;
  if (!env.nonce || !env.timestamp || !env.requestHash) throw new Error('envelope missing nonce/timestamp/requestHash');
  const skew = Math.abs(Date.now() - new Date(env.timestamp).getTime());
  if (!(skew < ENVELOPE_TTL_MS)) throw new Error('envelope timestamp expired or skewed');
  if (expectedDid && env.agentDid !== expectedDid) throw new Error('DID binding mismatch');
  if (expectedEndpoint && env.endpoint !== expectedEndpoint) throw new Error('endpoint binding mismatch');
  const envKey = 'env:' + crypto.createHash('sha256').update(JSON.stringify(env)).digest('hex');
  const r = checkReplay(envKey);
  if (!r.ok) throw new Error('replay detected');
  return true;
}

// ── on-chain settlement verification (never trust a header alone) ─────────
async function verifySettlement(txHash /*, opts */) {
  if (!txHash) return { verified: false, reason: 'off-chain credits mode (no txHash)' };
  // TODO on-chain phase: query Solana RPC / facilitator to confirm the tx settled
  // to TREASURY for >= amount before marking paid. Left as an explicit hook so no
  // code path silently trusts a client-supplied txHash.
  return { verified: false, reason: 'on-chain settlement verification not enabled yet', txHash };
}

// ── PII-minimized ledger entry (DID/user + endpoint + amount only) ───────
function safeLogEntry({ did, user, endpoint, amount, txHash, outcome } = {}) {
  return { at: Date.now(), id: did || user || 'anon', endpoint: endpoint || null,
    amount: amount == null ? null : Number(amount), txHash: txHash || null, outcome: outcome || 'ok' };
}

module.exports = {
  TAKE_RATES, isPaused, setPaused, dailyLimitFor, setDailyLimit, checkDailyBudget,
  recordSpend, spentToday, checkReplay, validateEnvelope, verifySettlement, safeLogEntry,
};
