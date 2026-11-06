// x402-v2.js — wallet sessions + dynamic payTo + multi-chain settlement routing.
//   BACKWARD-COMPATIBLE: off-chain settlement still flows through the REAL existing
//   x402 ledger (POST /api/x402/charge). on-chain (base/solana) are stubs for now.
//   - resolvePayTo(sellerId)     → seller's payout target (stub: off-chain id for now)
//   - CHAIN_HANDLERS             → { offchain, base, solana } settlement adapters
//   - debit({chain,...})         → routes to the chosen chain handler
//   - createSession(wallet)      → signed HS256 JWT (1h) wallet session
//   - verifySession(token)       → decoded payload or null
const jwt = require('jsonwebtoken');
let _fetch = global.fetch;
try { if (typeof _fetch !== 'function') _fetch = require('node-fetch'); } catch (e) {}

const SECRET = process.env.X402_SECRET || 'shaddai-dev-secret';
const BASE = process.env.RENDER_EXTERNAL_URL || ('http://localhost:' + (process.env.PORT || 8099));

// resolvePayTo — map a sellerId to its payout target. For now the off-chain ledger
// keys ARE the sellerId, so we pass it through. (Future: look up the seller's wallet.)
function resolvePayTo(sellerId) {
  return sellerId;
}

// CHAIN_HANDLERS — one settlement adapter per chain. offchain is REAL (hits the ledger);
// base/solana are simulated stubs (no RPC calls) until on-chain settlement lands.
const CHAIN_HANDLERS = {
  // offchain — settle via the REAL x402 ledger over HTTP. Returns { chain, txId, balance }.
  async offchain(opts = {}) {
    const { user = 'guest', amount, reason, payee } = opts;
    const res = await _fetch(BASE + '/api/x402/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, amount, reason, payee }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data && data.error) || ('x402 charge failed (' + res.status + ')'));
      err.status = res.status; err.data = data;
      throw err;
    }
    return { chain: 'offchain', txId: (data.tx && data.tx.id) || null, balance: data.balance };
  },

  // base — STUB. Logs intent, returns a mock receipt. No chain RPC.
  base(opts = {}) {
    console.log('[x402-v2] base settlement intent (simulated):', JSON.stringify(opts));
    return { chain: 'base', txId: 'mock_' + Date.now(), status: 'simulated', note: 'on-chain settlement not yet implemented' };
  },

  // solana — STUB. Logs intent, returns a mock receipt. No chain RPC.
  solana(opts = {}) {
    console.log('[x402-v2] solana settlement intent (simulated):', JSON.stringify(opts));
    return { chain: 'solana', txId: 'mock_' + Date.now(), status: 'simulated', note: 'on-chain settlement not yet implemented' };
  },
};

// debit — route a settlement to the chosen chain handler. Throws on unknown chain.
function debit({ chain = 'offchain', ...opts } = {}) {
  const handler = CHAIN_HANDLERS[chain];
  if (!handler) throw new Error('unknown chain: ' + chain);
  return handler(opts);
}

// createSession — issue a signed HS256 JWT wallet session (1h). Returns token bundle.
function createSession(wallet_address) {
  const session_token = jwt.sign({ wallet: wallet_address }, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  return { session_token, expires_in: 3600, wallet_address };
}

// verifySession — verify+decode a wallet session token. Returns payload or null.
function verifySession(token) {
  try { return jwt.verify(token, SECRET); } catch (e) { return null; }
}

module.exports = { resolvePayTo, CHAIN_HANDLERS, debit, createSession, verifySession, BASE };
