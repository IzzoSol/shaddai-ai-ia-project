/**
 * x402 -> S.A.P. treasury fee routing.
 *
 * The x402 marketplace fee is denominated in SHAD-Credits — a closed-loop soft
 * currency, NOT cents and NOT real money. These tests hold four lines:
 *
 *   1. GATED + ADDITIVE — with SAP_X402_FEE_ROUTING unset the legacy x402
 *      behaviour is untouched and the treasury sees nothing at all.
 *   2. ONE POLICY — the 40/40/20 split comes from treegens-service.js's
 *      splitByPolicy + readPolicyFromEnv, never from a copied constant.
 *   3. UNITS — the split is recorded as a CREDITS allocation and is NEVER
 *      counted in the treasury's real-money (cents) totals.
 *   4. NOTHING MOVES — no order is placed, no intent is queued, no funds move,
 *      and the Hyperliquid four-key gate stays closed.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ENV_KEYS = [
  'X402_LEDGER_FILE',
  'SAP_TREASURY_FILE',
  'X402_SECURITY_STATE_FILE',
  'SAP_X402_FEE_ROUTING',
  'SAP_TREE_FUND_BPS',
  'SAP_ASIMOV_LIQUIDITY_BPS',
  'SAP_PLATFORM_BPS',
  'HYPERLIQUID_TRADING_ENABLED',
  'HYPERLIQUID_PRIVATE_KEY',
  'HYPERLIQUID_ACCOUNT_ADDRESS',
  'HYPERLIQUID_SDK',
];

let savedEnv = {};
let tmpDir = null;
let ledgerFile = null;
let treasuryFile = null;
let securityFile = null;

/**
 * Load a FRESH module graph. Every module must come from the same registry so
 * the TreasuryService the test inspects is the very one x402-routes writes to.
 */
function load() {
  jest.resetModules();
  const x402 = require('../x402-routes');
  const treasury = require('../services/treasury-service');
  const treegens = require('../services/treegens-service');
  const hl = require('../lib/hyperliquid');
  return { x402, treasury, treegens, hl };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-sap-'));
  ledgerFile = path.join(tmpDir, 'x402-ledger.json');
  treasuryFile = path.join(tmpDir, 'treasury.json');
  securityFile = path.join(tmpDir, 'x402-security.json');
  process.env.X402_LEDGER_FILE = ledgerFile;
  process.env.SAP_TREASURY_FILE = treasuryFile;
  process.env.X402_SECURITY_STATE_FILE = securityFile;
  // Default state for every test: the new behaviour is OFF.
  delete process.env.SAP_X402_FEE_ROUTING;
  delete process.env.SAP_TREE_FUND_BPS;
  delete process.env.SAP_ASIMOV_LIQUIDITY_BPS;
  delete process.env.SAP_PLATFORM_BPS;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

// ─────────────────────────────── the gate ───────────────────────────────────

describe('x402 SAP fee routing — the gate', () => {
  test('the behaviour is OFF by default', () => {
    const { x402 } = load();
    expect(x402.sapFeeRoutingEnabled({})).toBe(false);
    expect(x402.sapFeeRoutingEnabled({ SAP_X402_FEE_ROUTING: undefined })).toBe(false);
    expect(x402.sapFeeRoutingEnabled(process.env)).toBe(false);
  });

  test('only an explicit flag turns it on', () => {
    const { x402 } = load();
    expect(x402.sapFeeRoutingEnabled({ SAP_X402_FEE_ROUTING: '1' })).toBe(true);
    expect(x402.sapFeeRoutingEnabled({ SAP_X402_FEE_ROUTING: 'true' })).toBe(true);
    expect(x402.sapFeeRoutingEnabled({ SAP_X402_FEE_ROUTING: 'TRUE' })).toBe(true);
    expect(x402.sapFeeRoutingEnabled({ SAP_X402_FEE_ROUTING: '0' })).toBe(false);
    expect(x402.sapFeeRoutingEnabled({ SAP_X402_FEE_ROUTING: 'false' })).toBe(false);
    expect(x402.sapFeeRoutingEnabled({ SAP_X402_FEE_ROUTING: '' })).toBe(false);
    expect(x402.sapFeeRoutingEnabled({ SAP_X402_FEE_ROUTING: 'yes' })).toBe(false);
  });
});

// ───────────────────────────── flag OFF ─────────────────────────────────────

describe('x402 SAP fee routing — flag OFF keeps the legacy behaviour', () => {
  test('the fee still lands in the credits ledger and nothing else changes', async () => {
    const { x402 } = load();
    const res = await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.charged).toBe(20);
    expect(res.body.fee).toBe(1);            // 5% of 20
    expect(res.body.net).toBe(19);
    expect(res.body.balance).toBe(80);

    // The legacy credits-ledger sink is untouched.
    const db = readJson(ledgerFile);
    expect(db.balances['SHADDAI_TREASURY']).toBe(101);   // 100 start credits + 1 fee
    expect(db.balances.u1).toBe(80);
    expect(db.balances.agent1).toBe(119);
    expect(db.txns.length).toBe(1);

    // No routing artefacts anywhere.
    expect(db.feeAllocations).toBeUndefined();
    expect(res.body.feeRouting).toBeUndefined();
  });

  test('the treasury is not touched at all', async () => {
    const { x402, treasury } = load();
    await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    expect((await t.listCreditFeeAllocations()).length).toBe(0);
    expect((await t.listSettlements()).length).toBe(0);
    expect((await t.listTreePayments()).length).toBe(0);
    expect((await t.listOnchainIntents()).length).toBe(0);
    const pools = await t.getPools();
    expect(Object.values(pools).every((v) => v === 0)).toBe(true);
  });
});

// ────────────────────────────── flag ON ─────────────────────────────────────

describe('x402 SAP fee routing — flag ON splits the fee 40/40/20', () => {
  beforeEach(() => { process.env.SAP_X402_FEE_ROUTING = '1'; });

  test('the treasury records a 40/40/20 credits allocation', async () => {
    const { x402, treasury } = load();
    const res = await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    expect(res.status).toBe(200);

    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    const allocs = await t.listCreditFeeAllocations();
    expect(allocs.length).toBe(1);
    const a = allocs[0];

    // 1 credit fee -> 100 credit units -> 40 / 40 / 20.
    expect(a.grossCreditUnits).toBe(100);
    expect(a.grossCredits).toBe(1);
    expect(a.allocation).toEqual({ treeFund: 40, asimovLiquidity: 40, platform: 20 });
    expect(a.allocationCredits).toEqual({ treeFund: 0.4, asimovLiquidity: 0.4, platform: 0.2 });
    expect(a.policy).toEqual({ treeFundBps: 4000, asimovLiquidityBps: 4000, platformBps: 2000 });
    expect(a.source).toBe('x402_fee');
  });

  test('the split comes from the SHARED policy, so an env override moves both paths', async () => {
    // The green initiative's policy is env-overridable; the x402 route must
    // follow the SAME override rather than hard-code 4000/4000/2000.
    process.env.SAP_TREE_FUND_BPS = '5000';
    process.env.SAP_ASIMOV_LIQUIDITY_BPS = '4000';
    process.env.SAP_PLATFORM_BPS = '1000';
    const { x402, treasury, treegens } = load();

    // The green-initiative policy and the x402 policy are the same numbers.
    const p = treegens.readPolicyFromEnv(process.env);
    expect(p.treeFundBps).toBe(5000);

    await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    const a = (await t.listCreditFeeAllocations())[0];
    expect(a.allocation).toEqual({ treeFund: 50, asimovLiquidity: 40, platform: 10 });
    expect(a.policy).toEqual({ treeFundBps: 5000, asimovLiquidityBps: 4000, platformBps: 1000 });
  });

  test('no credit unit is created or lost, for any fee amount', async () => {
    const { x402, treasury } = load();
    for (const amount of [1, 3, 7, 19, 20, 33, 99, 1234]) {
      await x402.grantCredits({ user: 'u' + amount, amount: 5000, reason: 'test top-up' });
      await x402.chargeCredits({ user: 'u' + amount, amount, reason: 'agent call', payee: 'agent1' });
    }
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    const allocs = await t.listCreditFeeAllocations();
    expect(allocs.length).toBe(8);
    for (const a of allocs) {
      const sum = a.allocation.treeFund + a.allocation.asimovLiquidity + a.allocation.platform;
      expect(sum).toBe(a.grossCreditUnits);
      const creditsSum = a.allocationCredits.treeFund + a.allocationCredits.asimovLiquidity + a.allocationCredits.platform;
      expect(creditsSum).toBeCloseTo(a.grossCredits, 10);
    }
  });

  test('the credits ledger mirrors the split with an explicit unit label', async () => {
    const { x402 } = load();
    await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    const db = readJson(ledgerFile);
    expect(Array.isArray(db.feeAllocations)).toBe(true);
    expect(db.feeAllocations.length).toBe(1);
    const f = db.feeAllocations[0];
    expect(f.unit).toBe('SHAD-Credits');
    expect(f.currency).toBe('SHAD-Credits');
    expect(f.creditUnitScale).toBe(100);
    expect(f.grossCredits).toBe(1);
    expect(f.allocationCredits).toEqual({ treeFund: 0.4, asimovLiquidity: 0.4, platform: 0.2 });
    expect(f.allocationCreditUnits).toEqual({ treeFund: 40, asimovLiquidity: 40, platform: 20 });
    // The legacy credits balance is unchanged by the routing.
    expect(db.balances['SHADDAI_TREASURY']).toBe(101);
  });

  test('the charge itself is unchanged — the routing is purely additive', async () => {
    const { x402 } = load();
    const res = await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    expect(res.body.charged).toBe(20);
    expect(res.body.fee).toBe(1);
    expect(res.body.net).toBe(19);
    expect(res.body.balance).toBe(80);
    // ...and the routing is reported alongside it.
    expect(res.body.feeRouting).toBeTruthy();
    expect(res.body.feeRouting.unit).toBe('SHAD-Credits');
    expect(res.body.feeRouting.treasury.status).toBe('pending');
    expect(res.body.feeRouting.treasury.realMoneyValue).toBeNull();
  });
});

// ──────────────────────────────── units ─────────────────────────────────────

describe('x402 SAP fee routing — units are credits, never cents', () => {
  beforeEach(() => { process.env.SAP_X402_FEE_ROUTING = '1'; });

  test('the credits allocation is excluded from every real-money total', async () => {
    const { x402, treasury } = load();
    await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });

    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    // Real money: every cents collection stays empty.
    expect((await t.listSettlements()).length).toBe(0);
    expect((await t.listTreePayments()).length).toBe(0);
    expect((await t.getPools()).treasury).toBe(0);
    expect((await t.getPools()).eco).toBe(0);
    expect((await t.getPools()).asimovLiquidity).toBe(0);

    const report = await t.getTransparencyReport();
    expect(Object.values(report.pools).every((v) => v === 0)).toBe(true);
    expect(report.treePayments.totalCents).toBe(0);
    expect(report.settlements.total).toBe(0);
    expect(report.currency).toBe('cents');
  });

  test('the transparency report labels the credits section explicitly', async () => {
    const { x402, treasury } = load();
    await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });

    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    const report = await t.getTransparencyReport();
    const cfr = report.creditFeeRouting;
    expect(cfr.unit).toBe('SHAD-Credits');
    expect(cfr.currency).toBe('SHAD-Credits');
    expect(cfr.creditUnitScale).toBe(100);
    expect(cfr.count).toBe(1);
    expect(cfr.grossCredits).toBe(1);
    expect(cfr.treeFundCredits).toBe(0.4);
    expect(cfr.asimovLiquidityCredits).toBe(0.4);
    expect(cfr.platformCredits).toBe(0.2);
    expect(cfr.excludedFromRealMoneyTotals).toBe(true);
    expect(cfr.realMoneyValue).toBeNull();
    expect(cfr.note).toMatch(/NOT cents/i);
    expect(report.currencies.creditFeeRouting).toMatch(/SHAD-Credits/);
    expect(report.caveats.join(' ')).toMatch(/SHAD-Credits/);
    expect(cfr.entries.length).toBe(1);
    expect(cfr.entries[0].unit).toBe('SHAD-Credits');
  });

  test('a credits allocation carries no real-money value', async () => {
    const { x402, treasury } = load();
    await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    const a = (await t.listCreditFeeAllocations())[0];
    expect(a.unit).toBe('SHAD-Credits');
    expect(a.currency).toBe('SHAD-Credits');
    expect(a.realMoneyValue).toBeNull();
    expect(a.creditUnitScale).toBe(100);
  });

  test('the treeFund slice carries the tree-payment semantics, not a token purchase', async () => {
    const { x402, treasury } = load();
    await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    const a = (await t.listCreditFeeAllocations())[0];
    expect(a.treeFundPayment.note).toBe(treasury.TREE_PAYMENT_NOTE);
    expect(a.treeFundPayment.note).toMatch(/Payment for planting and verification services already rendered/);
    expect(a.treeFundPayment.note).toMatch(/Not an investment/);
    expect(a.treeFundPayment.note).toMatch(/not redeemable for fiat/);
    expect(a.treeFundPayment.serviceType).toBe('tree_planting');
    // The CENTS tree-payment ledger stays clean: no real money changed hands,
    // so no cents tree payment is fabricated.
    expect((await t.listTreePayments()).length).toBe(0);
  });
});

// ─────────────────────────── policy integrity ───────────────────────────────

describe('x402 SAP fee routing — policy integrity', () => {
  test('the policy sums to exactly 10000 bps', () => {
    const { treegens } = load();
    const p = treegens.readPolicyFromEnv({});
    expect(p.treeFundBps + p.asimovLiquidityBps + p.platformBps).toBe(10000);
  });

  test('the recorded policy sums to exactly 10000 bps', async () => {
    process.env.SAP_X402_FEE_ROUTING = '1';
    const { x402, treasury } = load();
    await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    const a = (await t.listCreditFeeAllocations())[0];
    const sum = a.policy.treeFundBps + a.policy.asimovLiquidityBps + a.policy.platformBps;
    expect(sum).toBe(10000);
  });

  test('the treasury refuses an allocation that does not sum to the gross', async () => {
    const { treasury } = load();
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    await expect(t.recordCreditFeeAllocation({
      allocationId: 'bad_sum',
      source: 'x402_fee',
      grossCreditUnits: 100,
      allocation: { treeFund: 40, asimovLiquidity: 40, platform: 10 },
      policy: { treeFundBps: 4000, asimovLiquidityBps: 4000, platformBps: 2000 },
    })).rejects.toThrow(/sum 90 != grossCreditUnits 100/);
  });

  test('the treasury refuses a policy that does not sum to 10000 bps', async () => {
    const { treasury } = load();
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    await expect(t.recordCreditFeeAllocation({
      allocationId: 'bad_policy',
      source: 'x402_fee',
      grossCreditUnits: 100,
      allocation: { treeFund: 50, asimovLiquidity: 40, platform: 10 },
      // 5000 + 4000 + 500 = 9500 — short by 500 bps.
      policy: { treeFundBps: 5000, asimovLiquidityBps: 4000, platformBps: 500 },
    })).rejects.toThrow(/10000 bps/);
  });

  test('a replayed allocation does not double-count', async () => {
    const { treasury } = load();
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    const args = {
      allocationId: 'once',
      source: 'x402_fee',
      grossCreditUnits: 100,
      allocation: { treeFund: 40, asimovLiquidity: 40, platform: 20 },
      policy: { treeFundBps: 4000, asimovLiquidityBps: 4000, platformBps: 2000 },
    };
    const first = await t.recordCreditFeeAllocation(args);
    const second = await t.recordCreditFeeAllocation(args);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect((await t.listCreditFeeAllocations()).length).toBe(1);
    // Still no real money moved into the cents pools.
    expect(Object.values(await t.getPools()).every((v) => v === 0)).toBe(true);
  });
});

// ────────────────────── nothing moves, no order is placed ───────────────────

describe('x402 SAP fee routing — nothing moves', () => {
  beforeEach(() => { process.env.SAP_X402_FEE_ROUTING = '1'; });

  test('no on-chain intent is queued and nothing is settled', async () => {
    const { x402, treasury } = load();
    await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    expect((await t.listOnchainIntents()).length).toBe(0);
    const a = (await t.listCreditFeeAllocations())[0];
    expect(a.onchainIntentId).toBeNull();
    expect(a.settlement).toBe('not_applicable');
    expect(a.status).toBe('pending');
    expect(a.settledAt).toBeNull();
  });

  test('no order is placed and the four-key trading gate stays closed', async () => {
    const { x402, hl } = load();
    const placeOrder = jest.spyOn(hl, 'placeOrder');
    const placeSpotOrder = jest.spyOn(hl, 'placeSpotOrder');
    try {
      await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
      expect(placeOrder).not.toHaveBeenCalled();
      expect(placeSpotOrder).not.toHaveBeenCalled();

      // The four-key gate is intact: trading flag + private key + account
      // address + SDK must ALL be present, or nothing happens.
      delete process.env.HYPERLIQUID_TRADING_ENABLED;
      delete process.env.HYPERLIQUID_PRIVATE_KEY;
      delete process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
      process.env.HYPERLIQUID_SDK = 'none';
      const readiness = hl.tradingReadiness();
      expect(readiness.ready).toBe(false);
      expect(readiness.reasons.join(' ')).toContain('HYPERLIQUID_TRADING_ENABLED');
      expect(readiness.reasons.join(' ')).toContain('PRIVATE_KEY');
      expect(readiness.reasons.join(' ')).toContain('ACCOUNT_ADDRESS');
      expect(() => hl.assertTradingEnabled()).toThrow(/disabled/i);
    } finally {
      placeOrder.mockRestore();
      placeSpotOrder.mockRestore();
    }
  });

  test('the treasury still exposes no way to move money', async () => {
    const { treasury } = load();
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    for (const method of ['payout', 'withdraw', 'transfer', 'settleToAccount', 'send', 'move']) {
      expect(typeof t[method]).toBe('undefined');
    }
  });

  test('a malformed policy never breaks the charge', async () => {
    process.env.SAP_TREE_FUND_BPS = '5000';   // 5000 + 4000 + 2000 = 11000
    const { x402, treasury } = load();
    const res = await x402.chargeCredits({ user: 'u1', amount: 20, reason: 'agent call', payee: 'agent1' });
    expect(res.status).toBe(200);
    expect(res.body.charged).toBe(20);
    expect(res.body.fee).toBe(1);
    expect(res.body.feeRouting).toBeUndefined();
    const t = new treasury.TreasuryService({ filePath: treasuryFile });
    expect((await t.listCreditFeeAllocations()).length).toBe(0);
  });
});
