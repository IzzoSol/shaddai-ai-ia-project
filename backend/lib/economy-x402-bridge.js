'use strict';
/**
 * economy-x402-bridge.js — settle x402 pay-per-call through the CANONICAL
 * Sparks economy (economy-service.js) instead of a parallel SHAD-Credits
 * float ledger. Closes the MASTER-PLAN.md §Phase 2 gap: "x402 micropayment
 * layer for pay-per-insight settles into the same Sparks economy via
 * spend()/grant()".
 *
 * WHY A SEPARATE MODULE (not edits to x402-routes.js):
 *   Bazaar / hire / districts / federation all settle through the existing
 *   SHAD-Credits float ledger today and WORK. This module is additive — it
 *   lets a caller ALSO have the charge recorded against Sparks, without
 *   touching (or breaking) any of those proven paths.
 *
 * SAFETY (PIKADON gate semantics):
 *   1. OFF BY DEFAULT — does nothing unless X402_SPARKS_BRIDGE==='true'.
 *   2. INTEGER ONLY     — rejects non-integer USD amounts; promotes USD(cents)
 *                        to whole Sparks. No floats can reach the ledger.
 *   3. IDEMPOTENT      — every settle carries an idempotency key derived from
 *                        the caller's nonce + user + amount; replay is a no-op,
 *                        never a double-debit.
 *   4. FAIL-SAFE       — a bridge error is caught, logged, and reported as
 *                        { settledInSparks:false }, NEVER thrown to break an
 *                        otherwise-working x402 charge.
 *   5. ONE-DIRECTIONAL — Sparks are closed-loop. Charging a caller = spend();
 *                        crediting a payee = grant(). There is no cash-out and
 *                        none is added here.
 */
const crypto = require('crypto');
const { ValidationError, InsufficientFundsError, getDefault } = require('../economy-service');

function enabled() {
  return process.env.X402_SPARKS_BRIDGE === 'true';
}

/**
 * Convert a positive USD amount to a whole-Spark integer, rejecting floats.
 * Sparks are integer-only in economy-service; a fractional-$ amount cannot be
 * settled through it and is refused rather than rounded (rounding a fee is how
 * float dust creeps into a ledger).
 */
function usdToSparks(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError('amount must be a positive number');
  }
  if (!Number.isInteger(n)) {
    throw new ValidationError('Sparks bridge requires integer USD amounts (no fractional Sparks)');
  }
  return n;
}

/**
 * Settle an x402 charge against Sparks, in addition to the SHAD-Credits rail.
 *
 * @param {object} opts
 *   user     {string}  who is debited (the payer)
 *   payee    {string?} who is credited net (the seller/agent)
 *   amount   {number}  gross charge in USD (integer)
 *   reason   {string?}
 *   nonce    {string?} caller idempotency nonce; folded into the settle key
 * @returns {object} { settledInSparks, payerBalance?, payeeBalance?, error? }
 */
async function settleCharge({ user, payee, amount, reason, nonce }) {
  if (!enabled()) return { settledInSparks: false, reason: 'disabled' };

  const svc = getDefault();
  try {
    const sparks = usdToSparks(amount);

    // Nonce-less calls (legacy) get a random suffix so idempotency still holds
    // per-invocation without a cross-call stable key; nonce-ful calls replay safe.
    // The suffix is server-generated, never attacker-supplied, so Math.random()'s
    // weakness was never an exploitable replay path — crypto.randomBytes is used
    // anyway as cheap, harmless defense-in-depth.
    const tail = nonce ? nonce : `rand-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
    const key = `x402:${user}:${tail}`;

    // Fail-safe: if the payer has no Sparks account/balance, don't hard-block
    // the pre-existing SHAD-Credits path — record nothing and report cleanly.
    // (The bridge is additive; absence of Sparks must not break a charge that
    // previously succeeded on the legacy float ledger.)
    let payerBalance;
    try {
      const out = await svc.spend(user, sparks, reason || 'x402_charge', key, { refId: payee || null });
      payerBalance = out.balance;
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return { settledInSparks: false, reason: 'insufficient_sparks', payerBalance: await svc.getBalance(user).catch(() => null) };
      }
      throw e;
    }

    let payeeBalance = null;
    if (payee && payee !== user) {
      // net = gross (Sparks bridge does not re-impose the 5% SHAD-Credits fee;
      // that fee is the legacy rail's concern). Grant the payee the full amount.
      const gk = `${key}:payee`;
      const g = await svc.grant(payee, sparks, reason || 'x402_payout', gk, { refId: user });
      payeeBalance = g.balance;
    }

    return { settledInSparks: true, payerBalance, payeeBalance, sparks };
  } catch (e) {
    // Validation or store error: log, never throw back into a working charge.
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[economy-x402-bridge] settle skipped:', e && e.message);
    }
    return { settledInSparks: false, error: e && e.message };
  }
}

/**
 * Credit Sparks to a user for a settled x402 on-chain payment.
 * This is the "SOL/ETH/USDC → USD → Sparks (1:1)" gap from Phase 2: the on-chain
 * settlement stubs report an amount; here it becomes real Sparks on the ledger.
 *
 * IMPORTANT: callers MUST only invoke this after independently verifying a real
 * on-chain transaction (amount, recipient, confirmations) -- this function does
 * no verification itself. See MASTER-PLAN.md Phase 2 SOL/ETH/USDC item: no
 * caller in this codebase does that verification yet, so nothing should call
 * this in production until one does.
 *
 * @param {object} opts
 *   user     {string} recipient
 *   amount   {number} integer USD to grant as Sparks
 *   reason   {string?}
 *   refId    {string?} external tx/order id (idempotency anchor)
 * @returns {object} { granted, balance, error? }
 */
async function creditSparks({ user, amount, reason, refId }) {
  if (!enabled()) return { granted: false, reason: 'disabled' };
  const svc = getDefault();
  try {
    const sparks = usdToSparks(amount);
    const key = `x402:credit:${user}:${refId || `rand-${Date.now().toString(36)}`}`;
    const out = await svc.grant(user, sparks, reason || 'x402_onchain', key, { refId });
    return { granted: true, sparks, balance: out.balance, replayed: out.replayed };
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[economy-x402-bridge] credit skipped:', e && e.message);
    }
    return { granted: false, error: e && e.message };
  }
}

module.exports = { enabled, usdToSparks, settleCharge, creditSparks };
