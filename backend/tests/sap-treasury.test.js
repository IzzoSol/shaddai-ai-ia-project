/**
 * SAP green-initiative tests — treasury accounting, fee-routing policy,
 * on-chain settlement intents, tree payments, and the HIP-1 deployment planner.
 *
 * The invariants under test are the ones that lose real money if they break:
 *   - no cent is created or destroyed by a split
 *   - a replayed payment never double-accrues
 *   - the treasury can never move money (there is no method that can)
 *   - an on-chain intent records INTENT and never a transfer
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { TreasuryService, TreasuryError, POOLS } = require('../services/treasury-service');
const {
  TreegensService,
  TreegensError,
  splitByPolicy,
  readPolicyFromEnv,
  DEFAULT_POLICY,
} = require('../services/treegens-service');
const HIP1 = require('../lib/hip1-deploy');
const HL = require('../lib/hyperliquid');

let tmpCounter = 0;
function tmpFile(tag) {
  tmpCounter += 1;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sap-${tag}-`));
  return path.join(dir, `${tag}.json`);
}

function svc(tag = 'treas') {
  return new TreasuryService({ filePath: tmpFile(tag) });
}

// ───────────────────────────── treasury ────────────────────────────────────

describe('TreasuryService — SAP extension', () => {
  test('the asimovLiquidity pool exists and is zero on a fresh ledger', async () => {
    const s = svc();
    const pools = await s.getPools();
    expect(pools.asimovLiquidity).toBe(0);
    expect(POOLS).toContain('asimovLiquidity');
  });

  test('a legacy settlement (no asimovLiquidity key) still validates and accrues', async () => {
    // Backward compatibility: referral-routes.js and reward-engine.js still
    // pass a 5-key split. This must keep working unchanged.
    const s = svc();
    const r = await s.recordSettlement({
      attributionId: 'ref_legacy',
      sourceType: 'hire',
      grossAmount: 1000,
      currency: 'USD',
      split: { treasury: 250, owner: 450, referrer: 200, eco: 100, partner: 0 },
    });
    expect(r.replayed).toBe(false);
    expect(r.asimovLiquidityAmount).toBe(0);
    const pools = await s.getPools();
    expect(pools.treasury).toBe(250);
    expect(pools.owner).toBe(450);
    expect(pools.asimovLiquidity).toBe(0);
  });

  test('an explicit asimovLiquidity slice accrues to its own pool', async () => {
    const s = svc();
    await s.recordSettlement({
      attributionId: 'ref_liq',
      grossAmount: 1000,
      split: { treasury: 200, owner: 200, referrer: 100, eco: 100, partner: 0, asimovLiquidity: 400 },
    });
    const pools = await s.getPools();
    expect(pools.asimovLiquidity).toBe(400);
    // Every pool together still equals gross — no cent invented.
    const total = Object.values(pools).reduce((a, b) => a + b, 0);
    expect(total).toBe(1000);
  });

  test('a ledger written before the new pool is normalized, not poisoned with NaN', async () => {
    const file = tmpFile('legacy-file');
    // Simulate a pre-extension ledger on disk: pools without asimovLiquidity.
    fs.writeFileSync(file, JSON.stringify({
      settlements: [],
      pools: { treasury: 10, owner: 20, referrer: 30, eco: 40, partner: 50 },
      ownerPayouts: {},
      _seq: 0,
    }));
    const s = new TreasuryService({ filePath: file });
    await s.recordSettlement({
      attributionId: 'ref_after_upgrade',
      grossAmount: 100,
      split: { treasury: 100, owner: 0, referrer: 0, eco: 0, partner: 0 },
    });
    const pools = await s.getPools();
    expect(pools.asimovLiquidity).toBe(0);
    expect(Number.isNaN(pools.treasury)).toBe(false);
    expect(pools.treasury).toBe(110);
  });

  test('tree payment splits across tree fund, liquidity and platform', async () => {
    const s = svc();
    const payment = await s.recordTreePayment({
      paymentId: 'pay_1',
      payerUserId: 'u1',
      plotId: 'TG-MANGROVE-001',
      stems: 10,
      amount: 1000,
      currency: 'USD',
      allocation: { treeFund: 400, asimovLiquidity: 400, platform: 200 },
    });
    expect(payment.replayed).toBe(false);
    const pools = await s.getPools();
    expect(pools.eco).toBe(400);
    expect(pools.asimovLiquidity).toBe(400);
    expect(pools.treasury).toBe(200);
    const total = Object.values(pools).reduce((a, b) => a + b, 0);
    expect(total).toBe(1000);
  });

  test('a tree payment allocation that does not sum to the amount is rejected', async () => {
    const s = svc();
    await expect(s.recordTreePayment({
      paymentId: 'pay_bad',
      payerUserId: 'u1',
      amount: 1000,
      allocation: { treeFund: 400, asimovLiquidity: 400, platform: 100 },
    })).rejects.toThrow(TreasuryError);
  });

  test('a replayed tree payment does not double-accrue', async () => {
    const s = svc();
    const args = {
      paymentId: 'pay_replay',
      payerUserId: 'u1',
      amount: 1000,
      allocation: { treeFund: 400, asimovLiquidity: 400, platform: 200 },
    };
    await s.recordTreePayment(args);
    const dup = await s.recordTreePayment(args);
    expect(dup.replayed).toBe(true);
    const pools = await s.getPools();
    expect(pools.eco + pools.asimovLiquidity + pools.treasury).toBe(1000);
  });

  test('the treasury exposes NO way to move money', async () => {
    const s = svc();
    for (const method of ['payout', 'withdraw', 'transfer', 'settleToAccount', 'send', 'move']) {
      expect(typeof s[method]).toBe('undefined');
    }
  });
});

// ───────────────────────── on-chain intents ────────────────────────────────

describe('TreasuryService — on-chain settlement intents', () => {
  test('an intent is recorded as pending and never as a transfer', async () => {
    const s = svc();
    const intent = await s.queueOnchainIntent({
      intentId: 'ix_1',
      chain: 'solana-amm',
      kind: 'asimov_liquidity',
      amount: 400,
      currency: 'USD',
    });
    expect(intent.status).toBe('pending');
    expect(intent.txId).toBeNull();
  });

  test('intents are idempotent on intentId', async () => {
    const s = svc();
    const args = { intentId: 'ix_2', chain: 'solana', kind: 'tree_fund', amount: 100 };
    const a = await s.queueOnchainIntent(args);
    const b = await s.queueOnchainIntent(args);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect((await s.listOnchainIntents()).length).toBe(1);
  });

  test('intent lifecycle moves pending -> submitted -> confirmed', async () => {
    const s = svc();
    await s.queueOnchainIntent({ intentId: 'ix_3', chain: 'solana', kind: 'tree_fund', amount: 100 });
    await s.markOnchainIntent('ix_3', 'submitted', { txId: 'sig_abc' });
    const done = await s.markOnchainIntent('ix_3', 'confirmed', { txId: 'sig_abc' });
    expect(done.status).toBe('confirmed');
    expect(done.txId).toBe('sig_abc');
  });

  test('a confirmed intent is immutable', async () => {
    const s = svc();
    await s.queueOnchainIntent({ intentId: 'ix_4', chain: 'solana', kind: 'tree_fund', amount: 100 });
    await s.markOnchainIntent('ix_4', 'confirmed', { txId: 'sig' });
    await expect(s.markOnchainIntent('ix_4', 'failed')).rejects.toThrow(TreasuryError);
  });

  test('an unknown intentId is a NOT_FOUND, not a silent no-op', async () => {
    const s = svc();
    await expect(s.markOnchainIntent('nope', 'submitted')).rejects.toThrow(TreasuryError);
  });

  test('a non-positive or fractional intent amount is rejected', async () => {
    const s = svc();
    await expect(s.queueOnchainIntent({ intentId: 'ix_5', chain: 'x', kind: 'k', amount: 0 })).rejects.toThrow(TreasuryError);
    await expect(s.queueOnchainIntent({ intentId: 'ix_6', chain: 'x', kind: 'k', amount: 1.5 })).rejects.toThrow(TreasuryError);
  });
});

// ─────────────────────────── transparency ──────────────────────────────────

describe('TreasuryService — transparency report', () => {
  test('the report totals pools, tree payments and intent statuses', async () => {
    const s = svc();
    await s.recordTreePayment({
      paymentId: 'pay_r',
      payerUserId: 'u1',
      amount: 1000,
      allocation: { treeFund: 400, asimovLiquidity: 400, platform: 200 },
    });
    await s.queueOnchainIntent({ intentId: 'ix_r', chain: 'solana', kind: 'asimov_liquidity', amount: 400 });
    await s.queueOnchainIntent({ intentId: 'ix_r2', chain: 'treegens', kind: 'tree_fund', amount: 400 });

    const report = await s.getTransparencyReport();
    expect(report.pools.asimovLiquidity).toBe(400);
    expect(report.pools.eco).toBe(400);
    expect(report.treePayments.count).toBe(1);
    expect(report.treePayments.totalCents).toBe(1000);
    expect(report.treePayments.treeFundCents).toBe(400);
    expect(report.onchainIntents.total).toBe(2);
    expect(report.onchainIntents.byStatus.pending).toBe(2);
    expect(report.caveats.join(' ')).toContain('Illustrative averages, not site-specific predictions');
  });
});

// ──────────────────────────── fee policy ───────────────────────────────────

describe('fee-routing policy', () => {
  test('the default policy sums to 10000 bps', () => {
    const p = readPolicyFromEnv({});
    expect(p.treeFundBps + p.asimovLiquidityBps + p.platformBps).toBe(10000);
    expect(p.treeFundBps).toBe(DEFAULT_POLICY.treeFundBps);
  });

  test('a policy that does not sum to 10000 bps is rejected', () => {
    // 5000 + 4000 + 500 = 9500, which is short by 500 bps.
    expect(() => readPolicyFromEnv({
      SAP_TREE_FUND_BPS: '5000',
      SAP_ASIMOV_LIQUIDITY_BPS: '4000',
      SAP_PLATFORM_BPS: '500',
    })).toThrow(TreegensError);
  });

  test('a negative or non-integer bps value is rejected', () => {
    expect(() => readPolicyFromEnv({ SAP_TREE_FUND_BPS: '-1' })).toThrow(TreegensError);
    expect(() => readPolicyFromEnv({ SAP_TREE_FUND_BPS: '12.5' })).toThrow(TreegensError);
    expect(() => readPolicyFromEnv({ SAP_TREE_FUND_BPS: 'abc' })).toThrow(TreegensError);
  });

  test('an empty-string env var is treated as unset, not as zero bps', () => {
    // '' ?? default -> '' (nullish coalescing does not fire on the empty string),
    // so without an explicit guard this would silently become 0 bps.
    const p = readPolicyFromEnv({ SAP_TREE_FUND_BPS: '' });
    expect(p.treeFundBps).toBe(DEFAULT_POLICY.treeFundBps);
  });

  test('splitByPolicy never loses or invents a cent', () => {
    const policy = readPolicyFromEnv({});
    for (const amount of [1, 3, 7, 99, 100, 999, 12345, 1000000]) {
      const s = splitByPolicy(amount, policy);
      expect(s.treeFund + s.asimovLiquidity + s.platform).toBe(amount);
      expect(s.treeFund).toBeGreaterThanOrEqual(0);
      expect(s.asimovLiquidity).toBeGreaterThanOrEqual(0);
      expect(s.platform).toBeGreaterThanOrEqual(0);
    }
  });

  test('a non-integer amount is refused rather than rounded', () => {
    const policy = readPolicyFromEnv({});
    expect(() => splitByPolicy(10.5, policy)).toThrow(TreegensError);
    expect(() => splitByPolicy(-1, policy)).toThrow(TreegensError);
  });
});

// ─────────────────────────── tree payments ─────────────────────────────────

describe('TreegensService.payForTrees', () => {
  function makeSvc() {
    const file = tmpFile('treegens');
    return new TreegensService({
      treasuryFile: file,
      env: { TREEGENS_TREASURY_WALLET: 'TreegensTreasury1111111111111111111111111111' },
    });
  }

  test('a payment creates a receipt, splits the money and queues both intents', async () => {
    const s = makeSvc();
    const receipt = await s.payForTrees({
      paymentId: 'pay_tree_1',
      payerUserId: 'u1',
      plotId: 'TG-MANGROVE-001',
      stems: 10,
    });
    expect(receipt.ok).toBe(true);
    expect(receipt.amountCents).toBe(2400); // 10 stems x 240 cents
    expect(receipt.allocation.treeFundCents + receipt.allocation.asimovLiquidityCents + receipt.allocation.platformCents)
      .toBe(receipt.amountCents);
    const kinds = receipt.onchainIntents.map((i) => i.kind).sort();
    expect(kinds).toEqual(['asimov_liquidity', 'tree_fund']);
    for (const i of receipt.onchainIntents) {
      expect(i.status).toBe('pending');
      expect(i.txId).toBeUndefined();
    }
  });

  test('the money lands in the right pools', async () => {
    const s = makeSvc();
    await s.payForTrees({ paymentId: 'pay_tree_2', payerUserId: 'u1', plotId: 'TG-MANGROVE-001', stems: 10 });
    const pools = await s.treasury.getPools();
    expect(pools.eco).toBe(960);        // 40% of 2400
    expect(pools.asimovLiquidity).toBe(960);
    expect(pools.treasury).toBe(480);
  });

  test('a replayed payment returns the original receipt and does not double-charge', async () => {
    const s = makeSvc();
    const args = { paymentId: 'pay_tree_3', payerUserId: 'u1', plotId: 'TG-MANGROVE-001', stems: 5 };
    const a = await s.payForTrees(args);
    const b = await s.payForTrees(args);
    expect(b.replayed).toBe(true);
    const pools = await s.treasury.getPools();
    expect(pools.eco + pools.asimovLiquidity + pools.treasury).toBe(a.amountCents);
  });

  test('an unknown plot is NOT_FOUND', async () => {
    const s = makeSvc();
    await expect(s.payForTrees({
      paymentId: 'pay_tree_4', payerUserId: 'u1', plotId: 'NOPE',
    })).rejects.toThrow(TreegensError);
  });

  test('a Sparks charge goes through the canonical economy and is idempotent', async () => {
    const s = makeSvc();
    const calls = [];
    const economy = {
      spend: async (userId, amount, reason, key) => {
        calls.push({ userId, amount, reason, key });
        return { balance: 100 - amount, replayed: false };
      },
    };
    const receipt = await s.payForTrees({
      paymentId: 'pay_tree_5', payerUserId: 'u1', plotId: 'TG-MANGROVE-001', stems: 1, sparksAmount: 25,
    }, { economy });
    expect(calls.length).toBe(1);
    expect(calls[0].amount).toBe(25);
    expect(calls[0].key).toBe('sap:tree:pay_tree_5');
    expect(receipt.sparksCharged.amount).toBe(25);
  });

  test('a Sparks charge without an economy service is refused, not silently skipped', async () => {
    const s = makeSvc();
    await expect(s.payForTrees({
      paymentId: 'pay_tree_6', payerUserId: 'u1', plotId: 'TG-MANGROVE-001', stems: 1, sparksAmount: 25,
    })).rejects.toThrow(TreegensError);
  });

  test('the plot registry exposes price, verification and status', () => {
    const s = makeSvc();
    const plots = s.listPlots();
    expect(plots.length).toBeGreaterThan(0);
    for (const p of plots) {
      expect(p.plotId).toBeTruthy();
      expect(p.priceCentsPerStem).toBeGreaterThan(0);
      expect(p.verification).toContain('Proof of Tree');
    }
  });
});

// ───────────────────────────── HIP-1 planner ───────────────────────────────

describe('HIP-1 deployment planner', () => {
  test('a name longer than 6 characters is rejected', () => {
    const r = HIP1.validateTokenSpec({ name: 'TOOLONGNAME', szDecimals: 2, weiDecimals: 8 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('6-character');
  });

  test('szDecimals + 5 must be <= weiDecimals', () => {
    const r = HIP1.validateTokenSpec({ name: 'SAP', szDecimals: 5, weiDecimals: 8 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('szDecimals + 5');
  });

  test('a valid spec passes', () => {
    expect(HIP1.validateTokenSpec({ name: 'ASIMOV', szDecimals: 2, weiDecimals: 8 }).ok).toBe(true);
  });

  test('the Hyperliquidity ladder steps by 0.3% and rounds', () => {
    const ladder = HIP1.buildLadder('100', 4);
    expect(ladder).toEqual(['100', '100', '100', '100']); // 100 * 1.003 = 100.3 -> rounds to 100
    const ladder2 = HIP1.buildLadder('1000', 3);
    expect(ladder2[0]).toBe('1000');
    expect(ladder2[1]).toBe('1003');
    expect(ladder2[2]).toBe('1006');
  });

  test('the seed cost funds each seeded level with px * sz', () => {
    const ladder = HIP1.buildLadder('2', 3);
    const cost = HIP1.seedCostUsdc(ladder, '10', 2);
    expect(cost).toBeCloseTo((2 + 2) * 10, 6);
  });

  test('the deploy plan emits the actions in the required order', () => {
    const plan = HIP1.buildDeployPlan({
      token: { name: 'ASIMOV', szDecimals: 2, weiDecimals: 8 },
      maxSupplyWei: '1000',
      genesisUsers: [['0xabc', '1000']],
      startPx: '2',
      orderSz: '10',
      nOrders: 5,
      nSeededLevels: 2,
    });
    const ids = plan.actions.map((a) => a.id);
    expect(ids).toEqual([
      'registerToken2',
      'userGenesis',
      'genesis',
      'registerSpot',
      'registerHyperliquidity',
    ]);
    expect(plan.checks.supplyMatchesGenesis).toBe(true);
    expect(plan.checks.feeShare).toBe('100%');
  });

  test('a maxSupply that does not match the genesis allocation is rejected', () => {
    expect(() => HIP1.buildDeployPlan({
      token: { name: 'ASIMOV', szDecimals: 2, weiDecimals: 8 },
      maxSupplyWei: '1000',
      genesisUsers: [['0xabc', '999']],
    })).toThrow(HIP1.Hip1Error);
  });

  test('lowering the fee share adds the action and the remainder is burnable', () => {
    const plan = HIP1.buildDeployPlan({
      token: { name: 'ASIMOV', szDecimals: 2, weiDecimals: 8 },
      maxSupplyWei: '1000',
      genesisUsers: [['0xabc', '1000']],
      deployerTradingFeeShare: '40%',
      noHyperliquidity: true,
    });
    const fee = plan.actions.find((a) => a.id === 'setDeployerTradingFeeShare');
    expect(fee).toBeTruthy();
    expect(fee.action.setDeployerTradingFeeShare.share).toBe('40%');
    expect(plan.checks.feeShareDirection).toBe('lowered');
  });

  test('noHyperliquidity still emits registerHyperliquidity with nOrders 0', () => {
    const plan = HIP1.buildDeployPlan({
      token: { name: 'ASIMOV', szDecimals: 2, weiDecimals: 8 },
      maxSupplyWei: '1000',
      genesisUsers: [['0xabc', '1000']],
      noHyperliquidity: true,
    });
    const hl = plan.actions.find((a) => a.id === 'registerHyperliquidity');
    expect(hl).toBeTruthy();
    expect(hl.action.registerHyperliquidity.nOrders).toBe(0);
  });

  test('the auction model descends linearly to the 500 HYPE floor over 31 hours', () => {
    const start = HIP1.modelAuction({ startGas: 1000 });
    expect(start.durationHours).toBe(31);
    expect(start.floorGas).toBe(500);
    const mid = HIP1.modelAuction({ startGas: 1000, elapsedSeconds: start.durationSeconds / 2 });
    expect(mid.currentGas).toBeCloseTo(750, 3);
    const end = HIP1.modelAuction({ startGas: 1000, elapsedSeconds: start.durationSeconds });
    expect(end.currentGas).toBeCloseTo(500, 3);
  });

  test('the fee-side matrix is explicit that HIP-1 captures the base side only', () => {
    expect(HIP1.FEE_SIDE_MATRIX.hip1DeployerFeeShare.side).toBe('base');
    expect(HIP1.FEE_SIDE_MATRIX.builderCodes.side).toBe('quote');
    expect(HIP1.FEE_SIDE_MATRIX.builderCodes.capture).toContain('1%');
  });
});

// ────────────────────────── hyperliquid client ─────────────────────────────

describe('Hyperliquid client — gating', () => {
  const saved = {};
  beforeEach(() => {
    saved.enabled = process.env.HYPERLIQUID_TRADING_ENABLED;
    saved.key = process.env.HYPERLIQUID_PRIVATE_KEY;
    saved.addr = process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
    saved.sdk = process.env.HYPERLIQUID_SDK;
    process.env.HYPERLIQUID_SDK = 'none';
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test('trading is refused with a precise reason list', () => {
    delete process.env.HYPERLIQUID_TRADING_ENABLED;
    delete process.env.HYPERLIQUID_PRIVATE_KEY;
    delete process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
    const readiness = HL.tradingReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.join(' ')).toContain('HYPERLIQUID_TRADING_ENABLED');
    expect(readiness.reasons.join(' ')).toContain('PRIVATE_KEY');
    expect(readiness.reasons.join(' ')).toContain('ACCOUNT_ADDRESS');
    expect(() => HL.assertTradingEnabled()).toThrow(/disabled/i);
  });

  test('a bad address is rejected before any network call', async () => {
    // getClearinghouseState is async, so the validation surfaces as a rejected
    // promise. The important part is that it rejects WITHOUT hitting the network.
    await expect(HL.getClearinghouseState('not-an-address')).rejects.toThrow(/hex address/i);
    await expect(HL.getSpotClearinghouseState('0x123')).rejects.toThrow(/hex address/i);
  });

  test('info() normalizes an HTTP failure into a typed error', async () => {
    const original = global.fetch;
    global.fetch = async () => ({ ok: false, status: 503, text: async () => 'upstream down' });
    try {
      await expect(HL.info({ type: 'meta' })).rejects.toThrow(/HTTP 503/);
    } finally {
      global.fetch = original;
    }
  });

  test('info() parses a JSON body', async () => {
    const original = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ universe: [{ name: 'BTC' }] }) });
    try {
      const meta = await HL.getPerpMeta();
      expect(meta[0].name).toBe('BTC');
    } finally {
      global.fetch = original;
    }
  });
});
