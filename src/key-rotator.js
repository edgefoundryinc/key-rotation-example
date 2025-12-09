/**
 * Key Rotator - Core Module
 * =========================
 * 
 * Pure functions for API key generation, hashing, and rotation management.
 * Uses Web Crypto API (available in Cloudflare Workers and modern browsers).
 * 
 * @module key-rotator
 * @version 2.0.0
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * MODULE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PRIMARY INTERFACE: SigningKey (Tim Cook's enterprise-aligned design)
 * 
 * @typedef {Object} SigningKey
 * @property {string} keyId              - Stable, human-readable identifier
 * @property {string} hash               - SHA-256 hash of plaintext key
 * @property {number} createdAt          - Epoch ms when created
 * @property {number} expiresAt          - Epoch ms when key should be rotated (TTL)
 * @property {number|null} deprecatedAt  - Epoch ms soft cutoff (overlap starts)
 * @property {number|null} destroyedAt   - Epoch ms hard cutoff (invalid)
 * @property {Object} rotationPolicy
 * @property {number} rotationPolicy.ttlMs      - Key lifetime before rotation
 * @property {number} rotationPolicy.overlapMs  - Grace period for deprecated keys
 * @property {Object} [metadata]
 * @property {string} [metadata.merchantId]     - Multi-tenant identifier
 * @property {string} metadata.environment      - 'live' | 'test'
 * @property {string} metadata.createdBy        - 'system' | 'auto-rotation' | 'user'
 * 
 * KEY FORMAT:
 *   {prefix}_{environment}_{32-char-random}
 *   Example: sk_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
 * 
 * KEY LIFECYCLE:
 *   active → deprecated (overlap/grace) → destroyed
 *   
 *   - Active: deprecatedAt=null, destroyedAt=null
 *   - Deprecated: deprecatedAt set, still valid during overlapMs
 *   - Destroyed: destroyedAt set, immediately invalid
 * 
 * SECURITY NOTES:
 *   - Keys generated using crypto.getRandomValues() (CSPRNG)
 *   - Keys stored as SHA-256 hash only; plaintext returned once on creation
 *   - Use timing-safe comparison when validating keys
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Key lifecycle states (derived from SigningKey timestamps)
 */
const KEY_STATUS = {
  ACTIVE: 'active',
  DEPRECATED: 'deprecated',
  DESTROYED: 'destroyed'
};

/**
 * Valid key prefixes
 */
const VALID_PREFIXES = ['sk', 'pk', 'ak', 'tk'];

/**
 * Valid environments
 */
const VALID_ENVIRONMENTS = ['live', 'test', 'dev', 'staging'];

/**
 * Valid createdBy values
 */
const VALID_CREATED_BY = ['system', 'auto-rotation', 'user'];

/**
 * Default TTL: 30 days
 */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Default overlap/grace period: 24 hours
 */
const DEFAULT_OVERLAP_MS = 24 * 60 * 60 * 1000;

/**
 * Minimum overlap: 5 minutes
 */
const MIN_OVERLAP_MS = 5 * 60 * 1000;

/**
 * Maximum overlap: 7 days
 */
const MAX_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Key random portion length (characters)
 */
const KEY_RANDOM_LENGTH = 32;

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate cryptographically secure random string
 * Uses base62 alphabet (a-z, A-Z, 0-9) for URL-safe keys
 * @param {number} length - Length of random string
 * @returns {string}
 */
function generateRandomString(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);

  let result = '';
  for (let i = 0; i < length; i++) {
    result += alphabet[randomBytes[i] % alphabet.length];
  }
  return result;
}

/**
 * Generate a new API key
 * @param {string} [prefix='sk'] - Key prefix (sk, pk, ak, tk)
 * @param {string} [environment='live'] - Environment (live, test, dev, staging)
 * @returns {string} - Full API key (e.g., "sk_live_xxxxx")
 */
function generateKey(prefix = 'sk', environment = 'live') {
  const normalizedPrefix = String(prefix).toLowerCase();
  if (!VALID_PREFIXES.includes(normalizedPrefix)) {
    throw new Error(`Invalid prefix: ${prefix}. Valid: ${VALID_PREFIXES.join(', ')}`);
  }

  const normalizedEnv = String(environment).toLowerCase();
  if (!VALID_ENVIRONMENTS.includes(normalizedEnv)) {
    throw new Error(`Invalid environment: ${environment}. Valid: ${VALID_ENVIRONMENTS.join(', ')}`);
  }

  const randomPart = generateRandomString(KEY_RANDOM_LENGTH);
  return `${normalizedPrefix}_${normalizedEnv}_${randomPart}`;
}

/**
 * Generate unique key ID
 * @returns {string} - Key ID (e.g., "key_1a2b3c4d")
 */
function generateKeyId() {
  const randomPart = generateRandomString(8).toLowerCase();
  return `key_${randomPart}`;
}

/**
 * Hash a key using SHA-256 for secure storage
 * @param {string} key - The plaintext API key
 * @returns {Promise<string>} - Hex-encoded SHA-256 hash
 */
async function hashKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Key must be a non-empty string');
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate key format
 * @param {string} key - The API key to validate
 * @returns {{valid: boolean, error: string|null, parts: Object|null}}
 */
function validateKeyFormat(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'Key must be a non-empty string', parts: null };
  }

  const parts = key.split('_');
  if (parts.length !== 3) {
    return { valid: false, error: 'Key must have format: prefix_environment_random', parts: null };
  }

  const [prefix, environment, random] = parts;

  if (!VALID_PREFIXES.includes(prefix.toLowerCase())) {
    return { valid: false, error: `Invalid prefix: ${prefix}`, parts: null };
  }

  if (!VALID_ENVIRONMENTS.includes(environment.toLowerCase())) {
    return { valid: false, error: `Invalid environment: ${environment}`, parts: null };
  }

  if (random.length !== KEY_RANDOM_LENGTH) {
    return {
      valid: false,
      error: `Random portion must be ${KEY_RANDOM_LENGTH} characters, got ${random.length}`,
      parts: null
    };
  }

  if (!/^[a-zA-Z0-9]+$/.test(random)) {
    return { valid: false, error: 'Random portion must be alphanumeric', parts: null };
  }

  return {
    valid: true,
    error: null,
    parts: { prefix: prefix.toLowerCase(), environment: environment.toLowerCase(), random }
  };
}

/**
 * Format milliseconds as human-readable duration
 * @param {number} ms - Milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 60000) {
    return `${Math.round(ms / 1000)}s`;
  }
  if (ms < 3600000) {
    return `${Math.round(ms / 60000)}m`;
  }
  if (ms <= 86400000) {
    return `${Math.round(ms / 3600000)}h`;
  }
  return `${Math.round(ms / 86400000)}d`;
}

/**
 * Clamp overlap/grace period to valid range
 * @param {number} overlapMs
 * @returns {number}
 */
function clampOverlap(overlapMs) {
  if (overlapMs < MIN_OVERLAP_MS) return MIN_OVERLAP_MS;
  if (overlapMs > MAX_OVERLAP_MS) return MAX_OVERLAP_MS;
  return overlapMs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNING KEY FUNCTIONS (Primary Interface)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new SigningKey
 * @param {Object} options
 * @param {string} [options.prefix='sk'] - Key prefix
 * @param {string} [options.environment='live'] - Environment
 * @param {string} [options.merchantId=null] - Multi-tenant identifier
 * @param {string} [options.createdBy='system'] - Who created the key
 * @param {number} [options.ttlMs] - Key lifetime in ms (default 30 days)
 * @param {number} [options.overlapMs] - Grace period in ms (default 24h)
 * @returns {Promise<{signingKey: SigningKey, plaintextKey: string}>}
 */
async function createSigningKey(options = {}) {
  const {
    prefix = 'sk',
    environment = 'live',
    merchantId = null,
    createdBy = 'system',
    ttlMs = DEFAULT_TTL_MS,
    overlapMs = DEFAULT_OVERLAP_MS
  } = options;

  // Validate createdBy
  if (!VALID_CREATED_BY.includes(createdBy)) {
    throw new Error(`Invalid createdBy: ${createdBy}. Valid: ${VALID_CREATED_BY.join(', ')}`);
  }

  const plaintextKey = generateKey(prefix, environment);
  const hash = await hashKey(plaintextKey);
  const now = Date.now();

  const signingKey = {
    keyId: generateKeyId(),
    hash,
    createdAt: now,
    expiresAt: now + ttlMs,
    deprecatedAt: null,
    destroyedAt: null,
    rotationPolicy: {
      ttlMs,
      overlapMs: clampOverlap(overlapMs)
    },
    metadata: {
      merchantId,
      environment,
      createdBy
    }
  };

  return { signingKey, plaintextKey };
}

/**
 * Deprecate a SigningKey (soft cutoff - starts overlap period)
 * Key remains valid during overlap period.
 * @param {SigningKey} signingKey
 * @returns {SigningKey}
 */
function deprecateSigningKey(signingKey) {
  if (!signingKey || typeof signingKey !== 'object') {
    throw new Error('Invalid signing key');
  }
  if (signingKey.deprecatedAt) {
    throw new Error('Key already deprecated');
  }
  if (signingKey.destroyedAt) {
    throw new Error('Cannot deprecate destroyed key');
  }

  return {
    ...signingKey,
    deprecatedAt: Date.now()
  };
}

/**
 * Destroy a SigningKey (hard cutoff - immediately invalid)
 * @param {SigningKey} signingKey
 * @returns {SigningKey}
 */
function destroySigningKey(signingKey) {
  if (!signingKey || typeof signingKey !== 'object') {
    throw new Error('Invalid signing key');
  }
  if (signingKey.destroyedAt) {
    return signingKey; // Already destroyed
  }

  const now = Date.now();
  return {
    ...signingKey,
    deprecatedAt: signingKey.deprecatedAt || now,
    destroyedAt: now
  };
}

/**
 * Check if a SigningKey is currently valid
 * @param {SigningKey} signingKey
 * @param {number} [now] - Current timestamp (for testing)
 * @returns {{valid: boolean, status: string, reason: string|null, remainingMs: number|null}}
 */
function isSigningKeyValid(signingKey, now = Date.now()) {
  if (!signingKey || typeof signingKey !== 'object') {
    return { valid: false, status: KEY_STATUS.DESTROYED, reason: 'Invalid signing key', remainingMs: null };
  }

  // Hard cutoff - destroyed
  if (signingKey.destroyedAt) {
    return { valid: false, status: KEY_STATUS.DESTROYED, reason: 'Key has been destroyed', remainingMs: 0 };
  }

  // Soft cutoff - deprecated but within overlap
  if (signingKey.deprecatedAt) {
    const overlapEndsAt = signingKey.deprecatedAt + signingKey.rotationPolicy.overlapMs;
    if (now >= overlapEndsAt) {
      return { valid: false, status: KEY_STATUS.DESTROYED, reason: 'Overlap period has ended', remainingMs: 0 };
    }
    const remainingMs = overlapEndsAt - now;
    return {
      valid: true,
      status: KEY_STATUS.DEPRECATED,
      reason: `Deprecated - ${formatDuration(remainingMs)} remaining in overlap`,
      remainingMs
    };
  }

  // Check if past TTL (should have been rotated)
  if (now >= signingKey.expiresAt) {
    const overdueMs = now - signingKey.expiresAt;
    return {
      valid: true,
      status: KEY_STATUS.ACTIVE,
      reason: `Key past TTL by ${formatDuration(overdueMs)} - rotation recommended`,
      remainingMs: null
    };
  }

  // Active and within TTL
  const remainingMs = signingKey.expiresAt - now;
  return {
    valid: true,
    status: KEY_STATUS.ACTIVE,
    reason: null,
    remainingMs
  };
}

/**
 * Get the current status of a SigningKey
 * @param {SigningKey} signingKey
 * @returns {string} - 'active' | 'deprecated' | 'destroyed'
 */
function getSigningKeyStatus(signingKey) {
  if (!signingKey) return KEY_STATUS.DESTROYED;
  if (signingKey.destroyedAt) return KEY_STATUS.DESTROYED;
  if (signingKey.deprecatedAt) return KEY_STATUS.DEPRECATED;
  return KEY_STATUS.ACTIVE;
}

/**
 * Check if a SigningKey needs rotation (past TTL)
 * @param {SigningKey} signingKey
 * @param {number} [now] - Current timestamp
 * @returns {boolean}
 */
function needsRotation(signingKey, now = Date.now()) {
  if (!signingKey) return false;
  if (signingKey.destroyedAt || signingKey.deprecatedAt) return false;
  return now >= signingKey.expiresAt;
}

/**
 * Rotate a SigningKey - deprecate current and create new
 * @param {SigningKey} currentKey - Key to deprecate
 * @param {Object} [options] - Options for new key (inherits from current if not specified)
 * @returns {Promise<{oldKey: SigningKey, newKey: SigningKey, plaintextKey: string}>}
 */
async function rotateSigningKey(currentKey, options = {}) {
  if (!currentKey || typeof currentKey !== 'object') {
    throw new Error('Invalid signing key');
  }
  if (currentKey.destroyedAt) {
    throw new Error('Cannot rotate destroyed key');
  }

  // Deprecate current key
  const oldKey = currentKey.deprecatedAt ? currentKey : deprecateSigningKey(currentKey);

  // Create new key with inherited or specified options
  const { signingKey: newKey, plaintextKey } = await createSigningKey({
    environment: options.environment || currentKey.metadata.environment,
    merchantId: options.merchantId ?? currentKey.metadata.merchantId,
    createdBy: options.createdBy || 'auto-rotation',
    ttlMs: options.ttlMs || currentKey.rotationPolicy.ttlMs,
    overlapMs: options.overlapMs || currentKey.rotationPolicy.overlapMs
  });

  return { oldKey, newKey, plaintextKey };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELF-TEST
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Self-test - validates all functions
 * @returns {Promise<{pass: boolean, results: Object, summary: string}>}
 */
async function selfTest() {
  const results = {
    // Utility functions
    generateKey_valid: { pass: false },
    generateKey_invalid_prefix: { pass: false },
    generateKey_invalid_env: { pass: false },
    generateKeyId: { pass: false },
    hashKey_valid: { pass: false },
    hashKey_deterministic: { pass: false },
    validateKeyFormat_valid: { pass: false },
    validateKeyFormat_invalid: { pass: false },
    formatDuration: { pass: false },
    clampOverlap_min: { pass: false },
    clampOverlap_max: { pass: false },

    // SigningKey creation
    createSigningKey_shape: { pass: false },
    createSigningKey_hash: { pass: false },
    createSigningKey_policy: { pass: false },
    createSigningKey_metadata: { pass: false },
    createSigningKey_custom_merchant: { pass: false },
    createSigningKey_custom_createdBy: { pass: false },

    // SigningKey lifecycle
    deprecate_sets_timestamp: { pass: false },
    deprecate_still_valid: { pass: false },
    deprecate_overlap_expires: { pass: false },
    destroy_sets_timestamp: { pass: false },
    destroy_immediately_invalid: { pass: false },
    status_transitions: { pass: false },

    // Rotation
    needsRotation_active: { pass: false },
    needsRotation_expired: { pass: false },
    rotateSigningKey: { pass: false }
  };

  try {
    // Test: Generate valid key
    const key1 = generateKey('sk', 'live');
    results.generateKey_valid.pass =
      key1.startsWith('sk_live_') &&
      key1.length === 'sk_live_'.length + KEY_RANDOM_LENGTH;
    results.generateKey_valid.details = { key: key1.substring(0, 15) + '...' };

    // Test: Invalid prefix throws
    try {
      generateKey('invalid', 'live');
      results.generateKey_invalid_prefix.pass = false;
    } catch (e) {
      results.generateKey_invalid_prefix.pass = e.message.includes('Invalid prefix');
    }

    // Test: Invalid environment throws
    try {
      generateKey('sk', 'invalid');
      results.generateKey_invalid_env.pass = false;
    } catch (e) {
      results.generateKey_invalid_env.pass = e.message.includes('Invalid environment');
    }

    // Test: Generate key ID
    const keyId = generateKeyId();
    results.generateKeyId.pass =
      keyId.startsWith('key_') &&
      keyId.length === 'key_'.length + 8;

    // Test: Hash key
    const hash1 = await hashKey('test_key_123');
    results.hashKey_valid.pass =
      typeof hash1 === 'string' &&
      hash1.length === 64 &&
      /^[a-f0-9]+$/.test(hash1);

    // Test: Hash is deterministic
    const hash2 = await hashKey('test_key_123');
    results.hashKey_deterministic.pass = hash1 === hash2;

    // Test: Validate valid key format
    const validation1 = validateKeyFormat(key1);
    results.validateKeyFormat_valid.pass =
      validation1.valid === true &&
      validation1.parts.prefix === 'sk';

    // Test: Validate invalid key format
    const validation2 = validateKeyFormat('invalid_key');
    results.validateKeyFormat_invalid.pass =
      validation2.valid === false &&
      validation2.error !== null;

    // Test: Format duration
    results.formatDuration.pass =
      formatDuration(30000) === '30s' &&
      formatDuration(300000) === '5m' &&
      formatDuration(7200000) === '2h' &&
      formatDuration(86400000) === '24h' &&
      formatDuration(172800000) === '2d';

    // Test: Clamp overlap min
    results.clampOverlap_min.pass = clampOverlap(1000) === MIN_OVERLAP_MS;

    // Test: Clamp overlap max
    results.clampOverlap_max.pass = clampOverlap(999999999999) === MAX_OVERLAP_MS;

    // Test: Create SigningKey shape
    const { signingKey: sk1, plaintextKey: pk1 } = await createSigningKey();
    results.createSigningKey_shape.pass =
      typeof sk1.keyId === 'string' &&
      sk1.keyId.startsWith('key_') &&
      typeof sk1.hash === 'string' &&
      typeof sk1.createdAt === 'number' &&
      typeof sk1.expiresAt === 'number' &&
      sk1.deprecatedAt === null &&
      sk1.destroyedAt === null &&
      typeof sk1.rotationPolicy === 'object' &&
      typeof sk1.metadata === 'object';
    results.createSigningKey_shape.details = { keyId: sk1.keyId };

    // Test: Hash is valid SHA-256
    results.createSigningKey_hash.pass =
      sk1.hash.length === 64 &&
      /^[a-f0-9]+$/.test(sk1.hash);

    // Test: Rotation policy
    results.createSigningKey_policy.pass =
      sk1.rotationPolicy.ttlMs === DEFAULT_TTL_MS &&
      sk1.rotationPolicy.overlapMs === DEFAULT_OVERLAP_MS;

    // Test: Metadata
    results.createSigningKey_metadata.pass =
      sk1.metadata.environment === 'live' &&
      sk1.metadata.createdBy === 'system' &&
      sk1.metadata.merchantId === null;

    // Test: Custom merchantId
    const { signingKey: sk2 } = await createSigningKey({ merchantId: 'merchant_abc' });
    results.createSigningKey_custom_merchant.pass =
      sk2.metadata.merchantId === 'merchant_abc';

    // Test: Custom createdBy
    const { signingKey: sk3 } = await createSigningKey({ createdBy: 'user' });
    results.createSigningKey_custom_createdBy.pass =
      sk3.metadata.createdBy === 'user';

    // Test: Deprecate sets timestamp
    const deprecated = deprecateSigningKey(sk1);
    results.deprecate_sets_timestamp.pass =
      typeof deprecated.deprecatedAt === 'number' &&
      deprecated.deprecatedAt > 0 &&
      deprecated.destroyedAt === null;

    // Test: Deprecated key still valid during overlap
    const validity1 = isSigningKeyValid(deprecated);
    results.deprecate_still_valid.pass =
      validity1.valid === true &&
      validity1.status === KEY_STATUS.DEPRECATED;
    results.deprecate_still_valid.details = { reason: validity1.reason };

    // Test: Deprecated key invalid after overlap
    const futureTime = deprecated.deprecatedAt + deprecated.rotationPolicy.overlapMs + 1000;
    const validity2 = isSigningKeyValid(deprecated, futureTime);
    results.deprecate_overlap_expires.pass =
      validity2.valid === false &&
      validity2.reason === 'Overlap period has ended';

    // Test: Destroy sets timestamp
    const destroyed = destroySigningKey(deprecated);
    results.destroy_sets_timestamp.pass =
      typeof destroyed.destroyedAt === 'number' &&
      destroyed.destroyedAt > 0;

    // Test: Destroyed key immediately invalid
    const validity3 = isSigningKeyValid(destroyed);
    results.destroy_immediately_invalid.pass =
      validity3.valid === false &&
      validity3.status === KEY_STATUS.DESTROYED;

    // Test: Status transitions
    results.status_transitions.pass =
      getSigningKeyStatus(sk1) === KEY_STATUS.ACTIVE &&
      getSigningKeyStatus(deprecated) === KEY_STATUS.DEPRECATED &&
      getSigningKeyStatus(destroyed) === KEY_STATUS.DESTROYED;

    // Test: Needs rotation (active, not expired)
    const { signingKey: freshKey } = await createSigningKey({ ttlMs: 86400000 });
    results.needsRotation_active.pass = needsRotation(freshKey) === false;

    // Test: Needs rotation (expired)
    const expiredKey = { ...freshKey, expiresAt: Date.now() - 1000 };
    results.needsRotation_expired.pass = needsRotation(expiredKey) === true;

    // Test: Rotate signing key
    const { oldKey, newKey, plaintextKey } = await rotateSigningKey(freshKey);
    results.rotateSigningKey.pass =
      oldKey.deprecatedAt !== null &&
      newKey.deprecatedAt === null &&
      newKey.metadata.createdBy === 'auto-rotation' &&
      plaintextKey.startsWith('sk_live_');

  } catch (error) {
    console.error('Self-test error:', error);
  }

  const allPass = Object.values(results).every(r => r.pass);
  const passCount = Object.values(results).filter(r => r.pass).length;
  const totalCount = Object.keys(results).length;

  return {
    pass: allPass,
    results,
    summary: `${passCount}/${totalCount} tests passed`
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export {
  // Constants
  KEY_STATUS,
  VALID_PREFIXES,
  VALID_ENVIRONMENTS,
  VALID_CREATED_BY,
  DEFAULT_TTL_MS,
  DEFAULT_OVERLAP_MS,
  MIN_OVERLAP_MS,
  MAX_OVERLAP_MS,
  KEY_RANDOM_LENGTH,

  // Utility functions
  generateRandomString,
  generateKey,
  generateKeyId,
  hashKey,
  validateKeyFormat,
  formatDuration,
  clampOverlap,

  // SigningKey functions (Primary Interface)
  createSigningKey,
  deprecateSigningKey,
  destroySigningKey,
  isSigningKeyValid,
  getSigningKeyStatus,
  needsRotation,
  rotateSigningKey,

  // Testing
  selfTest
};
