'use strict';
/**
 * SHADDAI x402 — HTTP 402 micropayments for SCARCE COMPUTE only.
 * Implements the x402 standard (Coinbase): 402 -> { x402Version, accepts:[reqs] };
 * client retries with `X-PAYMENT` header; server verifies/settles, sets
 * `X-PAYMENT-RESPONSE`. x402 is the PRIMARY rail; MoonPay is the secondary option.
 *
 * SAFETY: dev-permissive. Charges NOTHING unless X402_ENABLED==='true'.
 * Free things (basic chat, free Pollinations images) are NOT listed here —
 * only scarce compute (premium models, real music, voice, premium image).
 */
const PRICED = {
  'chat.premium':   { path: '/api/llm/chat',        priceUsd: 0.001, description: 'Premium-model chat (Claude/GPT/Groq-70B)', mimeType: 'application/json' },
  'image.premium':  { path: '/api/image/generate',  priceUsd: 0.004, description: 'Premium image (Flux/NanoBanana/DALL·E)',   mimeType: 'image/*' },
  'music.make':     { path: '/api/agent/run',       priceUsd: 0.05,  description: 'AI music generation (Suno)',               mimeType: 'audio/*' },
  'voice.tts':      { path: '/api/agent/run',        priceUsd: 0.01, description: 'Voice synthesis / cloning (ElevenLabs)',   mimeType: 'audio/*' },
  'agent.hire':     { path: '/api/x402/agent',       priceUsd: 0.02,  description: 'Hire a SHADDAI agent to run a task',      mimeType: 'application/json' }
};

const X402_VERSION = 1; // x402 protocol version (v2 spec; field name `x402Version`)

// Default USDC asset contract addresses per network (overridable via X402_ASSET_ADDRESS).
const USDC_ADDRESS = {
  base:           '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  solana:         'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
};

function enabled()   { return process.env.X402_ENABLED === 'true'; }
function network()   { return process.env.X402_NETWORK || 'base'; }       // base | base-sepolia | solana
function asset()     { return process.env.X402_ASSET   || 'USDC'; }       // human-readable symbol
function assetAddress() {                                                 // v2 `asset` = token contract/mint address
  return process.env.X402_ASSET_ADDRESS || USDC_ADDRESS[network()] || USDC_ADDRESS.base;
}
function payTo()     { return process.env.X402_PAY_TO  || ''; }            // merchant wallet
function facilitator(){ return process.env.X402_FACILITATOR_URL || ''; }

// USDC has 6 decimals → atomic units string (x402 expects atomic amounts).
function usdToAtomic(usd) { return String(Math.round(Number(usd) * 1e6)); }

/**
 * Scheme-specific `extra` block (x402 v2). For EIP-3009/`exact` on EVM the
 * facilitator needs the ERC-20 token `name`/`version` for the EIP-712 domain.
 */
function extraFor() {
  const net = network();
  if (net === 'solana') return { feePayer: facilitator() || undefined };
  // EVM (base / base-sepolia): USDC EIP-712 domain hints.
  return { name: asset() === 'USDC' ? 'USD Coin' : asset(), version: '2' };
}

/** Build a single PaymentRequirements object (x402 v2 'exact' scheme). */
function paymentRequirements(key, resourceUrl) {
  const p = PRICED[key] || { priceUsd: 0.001, description: key, mimeType: 'application/json' };
  return {
    scheme: 'exact',
    network: network(),
    maxAmountRequired: usdToAtomic(p.priceUsd),
    resource: resourceUrl || '',
    description: p.description,
    mimeType: p.mimeType,
    payTo: payTo(),
    maxTimeoutSeconds: 60,
    asset: assetAddress(),
    extra: extraFor()
  };
}

/**
 * Build a PaymentRequirements object for hiring a specific agent.
 * Reuses the 'exact' scheme via paymentRequirements but overrides amount/description
 * so each agent + price can be advertised individually.
 */
function agentPaymentRequirements(agentName, priceUsd, resourceUrl) {
  const base = paymentRequirements('agent.hire', resourceUrl);
  return Object.assign({}, base, {
    maxAmountRequired: usdToAtomic(priceUsd == null ? PRICED['agent.hire'].priceUsd : priceUsd),
    description: `Hire agent ${agentName}`
  });
}

/** Discovery document — what's billable, discoverable before calling. */
function discovery() {
  return {
    x402Version: X402_VERSION,
    enabled: enabled(),
    network: network(),
    payTo: payTo() || null,
    facilitator: facilitator() || null,
    asset: asset(),
    assetAddress: assetAddress(),
    endpoints: Object.entries(PRICED).map(([key, p]) => ({
      resource: key, path: p.path, price: `$${p.priceUsd}`, priceUsd: p.priceUsd,
      maxAmountRequired: usdToAtomic(p.priceUsd),
      network: network(), asset: asset(), assetAddress: assetAddress(),
      mimeType: p.mimeType, description: p.description
    }))
  };
}

/**
 * Verify a submitted X-PAYMENT header.
 * - If a facilitator URL is configured → POST to its /verify (real settlement).
 * - Else (dev) → accept any non-empty header so flows can be exercised locally.
 */
async function verifyPayment(header, key, requirements) {
  const fac = facilitator();
  if (!fac) return Boolean(header); // dev-permissive
  try {
    const r = await fetch(fac.replace(/\/$/, '') + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: X402_VERSION, paymentHeader: header, paymentRequirements: requirements })
    });
    if (!r.ok) return false;
    const data = await r.json().catch(() => ({}));
    return data.isValid === true || data.valid === true;
  } catch { return false; }
}

/**
 * Express middleware factory. Gates a route behind x402 payment for `key`.
 * No-op (free) unless X402_ENABLED==='true'.
 */
function requirePayment(key) {
  return async (req, res, next) => {
    if (!enabled()) return next();
    const resourceUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const reqs = paymentRequirements(key, resourceUrl);
    const header = req.headers['x-payment'];
    if (!header) {
      return res.status(402).json({ x402Version: X402_VERSION, error: 'X-PAYMENT required', accepts: [reqs] });
    }
    const ok = await verifyPayment(header, key, reqs);
    if (!ok) {
      return res.status(402).json({ x402Version: X402_VERSION, error: 'payment invalid or unsettled', accepts: [reqs] });
    }
    // Settled — attach receipt header (base64 per x402).
    res.setHeader('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ settled: true, resource: key, network: network(), at: Date.now() })).toString('base64'));
    next();
  };
}

module.exports = { discovery, paymentRequirements, agentPaymentRequirements, requirePayment, verifyPayment, PRICED, X402_VERSION, enabled };
