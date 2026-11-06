'use strict';
/**
 * hip1-deploy.js — planner for Hyperliquid's HIP-1 native token standard
 * and HIP-2 Hyperliquidity.
 *
 * WHY THIS EXISTS
 *   "Fees to the liquidity of the coin" has a native, protocol-sanctioned
 *   implementation on Hyperliquid, and it is NOT an AMM you write yourself:
 *
 *     HIP-1  defines a native token whose BASE-side trading fees accrue to
 *            the deployer AT 100% BY DEFAULT. The portion you do not claim is
 *            burned. Quote-side (USDC) fees go to the Assistance Fund and are
 *            NOT capturable via HIP-1.
 *
 *     HIP-2  "Hyperliquidity" is an onchain strategy that posts a LADDER of
 *            resting orders around a reference price. It IS your liquidity
 *            provider for the pair — and because the protocol recognises it,
 *            using it avoids the "your own wallet is both sides of every
 *            trade" wash-trade appearance that a bespoke pool creates.
 *
 *   The loop: users trade YOURTOKEN/USDC -> base-side fees in YOURTOKEN
 *   accrue to the deployer -> those fees seed/deepen the HIP-2 bid ladder ->
 *   the token's liquidity grows, protocol-natively, with no bespoke pool.
 *
 * RULES ENCODED HERE (all verified against the primary Hyperliquid docs and
 * live API responses on 2026-11-04 — see the SOURCES block at the bottom)
 *
 *   TokenSpec          name <= 6 chars (no uniqueness constraint);
 *                      szDecimals + 5 <= weiDecimals.
 *   Genesis            maxSupply must equal the total user-genesis allocation.
 *   RegisterSpot       pairs [baseIndex, quoteIndex]; quote is usually USDC (0).
 *   Hyperliquidity     ladder px_i = round(px_{i-1} * 1.003), updated at most
 *                      every 3 seconds; nSeededLevels bid levels are seeded
 *                      with USDC instead of tokens.
 *   Fee share          setDeployerTradingFeeShare may only ever be LOWERED
 *                      after the first send. Default is already 100%.
 *   Quote token        enableQuoteToken requires the fee share to be 0 FIRST.
 *   Annotation         setTokenAnnotation can be changed at most once per day.
 *   Auction            31-hour Dutch auction, floor 500 HYPE, paid in HYPE.
 *
 * THIS MODULE PLANS AND VALIDATES. IT DOES NOT SIGN OR BROADCAST.
 * Execution requires a private key and an SDK; see lib/hyperliquid.js.
 */

const AUCTION_DURATION_SECONDS = 111600; // 31 hours
const AUCTION_FLOOR_HYPE = 500;
const MAX_TOKEN_NAME_LENGTH = 6;
const LADDER_MULTIPLIER = 1.003;
const LADDER_MIN_UPDATE_SECONDS = 3;

class Hip1Error extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'Hip1Error';
    this.code = code || 'HIP1_ERROR';
    if (details !== undefined) this.details = details;
  }
}

// ─────────────────────────────── validation ────────────────────────────────

/**
 * Validate a HIP-1 TokenSpec.
 * @returns {{ok:boolean, errors:string[]}}
 */
function validateTokenSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') {
    return { ok: false, errors: ['spec must be an object'] };
  }
  const name = spec.name;
  if (typeof name !== 'string' || !name.trim()) {
    errors.push('name is required');
  } else if (name.trim().length > MAX_TOKEN_NAME_LENGTH) {
    errors.push(`name "${name}" exceeds the ${MAX_TOKEN_NAME_LENGTH}-character HIP-1 limit`);
  } else if (!/^[A-Za-z0-9]+$/.test(name.trim())) {
    errors.push('name must be alphanumeric');
  }

  const sz = Number(spec.szDecimals);
  const wei = Number(spec.weiDecimals);
  if (!Number.isInteger(sz) || sz < 0) errors.push('szDecimals must be a non-negative integer');
  if (!Number.isInteger(wei) || wei < 0) errors.push('weiDecimals must be a non-negative integer');
  if (Number.isInteger(sz) && Number.isInteger(wei) && sz + 5 > wei) {
    errors.push(`szDecimals + 5 must be <= weiDecimals (got szDecimals=${sz}, weiDecimals=${wei})`);
  }
  return { ok: errors.length === 0, errors };
}

/** Parse "12.5%" / "0.012" / 50 into a fraction in [0,1]. */
function parseFeeShare(share) {
  if (share === null || share === undefined) return null;
  if (typeof share === 'number') {
    if (!Number.isFinite(share) || share < 0 || share > 1) {
      throw new Hip1Error('fee share must be between 0 and 1', 'HIP1_BAD_FEE_SHARE');
    }
    return share;
  }
  const s = String(share).trim();
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new Hip1Error('fee share percentage must be between 0 and 100', 'HIP1_BAD_FEE_SHARE');
    }
    return n / 100;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Hip1Error('fee share must be a fraction or percentage string', 'HIP1_BAD_FEE_SHARE');
  }
  return n;
}

/** Format a fraction the way the API expects it: "100%", "12.5%", "0.012". */
function formatFeeShare(fraction) {
  if (fraction === null || fraction === undefined) return null;
  if (fraction === 1) return '100%';
  if (fraction === 0) return '0%';
  const pct = fraction * 100;
  if (Number.isInteger(pct)) return `${pct}%`;
  return String(fraction);
}

// ────────────────────────────── Hyperliquidity ─────────────────────────────

/**
 * Build the HIP-2 price ladder.
 * px_0 = startPx, px_i = round(px_{i-1} * 1.003).
 *
 * @param {number|string} startPx reference price
 * @param {number} nOrders number of ladder levels
 * @returns {string[]} ladder prices as decimal strings
 */
function buildLadder(startPx, nOrders) {
  const n = Number(nOrders);
  if (!Number.isInteger(n) || n < 0) {
    throw new Hip1Error('nOrders must be a non-negative integer', 'HIP1_BAD_ORDERS');
  }
  if (n === 0) return [];
  const prices = [];
  let px = Number(startPx);
  if (!Number.isFinite(px) || px <= 0) {
    throw new Hip1Error('startPx must be a positive number', 'HIP1_BAD_PRICE');
  }
  for (let i = 0; i < n; i += 1) {
    if (i > 0) px = Math.round(px * LADDER_MULTIPLIER);
    prices.push(String(px));
  }
  return prices;
}

/**
 * USDC required to seed the nSeededLevels bid levels of a ladder.
 * Each seeded level must be funded with px * sz worth of USDC.
 */
function seedCostUsdc(ladder, orderSz, nSeededLevels) {
  const levels = Math.max(0, Math.min(Number(nSeededLevels) || 0, ladder.length));
  let total = 0;
  for (let i = 0; i < levels; i += 1) {
    total += Number(ladder[i]) * Number(orderSz);
  }
  return total;
}

// ─────────────────────────────── auction ───────────────────────────────────

/**
 * Model the 31-hour Dutch auction and recommend a `maxGas` budget.
 * The auction descends linearly from `startGas` to 500 HYPE over 31 hours.
 *
 * @param {object} opts
 * @param {number} opts.durationSeconds  auction duration (default 111600 = 31h)
 * @param {string|number} opts.startGas  opening price in HYPE
 * @param {string|number} opts.floorGas  floor price in HYPE (default 500)
 * @param {number} [opts.elapsedSeconds] seconds since auction start
 */
function modelAuction(opts = {}) {
  const duration = Number(opts.durationSeconds || AUCTION_DURATION_SECONDS);
  const floor = Number(opts.floorGas || AUCTION_FLOOR_HYPE);
  const start = Number(opts.startGas || AUCTION_FLOOR_HYPE);
  if (!Number.isFinite(start) || start < floor) {
    throw new Hip1Error('startGas must be >= floorGas', 'HIP1_BAD_AUCTION');
  }
  const elapsed = Math.max(0, Math.min(Number(opts.elapsedSeconds || 0), duration));
  const current = start - ((start - floor) * elapsed) / duration;
  return {
    durationSeconds: duration,
    durationHours: duration / 3600,
    startGas: start,
    floorGas: floor,
    elapsedSeconds: elapsed,
    currentGas: Number(current.toFixed(6)),
    secondsRemaining: duration - elapsed,
  };
}

/**
 * Recommend a `maxGas` for `registerToken2`.
 * The SDK sends maxGas as the auction's maximum willingness to pay; the actual
 * charge is the auction price at inclusion time. Recommending the floor means
 * "only pay the minimum", which can fail if the auction already cleared.
 */
function recommendMaxGas(opts = {}) {
  const floor = Number(opts.floorGas || AUCTION_FLOOR_HYPE);
  const multiplier = Number(opts.multiplier || 1);
  if (!Number.isFinite(multiplier) || multiplier < 1) {
    throw new Hip1Error('multiplier must be >= 1', 'HIP1_BAD_MULTIPLIER');
  }
  return String(Math.ceil(floor * multiplier));
}

// ─────────────────────────────── plan builder ──────────────────────────────

/**
 * Build the full, ordered SpotDeployAction sequence for a HIP-1 token +
 * HIP-2 Hyperliquidity pair.
 *
 * The order matters and is fixed:
 *   1. registerToken2   (pays the auction gas; only this step is time-sensitive)
 *   2. userGenesis      (may be called multiple times)
 *   3. genesis          (maxSupply must match the user-genesis total)
 *   4. registerSpot     (pairs [base, quote])
 *   5. registerHyperliquidity (MUST be sent even when noHyperliquidity=true,
 *                              in which case nOrders must be 0)
 *   6. setDeployerTradingFeeShare (optional; may only ever be LOWERED)
 *
 * @param {object} opts
 * @param {{name:string, szDecimals:number, weiDecimals:number}} opts.token
 * @param {string|number} opts.maxSupplyWei total supply in wei units
 * @param {Array<[string,string]>} [opts.genesisUsers] [address, weiAmount] pairs
 * @param {Array<[number,string]>} [opts.anchorTokens] [existingTokenIndex, wei]
 * @param {number} [opts.quoteTokenIndex] USDC index (0)
 * @param {number} [opts.startPx] Hyperliquidity reference price
 * @param {number} [opts.orderSz] Hyperliquidity order size
 * @param {number} [opts.nOrders] ladder levels (0 => no Hyperliquidity)
 * @param {number} [opts.nSeededLevels] bid levels funded with USDC
 * @param {string|number} [opts.deployerTradingFeeShare] fraction or percent
 * @param {boolean} [opts.noHyperliquidity]
 * @param {object} [opts.annotation] {category, description, displayName, keywords}
 * @param {string} [opts.fullName] optional display name
 * @param {number} [opts.maxGas] auction budget in HYPE
 * @returns {{actions:Array, ladder:string[], seedCostUsdc:number, checks:object}}
 */
function buildDeployPlan(opts = {}) {
  const token = opts.token || {};
  const specCheck = validateTokenSpec(token);
  if (!specCheck.ok) {
    throw new Hip1Error(`invalid HIP-1 token spec: ${specCheck.errors.join('; ')}`, 'HIP1_BAD_SPEC', specCheck.errors);
  }

  const szDecimals = Number(token.szDecimals);
  const weiDecimals = Number(token.weiDecimals);
  const name = String(token.name).trim();

  const maxSupplyWei = String(opts.maxSupplyWei);
  if (!/^\d+$/.test(maxSupplyWei) || maxSupplyWei === '0') {
    throw new Hip1Error('maxSupplyWei must be a positive integer string', 'HIP1_BAD_SUPPLY');
  }

  const genesisUsers = opts.genesisUsers || [];
  if (!Array.isArray(genesisUsers)) {
    throw new Hip1Error('genesisUsers must be an array of [address, weiAmount] pairs', 'HIP1_BAD_GENESIS');
  }
  let genesisTotal = 0n;
  for (const pair of genesisUsers) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Hip1Error('each genesisUsers entry must be [address, weiAmount]', 'HIP1_BAD_GENESIS');
    }
    const amt = String(pair[1]);
    if (!/^\d+$/.test(amt)) {
      throw new Hip1Error(`genesis amount "${amt}" must be an integer string`, 'HIP1_BAD_GENESIS');
    }
    genesisTotal += BigInt(amt);
  }
  if (genesisTotal !== BigInt(maxSupplyWei)) {
    throw new Hip1Error(
      `maxSupplyWei (${maxSupplyWei}) must equal the total user-genesis allocation (${genesisTotal.toString()})`,
      'HIP1_SUPPLY_MISMATCH'
    );
  }

  const quoteTokenIndex = Number(opts.quoteTokenIndex == null ? 0 : opts.quoteTokenIndex);
  const noHyperliquidity = opts.noHyperliquidity === true;
  const nOrders = noHyperliquidity ? 0 : Number(opts.nOrders || 0);
  const orderSz = opts.orderSz == null ? '0' : String(opts.orderSz);
  const startPx = opts.startPx == null ? '0' : String(opts.startPx);

  const ladder = noHyperliquidity ? [] : buildLadder(startPx, nOrders);
  const nSeeded = noHyperliquidity ? 0 : Number(opts.nSeededLevels || 0);
  const seedCost = noHyperliquidity ? 0 : seedCostUsdc(ladder, orderSz, nSeeded);

  // Fee share: default 100%, may only ever be lowered after the first send.
  let feeShare = 1;
  if (opts.deployerTradingFeeShare !== undefined && opts.deployerTradingFeeShare !== null) {
    feeShare = parseFeeShare(opts.deployerTradingFeeShare);
  }

  const maxGas = opts.maxGas != null ? String(opts.maxGas) : recommendMaxGas({ multiplier: opts.maxGasMultiplier || 1 });

  const actions = [];

  // STEP 1 — register the token (this is the step that pays the auction).
  actions.push({
    step: 1,
    id: 'registerToken2',
    type: 'spotDeploy',
    action: {
      type: 'spotDeploy',
      registerToken2: {
        spec: { name, szDecimals, weiDecimals },
        maxGas: Number(maxGas),
        ...(opts.fullName ? { fullName: opts.fullName } : {}),
      },
    },
    notes: 'Pays the 31-hour Dutch auction gas. Only this step is time-sensitive; after it succeeds there is no time limit.',
  });

  // STEP 2 — user genesis (may be called multiple times).
  actions.push({
    step: 2,
    id: 'userGenesis',
    type: 'spotDeploy',
    action: {
      type: 'spotDeploy',
      userGenesis: {
        token: 0, // resolved at execution time from the step-1 response
        userAndWei: genesisUsers,
        existingTokenAndWei: opts.anchorTokens || [],
      },
    },
    notes: 'token index is resolved from the registerToken2 response. May be called repeatedly.',
  });

  // STEP 3 — genesis (max supply).
  actions.push({
    step: 3,
    id: 'genesis',
    type: 'spotDeploy',
    action: {
      type: 'spotDeploy',
      genesis: {
        token: 0,
        maxSupply: maxSupplyWei,
        noHyperliquidity,
      },
    },
    notes: 'maxSupply must equal the total user-genesis allocation.',
  });

  // STEP 4 — register the spot pair.
  actions.push({
    step: 4,
    id: 'registerSpot',
    type: 'spotDeploy',
    action: {
      type: 'spotDeploy',
      registerSpot: { tokens: [0, quoteTokenIndex] }, // [base index, quote index]
    },
    notes: 'Pairs the new token against the quote token (USDC is index 0).',
  });

  // STEP 5 — register Hyperliquidity. MUST be sent even when there is none.
  actions.push({
    step: 5,
    id: 'registerHyperliquidity',
    type: 'spotDeploy',
    action: {
      type: 'spotDeploy',
      registerHyperliquidity: {
        spot: 0, // resolved at execution time from the registerSpot response
        startPx,
        orderSz,
        nOrders,
        ...(nSeeded > 0 ? { nSeededLevels: nSeeded } : {}),
      },
    },
    notes: noHyperliquidity
      ? 'MUST be sent with nOrders = 0 because genesis set noHyperliquidity.'
      : `Ladder of ${nOrders} levels, 0.3% apart, ${nSeeded} level(s) seeded with USDC (${seedCost.toFixed(2)} USDC).`,
  });

  // STEP 6 — optional fee share. May only ever be LOWERED.
  if (feeShare < 1) {
    actions.push({
      step: 6,
      id: 'setDeployerTradingFeeShare',
      type: 'spotDeploy',
      action: {
        type: 'spotDeploy',
        setDeployerTradingFeeShare: { token: 0, share: formatFeeShare(feeShare) },
      },
      notes: `Base-side fees in ${name} will accrue to the deployer at ${formatFeeShare(feeShare)}. The remainder is burned. This value can only ever be LOWERED afterwards.`,
    });
  }

  // STEP 7 — optional annotation (at most once per day).
  if (opts.annotation) {
    const a = opts.annotation;
    if (a.category && String(a.category).length > 15) {
      throw new Hip1Error('annotation.category must be <= 15 characters', 'HIP1_BAD_ANNOTATION');
    }
    if (a.description && String(a.description).length > 400) {
      throw new Hip1Error('annotation.description must be <= 400 characters', 'HIP1_BAD_ANNOTATION');
    }
    if (a.displayName && String(a.displayName).length > 9) {
      throw new Hip1Error('annotation.displayName must be <= 9 characters', 'HIP1_BAD_ANNOTATION');
    }
    const keywords = a.keywords || [];
    if (keywords.length > 2) {
      throw new Hip1Error('annotation.keywords may contain at most 2 entries', 'HIP1_BAD_ANNOTATION');
    }
    for (const k of keywords) {
      if (String(k).length > 10) {
        throw new Hip1Error('each annotation keyword must be <= 10 characters', 'HIP1_BAD_ANNOTATION');
      }
    }
    actions.push({
      step: 7,
      id: 'setTokenAnnotation',
      type: 'spotDeploy',
      action: {
        type: 'spotDeploy',
        setTokenAnnotation: {
          token: 0,
          annotation: {
            category: a.category || 'sap',
            description: a.description || 'Shaddai Asimov Project regenerative initiative token.',
            displayName: a.displayName || null,
            keywords,
          },
        },
      },
      notes: 'Can be changed at most once per day.',
    });
  }

  return {
    actions,
    ladder,
    seedCostUsdc: Number(seedCost.toFixed(6)),
    checks: {
      specValid: true,
      supplyMatchesGenesis: true,
      feeShare: formatFeeShare(feeShare),
      feeShareDirection: feeShare < 1 ? 'lowered' : 'default-100-percent',
      quoteTokenIndex,
      nOrders,
      nSeededLevels: nSeeded,
      auction: {
        durationSeconds: AUCTION_DURATION_SECONDS,
        durationHours: AUCTION_DURATION_SECONDS / 3600,
        floorHype: AUCTION_FLOOR_HYPE,
        maxGas,
      },
      baseSideFees: `Base-side fees in ${name} accrue to the deployer at 100% by default. Quote-side (USDC) fees go to the Assistance Fund and require BUILDER CODES to capture.`,
      ladderRule: `px_i = round(px_{i-1} * ${LADDER_MULTIPLIER}), refreshed at most every ${LADDER_MIN_UPDATE_SECONDS}s`,
    },
  };
}

/**
 * Which of the two fee sides a given mechanism captures. Kept as data so the
 * API can be explicit rather than implying HIP-1 catches USDC too.
 */
const FEE_SIDE_MATRIX = {
  hip1DeployerFeeShare: {
    side: 'base',
    asset: 'your HIP-1 native token',
    capture: '100% by default; may be lowered (remainder is burned)',
    requires: 'deploying the token on HyperCore spot',
  },
  builderCodes: {
    side: 'quote',
    asset: 'USDC (collateral)',
    capture: 'up to 1% on spot, 0.1% on perps',
    requires: 'per-user ApproveBuilderFee signed by the MAIN wallet; builder needs >=100 USDC perps account value and `standard` account abstraction',
  },
  hip2Hyperliquidity: {
    side: 'liquidity',
    asset: 'your HIP-1 native token',
    capture: 'not a fee sink — it is the LP that the captured base-side fees are recycled into',
    requires: 'registerHyperliquidity with a seeded bid ladder',
  },
};

module.exports = {
  Hip1Error,
  AUCTION_DURATION_SECONDS,
  AUCTION_FLOOR_HYPE,
  MAX_TOKEN_NAME_LENGTH,
  LADDER_MULTIPLIER,
  validateTokenSpec,
  parseFeeShare,
  formatFeeShare,
  buildLadder,
  seedCostUsdc,
  modelAuction,
  recommendMaxGas,
  buildDeployPlan,
  FEE_SIDE_MATRIX,
};

/**
 * SOURCES (verified 2026-11-04)
 *  - HIP-1 native token standard
 *    https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-1-native-token-standard.md
 *  - HIP-2 Hyperliquidity
 *    https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-2-hyperliquidity.md
 *  - Deploying HIP-1 and HIP-2 assets (exact action union + auction rules)
 *    https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/deploying-hip-1-and-hip-2-assets.md
 *  - Fees (deployer fee formula, builder codes)
 *    https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees.md
 *  - Builder codes
 *    https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes.md
 */
