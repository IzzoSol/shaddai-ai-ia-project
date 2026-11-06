'use strict';
/**
 * server.js — a MINIMAL standalone host for the S.A.P. routes.
 *
 * The production SHADDAI app mounts these routers inside a much larger
 * server (auth, economy, media, reputation, tooling...). This file exists so
 * the payments leg can be cloned and run on its own, with no paid services
 * and no cloud:
 *
 *     cd backend
 *     npm install
 *     npm start          # http://127.0.0.1:3000
 *
 * Nothing here trades, signs, or moves money. Every route either READS the
 * chain or RECORDS an intent. See README.md.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const CAVEAT = 'Illustrative averages, not site-specific predictions.';

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'shaddai-sap-backend',
    note: 'Payments leg only. No trading, no custody, no automatic settlement.',
    caveat: CAVEAT,
  });
});

// The two routers carry their own full paths (/api/sap/*, /api/x402/*) and are
// mounted at the root, exactly as the production app mounts them.
try {
  app.use(require('./sap-routes'));
  console.log('[sap] SAP treasury + tree payments mounted (/api/sap/*)');
} catch (e) {
  console.error('[sap] sap-routes failed to load:', e.message);
}

try {
  app.use(require('./x402-routes'));
  console.log('[sap] x402 ledger mounted (/api/x402/*)');
  console.log('[sap] NOTE: x402 FEE ROUTING is gated off by default.');
  console.log('[sap]       set SAP_X402_FEE_ROUTING=1 to enable fee allocation.');
} catch (e) {
  console.error('[sap] x402-routes failed to load:', e.message);
}

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[sap] listening on http://127.0.0.1:${PORT}`);
  console.log('[sap] try: /api/health  /api/sap/health  /api/sap/policy  /api/sap/hip1/plan');
});
