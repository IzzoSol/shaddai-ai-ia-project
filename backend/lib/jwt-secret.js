/* ══════════════════════════════════════════════════════════════════
   jwt-secret.js — single source of truth for the JWT signing secret.
   SECURITY: never fall back to a hardcoded/public default (that lets
   anyone forge tokens). If JWT_SECRET is unset we generate a RANDOM
   ephemeral secret per boot — secure, but tokens reset each restart,
   which loudly nudges you to set a real JWT_SECRET.
   ══════════════════════════════════════════════════════════════════ */
'use strict';
const crypto = require('crypto');

let SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16 || /change[-_]?me|secret-key|current-secret/i.test(SECRET)) {
  SECRET = crypto.randomBytes(32).toString('hex');
  const msg = 'JWT_SECRET is unset or weak — using a random ephemeral secret. SET a strong JWT_SECRET in your environment (tokens reset on every restart until you do).';
  if (process.env.NODE_ENV === 'production') console.error('🔴 [auth] ' + msg);
  else console.warn('[auth] ' + msg);
}

module.exports = SECRET;
