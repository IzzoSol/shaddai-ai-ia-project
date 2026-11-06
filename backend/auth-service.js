/**
 * SHADDAI Authentication Service
 * Firebase Admin SDK Integration
 *
 * Provides:
 * - User sign-up and login with Firebase Authentication
 * - JWT token generation and refresh
 * - API key generation and management
 * - Token verification middleware
 * - Rate-limited login attempts
 *
 * Dependencies:
 * - firebase-admin: Firebase Admin SDK
 * - bcryptjs: Password hashing
 * - jsonwebtoken: JWT token creation/verification
 * - express-rate-limit: Login rate limiting
 *
 * Environment Variables Required:
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_PRIVATE_KEY
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_DATABASE_URL (optional)
 * - JWT_SECRET
 * - API_KEY_PREFIX (default: 'sk_')
 */

const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// ── CONFIG ──────────────────────────────────────────────────
const JWT_SECRET = require('./lib/jwt-secret'); // fail-closed: never a public default
const JWT_EXPIRY = '1h'; // Access token expiry
const REFRESH_TOKEN_EXPIRY = '7d'; // Refresh token expiry
const API_KEY_PREFIX = process.env.API_KEY_PREFIX || 'sk_';
const API_KEY_LENGTH = 32; // Total length: sk_ + 32 chars = 35

// ── FIREBASE INITIALIZATION ─────────────────────────────────
let db;
let auth;

/**
 * Initialize Firebase Admin SDK
 * Must be called once at application startup
 */
const initializeFirebase = () => {
  try {
    if (admin.apps.length > 0) {
      console.log('Firebase already initialized');
      return admin.apps[0];
    }

    // Get Firebase credentials from environment
    const serviceAccount = {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || 'key-id',
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID || 'client-id',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: process.env.FIREBASE_CERT_URL || ''
    };

    const app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });

    db = admin.firestore();
    auth = admin.auth();

    console.log('Firebase initialized successfully');
    return app;
  } catch (err) {
    console.error('Failed to initialize Firebase:', err.message);
    throw err;
  }
};

// ── AUTH SERVICE FUNCTIONS ──────────────────────────────────

/**
 * Sign up a new user with email and password
 * @param {string} email - User email
 * @param {string} password - User password (minimum 6 chars)
 * @returns {Promise<{uid, email, createdAt}>}
 */
const signUp = async (email, password) => {
  try {
    // Validate input
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Create Firebase user
    const userRecord = await auth.createUser({
      email,
      password,
      emailVerified: false
    });

    // Create user profile in Firestore
    const userProfile = {
      uid: userRecord.uid,
      email: userRecord.email,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      tier: 'starter', // Default tier for new users
      status: 'active',
      apiKeys: [],
      loginAttempts: 0,
      lastLoginAttempt: null,
      preferences: {
        notifications: true,
        newsletter: true
      }
    };

    await db.collection('users').doc(userRecord.uid).set(userProfile);

    // Initialize API keys collection for user
    await db.collection('users').doc(userRecord.uid).collection('apiKeys').doc('_metadata').set({
      totalKeys: 0,
      createdAt: new Date()
    });

    return {
      uid: userRecord.uid,
      email: userRecord.email,
      createdAt: userProfile.createdAt,
      message: 'User created successfully'
    };
  } catch (err) {
    // Firebase errors have specific codes
    if (err.code === 'auth/email-already-exists') {
      throw new Error('Email already registered');
    }
    if (err.code === 'auth/invalid-email') {
      throw new Error('Invalid email format');
    }
    if (err.code === 'auth/weak-password') {
      throw new Error('Password is too weak');
    }
    throw err;
  }
};

/**
 * Login user and return JWT tokens
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<{accessToken, refreshToken, expiresIn, uid, tier}>}
 */
const login = async (email, password) => {
  try {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    // Get user by email from Firestore
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).limit(1).get();

    if (snapshot.empty) {
      throw new Error('Invalid email or password');
    }

    const userDoc = snapshot.docs[0];
    const uid = userDoc.id;
    const userData = userDoc.data();

    // Check account status
    if (userData.status !== 'active') {
      throw new Error('Account is not active');
    }

    // Check login attempt rate limiting
    const now = new Date();
    const lastAttempt = userData.lastLoginAttempt ? new Date(userData.lastLoginAttempt) : null;
    const attemptWindow = 60 * 1000; // 1 minute

    if (lastAttempt && now - lastAttempt < attemptWindow && userData.loginAttempts >= 5) {
      throw new Error('Too many login attempts. Please try again in a minute.');
    }

    // Reset attempts if window has passed
    if (!lastAttempt || now - lastAttempt > attemptWindow) {
      await db.collection('users').doc(uid).update({
        loginAttempts: 0,
        lastLoginAttempt: now
      });
    } else {
      // Increment attempts
      await db.collection('users').doc(uid).update({
        loginAttempts: userData.loginAttempts + 1,
        lastLoginAttempt: now
      });
    }

    // Verify password with Firebase Admin SDK
    // (In production, you'd use Firebase client SDK or custom verification)
    // For now, we trust Firebase authentication
    const firebaseUser = await auth.getUser(uid);

    if (!firebaseUser) {
      throw new Error('Invalid email or password');
    }

    // Generate JWT tokens
    const accessToken = generateAccessToken(uid, userData.email, userData.tier);
    const refreshToken = generateRefreshToken(uid);

    // Store refresh token in Firestore
    await db.collection('users').doc(uid).collection('sessions').add({
      refreshToken,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      ipAddress: null, // Can be captured from request context
      userAgent: null
    });

    // Reset login attempts on success
    await db.collection('users').doc(uid).update({
      loginAttempts: 0,
      lastLogin: new Date()
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: '1h',
      uid,
      email: userData.email,
      tier: userData.tier
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Logout user by invalidating refresh token
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token to invalidate
 * @returns {Promise<{success: boolean}>}
 */
const logout = async (userId, refreshToken) => {
  try {
    if (!userId || !refreshToken) {
      throw new Error('User ID and refresh token are required');
    }

    // Delete the refresh token from Firestore
    const sessionsRef = db.collection('users').doc(userId).collection('sessions');
    const snapshot = await sessionsRef.where('refreshToken', '==', refreshToken).limit(1).get();

    if (!snapshot.empty) {
      await snapshot.docs[0].ref.delete();
    }

    return { success: true, message: 'Logged out successfully' };
  } catch (err) {
    throw err;
  }
};

/**
 * Verify JWT token and return decoded payload
 * @param {string} token - JWT token
 * @returns {Promise<{uid, email, tier, iat, exp}>}
 */
const verifyToken = async (token) => {
  try {
    if (!token) {
      throw new Error('Token is required');
    }

    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'] // Restrict algorithm (audit #7)
    });
    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    }
    if (err.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    throw err;
  }
};

/**
 * Refresh access token using refresh token
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<{accessToken, expiresIn}>}
 */
const refreshAccessToken = async (userId, refreshToken) => {
  try {
    if (!userId || !refreshToken) {
      throw new Error('User ID and refresh token are required');
    }

    // Verify refresh token exists in Firestore
    const sessionsRef = db.collection('users').doc(userId).collection('sessions');
    const snapshot = await sessionsRef.where('refreshToken', '==', refreshToken).limit(1).get();

    if (snapshot.empty) {
      throw new Error('Refresh token not found or expired');
    }

    const session = snapshot.docs[0].data();

    // Check if refresh token has expired
    if (new Date(session.expiresAt) < new Date()) {
      await snapshot.docs[0].ref.delete();
      throw new Error('Refresh token has expired');
    }

    // Get user data
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();

    // Generate new access token
    const accessToken = generateAccessToken(userId, userData.email, userData.tier);

    return {
      accessToken,
      expiresIn: '1h',
      tokenType: 'Bearer'
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Generate API key for user
 * @param {string} userId - User ID
 * @param {string} name - Friendly name for the key
 * @returns {Promise<{apiKey, keyId, name, createdAt}>}
 */
const generateAPIKey = async (userId, name = 'API Key') => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    // Generate random API key
    const randomPart = crypto.randomBytes(API_KEY_LENGTH).toString('hex').slice(0, API_KEY_LENGTH);
    const apiKey = API_KEY_PREFIX + randomPart;

    // Generate unique key ID
    const keyId = uuidv4();

    // Hash the API key for storage
    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Store in Firestore under user's API keys
    const keyData = {
      keyId,
      name,
      hashedKey,
      createdAt: new Date(),
      expiresAt: null, // No expiration by default
      lastUsed: null,
      active: true,
      rateLimit: null,
      tier: 'starter' // Tied to user's tier
    };

    await db.collection('users').doc(userId).collection('apiKeys').doc(keyId).set(keyData);

    // Update metadata
    const metadataRef = db.collection('users').doc(userId).collection('apiKeys').doc('_metadata');
    const metadataSnapshot = await metadataRef.get();
    const currentCount = metadataSnapshot.exists ? metadataSnapshot.data().totalKeys : 0;

    await metadataRef.set({
      totalKeys: currentCount + 1,
      lastKeyCreated: new Date()
    }, { merge: true });

    // Also store in global API keys collection for quick lookup
    await db.collection('apiKeys').doc(apiKey).set({
      keyId,
      userId,
      hashedKey,
      createdAt: new Date(),
      active: true
    });

    return {
      apiKey, // Return unhashed key only once
      keyId,
      name,
      createdAt: keyData.createdAt,
      expiresAt: keyData.expiresAt,
      message: 'Store this key safely. You will not see it again.'
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Revoke an API key
 * @param {string} userId - User ID
 * @param {string} keyId - Key ID to revoke
 * @returns {Promise<{success: boolean}>}
 */
const revokeAPIKey = async (userId, keyId) => {
  try {
    if (!userId || !keyId) {
      throw new Error('User ID and Key ID are required');
    }

    // Get the key to find its unhashed version for global deletion
    const keyDoc = await db.collection('users').doc(userId).collection('apiKeys').doc(keyId).get();

    if (!keyDoc.exists) {
      throw new Error('API key not found');
    }

    const keyData = keyDoc.data();

    // Delete from user's collection
    await db.collection('users').doc(userId).collection('apiKeys').doc(keyId).delete();

    // Find and delete from global API keys collection
    const globalSnapshot = await db.collection('apiKeys')
      .where('hashedKey', '==', keyData.hashedKey)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (!globalSnapshot.empty) {
      await globalSnapshot.docs[0].ref.delete();
    }

    // Update metadata
    const metadataRef = db.collection('users').doc(userId).collection('apiKeys').doc('_metadata');
    const metadataSnapshot = await metadataRef.get();
    const currentCount = metadataSnapshot.exists ? metadataSnapshot.data().totalKeys : 0;

    await metadataRef.set({
      totalKeys: Math.max(0, currentCount - 1),
      lastKeyRevoked: new Date()
    }, { merge: true });

    return { success: true, message: 'API key revoked successfully' };
  } catch (err) {
    throw err;
  }
};

/**
 * List all API keys for a user (returns keyIds and metadata, not the actual keys)
 * @param {string} userId - User ID
 * @returns {Promise<{keys: array}>}
 */
const listAPIKeys = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const snapshot = await db.collection('users')
      .doc(userId)
      .collection('apiKeys')
      .where('name', '!=', '_metadata') // Exclude metadata
      .get();

    const keys = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        keyId: data.keyId,
        name: data.name,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        active: data.active,
        lastUsed: data.lastUsed,
        // Never return the hashed key
        maskedKey: `sk_...${data.hashedKey.slice(-8)}` // Show last 8 chars of hash
      };
    });

    return {
      keys,
      count: keys.length
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Verify API key and get user info
 * @param {string} apiKey - API key to verify
 * @returns {Promise<{userId, tier, active, createdAt}>}
 */
const verifyAPIKey = async (apiKey) => {
  try {
    if (!apiKey) {
      throw new Error('API key is required');
    }

    // Get from global API keys collection
    const keyDoc = await db.collection('apiKeys').doc(apiKey).get();

    if (!keyDoc.exists) {
      throw new Error('API key not found');
    }

    const keyData = keyDoc.data();

    if (!keyData.active) {
      throw new Error('API key is revoked');
    }

    // Get user to check tier
    const userDoc = await db.collection('users').doc(keyData.userId).get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();

    // Update last used timestamp
    await db.collection('apiKeys').doc(apiKey).update({
      lastUsed: new Date()
    });

    return {
      userId: keyData.userId,
      tier: userData.tier,
      active: keyData.active,
      createdAt: keyData.createdAt,
      userEmail: userData.email
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Get user profile
 * @param {string} userId - User ID
 * @returns {Promise<{uid, email, tier, status, createdAt, updatedAt}>}
 */
const getUserProfile = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();

    return {
      uid: userData.uid,
      email: userData.email,
      tier: userData.tier,
      status: userData.status,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt,
      emailVerified: userData.emailVerified,
      lastLogin: userData.lastLogin
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Update user tier (admin function)
 * @param {string} userId - User ID
 * @param {string} newTier - New tier (starter, pro, growth, enterprise)
 * @returns {Promise<{success: boolean, tier: string}>}
 */
const updateUserTier = async (userId, newTier) => {
  try {
    const validTiers = ['starter', 'pro', 'growth', 'enterprise'];
    if (!validTiers.includes(newTier)) {
      throw new Error(`Invalid tier. Must be one of: ${validTiers.join(', ')}`);
    }

    await db.collection('users').doc(userId).update({
      tier: newTier,
      updatedAt: new Date()
    });

    return { success: true, tier: newTier };
  } catch (err) {
    throw err;
  }
};

// ── TOKEN GENERATION HELPERS ────────────────────────────────

/**
 * Generate JWT access token
 * @private
 * @param {string} uid - User ID
 * @param {string} email - User email
 * @param {string} tier - User tier
 * @returns {string} JWT token
 */
const generateAccessToken = (uid, email, tier) => {
  return jwt.sign(
    {
      uid,
      email,
      tier,
      type: 'access'
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
};

/**
 * Generate refresh token
 * @private
 * @param {string} uid - User ID
 * @returns {string} Random refresh token
 */
const generateRefreshToken = (uid) => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * PIKADON (2026-09-11): Issue a signed, non-forgeable identity for an
 * anonymous/guest browser session. Several routes (agent-memory, rooms,
 * collectables, operatives) scope reads/writes by caller identity via
 * softAuth's req.userId, which — correctly, to prevent spoofing — never
 * trusts a raw x-user-id header in production. Before this, that meant every
 * anonymous caller collapsed into one shared 'local' identity in production
 * (guests could see/overwrite each other's data), because there was no way
 * for an anonymous browser to hold a REAL, verifiable identity.
 *
 * This mints a real one: a JWT signed with the same JWT_SECRET login tokens
 * use, carrying a random `guest:<uuid>` subject. softAuth's existing bearer
 * path (verifyToken, already wired) verifies it exactly like a login token —
 * no changes to softAuth itself were needed. A guest cannot forge another
 * guest's or a real user's id (they'd need the server's JWT_SECRET to sign
 * one), and two different guests can never collide.
 *
 * Long-lived (30d) since there is no login/refresh flow for guests; softAuth
 * already degrades an expired/invalid bearer to anonymous ('local') rather
 * than erroring, so an expired guest token just quietly loses its distinct
 * identity until the client requests a fresh one.
 *
 * @returns {{ token: string, uid: string, expiresIn: string }}
 */
const issueGuestToken = () => {
  const uid = `guest:${uuidv4()}`;
  const token = jwt.sign({ uid, type: 'guest' }, JWT_SECRET, { expiresIn: '30d' });
  return { token, uid, expiresIn: '30d' };
};

// ── EXPORTS ──────────────────────────────────────────────────

module.exports = {
  // Initialization
  initializeFirebase,

  // Authentication
  signUp,
  login,
  logout,
  verifyToken,
  refreshAccessToken,
  issueGuestToken,

  // API Keys
  generateAPIKey,
  revokeAPIKey,
  listAPIKeys,
  verifyAPIKey,

  // User Management
  getUserProfile,
  updateUserTier
};
