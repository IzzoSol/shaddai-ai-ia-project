// x402-ledger.js — prepaid-balance ledger for SHADDAI's x402.
// JSON-file persistence (no database). Accounts pre-fund a balance and spend it down.
// Defensive by design: never throws on bad input; rounds money to 6 decimals.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'x402-ledger.json');

// ---- helpers -------------------------------------------------------------

function round6(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  // round to 6 decimals, avoid -0 and float dust
  return Math.round(x * 1e6) / 1e6;
}

function toAmount(n) {
  const x = round6(n);
  return Number.isFinite(x) ? x : 0;
}

function normAccount(account) {
  if (account === null || account === undefined) return '';
  return String(account).trim();
}

function defaultState() {
  // accounts: { [account]: { balance: number, entries: [ {type, amount, ref, at} ] } }
  return { accounts: {}, totalCredited: 0, totalDebited: 0 };
}

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) { /* ignore */ }
}

function readState() {
  try {
    if (!fs.existsSync(LEDGER_FILE)) return defaultState();
    const raw = fs.readFileSync(LEDGER_FILE, 'utf8');
    if (!raw || !raw.trim()) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultState();
    if (!parsed.accounts || typeof parsed.accounts !== 'object') parsed.accounts = {};
    if (!Number.isFinite(parsed.totalCredited)) parsed.totalCredited = 0;
    if (!Number.isFinite(parsed.totalDebited)) parsed.totalDebited = 0;
    return parsed;
  } catch (_) {
    return defaultState();
  }
}

function writeState(state) {
  try {
    ensureDir();
    // atomic-ish: write to temp file then rename over the target
    const tmp = LEDGER_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, LEDGER_FILE);
    return true;
  } catch (_) {
    return false;
  }
}

function getAccount(state, account) {
  let acct = state.accounts[account];
  if (!acct || typeof acct !== 'object') {
    acct = { balance: 0, entries: [] };
    state.accounts[account] = acct;
  }
  if (!Number.isFinite(acct.balance)) acct.balance = 0;
  if (!Array.isArray(acct.entries)) acct.entries = [];
  return acct;
}

// ---- public API ----------------------------------------------------------

function getBalance(account) {
  const acc = normAccount(account);
  if (!acc) return 0;
  const state = readState();
  const acct = state.accounts[acc];
  if (!acct || !Number.isFinite(acct.balance)) return 0;
  return round6(acct.balance);
}

function credit(account, amountUsd, ref) {
  const acc = normAccount(account);
  if (!acc) return 0;
  const amount = toAmount(amountUsd);
  if (amount <= 0) return getBalance(acc); // ignore non-positive credits

  const state = readState();
  const acct = getAccount(state, acc);
  acct.balance = round6(acct.balance + amount);
  acct.entries.push({
    type: 'credit',
    amount,
    ref: ref === undefined || ref === null ? '' : String(ref),
    at: new Date().toISOString()
  });
  state.totalCredited = round6(state.totalCredited + amount);
  writeState(state);
  return acct.balance;
}

function debit(account, amountUsd, ref) {
  const acc = normAccount(account);
  const amount = toAmount(amountUsd);

  if (!acc) {
    return { ok: false, error: 'insufficient balance', balance: 0, needed: amount };
  }
  if (amount <= 0) {
    // nothing to debit; treat as a no-op success against current balance
    return { ok: true, balance: getBalance(acc) };
  }

  const state = readState();
  const acct = getAccount(state, acc);
  const balance = round6(acct.balance);

  if (balance < amount) {
    return {
      ok: false,
      error: 'insufficient balance',
      balance,
      needed: round6(amount - balance)
    };
  }

  acct.balance = round6(balance - amount);
  acct.entries.push({
    type: 'debit',
    amount,
    ref: ref === undefined || ref === null ? '' : String(ref),
    at: new Date().toISOString()
  });
  state.totalDebited = round6(state.totalDebited + amount);
  writeState(state);
  return { ok: true, balance: acct.balance };
}

function history(account, limit = 50) {
  const acc = normAccount(account);
  if (!acc) return [];
  const state = readState();
  const acct = state.accounts[acc];
  if (!acct || !Array.isArray(acct.entries)) return [];
  let n = parseInt(limit, 10);
  if (!Number.isFinite(n) || n <= 0) n = 50;
  return acct.entries.slice(-n).reverse();
}

function stats() {
  const state = readState();
  const accountNames = Object.keys(state.accounts || {});
  let totalBalance = 0;
  for (const name of accountNames) {
    const acct = state.accounts[name];
    if (acct && Number.isFinite(acct.balance)) totalBalance += acct.balance;
  }
  return {
    accounts: accountNames.length,
    totalCredited: round6(state.totalCredited || 0),
    totalDebited: round6(state.totalDebited || 0),
    totalBalance: round6(totalBalance)
  };
}

module.exports = {
  getBalance,
  credit,
  debit,
  history,
  stats
};
