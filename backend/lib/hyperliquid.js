'use strict';
/**
 * hyperliquid.js — Hyperliquid read-only market + account client.
 *
 * WHAT THIS IS
 *   A small, dependency-free client for Hyperliquid's public `info` API.
 *   Every function here is a READ and works with NO API key, NO private key
 *   and NO signing. That is deliberate: the SAP green-initiative treasury needs
 *   to see what the chain is doing before it is ever allowed to touch it.
 *
 * WHAT THIS IS NOT
 *   It is NOT a trading client. `placeOrder` / `placeSpotOrder` exist as
 *   explicit, hard-gated stubs that delegate to an optional SDK if one is
 *   installed, and REFUSE to hand-roll EIP-712 signing. Signing Hyperliquid
 *   actions wrong means signing the wrong order — a money bug we cannot
 *   regression-test against a live chain. Enabling real trading requires
 *   (a) an SDK, (b) HYPERLIQUID_TRADING_ENABLED=true, (c) a private key,
 *   (d) an account address. All four, or nothing happens.
 *
 * API SHAPES (verified live against api.hyperliquid.xyz, 2026-11-04)
 *   POST /info  {type:'meta'}                      -> {universe:[{name,szDecimals,pxDecimals,maxLeverage}], ...}
 *   POST /info  {type:'allMids'}                   -> { [coinName]: midPrice }
 *   POST /info  {type:'spotMeta'}                  -> {tokens:[{name,index,szDecimals,tokenId,evmContract,deployerTradingFeeShare}], universe:[...]}
 *   POST /info  {type:'spotMetaAndAssetCtxs'}      -> {meta:{tokens,universe}, ctx:[{midPx,markPx,dayNtlVlm,circulatingSupply}]}
 *   POST /info  {type:'clearinghouseState',user}   -> {marginSummary, withdrawable, assetPositions:[...]}
 *   POST /info  {type:'spotClearinghouseState',u}  -> {balances:[{coin,token,hold,total,evmContract,spotIndex}]}
 *   POST /info  {type:'openOrders',user}           -> [...]
 *   POST /info  {type:'predictedFundings'}         -> [...]
 *
 * NETWORK FACTS THAT MATTER FOR SAP (verified 2026-11-04)
 *   - USDC is a canonical Hyperliquid spot token, index 0.
 *   - $ASIMOV (Solana mint DaFB3rooEtLMoQh9P8xAkSUeJ8utuh3VBfwnZAaysCXC)
 *     is NOT listed on Hyperliquid spot. Any "fees to $ASIMOV liquidity" plan
 *     must therefore settle against the Solana venue where $ASIMOV actually
 *     lives. Hyperliquid is the USDC treasury rail + a future HIP-3 venue.
 *   - Spot tokens expose `deployerTradingFeeShare` — the chain-native hook for
 *     "some of the trading fee goes to the token's deployer/rewards".
 */

const DEFAULT_INFO_URL = 'https://api.hyperliquid.xyz/info';
const DEFAULT_EXCHANGE_URL = 'https://api.hyperliquid.xyz/exchange';
const TESTNET_INFO_URL = 'https://api.hyperliquid-testnet.xyz/info';
const TESTNET_EXCHANGE_URL = 'https://api.hyperliquid-testnet.xyz/exchange';

const DEFAULT_TIMEOUT_MS = 15000;

class HyperliquidError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'HyperliquidError';
    this.code = code || 'HL_ERROR';
    if (details !== undefined) this.details = details;
  }
}

function infoUrl() {
  if (process.env.HYPERLIQUID_INFO_URL) return process.env.HYPERLIQUID_INFO_URL;
  return process.env.HYPERLIQUID_TESTNET === 'true' ? TESTNET_INFO_URL : DEFAULT_INFO_URL;
}

function exchangeUrl() {
  if (process.env.HYPERLIQUID_EXCHANGE_URL) return process.env.HYPERLIQUID_EXCHANGE_URL;
  return process.env.HYPERLIQUID_TESTNET === 'true' ? TESTNET_EXCHANGE_URL : DEFAULT_EXCHANGE_URL;
}

function isTestnet() {
  return process.env.HYPERLIQUID_TESTNET === 'true';
}

/**
 * POST a JSON payload to the `info` endpoint and return the parsed body.
 * All `info` calls are read-only by definition.
 */
async function info(payload, opts = {}) {
  const timeout = Number(opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const url = opts.url || infoUrl();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HyperliquidError(
        `Hyperliquid info ${payload && payload.type} failed: HTTP ${res.status}`,
        'HL_HTTP_ERROR',
        { status: res.status, body: text.slice(0, 500) }
      );
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new HyperliquidError('Hyperliquid info returned non-JSON body', 'HL_BAD_JSON', { body: text.slice(0, 500) });
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new HyperliquidError(`Hyperliquid info ${payload && payload.type} timed out after ${timeout}ms`, 'HL_TIMEOUT');
    }
    if (e instanceof HyperliquidError) throw e;
    throw new HyperliquidError(`Hyperliquid info ${payload && payload.type} failed: ${e && e.message}`, 'HL_NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

// ────────────────────────────── market reads ──────────────────────────────

/** Perp market universe: [{name, szDecimals, pxDecimals, maxLeverage, onlyIsolated}] */
async function getPerpMeta(opts) {
  const m = await info({ type: 'meta' }, opts);
  return (m && m.universe) || [];
}

/** All perp mid prices: { BTC: '...' , ... } */
async function getAllMids(opts) {
  return await info({ type: 'allMids' }, opts);
}

/** Spot market metadata: { tokens:[...], universe:[...] } */
async function getSpotMeta(opts) {
  const m = await info({ type: 'spotMeta' }, opts);
  return {
    tokens: (m && m.tokens) || [],
    universe: (m && m.universe) || [],
  };
}

/**
 * Spot metadata AND per-pair context (mid/mark price, 24h volume, supply).
 * ctx is indexed by the spot universe pair index.
 */
async function getSpotMetaAndAssetCtxs(opts) {
  const m = await info({ type: 'spotMetaAndAssetCtxs' }, opts);
  return {
    meta: (m && m.meta) || { tokens: [], universe: [] },
    ctx: (m && m.ctx) || [],
  };
}

/**
 * All spot tokens with their live price resolved.
 * @returns {Array<{name,index,midPx,markPx,dayNtlVlm,szDecimals,tokenId,evmContract,deployerTradingFeeShare,pairName}>}
 */
async function getSpotTokens(opts) {
  const { meta, ctx } = await getSpotMetaAndAssetCtxs(opts);
  const tokens = meta.tokens || [];
  const universe = meta.universe || [];

  // Build pairIndex -> pairName so we can attribute a mid price to its tokens.
  const pairNameByIndex = new Map();
  const pairTokensByIndex = new Map();
  universe.forEach((u, i) => {
    pairNameByIndex.set(u.index != null ? u.index : i, u.name);
    pairTokensByIndex.set(u.index != null ? u.index : i, u.tokens || []);
  });

  const byIndex = new Map(tokens.map((t) => [t.index, t]));

  return universe.map((u, i) => {
    const idx = u.index != null ? u.index : i;
    const c = ctx[idx] || ctx[i] || {};
    const pair = {
      name: u.name,
      index: idx,
      midPx: c.midPx != null ? c.midPx : null,
      markPx: c.markPx != null ? c.markPx : null,
      prevDayPx: c.prevDayPx != null ? c.prevDayPx : null,
      dayNtlVlm: c.dayNtlVlm != null ? c.dayNtlVlm : null,
      circulatingSupply: c.circulatingSupply != null ? c.circulatingSupply : null,
      tokenIndices: u.tokens || [],
    };
    const out = [];
    for (const ti of u.tokens || []) {
      const t = byIndex.get(ti);
      if (!t) continue;
      out.push({
        ...t,
        pairName: pair.name,
        pairIndex: idx,
        midPx: pair.midPx,
        markPx: pair.markPx,
        dayNtlVlm: pair.dayNtlVlm,
      });
    }
    return out.length ? out : [];
  }).flat();
}

/**
 * Look up a single spot token by name (case-insensitive), with live price.
 * Returns null when the token is not listed on Hyperliquid spot.
 */
async function findSpotToken(name, opts) {
  if (!name) return null;
  const wanted = String(name).trim().toUpperCase();
  const tokens = await getSpotTokens(opts);
  return tokens.find((t) => String(t.name || '').toUpperCase() === wanted) || null;
}

/** Spot price for a token name, or null if unlisted / no price. */
async function getSpotPrice(name, opts) {
  const t = await findSpotToken(name, opts);
  if (!t) return null;
  return {
    name: t.name,
    index: t.index,
    pairName: t.pairName,
    midPx: t.midPx,
    markPx: t.markPx,
    prevDayPx: t.prevDayPx,
    dayNtlVlm: t.dayNtlVlm,
    szDecimals: t.szDecimals,
    tokenId: t.tokenId || null,
    evmContract: t.evmContract || null,
    deployerTradingFeeShare: t.deployerTradingFeeShare != null ? t.deployerTradingFeeShare : null,
  };
}

// ────────────────────────────── account reads ──────────────────────────────

function assertAddress(user) {
  if (typeof user !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(user.trim())) {
    throw new HyperliquidError('user must be a 0x-prefixed 20-byte hex address', 'HL_BAD_ADDRESS');
  }
  return user.trim();
}

/** Perp account state: margin summary, withdrawable, open positions. */
async function getClearinghouseState(user, opts) {
  return await info({ type: 'clearinghouseState', user: assertAddress(user) }, opts);
}

/** Spot account state: { balances:[{coin,token,hold,total,evmContract,spotIndex}] } */
async function getSpotClearinghouseState(user, opts) {
  return await info({ type: 'spotClearinghouseState', user: assertAddress(user) }, opts);
}

/** Open orders (perp + spot) for an address. */
async function getOpenOrders(user, opts) {
  const r = await info({ type: 'openOrders', user: assertAddress(user) }, opts);
  return Array.isArray(r) ? r : [];
}

/** Role of an address on the exchange (user / agent / vault / subAccount). */
async function getUserRole(user, opts) {
  const r = await info({ type: 'userRole', user: assertAddress(user) }, opts);
  return (r && r.role) || 'unknown';
}

/** Predicted funding rates for every perp market. */
async function getPredictedFundings(opts) {
  return await info({ type: 'predictedFundings' }, opts);
}

/**
 * The address's ACTUAL fee tier. This is the number that decides what a trade
 * costs, so the treasury quotes from this rather than from the base table.
 * Shape (verified live 2026-11-04):
 *   { cross, add, spotCross, spotAdd, referralDiscount }   <- all decimal STRINGS
 */
async function getUserFees(user, opts) {
  return await info({ type: 'userFees', user: assertAddress(user) }, opts);
}

/** All builder-deployed perp DEXs and their fee recipients. */
async function getPerpDexs(opts) {
  const r = await info({ type: 'perpDexs' }, opts);
  return Array.isArray(r) ? r : [];
}

/** L2 order book for a perp coin. */
async function getL2Book(coin, opts) {
  return await info({ type: 'l2Book', coin: String(coin).toUpperCase() }, opts);
}

/**
 * Live spot-pair deployment auction. The spot auction is a 31-hour Dutch
 * auction with a 500 HYPE floor — see hip1-deploy.js for the full rules.
 * Verified shape: { startTimeSeconds, durationSeconds, startGas, currentGas, endGas }
 */
async function getSpotAuctionStatus(opts) {
  return await info({ type: 'spotPairDeployAuctionStatus' }, opts);
}

/** Live perp-dex deployment auction. */
async function getPerpAuctionStatus(opts) {
  return await info({ type: 'perpDeployAuctionStatus' }, opts);
}

/** HYPE staking discount tiers (fee discount by bps of max supply staked). */
async function getStakingDiscountTiers(opts) {
  return await info({ type: 'stakingDiscountTiers' }, opts);
}

/**
 * Maximum builder fee the user has approved for a builder address.
 * Builder codes are how a project captures the QUOTE-side (USDC) fees;
 * HIP-1's deployer fee share captures the BASE-side (your token) fees.
 * They are complementary, not alternatives.
 */
async function getMaxBuilderFee(user, builder, opts) {
  return await info({ type: 'maxBuilderFee', user: assertAddress(user), builder: assertAddress(builder) }, opts);
}

/** Referral totals for an address (includes claimed builder fees). */
async function getReferralTotals(user, opts) {
  return await info({ type: 'referral', user: assertAddress(user) }, opts);
}

// ──────────────────────────────── trading ──────────────────────────────────

/**
 * Is trading unlocked? Four independent conditions must ALL be true.
 * Kept as four separate checks on purpose so a missing env var produces a
 * precise error instead of a generic "disabled".
 */
function tradingReadiness() {
  const reasons = [];
  if (process.env.HYPERLIQUID_TRADING_ENABLED !== 'true') {
    reasons.push('HYPERLIQUID_TRADING_ENABLED is not "true"');
  }
  if (!process.env.HYPERLIQUID_PRIVATE_KEY) {
    reasons.push('HYPERLIQUID_PRIVATE_KEY is not set');
  }
  if (!process.env.HYPERLIQUID_ACCOUNT_ADDRESS) {
    reasons.push('HYPERLIQUID_ACCOUNT_ADDRESS is not set');
  }
  const sdk = loadSdk();
  if (!sdk) {
    reasons.push('no Hyperliquid SDK installed (run: npm i @nktkas/hyperliquid)');
  }
  return { ready: reasons.length === 0, reasons, sdk: !!sdk };
}

/** Resolve an optional Hyperliquid SDK without ever requiring it at load time. */
function loadSdk() {
  if (process.env.HYPERLIQUID_SDK === 'none') return null;
  for (const mod of ['@nktkas/hyperliquid', 'hyperliquid-ts']) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require(mod);
    } catch (e) { /* try next */ }
  }
  return null;
}

function assertTradingEnabled() {
  const readiness = tradingReadiness();
  if (!readiness.ready) {
    throw new HyperliquidError(
      `Hyperliquid trading is disabled: ${readiness.reasons.join('; ')}`,
      'HL_TRADING_DISABLED',
      readiness.reasons
    );
  }
  return readiness.sdk;
}

/**
 * Place an order. Requires a fully configured SDK + keys; otherwise throws.
 * We never synthesise signatures by hand.
 */
async function placeOrder(order, opts = {}) {
  const sdk = assertTradingEnabled();
  const instance = new sdk.Exchange({ privateKey: process.env.HYPERLIQUID_PRIVATE_KEY });
  const accountAddress = process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
  return await instance.order(order, opts);
}

/** Spot counterpart of placeOrder. Same gate. */
async function placeSpotOrder(order, opts = {}) {
  const sdk = assertTradingEnabled();
  const instance = new sdk.Exchange({ privateKey: process.env.HYPERLIQUID_PRIVATE_KEY });
  const accountAddress = process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
  return await instance.order(order, { ...opts, isSpot: true });
}

/** Health / connectivity probe used by the SAP routes. */
async function health(opts) {
  const started = Date.now();
  try {
    const meta = await getPerpMeta(opts);
    return {
      ok: true,
      network: isTestnet() ? 'testnet' : 'mainnet',
      infoUrl: infoUrl(),
      perpMarkets: meta.length,
      latencyMs: Date.now() - started,
      trading: tradingReadiness(),
    };
  } catch (e) {
    return {
      ok: false,
      network: isTestnet() ? 'testnet' : 'mainnet',
      infoUrl: infoUrl(),
      error: e && e.message,
      errorCode: e && e.code,
      latencyMs: Date.now() - started,
      trading: tradingReadiness(),
    };
  }
}

module.exports = {
  HyperliquidError,
  // reads
  info,
  getPerpMeta,
  getAllMids,
  getSpotMeta,
  getSpotMetaAndAssetCtxs,
  getSpotTokens,
  findSpotToken,
  getSpotPrice,
  getClearinghouseState,
  getSpotClearinghouseState,
  getOpenOrders,
  getUserRole,
  getPredictedFundings,
  getUserFees,
  getPerpDexs,
  getL2Book,
  getSpotAuctionStatus,
  getPerpAuctionStatus,
  getStakingDiscountTiers,
  getMaxBuilderFee,
  getReferralTotals,
  // trading (gated)
  tradingReadiness,
  assertTradingEnabled,
  placeOrder,
  placeSpotOrder,
  // misc
  health,
  infoUrl,
  exchangeUrl,
  isTestnet,
};
