// ============================================================================
// auth-guard.js — lightweight, scale-ready safety middleware (PIKADON).
// Designed to be NON-BREAKING locally and ENFORCING in production:
//   • rateLimit            — always on (cheap abuse/cost protection).
//   • softAuth             — attaches req.userId; only HARD-blocks if REQUIRE_AUTH==='true'.
//   • verifyFirebaseToken  — verifies a Firebase ID token from Authorization: Bearer header.
//                            Lazily inits firebase-admin when FIREBASE_SERVICE_ACCOUNT JSON
//                            or GOOGLE_APPLICATION_CREDENTIALS is set. When neither is set
//                            (local dev) falls back to x-user-id header (non-breaking).
//   • requireAdmin         — gates dangerous ops behind ADMIN_TOKEN; if ADMIN_TOKEN is
//                            unset (local/dev) it allows through, so nothing breaks during
//                            development.
// Flip REQUIRE_AUTH=true + set FIREBASE_SERVICE_ACCOUNT + ADMIN_TOKEN for production.
// ============================================================================
const crypto = require('crypto');
const _hits = new Map(); // ip -> [epoch-ms timestamps] (sliding window)

// Constant-time token compare — avoids leaking how many leading characters of
// a secret matched via response-time side channel. Added during the Hall
// cross-service auth review (Shaddai-Arcade issue #3) alongside
// economy-routes.js/lens-routes.js's admin-token checks; safe to reuse
// anywhere a caller-supplied header is compared against a server secret.
function timingSafeTokenMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // lengths differ -> definitely no match, no need to compare
  return crypto.timingSafeEqual(a, b);
}

// ── Firebase lazy init ───────────────────────────────────────────────────────
// _adminAuth is null until first call to _getAdminAuth().
let _adminAuth = null;   // firebase-admin Auth instance once initialized
let _adminInitAttempted = false; // only try once to avoid repeated noise

function _getAdminAuth() {
  if (_adminInitAttempted) return _adminAuth;
  _adminInitAttempted = true;

  // Check whether we have any Firebase credential to work with.
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const appCredsFile       = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!serviceAccountJson && !appCredsFile) {
    // No credentials configured — stay in dev-permissive mode.
    return null;
  }

  try {
    const admin = require('firebase-admin');

    // Only initialize once even if this function is somehow re-entered.
    if (!admin.apps.length) {
      let inited = false;
      if (serviceAccountJson) {
        // FIREBASE_SERVICE_ACCOUNT: full service-account JSON as a string.
        try {
          admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
          inited = true;
        } catch (e) {
          // Malformed env var (common: multi-line paste truncated) — fall back to the file.
          console.warn('[auth-guard] FIREBASE_SERVICE_ACCOUNT malformed, trying GOOGLE_APPLICATION_CREDENTIALS:', e.message);
        }
      }
      if (!inited && appCredsFile) {
        // GOOGLE_APPLICATION_CREDENTIALS: path to a service-account JSON file (Render Secret File).
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
        inited = true;
      }
      if (!inited) return null; // no usable credential
      console.log('[auth-guard] firebase-admin initialized');
    }

    _adminAuth = admin.auth();
    return _adminAuth;
  } catch (err) {
    console.warn('[auth-guard] firebase-admin init failed — running in dev-permissive mode:', err.message);
    return null;
  }
}

function rateLimit({ windowMs = 60000, max = 60 } = {}) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || 'local').toString().replace(/:/g, '_');
    const now = Date.now();
    const cutoff = now - windowMs;
    let times = _hits.get(ip);
    if (!times) { times = []; _hits.set(ip, times); }
    // Trim old hits outside the sliding window.
    while (times.length && times[0] <= cutoff) times.shift();
    // Check BEFORE recording so a concurrent burst can't push past the cap.
    if (times.length >= max) return res.status(429).json({ ok: false, error: 'rate limit exceeded — slow down' });
    times.push(now);
    // Opportunistic cleanup to bound memory growth.
    if (_hits.size > 2000) {
      for (const [k, arr] of _hits) {
        while (arr.length && arr[0] <= cutoff) arr.shift();
        if (arr.length === 0) _hits.delete(k);
      }
    }
    next();
  };
}

/* Soft auth: identify the caller; only reject when REQUIRE_AUTH is explicitly on.
 *
 * SECURITY — fixed 2026-08-28. This previously did:
 *     const uid = headerUid || authHeader.replace(/^Bearer\s+/i, '') || '';
 * i.e. it used the RAW bearer string AS the user id, with no verification.
 * Knowing someone's user id was therefore enough to fully become them:
 *     curl -H 'Authorization: Bearer <victim-id>' /api/jobs/scheduled
 * returned the victim's private data, byte-for-byte identical to their own
 * view. No password, no real token. softAuth guards router.use() across the
 * whole of api-proxy-routes.js plus /api/agents/:name/history,
 * /api/executions/history, /api/agents/task and skill invocation — so this
 * was read AND act-as impersonation over most of the API.
 *
 * A bearer is now only an identity if it VERIFIES: either a Firebase ID token
 * (when Firebase is configured) or a JWT signed with our own JWT_SECRET, which
 * is what /api/auth/login actually issues. An unverifiable token is treated as
 * anonymous — never as the identity it claims.
 *
 * x-user-id is still honoured in non-prod only, so local tooling keeps working.
 */
async function _identityFromBearer(bearer) {
  if (!bearer) return '';
  // 1. Firebase ID token, when Firebase is configured
  try {
    const fb = _getAdminAuth();
    if (fb) {
      const decoded = await fb.verifyIdToken(bearer);
      if (decoded && decoded.uid) return String(decoded.uid);
    }
  } catch (e) { /* not a valid Firebase token — fall through */ }
  // 2. our own signed session JWT (what /api/auth/login returns)
  try {
    const { verifyToken } = require('./auth-service');
    const decoded = await verifyToken(bearer);
    const uid = decoded && (decoded.uid || decoded.userId || decoded.id);
    if (uid) return String(uid);
  } catch (e) { /* invalid or expired — anonymous */ }
  return '';
}

async function softAuth(req, res, next) {
  try {
    // never trust x-user-id in production (spoofable); non-prod only
    const isProd = process.env.NODE_ENV === 'production';
    const headerUid = isProd ? '' : String(req.headers['x-user-id'] || '').trim();

    const authHeader = req.headers.authorization || '';
    const bearer = /^Bearer\s+/i.test(authHeader)
      ? authHeader.replace(/^Bearer\s+/i, '').trim()
      : '';

    const uid = headerUid || await _identityFromBearer(bearer);

    req.userId = uid || 'local';
    req.isAuthenticated = !!uid;

    if (process.env.REQUIRE_AUTH === 'true' && !uid) {
      return res.status(401).json({ ok: false, error: 'authentication required' });
    }
    next();
  } catch (e) {
    // auth must never 500 the request; fail closed to anonymous
    req.userId = 'local';
    req.isAuthenticated = false;
    if (process.env.REQUIRE_AUTH === 'true') {
      return res.status(401).json({ ok: false, error: 'authentication required' });
    }
    next();
  }
}

/**
 * verifyFirebaseToken — production-grade auth middleware.
 *
 * Behaviour matrix:
 *
 *  Firebase ready | Bearer token | REQUIRE_AUTH  | Outcome
 *  ───────────────┼──────────────┼───────────────┼─────────────────────────────────
 *  yes            | valid        | any           | req.userId = uid → next()
 *  yes            | invalid/exp  | true          | 401
 *  yes            | invalid/exp  | false/unset   | fall through (dev)
 *  yes            | absent       | true          | 401
 *  yes            | absent       | false/unset   | fall back to x-user-id header
 *  no (dev)       | any          | true          | 401 (no token, no firebase)
 *  no (dev)       | absent       | false/unset   | fall back to x-user-id header
 *
 * The last two rows ensure: if Firebase creds are NOT set locally nothing breaks.
 */
async function verifyFirebaseToken(req, res, next) {
  const requireAuth = process.env.REQUIRE_AUTH === 'true';
  const authHeader  = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  const firebaseAuth = _getAdminAuth();

  if (firebaseAuth && bearerToken) {
    // Firebase is ready and a token was supplied — verify it.
    try {
      const decoded = await firebaseAuth.verifyIdToken(bearerToken);
      req.userId = decoded.uid;
      req.userEmail = (decoded.email || '').toLowerCase();  // VERIFIED email (safe for admin allowlist)
      return next();
    } catch (err) {
      // Token is present but invalid / expired.
      if (requireAuth) {
        return res.status(401).json({ ok: false, error: 'invalid or expired token' });
      }
      // Dev-permissive: fall through to header fallback below.
      console.warn('[auth-guard] token verification failed (dev-permissive):', err.message);
    }
  }

  // No token (or Firebase not available).
  if (requireAuth) {
    // In strict mode we can't let anyone through without a verified token.
    return res.status(401).json({ ok: false, error: 'authentication required' });
  }

  // Dev fallback: honour the x-user-id header so existing local tooling keeps
  // working. SECURITY: never trust this spoofable header in production.
  const fallbackUid = process.env.NODE_ENV === 'production' ? '' : (req.headers['x-user-id'] || '');
  req.userId = fallbackUid || 'local';
  next();
}

// Gate dangerous operations. Local/dev (no ADMIN_TOKEN set) => allow, so the
// dashboard keeps working. Production => require the matching admin header.
function requireAdmin(req, res, next) {
  const tok = process.env.ADMIN_TOKEN;
  if (!tok) {
    // Fail CLOSED in production: refuse dangerous ops when no admin token is
    // configured. In dev, keep the pass-through so the dashboard works.
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ ok: false, error: 'admin not configured' });
    }
    return next(); // dev convenience
  }
  if ((req.headers['x-shaddai-admin'] || '') === tok) return next();
  return res.status(403).json({ ok: false, error: 'admin token required for this operation' });
}

// ── Email-based admin (SECURE) ───────────────────────────────────────────────
// Admin is decided by the caller's VERIFIED Firebase email (from the signed ID token),
// checked against the ADMIN_EMAILS allowlist — NOT a client-claimed string. This is the
// safe way to make a specific login (e.g. cloudzncrownz@gmail.com) an admin.
function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',').map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean);
}

// requireAdminUser — for owner/admin control endpoints. Passes if EITHER:
//   • the caller's verified Firebase email is in ADMIN_EMAILS, OR
//   • the master admin header matches ADMIN_TOKEN (x-shaddai-admin).
// Dev-permissive: if NODE_ENV!=='production' and neither ADMIN_EMAILS nor ADMIN_TOKEN is
// configured, allow through so local tooling works. Fails CLOSED in production.
async function requireAdminUser(req, res, next) {
  const emails = adminEmails();
  const tok = process.env.ADMIN_TOKEN;
  const notConfigured = emails.length === 0 && !tok;
  if (notConfigured) {
    if (process.env.NODE_ENV === 'production') return res.status(500).json({ ok: false, error: 'admin not configured' });
    return next(); // dev convenience
  }
  // master token path
  if (tok && (req.headers['x-shaddai-admin'] || '') === tok) return next();
  // verified-email path — verify the Bearer token now (independent of route order)
  if (emails.length) {
    const firebaseAuth = _getAdminAuth();
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (firebaseAuth && bearer) {
      try {
        const decoded = await firebaseAuth.verifyIdToken(bearer);
        const email = (decoded.email || '').toLowerCase();
        req.userId = decoded.uid; req.userEmail = email;
        if (email && emails.indexOf(email) !== -1) return next();
      } catch (e) { /* fall through to 403 */ }
    }
    // dev fallback: allow an x-user-email header ONLY off-prod (never trust it in prod)
    if (process.env.NODE_ENV !== 'production') {
      const devEmail = (req.headers['x-user-email'] || '').toLowerCase();
      if (devEmail && emails.indexOf(devEmail) !== -1) return next();
    }
  }
  return res.status(403).json({ ok: false, error: 'admin only' });
}

// isAdminUser — non-blocking check for a /whoami style endpoint. Returns a Promise<bool>.
async function isAdminUser(req) {
  const emails = adminEmails();
  const tok = process.env.ADMIN_TOKEN;
  if (tok && (req.headers['x-shaddai-admin'] || '') === tok) return true;
  if (!emails.length) return false;
  const firebaseAuth = _getAdminAuth();
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (firebaseAuth && bearer) {
    try { const d = await firebaseAuth.verifyIdToken(bearer); return emails.indexOf((d.email || '').toLowerCase()) !== -1; } catch (e) {}
  }
  if (process.env.NODE_ENV !== 'production') {
    const devEmail = (req.headers['x-user-email'] || '').toLowerCase();
    if (devEmail && emails.indexOf(devEmail) !== -1) return true;
  }
  return false;
}

module.exports = { rateLimit, softAuth, verifyFirebaseToken, requireAdmin, requireAdminUser, isAdminUser, adminEmails, timingSafeTokenMatch };
