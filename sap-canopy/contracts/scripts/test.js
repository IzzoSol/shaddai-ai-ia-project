#!/usr/bin/env node
'use strict';
// ---------------------------------------------------------------------------
// test.js
//
// The behavioural suite for the S.A.P. AgentPay + TreeNFT contracts.
//
// Deploys the contracts and the hostile mocks to a local ganache chain and
// asserts every spec flaw fix end-to-end against real deployed bytecode.
//
//   node scripts/test.js
//
// Why ganache and not forge: Foundry is not installed on this machine
// (`forge` / `anvil` are absent). The equivalent Forge suites live in
// test/AgentPay.t.sol and test/TreeNFT.t.sol and are type-checked by
// scripts/check-foundry.js, but THIS is the suite that actually executes.
//
// Each assertion is named after the defect it pins down, so a failure reads as
// a regression against a known defect rather than a mystery.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');

// ── the six flaws, and the five from the original spec sketch ──────────────
// FLAW 1  uint8 chainId cannot hold Base's 8453, and was hardcoded.
// FLAW 2  ERC20 return values ignored -> USDT (no return) / false-return tokens.
// FLAW 3  the 1% tree fund was transferred to the contract itself (a no-op).
// FLAW 4  the REQUESTED bounty was recorded, so fee-on-transfer tokens
//         left the contract insolvent.
// FLAW 5  no cancel / timeout / expiry / zero-address check -> locked funds.
// FLAW 6  jobCounter started at 0, so the FIRST job got id 0 -- which is the
//         "no such job" sentinel. Job 0 was unreadable, uncompletable,
//         uncancellable and unexpirable. Its bounty was locked forever.

const FILES = ['src/AgentPay.sol', 'src/TreeNFT.sol', 'test/mocks/Mocks.sol'];

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

function findImports(importPath) {
  const resolved = path.resolve(NM, importPath);
  if (!resolved.startsWith(NM)) return { error: 'import outside node_modules rejected: ' + importPath };
  if (!fs.existsSync(resolved)) return { error: 'import not found: ' + importPath };
  return { contents: fs.readFileSync(resolved, 'utf8') };
}

function compileAll() {
  const sources = {};
  for (const f of FILES) {
    sources[f] = { content: fs.readFileSync(path.join(ROOT, f), 'utf8') };
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) {
    for (const e of errors) console.error(e.formattedMessage || e.message);
    throw new Error('compile failed');
  }
  const bundle = {};
  for (const f of FILES) {
    const unit = output.contracts[f] || {};
    for (const name of Object.keys(unit)) {
      bundle[name] = { abi: unit[name].abi, bytecode: '0x' + unit[name].evm.bytecode.object };
    }
  }
  return bundle;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond, extra) {
  if (cond) {
    passed++;
    console.log('  [PASS] ' + label + (extra ? '  ' + extra : ''));
  } else {
    failed++;
    failures.push(label);
    console.log('  [FAIL] ' + label + (extra ? '  ' + extra : ''));
  }
}

function eq(label, actual, expected) {
  // Normalise bigint / number / string so 8453n and 8453 and "8453" compare
  // equal. Ethers v6 returns bigint, the ganache network object returns a
  // bigint, and some values arrive as strings.
  const norm = (v) => (typeof v === 'bigint' ? v.toString() : typeof v === 'number' ? String(v) : v);
  const a = norm(actual);
  const e = norm(expected);
  ok(label, a === e, a === e ? '' : 'got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(e));
}

// ---------------------------------------------------------------------------
// Revert decoding
//
// ethers v6 has no expectRevert helper, so we decode it ourselves.
//
// Two things make this non-trivial:
//
//  1. When a STATE-CHANGING call is sent, ethers runs `estimateGas` first.
//     Ganache's estimateGas error carries NO decoded revert data, so the
//     custom error is lost before the transaction is ever mined. Every
//     revert assertion therefore uses `.staticCall(...)` -- an `eth_call`,
//     which returns the raw revert data intact.
//
//  2. Some of the errors we care about are NOT in the contract's own ABI.
//     `SafeERC20FailedOperation(address)` comes from OpenZeppelin's
//     SafeERC20 and is raised by AgentPay's token transfer, but it is not
//     declared in AgentPay, so the contract interface cannot decode it. It
//     has to be decoded with a standalone interface.
// ---------------------------------------------------------------------------

const AGENTPAY_ERRORS = [
  'ZeroBounty()',
  'NoTokensReceived()',
  'PromptTooLong()',
  'UnknownJob()',
  'JobNotOpen()',
  'JobExpired_()',
  'NotPoster()',
  'NotSettler()',
  'ZeroAddress()',
  'ZeroAmount()',
  'InsufficientTreeFund()',
  'WrongRecipient()',
  'TreeNFTNotSet()',
  'TreeMintFailed()',
  'NothingToCancel()',
];

const TREENFT_ERRORS = [
  'NotMinter()',
  'NotVerifier()',
  'NotAuthorized()',
  'JobIdZero()',
  'JobAlreadyMinted()',
  'AlreadyPlanted()',
  'NonexistentToken()',
];

// Declared by OpenZeppelin v5 SafeERC20 -- raised by AgentPay's transfers,
// but absent from AgentPay's ABI.
const SAFE_ERC20_ERRORS = [
  'SafeERC20FailedOperation(address token)',
  'SafeERC20FailedDecreaseAllowance(address spender,uint256 currentAllowance,uint256 requestedDecrease)',
];

const ERROR_INTERFACE = new ethers.Interface(
  AGENTPAY_ERRORS.concat(TREENFT_ERRORS).concat(SAFE_ERC20_ERRORS).map((s) => 'error ' + s)
);

/** Pull the raw revert data hex out of whatever shape ethers/ganache threw. */
function extractRevertData(e) {
  const candidates = [
    e && e.data,
    e && e.info && e.info.error && e.info.error.data,
    e && e.info && e.info.error && e.info.error.data && e.info.error.data.data,
    e && e.error && e.error.data,
    e && e.receipt && e.receipt.revertReason,
    e && e.reason,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(c)) return c;
    if (c && typeof c === 'object' && typeof c.data === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(c.data)) {
      return c.data;
    }
  }
  // Last resort: a hex blob embedded in the message.
  const msg = String((e && (e.shortMessage || e.message)) || '');
  const m = msg.match(/0x[0-9a-fA-F]{40,}/);
  return m ? m[0] : null;
}

/** Resolve the custom error name from a raw revert payload. */
function decodeErrorName(e) {
  // 1. ethers already decoded it for us (the error is in the contract ABI).
  if (e && e.revert && e.revert.name) return e.revert.name;

  // 2. Decode the raw payload with the combined interface.
  const data = extractRevertData(e);
  if (data) {
    try {
      const parsed = ERROR_INTERFACE.parseError(data);
      if (parsed && parsed.name) return parsed.name;
    } catch (_) {
      /* fall through */
    }
  }

  // 3. ethers may still have put the name in the message.
  const msg = String((e && (e.shortMessage || e.message)) || '');
  const m = msg.match(/custom error '([A-Za-z0-9_]+)\(/);
  if (m) return m[1];
  return null;
}

/**
 * Assert that a call reverts with a specific custom error.
 *
 * `fn` MUST use `.staticCall(...)` for state-changing methods -- see the note
 * above about estimateGas discarding the revert data.
 */
async function expectRevertWith(label, fn, errorName) {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    const name = decodeErrorName(e);
    const msg = String((e && (e.shortMessage || e.message)) || '');
    if (name === errorName || msg.indexOf(errorName) !== -1) {
      ok(label, true, '(' + (name || errorName) + ')');
      return;
    }
    const raw = extractRevertData(e);
    ok(
      label,
      false,
      'expected ' + errorName +
        ' but got: ' + (name || msg.split('\n')[0] || 'unknown') +
        (raw ? ' [' + raw.slice(0, 10) + '...]' : ' [no revert data]')
    );
    return;
  }
  ok(label, false, 'expected ' + errorName + ' but the call SUCCEEDED' + (threw ? '' : ''));
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeProvider() {
  return new ethers.BrowserProvider(
    ganache.provider({
      logging: { quiet: true },
      wallet: { totalAccounts: 10, defaultBalance: 1000 },
      chain: { chainId: 8453, networkId: 8453, hardfork: 'shanghai' },
    }),
    'any'
  );
}

async function deployer(bundle, provider, name, args) {
  const signer = await provider.getSigner(0);
  const factory = new ethers.ContractFactory(bundle[name].abi, bundle[name].bytecode, signer);
  const c = await factory.deploy.apply(factory, args || []);
  await c.waitForDeployment();
  return c;
}

/** A full AgentPay + TreeNFT + MockERC20 rig, wired together. */
async function rig(bundle, provider) {
  const token = await deployer(bundle, provider, 'MockERC20');
  const nft = await deployer(bundle, provider, 'TreeNFT', [(await provider.getSigner(0)).address]);
  const pay = await deployer(bundle, provider, 'AgentPay', [await token.getAddress(), (await provider.getSigner(0)).address]);
  await (await nft.setMinter(await pay.getAddress())).wait();
  await (await pay.setTreeNFT(await nft.getAddress())).wait();
  return { token, nft, pay };
}

async function main() {
  console.log('solc ' + solc.version());
  const bundle = compileAll();
  const provider = makeProvider();
  const signer = await provider.getSigner(0);
  const me = await signer.getAddress();

  console.log('\n=== the chain ===');
  {
    const net = await provider.getNetwork();
    const { pay } = await rig(bundle, provider);
    eq('the test chain id is 8453 (Base)', net.chainId, 8453);
    eq('AgentPay.chainId() matches the chain', await pay.chainId(), net.chainId);
  }

  // ── FLAW 1 ───────────────────────────────────────────────────────────────
  console.log('\n=== FLAW 1: chainId is uint256 and comes from the chain ===');
  {
    const { pay } = await rig(bundle, provider);
    const chainId = await pay.chainId();
    ok('chainId() is not truncated to a uint8', chainId > 255n, 'chainId=' + chainId.toString());
    ok('chainId() equals block.chainid', chainId === (await provider.getNetwork()).chainId);
    const abi = bundle.AgentPay.abi.find((x) => x.type === 'function' && x.name === 'chainId');
    eq('the ABI declares chainId as uint256', abi.outputs[0].type, 'uint256');
  }

  // ── FLAW 6 ───────────────────────────────────────────────────────────────
  console.log('\n=== FLAW 6: the first job id is 1, never the 0 sentinel ===');
  {
    const { token, nft, pay } = await rig(bundle, provider);
    const poster = await provider.getSigner(1);
    const posterAddr = await poster.getAddress();
    const winner = await provider.getSigner(2);
    const winnerAddr = await winner.getAddress();

    await (await token.mint(posterAddr, 1000000n)).wait();
    await (await token.connect(poster).approve(await pay.getAddress(), 1000000n)).wait();

    eq('FIRST_JOB_ID is 1', await pay.FIRST_JOB_ID(), 1n);
    eq('a fresh contract issues ids from 1', await pay.jobCounter(), 1n);

    const jobId = await pay.connect(poster).postJob.staticCall('the first job', 100000n);
    eq('the first postJob returns job id 1', jobId, 1n);
    await (await pay.connect(poster).postJob('the first job', 100000n)).wait();
    eq('jobCounter is 2 after one post', await pay.jobCounter(), 2n);

    const j = await pay.job(1);
    eq('job(1) resolves', j.jobId, 1n);
    eq('job(1) recorded the bounty', j.bounty, 100000n);

    await expectRevertWith('job(0) still reverts with UnknownJob', () => pay.job.staticCall(0), 'UnknownJob');

    const before = await token.balanceOf(winnerAddr);
    await (await pay.connect(poster).completeJob(1, winnerAddr)).wait();
    const after = await token.balanceOf(winnerAddr);
    eq('completeJob(1) pays the winner 99%', after - before, 99000n);
    eq('the contract retains exactly the 1% tree fund', await token.balanceOf(await pay.getAddress()), 1000n);
    eq('the tree claim was minted for job 1', await nft.tokenIdForJob(1), 1n);
  }

  // ── FLAW 2 ───────────────────────────────────────────────────────────────
  console.log('\n=== FLAW 2: ERC20 return values are handled (USDT shape) ===');
  {
    // A token whose transfer returns NOTHING, exactly like USDT.
    const nr = await deployer(bundle, provider, 'NoReturnToken');
    const nft = await deployer(bundle, provider, 'TreeNFT', [me]);
    const pay = await deployer(bundle, provider, 'AgentPay', [await nr.getAddress(), me]);
    await (await nft.setMinter(await pay.getAddress())).wait();
    await (await pay.setTreeNFT(await nft.getAddress())).wait();

    const poster = await provider.getSigner(1);
    const posterAddr = await poster.getAddress();
    const winner = await provider.getSigner(2);
    const winnerAddr = await winner.getAddress();

    await (await nr.mint(posterAddr, 1000000n)).wait();
    await (await nr.connect(poster).approve(await pay.getAddress(), 1000000n)).wait();
    await (await pay.connect(poster).postJob('usdt shaped job', 100000n)).wait();

    const before = await nr.balanceOf(winnerAddr);
    await (await pay.connect(poster).completeJob(1, winnerAddr)).wait();
    const after = await nr.balanceOf(winnerAddr);

    eq('a no-return token still PAYS the winner', after - before, 99000n);
    eq('the tree fund still accrues at 1%', await pay.treeFundAccrued(), 1000n);
    ok('the job is marked completed', (await pay.job(1)).completed === true);
  }
  {
    // A token that transfers the funds and then LIES, returning false.
    const fr = await deployer(bundle, provider, 'FalseReturnToken');
    const nft = await deployer(bundle, provider, 'TreeNFT', [me]);
    const pay = await deployer(bundle, provider, 'AgentPay', [await fr.getAddress(), me]);
    await (await nft.setMinter(await pay.getAddress())).wait();
    await (await pay.setTreeNFT(await nft.getAddress())).wait();

    const poster = await provider.getSigner(1);
    const posterAddr = await poster.getAddress();
    const winner = await provider.getSigner(2);
    const winnerAddr = await winner.getAddress();

    await (await fr.mint(posterAddr, 1000000n)).wait();
    await (await fr.connect(poster).approve(await pay.getAddress(), 1000000n)).wait();
    await (await pay.connect(poster).postJob('lying token job', 100000n)).wait();

    await expectRevertWith(
      'a false-return token makes completeJob REVERT',
      () => pay.connect(poster).completeJob.staticCall(1, winnerAddr),
      'SafeERC20FailedOperation'
    );
    ok('the job is still open after the failed payment', (await pay.job(1)).completed === false);
    eq('nothing was booked to the tree fund', await pay.treeFundAccrued(), 0n);
    eq('the winner received nothing', await fr.balanceOf(winnerAddr), 0n);
  }

  // ── FLAW 3 ───────────────────────────────────────────────────────────────
  console.log('\n=== FLAW 3: the tree fund is BOOKED and only the settler may release it ===');
  {
    const { token, pay } = await rig(bundle, provider);
    const recipient = (await provider.getSigner(3)).address;
    const settler = await provider.getSigner(4);
    const settlerAddr = await settler.getAddress();
    const stranger = await provider.getSigner(5);
    const strangerAddr = await stranger.getAddress();
    const poster = await provider.getSigner(1);
    const posterAddr = await poster.getAddress();
    const winner = await provider.getSigner(2);
    const winnerAddr = await winner.getAddress();

    await (await pay.setTreeFundRecipient(recipient)).wait();
    await (await pay.setSettler(settlerAddr)).wait();

    await (await token.mint(posterAddr, 1000000n)).wait();
    await (await token.connect(poster).approve(await pay.getAddress(), 1000000n)).wait();
    await (await pay.connect(poster).postJob('tree fund job', 100000n)).wait();
    await (await pay.connect(poster).completeJob(1, winnerAddr)).wait();

    eq('the tree fund is booked at exactly 1%', await pay.treeFundAccrued(), 1000n);
    eq('nothing has been released yet', await pay.treeFundReleased(), 0n);
    eq('the winner got 99%', await token.balanceOf(winnerAddr), 99000n);
    eq('the contract holds the tree fund', await token.balanceOf(await pay.getAddress()), 1000n);

    await expectRevertWith(
      'a stranger cannot release the tree fund',
      () => pay.connect(stranger).releaseTreeFund.staticCall(1000n),
      'NotSettler'
    );
    await expectRevertWith(
      'the poster cannot release the tree fund',
      () => pay.connect(poster).releaseTreeFund.staticCall(1000n),
      'NotSettler'
    );
    await expectRevertWith(
      'an over-release is rejected',
      () => pay.connect(settler).releaseTreeFund.staticCall(1001n),
      'InsufficientTreeFund'
    );
    await expectRevertWith(
      'a zero-amount release is rejected',
      () => pay.connect(settler).releaseTreeFund.staticCall(0n),
      'ZeroAmount'
    );

    await (await pay.connect(settler).releaseTreeFund(1000n)).wait();
    eq('the settler releases to the designated recipient', await token.balanceOf(recipient), 1000n);
    eq('the accrued balance falls to zero', await pay.treeFundAccrued(), 0n);
    eq('the released total is recorded', await pay.treeFundReleased(), 1000n);
  }

  // ── FLAW 4 ───────────────────────────────────────────────────────────────
  console.log('\n=== FLAW 4: a fee-on-transfer token cannot make the books insolvent ===');
  {
    const ft = await deployer(bundle, provider, 'FeeOnTransferToken'); // 3%, like $ASIMOV
    const nft = await deployer(bundle, provider, 'TreeNFT', [me]);
    const pay = await deployer(bundle, provider, 'AgentPay', [await ft.getAddress(), me]);
    await (await nft.setMinter(await pay.getAddress())).wait();
    await (await pay.setTreeNFT(await nft.getAddress())).wait();

    const poster = await provider.getSigner(1);
    const posterAddr = await poster.getAddress();
    const winner = await provider.getSigner(2);
    const winnerAddr = await winner.getAddress();

    await (await ft.mint(posterAddr, 1000000n)).wait();
    await (await ft.connect(poster).approve(await pay.getAddress(), 1000000n)).wait();
    await (await pay.connect(poster).postJob('fee on transfer job', 100000n)).wait();

    eq('the ACTUAL received amount is recorded, not the requested one', (await pay.job(1)).bounty, 97000n);

    await (await pay.connect(poster).completeJob(1, winnerAddr)).wait();

    eq('the tree fund is 1% of what actually arrived', await pay.treeFundAccrued(), 970n);
    const payout = (97000n * 9900n) / 10000n; // 96030
    const feeOnPayout = (payout * 300n) / 10000n; // 2880
    eq('the winner receives the payout net of the token fee', await ft.balanceOf(winnerAddr), payout - feeOnPayout);
    ok(
      'the contract still holds at least the booked tree fund',
      (await ft.balanceOf(await pay.getAddress())) >= (await pay.treeFundAccrued()),
      'held=' + (await ft.balanceOf(await pay.getAddress())).toString() + ' accrued=' + (await pay.treeFundAccrued()).toString()
    );
  }

  // ── FLAW 5 ───────────────────────────────────────────────────────────────
  console.log('\n=== FLAW 5: a bounty can never be locked forever ===');
  {
    const { token, pay } = await rig(bundle, provider);
    const poster = await provider.getSigner(1);
    const posterAddr = await poster.getAddress();
    const stranger = await provider.getSigner(5);
    const winner = await provider.getSigner(2);
    const winnerAddr = await winner.getAddress();

    await (await token.mint(posterAddr, 1000000n)).wait();
    await (await token.connect(poster).approve(await pay.getAddress(), 1000000n)).wait();

    // cancel by the poster
    await (await pay.connect(poster).postJob('cancel me', 100000n)).wait();
    const beforeCancel = await token.balanceOf(posterAddr);
    await expectRevertWith(
      'a stranger cannot cancel someone else\'s job',
      () => pay.connect(stranger).cancelJob.staticCall(1),
      'NotPoster'
    );
    await (await pay.connect(poster).cancelJob(1)).wait();
    eq('cancelling refunds the full bounty', await token.balanceOf(posterAddr), beforeCancel + 100000n);
    ok('the job is marked cancelled', (await pay.job(1)).cancelled === true);

    // expire by anyone, after the deadline
    await (await pay.connect(poster).postJob('expire me', 100000n)).wait();
    await expectRevertWith(
      'expiring before the deadline is rejected',
      () => pay.connect(stranger).expireJob.staticCall(2),
      'JobNotOpen'
    );
    const beforeExpire = await token.balanceOf(posterAddr);
    await provider.send('evm_increaseTime', [30 * 24 * 3600 + 10]);
    await provider.send('evm_mine', []);
    await (await pay.connect(stranger).expireJob(2)).wait();
    eq('ANYONE can expire an overdue job and the poster is refunded', await token.balanceOf(posterAddr), beforeExpire + 100000n);

    // zero address
    await (await pay.connect(poster).postJob('zero winner', 100000n)).wait();
    await expectRevertWith(
      'the zero address may not win',
      () => pay.connect(poster).completeJob.staticCall(3, '0x0000000000000000000000000000000000000000'),
      'ZeroAddress'
    );

    // bounded prompt
    await expectRevertWith(
      'a prompt longer than 1024 bytes is rejected',
      () => pay.connect(poster).postJob.staticCall('x'.repeat(1025), 100000n),
      'PromptTooLong'
    );

    // zero bounty
    await expectRevertWith(
      'a zero bounty is rejected',
      () => pay.connect(poster).postJob.staticCall('free work?', 0n),
      'ZeroBounty'
    );

    // only the poster may complete
    await expectRevertWith(
      'only the poster may complete a job',
      () => pay.connect(stranger).completeJob.staticCall(3, winnerAddr),
      'NotPoster'
    );

    // extend
    const original = (await pay.job(3)).deadline;
    await expectRevertWith(
      'a stranger may not extend a deadline',
      () => pay.connect(stranger).extendJob.staticCall(3, original + 100n),
      'NotPoster'
    );
    await (await pay.connect(poster).extendJob(3, original + 86400n)).wait();
    eq('the poster may extend the deadline', (await pay.job(3)).deadline, original + 86400n);
  }

  // ── Core flow ────────────────────────────────────────────────────────────
  console.log('\n=== the core job flow ===');
  {
    const { token, nft, pay } = await rig(bundle, provider);
    const poster = await provider.getSigner(1);
    const posterAddr = await poster.getAddress();
    const winner = await provider.getSigner(2);
    const winnerAddr = await winner.getAddress();

    await (await token.mint(posterAddr, 1000000n)).wait();
    await (await token.connect(poster).approve(await pay.getAddress(), 1000000n)).wait();

    await (await pay.connect(poster).postJob('render the sap forest site flythrough', 100000n)).wait();
    await (await pay.connect(poster).completeJob(1, winnerAddr)).wait();

    const j = await pay.job(1);
    ok('the job is completed', j.completed === true);
    eq('the winner is recorded on the job', j.selectedWinner, winnerAddr);
    eq('the winner is paid 99%', await token.balanceOf(winnerAddr), 99000n);
    eq('the tree fund is booked at 1%', await pay.treeFundAccrued(), 1000n);
    eq('a tree claim was minted', await nft.totalMinted(), 1n);
    eq('the claim is owned by the winner', await nft.ownerOf(1), winnerAddr);
    eq('the claim points back at the job', (await nft.record(1)).jobId, 1n);
    eq('the escrow for open jobs is zero', await pay.escrowedBalance(), 0n);
    eq('the contract holds exactly the tree fund', await pay.totalHeld(), 1000n);
  }

  // ── TreeNFT: monotonic ids, roles, proof of tree ────────────────────────
  console.log('\n=== TreeNFT: monotonic ids, roles and Proof-of-Tree ===');
  {
    const { nft } = await rig(bundle, provider);
    const minter = await provider.getSigner(0);
    const minterAddr = await minter.getAddress();
    const stranger = await provider.getSigner(5);
    const winner = await provider.getSigner(2);
    const winnerAddr = await winner.getAddress();

    await (await nft.setMinter(minterAddr)).wait();
    await (await nft.setVerifier(stranger.address)).wait();

    // The SAME winner wins two jobs -> two distinct token ids.
    const t1 = await nft.connect(minter).mintForJob.staticCall(winnerAddr, 1, '');
    await (await nft.connect(minter).mintForJob(winnerAddr, 1, '')).wait();
    const t2 = await nft.connect(minter).mintForJob.staticCall(winnerAddr, 2, '');
    await (await nft.connect(minter).mintForJob(winnerAddr, 2, '')).wait();

    eq('the first token id is 1', t1, 1n);
    eq('the second token id is 2 -- no collision', t2, 2n);
    ok('the token ids are distinct', t1 !== t2);
    eq('the FIRST record is still intact', (await nft.record(t1)).jobId, 1n);
    eq('the SECOND record points at job 2', (await nft.record(t2)).jobId, 2n);
    eq('totalMinted counts both', await nft.totalMinted(), 2n);
    eq('tokenIdForJob resolves job 1', await nft.tokenIdForJob(1), 1n);
    eq('tokenIdForJob resolves job 2', await nft.tokenIdForJob(2), 2n);

    await expectRevertWith(
      'a non-minter cannot mint',
      () => nft.connect(stranger).mintForJob.staticCall(winnerAddr, 3, ''),
      'NotMinter'
    );
    await expectRevertWith(
      'job id 0 is rejected',
      () => nft.connect(minter).mintForJob.staticCall(winnerAddr, 0, ''),
      'JobIdZero'
    );
    await expectRevertWith(
      'the same job cannot mint twice',
      () => nft.connect(minter).mintForJob.staticCall(winnerAddr, 1, ''),
      'JobAlreadyMinted'
    );

    // Proof of Tree
    await (await nft.connect(stranger).markPlanted(1, 'treegens-proof-of-tree-ref')).wait();
    const rec = await nft.record(1);
    ok('the verifier can confirm planting', rec.planted === true);
    eq('the Treegens reference is stored on-chain', rec.treegensRef, 'treegens-proof-of-tree-ref');
    const other = await provider.getSigner(6);
    await expectRevertWith(
      'a stranger cannot confirm planting',
      () => nft.connect(other).markPlanted.staticCall(1, 'ref'),
      'NotAuthorized'
    );
    await expectRevertWith(
      'planting cannot be confirmed twice',
      () => nft.connect(stranger).markPlanted.staticCall(1, 'ref'),
      'AlreadyPlanted'
    );

    // Metadata is self-contained JSON -- no IPFS, no host to go down.
    const uri = await nft.tokenURI(1);
    ok('the token URI names the tree', uri.indexOf('SHADDAI Tree #1') !== -1);
    ok('the token URI carries the Proof-of-Tree attribute', uri.indexOf('treegensProofOfTree') !== -1);
    ok('the token URI carries the planted flag', uri.indexOf('"planted","value":true') !== -1);
  }

  // ── Nothing moves ────────────────────────────────────────────────────────
  console.log('\n=== nothing moves: there is no route that can move user funds ===');
  {
    const { token, pay } = await rig(bundle, provider);
    const forbidden = ['payout', 'withdraw', 'transfer', 'send', 'settleToAccount', 'move', 'sweep', 'drain'];
    const present = forbidden.filter((m) => bundle.AgentPay.abi.some((x) => x.type === 'function' && x.name === m));
    ok('AgentPay exposes no payout/withdraw/transfer/send/move method', present.length === 0, present.length ? 'found: ' + present.join(', ') : '');

    // The ABI check above is necessary but not sufficient -- a function could
    // exist without being in the ABI. So the selectors are built BY HAND and
    // sent raw, which proves the contract has no matching entry point at all.
    // (Using abi.encodeFunctionData here would throw on the unknown name and
    // never send anything, so it would prove nothing.)
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const rawSelectors = {
      payout: 'payout(address,uint256)',
      withdraw: 'withdraw(uint256)',
      transfer: 'transfer(address,uint256)',
      send: 'send(address,uint256)',
      settleToAccount: 'settleToAccount(address,uint256)',
      move: 'move(address,uint256)',
      sweep: 'sweep(uint256)',
      drain: 'drain()',
    };
    const addrWord = coder.encode(['address'], [me]).slice(2);
    const uintWord = coder.encode(['uint256'], [1n]).slice(2);

    let anySucceeded = false;
    const successes = [];
    for (const m of forbidden) {
      const selector = ethers.id(rawSelectors[m]).slice(0, 10);
      const args = rawSelectors[m].endsWith('()')
        ? ''
        : rawSelectors[m].indexOf('address') !== -1
          ? addrWord + uintWord
          : uintWord;
      try {
        // eth_call, not estimateGas: this proves the EVM itself rejects the
        // call (no matching entry point, no fallback), rather than merely
        // proving that gas estimation failed.
        await provider.call({ to: await pay.getAddress(), from: me, data: selector + args });
        anySucceeded = true;
        successes.push(m);
      } catch (e) { /* expected: no such entry point, so the call reverts */ }
    }
    ok('no forbidden selector is callable on-chain', !anySucceeded, successes.length ? 'CALLABLE: ' + successes.join(', ') : '');

    // Sanity check that the probe is real: a selector that DOES exist must
    // be callable through the same path, otherwise the loop above would
    // pass vacuously because eth_call always failed.
    let knownSelectorWorked = false;
    try {
      await provider.call({
        to: await pay.getAddress(),
        from: me,
        data: ethers.id('escrowedBalance()').slice(0, 10),
      });
      knownSelectorWorked = true;
    } catch (e) { /* expected only if the probe itself is broken */ }
    ok('the forbidden-selector probe is not vacuous', knownSelectorWorked);

    // The tree-fund release is bounded by the accrued amount, so it can never
    // reach a poster's escrowed bounty. NOTE: one rig only -- the token and
    // the contract must be the same pair, or the approve goes to the wrong
    // token and the post fails on allowance rather than on the assertion.
    const poster = await provider.getSigner(1);
    const posterAddr = await poster.getAddress();
    await (await token.mint(posterAddr, 1000000n)).wait();
    await (await token.connect(poster).approve(await pay.getAddress(), 1000000n)).wait();
    await (await pay.connect(poster).postJob('escrowed', 100000n)).wait();

    // The tree-fund release is bounded by `treeFundAccrued`, so even an
    // AUTHORISED settler cannot reach a poster's escrowed bounty.
    //
    // NOTE: this call is made by signer 0, which is the deployer and
    // therefore the contract OWNER -- and the owner is allowed to release.
    // So the NotSettler check does not fire here; the bound that matters is
    // `amount > treeFundAccrued`, which reverts because nothing has accrued
    // yet. That is the stronger guarantee: authorisation alone cannot move
    // user escrow. The NotSettler path is asserted separately in the FLAW 3
    // block above, where a stranger and the poster are both rejected.
    await expectRevertWith(
      'even the owner cannot release the tree fund against user escrow',
      () => pay.releaseTreeFund.staticCall(1n),
      'InsufficientTreeFund'
    );
    eq('the poster escrow is untouched', await pay.totalHeld(), 100000n);
    eq('the escrow for open jobs is the full bounty', await pay.escrowedBalance(), 100000n);

    // And once a tree fund HAS accrued, releasing it still cannot touch the
    // open job's escrow -- the two pots stay separate.
    await (await pay.connect(poster).completeJob(1, (await provider.getSigner(2)).getAddress())).wait();
    const accrued = await pay.treeFundAccrued();
    eq('a completed job accrues exactly 1%', accrued, 1000n);
    await (await pay.releaseTreeFund(1000n)).wait();
    eq('the tree fund released equals the tree fund accrued', await pay.treeFundReleased(), 1000n);
    eq('no escrow remains once the only job is complete', await pay.escrowedBalance(), 0n);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(64));
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
  }
  console.log('='.repeat(64));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
