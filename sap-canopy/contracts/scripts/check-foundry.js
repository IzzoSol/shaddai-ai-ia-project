#!/usr/bin/env node
'use strict';
// ---------------------------------------------------------------------------
// check-foundry.js
//
// Type-checks the Foundry suites (test/AgentPay.t.sol, test/TreeNFT.t.sol)
// with solc, on a machine where Foundry is NOT installed.
//
// Why this exists: `forge` and `anvil` are absent here, so the Forge suites
// cannot be executed. But shipping Solidity that has never been compiled is
// how broken tests get committed. This script compiles them against a local
// stub of forge-std (test/forge-std-stub/Test.sol) so syntax errors, type
// errors and ABI mismatches are caught by the same compiler that builds the
// production contracts.
//
// It is NOT a test runner. The assertions live in scripts/test.js, which is
// the suite that actually executes. This script only proves the Forge code
// compiles.
//
//   node scripts/check-foundry.js
//
// Exit code 0 = the suites compile cleanly.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const STUB = path.join(ROOT, 'test', 'forge-std-stub');

const FILES = [
  'src/AgentPay.sol',
  'src/TreeNFT.sol',
  'test/mocks/Mocks.sol',
  'test/AgentPay.t.sol',
  'test/TreeNFT.t.sol',
];

function findImports(importPath) {
  // forge-std/Test.sol -> the local stub
  if (importPath === 'forge-std/Test.sol' || importPath.startsWith('forge-std/')) {
    const f = path.join(STUB, path.basename(importPath));
    if (!fs.existsSync(f)) return { error: 'forge-std stub not found: ' + importPath };
    return { contents: fs.readFileSync(f, 'utf8') };
  }
  // everything else resolves inside node_modules (OpenZeppelin)
  const resolved = path.resolve(NM, importPath);
  if (!resolved.startsWith(NM)) return { error: 'import outside node_modules rejected: ' + importPath };
  if (!fs.existsSync(resolved)) return { error: 'import not found: ' + importPath };
  return { contents: fs.readFileSync(resolved, 'utf8') };
}

function main() {
  console.log('solc ' + solc.version());

  const sources = {};
  for (const f of FILES) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) {
      console.log('  [SKIP] ' + f + ' not present');
      continue;
    }
    sources[f] = { content: fs.readFileSync(p, 'utf8') };
  }

  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi'] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
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

  let pass = 0;
  let fail = 0;
  const ok = (label, cond, extra) => {
    (cond ? pass++ : fail++);
    console.log((cond ? '  [PASS] ' : '  [FAIL] ') + label + (extra ? '  ' + extra : ''));
  };

  ok('no compile errors in the Foundry suites', errors.length === 0, errors.length ? errors.length + ' error(s)' : '');
  ok('no compile warnings in the Foundry suites', warnings.length === 0, warnings.length ? warnings.length + ' warning(s)' : '');

  const units = output.contracts || {};
  let total = 0;
  for (const f of FILES) {
    for (const name of Object.keys(units[f] || {})) {
      const abi = units[f][name].abi || [];
      const n = abi.filter((x) => x.type === 'function' && x.name.startsWith('test')).length;
      if (n) {
        console.log('  ' + f + ' -> ' + name + ': ' + n + ' test functions');
        total += n;
      }
    }
  }
  ok('the Foundry suites declare test functions', total > 0, total + ' total');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('NOTE: this proves the Forge suites COMPILE. The suite that EXECUTES');
  console.log('      the assertions is scripts/test.js (ganache + ethers).');
  process.exit(fail ? 1 : 0);
}

main();
