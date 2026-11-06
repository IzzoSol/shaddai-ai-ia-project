#!/usr/bin/env node
'use strict';
// ---------------------------------------------------------------------------
// compile.js
//
// Compiles the S.A.P. contracts with solc 0.8.24 and fails loudly on any
// error or warning. Foundry is not installed on this machine, so this script
// is the build gate for the production contracts.
//
//   node scripts/compile.js
//
// Output: build/contracts.json  (ABI + bytecode for each contract)
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'build');
const NODE_MODULES = path.join(ROOT, 'node_modules');

const SOURCES = ['AgentPay.sol', 'TreeNFT.sol'];

function findImports(importPath) {
  // Only ever resolve inside node_modules -- the contracts import nothing
  // else, and we do not want the compiler reaching anywhere unexpected.
  const resolved = path.resolve(NODE_MODULES, importPath);
  if (!resolved.startsWith(NODE_MODULES)) {
    return { error: 'import outside node_modules rejected: ' + importPath };
  }
  if (!fs.existsSync(resolved)) {
    return { error: 'import not found: ' + importPath };
  }
  return { contents: fs.readFileSync(resolved, 'utf8') };
}

function main() {
  console.log('solc ' + solc.version());

  const sources = {};
  for (const f of SOURCES) {
    sources['src/' + f] = { content: fs.readFileSync(path.join(SRC, f), 'utf8') };
  }

  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
      },
    },
  };

  const findImport = findImports;
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));

  let pass = 0;
  let fail = 0;
  const ok = (label, cond, extra) => {
    (cond ? pass++ : fail++);
    console.log((cond ? '  [PASS] ' : '  [FAIL] ') + label + (extra ? '  ' + extra : ''));
  };

  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  const warnings = (output.errors || []).filter((e) => e.severity === 'warning');

  if (errors.length) {
    console.log('\n--- solc errors ---');
    for (const e of errors) console.log(e.formattedMessage || e.message);
    console.log('--------------------');
  }
  if (warnings.length) {
    console.log('\n--- solc warnings ---');
    for (const w of warnings) console.log(w.formattedMessage || w.message);
    console.log('--------------------');
  }

  ok('no compile errors', errors.length === 0, errors.length ? errors.length + ' error(s)' : '');
  ok('no compile warnings', warnings.length === 0, warnings.length ? warnings.length + ' warning(s)' : '');

  const bundle = {};
  for (const f of SOURCES) {
    const name = path.basename(f, '.sol');
    const key = 'src/' + f;
    const c = output.contracts && output.contracts[key] && output.contracts[key][name];
    const hasCode = !!(c && c.evm && c.evm.bytecode && c.evm.bytecode.object);
    ok(name + ' compiled to bytecode', hasCode, hasCode ? c.evm.bytecode.object.length / 2 + ' bytes' : 'no bytecode');
    if (c) {
      bundle[name] = {
        abi: c.abi,
        bytecode: '0x' + c.evm.bytecode.object,
        deployedBytecode: '0x' + c.evm.deployedBytecode.object,
      };
    }
  }

  // Sanity checks on the ABI surface: the events and functions the S.A.P.
  // backend and the documentation rely on must actually exist.
  const ap = bundle.AgentPay && bundle.AgentPay.abi;
  const nft = bundle.TreeNFT && bundle.TreeNFT.abi;
  const has = (abi, name) => !!(abi && abi.some((x) => x.type === 'function' && x.name === name));
  const hasEvent = (abi, name) => !!(abi && abi.some((x) => x.type === 'event' && x.name === name));
  const hasError = (abi, name) => !!(abi && abi.some((x) => x.type === 'error' && x.name === name));

  if (ap) {
    for (const fn of ['postJob', 'completeJob', 'cancelJob', 'expireJob', 'extendJob', 'releaseTreeFund', 'sweepTreeFund', 'job', 'escrowedBalance']) {
      ok('AgentPay exposes ' + fn + '()', has(ap, fn));
    }
    for (const ev of ['JobPosted', 'JobCompleted', 'JobCancelled', 'JobExpired', 'TreeFundReleased']) {
      ok('AgentPay emits ' + ev, hasEvent(ap, ev));
    }
    ok('AgentPay uses custom errors', hasError(ap, 'ZeroBounty') && hasError(ap, 'NoTokensReceived'));
    // FLAW 1: chainId must be uint256, never uint8.
    const chainId = ap.find((x) => x.type === 'function' && x.name === 'chainId');
    const out = chainId && chainId.outputs && chainId.outputs[0];
    ok('chainId is uint256 (FLAW 1 fix)', !!out && out.type === 'uint256', out ? out.type : 'missing');
    // FLAW 6: the first job id must be 1 so the "no such job" sentinel (0)
    // can never collide with a real job. FIRST_JOB_ID is a public constant so
    // the invariant is assertable from outside the contract -- and therefore
    // assertable by the behavioural harness.
    ok('AgentPay exposes FIRST_JOB_ID() (FLAW 6 fix)', has(ap, 'FIRST_JOB_ID'));
    const firstId = ap.find((x) => x.type === 'function' && x.name === 'FIRST_JOB_ID');
    const fidOut = firstId && firstId.outputs && firstId.outputs[0];
    // solc emits public constants as `view` functions (not `constant: true`),
    // so the ABI check is on the output type and the view state mutability.
    ok(
      'FIRST_JOB_ID is a uint256 view constant',
      !!fidOut && fidOut.type === 'uint256' && firstId.stateMutability === 'view',
      fidOut ? fidOut.type + '/' + firstId.stateMutability : 'missing'
    );
    // The constructor must initialise the counter to FIRST_JOB_ID, not leave it
    // at 0. A source-level check is the only way to catch this statically --
    // the behavioural harness catches it dynamically.
    const agentPaySrc = sources['src/AgentPay.sol'].content;
    ok('constructor sets jobCounter = FIRST_JOB_ID (FLAW 6 fix)', /jobCounter\s*=\s*FIRST_JOB_ID\s*;/.test(agentPaySrc));
  }
  if (nft) {
    for (const fn of ['mintForJob', 'markPlanted', 'tokenIdForJob', 'record', 'totalMinted', 'tokenURI']) {
      ok('TreeNFT exposes ' + fn + '()', has(nft, fn));
    }
    for (const ev of ['TreeMinted', 'TreePlanted']) {
      ok('TreeNFT emits ' + ev, hasEvent(nft, ev));
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'contracts.json'), JSON.stringify(bundle, null, 2));
  console.log('\nwrote ' + path.relative(ROOT, path.join(OUT, 'contracts.json')));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
