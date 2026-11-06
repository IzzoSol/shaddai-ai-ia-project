// backend/middleware/did-resolver.js
// ─────────────────────────────────────────────────────────────────────────
// SHADDAI Phase 0 · Item 1 — DID resolver middleware (did:key, Ed25519).
//
// Design note: Grok's blueprint suggested `did-resolver` + `key-did-resolver`
// + NodeCache. Those are ESM-only / heavy and would risk this CommonJS
// production service's boot. `did:key` resolution is DETERMINISTIC (no network)
// and Ed25519 is native in Node's `crypto`, so this is implemented
// dependency-free in CommonJS — same capability, zero dependency risk.
//
// Exports:
//   didResolverMiddleware(req,res,next) — attaches req.did / req.didDocument
//   ed25519RawToDidKey(Buffer32)        — raw pubkey  → did:key
//   publicKeyToDidKey(keyObject|pem)    — crypto key  → did:key
//   resolveDidKey(did)                  — did:key     → DID document
//   createDidKey()                      — new keypair + its did:key (for
//                                         issuing DIDs to users/operatives)
//   base58encode / base58decode
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const crypto = require('crypto');

// ── base58btc (Bitcoin alphabet) — multibase 'z' ─────────────────────────
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58encode(bytes) {
  if (!bytes || bytes.length === 0) return '';
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let str = '';
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) str += ALPHABET[0];
  for (let q = digits.length - 1; q >= 0; q--) str += ALPHABET[digits[q]];
  return str;
}

function base58decode(str) {
  if (!str || str.length === 0) return Buffer.alloc(0);
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const val = ALPHABET.indexOf(str[i]);
    if (val < 0) throw new Error('invalid base58 character');
    let carry = val;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry = carry >> 8; }
    while (carry) { bytes.push(carry & 0xff); carry = carry >> 8; }
  }
  for (let k = 0; k < str.length && str[k] === ALPHABET[0]; k++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

// multicodec varint prefix for ed25519-pub = 0xed 0x01
const ED25519_MULTICODEC = Buffer.from([0xed, 0x01]);

// ── did:key <-> Ed25519 raw public key ───────────────────────────────────
function ed25519RawToDidKey(raw32) {
  if (!Buffer.isBuffer(raw32) || raw32.length !== 32) throw new Error('expected 32-byte Ed25519 public key');
  const mb = 'z' + base58encode(Buffer.concat([ED25519_MULTICODEC, raw32]));
  return 'did:key:' + mb;
}

// Accept a crypto KeyObject, SPKI DER Buffer, or PEM string → did:key.
// Ed25519 SPKI is a fixed 12-byte header + the 32-byte raw key, so raw = der.slice(-32).
function publicKeyToDidKey(pub) {
  let der;
  if (Buffer.isBuffer(pub)) der = pub;
  else if (typeof pub === 'string') der = crypto.createPublicKey(pub).export({ type: 'spki', format: 'der' });
  else der = pub.export({ type: 'spki', format: 'der' }); // KeyObject
  return ed25519RawToDidKey(der.subarray(der.length - 32));
}

function didKeyToRawPublic(did) {
  if (typeof did !== 'string' || !did.startsWith('did:key:z')) throw new Error('not a did:key');
  const mb = did.slice('did:key:'.length);           // 'z...'
  const decoded = base58decode(mb.slice(1));          // drop 'z'
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) throw new Error('unsupported did:key type (only Ed25519)');
  const raw = decoded.subarray(2);
  if (raw.length !== 32) throw new Error('bad Ed25519 key length');
  return { raw, mb };
}

// Deterministic did:key resolution → W3C DID document (no network call).
function resolveDidKey(did) {
  const { mb } = didKeyToRawPublic(did);
  const kid = did + '#' + mb;
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/ed25519-2020/v1'],
    id: did,
    verificationMethod: [{ id: kid, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase: mb }],
    authentication: [kid],
    assertionMethod: [kid],
  };
}

// Mint a brand-new did:key + its keypair (for issuing DIDs to users/operatives).
function createDidKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const did = ed25519RawToDidKey(der.subarray(der.length - 32));
  return {
    did,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

// ── tiny in-memory TTL cache (no external dep) ───────────────────────────
const _cache = new Map();
const TTL_MS = 5 * 60 * 1000;
function _get(k) { const e = _cache.get(k); if (!e) return null; if (Date.now() > e.exp) { _cache.delete(k); return null; } return e.val; }
function _set(k, v) { if (_cache.size > 5000) _cache.clear(); _cache.set(k, { val: v, exp: Date.now() + TTL_MS }); }

// ── Express middleware — NEVER blocks a request ──────────────────────────
// Extracts a DID from X-DID header / `Authorization: DID <did>` / ?did= / body.did,
// resolves it (cached), and attaches req.did / req.didDocument / req.agentDid.
// Public routes with no DID simply pass through.
function didResolverMiddleware(req, res, next) {
  try {
    const auth = req.headers['authorization'] || '';
    const rawDid =
      req.headers['x-did'] ||
      (/^DID\s+/i.test(auth) ? auth.replace(/^DID\s+/i, '') : '') ||
      (req.query && req.query.did) ||
      (req.body && req.body.did) || '';
    const did = typeof rawDid === 'string' ? rawDid.trim() : '';
    if (!did || !did.startsWith('did:')) return next();

    let doc = _get(did);
    if (!doc) {
      try { doc = resolveDidKey(did); _set(did, doc); }
      catch (e) { return next(); } // unsupported/malformed DID → don't block
    }
    req.did = did;
    req.didDocument = doc;
    req.agentDid = did; // alias for operative/agent contexts
  } catch (e) { /* identity is best-effort; never break the request */ }
  next();
}

module.exports = {
  didResolverMiddleware,
  ed25519RawToDidKey,
  publicKeyToDidKey,
  resolveDidKey,
  didKeyToRawPublic,
  createDidKey,
  base58encode,
  base58decode,
};
