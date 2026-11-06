// backend/services/reputation-service.js
// ─────────────────────────────────────────────────────────────────────────
// SHADDAI Phase 0 · Item 3 — Reputation service v1 + Verifiable Credentials.
//
// Records attestations (x402 success, task completion, peer endorsement),
// computes a recency-weighted reputation score per DID, and issues compact
// Ed25519-signed Verifiable Credentials.
//
// Design note: Grok suggested @digitalbazaar/vc (JSON-LD LD-proofs, heavy/ESM).
// To stay boot-safe in this CommonJS service, VCs are signed with node:crypto
// Ed25519 over the canonical credential JSON (compact proof, cryptographically
// sound + verifiable). Reuses did:key helpers from ../middleware/did-resolver.
// Issuer key: env SHADDAI_ISSUER_PRIVATE_KEY (PEM) if set, else an EPHEMERAL
// in-memory key (VCs are re-issuable on demand; set the env for a stable issuer).
// No private key is ever written to disk.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const did = require('../middleware/did-resolver');

const STORE_PATH = path.join(__dirname, '..', 'data', 'reputation-attestations.json');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // fixed Ed25519 SPKI header

// ── issuer key (platform) ────────────────────────────────────────────────
let _issuer;
function getIssuer() {
  if (_issuer) return _issuer;
  const pem = process.env.SHADDAI_ISSUER_PRIVATE_KEY;
  let priv, pub;
  if (pem) {
    priv = crypto.createPrivateKey(pem);
    pub = crypto.createPublicKey(priv);
  } else {
    const kp = crypto.generateKeyPairSync('ed25519');
    priv = kp.privateKey; pub = kp.publicKey;
    if (!process.env.__SHADDAI_ISSUER_WARNED) { console.warn('[reputation] using EPHEMERAL issuer key — set SHADDAI_ISSUER_PRIVATE_KEY (PEM) for a stable issuer DID'); process.env.__SHADDAI_ISSUER_WARNED = '1'; }
  }
  const didKey = did.publicKeyToDidKey(pub);
  _issuer = { priv, pub, did: didKey };
  return _issuer;
}
function rawToPublicKey(raw32) {
  return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw32]), format: 'der', type: 'spki' });
}

// ── attestation store ────────────────────────────────────────────────────
function loadStore() { try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); } catch (e) { return {}; } }
function saveStore(s) { try { fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2)); } catch (e) {} }

const _scoreCache = new Map();
function _cacheGet(k) { const e = _scoreCache.get(k); if (!e) return null; if (Date.now() > e.exp) { _scoreCache.delete(k); return null; } return e.val; }
function _cacheSet(k, v) { if (_scoreCache.size > 5000) _scoreCache.clear(); _scoreCache.set(k, { val: v, exp: Date.now() + 5 * 60 * 1000 }); }

// Record an attestation. Call from x402 success, skill/agent execution, endorsements.
function recordAttestation(subjectDid, type, outcome, metadata = {}) {
  if (!subjectDid) return null;
  const store = loadStore();
  if (!store[subjectDid]) store[subjectDid] = [];
  const att = {
    id: 'att_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,                                        // 'x402_success' | 'task_completion' | 'peer_endorsement' | ...
    outcome: outcome === 'success' || outcome === 1 ? 1 : 0,
    at: new Date().toISOString(),
    // keep metadata PII-safe: only counterparty DID + endpoint + amount
    meta: { counterpartyDid: metadata.counterpartyDid || null, endpoint: metadata.endpoint || null, amount: metadata.amount == null ? null : Number(metadata.amount) },
  };
  store[subjectDid].push(att);
  if (store[subjectDid].length > 500) store[subjectDid] = store[subjectDid].slice(-500);
  saveStore(store);
  _scoreCache.delete(subjectDid);
  return att;
}

// Weighted score (0–10000). Recency decay + type weights + volume + diversity.
function calculateScore(subjectDid) {
  const atts = (loadStore()[subjectDid]) || [];
  if (atts.length === 0) return { score: 5000, breakdown: { note: 'neutral (no history)' } };
  const now = Date.now();
  let totalWeight = 0, weightedSuccess = 0;
  for (const a of atts) {
    const ageDays = (now - new Date(a.at).getTime()) / 86400000;
    const recency = Math.max(0.1, Math.exp(-ageDays / 90));      // ~90-day half-life
    const typeW = a.type === 'peer_endorsement' ? 1.8 : a.type === 'x402_success' ? 1.5 : a.type === 'task_completion' ? 1.2 : 1;
    const w = recency * typeW;
    weightedSuccess += a.outcome * w; totalWeight += w;
  }
  const successRate = totalWeight > 0 ? weightedSuccess / totalWeight : 0.5;
  const volumeBonus = Math.min(2000, Math.log(atts.length + 1) * 500);
  const diversity = new Set(atts.map(a => a.meta && a.meta.counterpartyDid).filter(Boolean)).size;
  const diversityBonus = Math.min(1500, diversity * 150);
  const score = Math.max(0, Math.min(10000, Math.round(successRate * 5500 + volumeBonus + diversityBonus)));
  return { score, breakdown: { successRate: +(successRate * 100).toFixed(1), volume: atts.length, diversity } };
}
function getScore(subjectDid) {
  const c = _cacheGet(subjectDid); if (c) return c;
  const r = calculateScore(subjectDid); _cacheSet(subjectDid, r); return r;
}
function tierFor(score) { return score >= 8000 ? 'Elite' : score >= 6000 ? 'Pro' : score >= 4000 ? 'Builder' : 'Untrusted'; }

// ── Verifiable Credential (compact Ed25519-signed) ───────────────────────
function _canonical(cred) { return Buffer.from(JSON.stringify(cred)); } // stable: fixed key order in this code
function issueReputationVC(subjectDid) {
  const iss = getIssuer();
  const { score, breakdown } = getScore(subjectDid);
  const credential = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: 'urn:shaddai:reputation:' + Buffer.from(subjectDid).toString('base64url'),
    type: ['VerifiableCredential', 'AgentReputationCredential'],
    issuer: iss.did,
    issuanceDate: new Date().toISOString(),
    credentialSubject: { id: subjectDid, reputationScore: score, successRate: breakdown.successRate ?? null, volume: breakdown.volume ?? 0, tier: tierFor(score) },
  };
  const sig = crypto.sign(null, _canonical(credential), iss.priv);
  credential.proof = { type: 'Ed25519Signature2020', created: new Date().toISOString(), verificationMethod: iss.did + '#' + iss.did.slice('did:key:'.length), proofPurpose: 'assertionMethod', proofValue: 'z' + did.base58encode(sig) };
  return credential;
}
function verifyReputationVC(vc) {
  try {
    if (!vc || !vc.proof || !vc.issuer) return { verified: false, error: 'missing proof/issuer' };
    const { proof, ...unsigned } = vc;
    const { raw } = did.didKeyToRawPublic(vc.issuer);
    const pub = rawToPublicKey(raw);
    const sig = did.base58decode(String(proof.proofValue).replace(/^z/, ''));
    const ok = crypto.verify(null, _canonical(unsigned), pub, sig);
    return { verified: ok, credentialSubject: ok ? vc.credentialSubject : null };
  } catch (e) { return { verified: false, error: e.message }; }
}

module.exports = { recordAttestation, calculateScore, getScore, tierFor, issueReputationVC, verifyReputationVC, getIssuer };
