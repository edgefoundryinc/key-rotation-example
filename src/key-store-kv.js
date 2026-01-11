/**
 * Key Store - Cloudflare KV Backend
 * ==================================
 * 
 * KV storage operations for SigningKeys with per-merchant isolation.
 * Designed for read-heavy workloads with eventual consistency.
 * 
 * @module key-store-kv
 * @version 1.0.0
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * KV SCHEMA
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Key Patterns:
 *   hash:{sha256}           → SigningKey JSON (primary lookup)
 *   key:{keyId}             → SigningKey JSON (admin lookup)
 *   merchant:{id}:keys      → Array of keyIds (list per merchant)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { hashKey, isSigningKeyValid, getSigningKeyStatus } from './key-rotator.js';

// ═══════════════════════════════════════════════════════════════════════════════
// KV KEY PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate KV key for hash lookup
 * @param {string} hash - SHA-256 hash
 * @returns {string}
 */
function hashKeyPattern(hash) {
  return `hash:${hash}`;
}

/**
 * Generate KV key for keyId lookup
 * @param {string} keyId - Key ID
 * @returns {string}
 */
function keyIdPattern(keyId) {
  return `key:${keyId}`;
}

/**
 * Generate KV key for merchant's key list
 * @param {string} merchantId - Merchant ID
 * @returns {string}
 */
function merchantKeysPattern(merchantId) {
  return `merchant:${merchantId || '_global'}:keys`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Store a SigningKey in KV
 * Creates entries for hash lookup, keyId lookup, and merchant list
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {Object} signingKey - SigningKey object
 * @returns {Promise<void>}
 */
async function storeKey(KV, signingKey) {
  if (!KV) {
    throw new Error('KV namespace is required');
  }
  if (!signingKey || !signingKey.keyId || !signingKey.hash) {
    throw new Error('Invalid SigningKey: missing keyId or hash');
  }

  const keyJson = JSON.stringify(signingKey);
  const merchantId = signingKey.metadata?.merchantId;

  // Store by hash (primary lookup)
  await KV.put(hashKeyPattern(signingKey.hash), keyJson);

  // Store by keyId (admin lookup)
  await KV.put(keyIdPattern(signingKey.keyId), keyJson);

  // Update merchant's key list
  const merchantKey = merchantKeysPattern(merchantId);
  const existingList = await KV.get(merchantKey, { type: 'json' }) || [];
  
  if (!existingList.includes(signingKey.keyId)) {
    existingList.push(signingKey.keyId);
    await KV.put(merchantKey, JSON.stringify(existingList));
  }
}

/**
 * Update a SigningKey in KV (e.g., after deprecation)
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {Object} signingKey - Updated SigningKey object
 * @returns {Promise<void>}
 */
async function updateKey(KV, signingKey) {
  if (!KV) {
    throw new Error('KV namespace is required');
  }
  if (!signingKey || !signingKey.keyId || !signingKey.hash) {
    throw new Error('Invalid SigningKey: missing keyId or hash');
  }

  const keyJson = JSON.stringify(signingKey);

  // Update both lookups
  await KV.put(hashKeyPattern(signingKey.hash), keyJson);
  await KV.put(keyIdPattern(signingKey.keyId), keyJson);
}

/**
 * Lookup SigningKey by plaintext key
 * Hashes the key internally and looks up by hash
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {string} plaintextKey - The plaintext API key
 * @returns {Promise<Object|null>} - SigningKey or null if not found
 */
async function lookupByPlaintext(KV, plaintextKey) {
  if (!KV) {
    throw new Error('KV namespace is required');
  }
  if (!plaintextKey || typeof plaintextKey !== 'string') {
    return null;
  }

  const hash = await hashKey(plaintextKey);
  return await lookupByHash(KV, hash);
}

/**
 * Lookup SigningKey by hash
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {string} hash - SHA-256 hash
 * @returns {Promise<Object|null>} - SigningKey or null if not found
 */
async function lookupByHash(KV, hash) {
  if (!KV) {
    throw new Error('KV namespace is required');
  }
  if (!hash) {
    return null;
  }

  const key = await KV.get(hashKeyPattern(hash), { type: 'json' });
  return key || null;
}

/**
 * Lookup SigningKey by keyId
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {string} keyId - Key ID
 * @returns {Promise<Object|null>} - SigningKey or null if not found
 */
async function lookupByKeyId(KV, keyId) {
  if (!KV) {
    throw new Error('KV namespace is required');
  }
  if (!keyId) {
    return null;
  }

  const key = await KV.get(keyIdPattern(keyId), { type: 'json' });
  return key || null;
}

/**
 * List all keyIds for a merchant
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {string} merchantId - Merchant ID (null for global keys)
 * @returns {Promise<string[]>} - Array of keyIds
 */
async function listMerchantKeyIds(KV, merchantId) {
  if (!KV) {
    throw new Error('KV namespace is required');
  }

  const list = await KV.get(merchantKeysPattern(merchantId), { type: 'json' });
  return list || [];
}

/**
 * List all SigningKeys for a merchant (full objects)
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {string} merchantId - Merchant ID (null for global keys)
 * @returns {Promise<Object[]>} - Array of SigningKey objects
 */
async function listMerchantKeys(KV, merchantId) {
  const keyIds = await listMerchantKeyIds(KV, merchantId);
  
  const keys = await Promise.all(
    keyIds.map(keyId => lookupByKeyId(KV, keyId))
  );
  
  return keys.filter(k => k !== null);
}

/**
 * Delete a SigningKey from KV
 * Removes all associated entries (hash, keyId, from merchant list)
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {string} keyId - Key ID to delete
 * @returns {Promise<boolean>} - True if deleted, false if not found
 */
async function deleteKey(KV, keyId) {
  if (!KV) {
    throw new Error('KV namespace is required');
  }
  if (!keyId) {
    return false;
  }

  // Get the key first to find hash and merchantId
  const signingKey = await lookupByKeyId(KV, keyId);
  if (!signingKey) {
    return false;
  }

  const merchantId = signingKey.metadata?.merchantId;

  // Delete hash lookup
  await KV.delete(hashKeyPattern(signingKey.hash));

  // Delete keyId lookup
  await KV.delete(keyIdPattern(keyId));

  // Remove from merchant's key list
  const merchantKey = merchantKeysPattern(merchantId);
  const existingList = await KV.get(merchantKey, { type: 'json' }) || [];
  const newList = existingList.filter(id => id !== keyId);
  
  if (newList.length > 0) {
    await KV.put(merchantKey, JSON.stringify(newList));
  } else {
    await KV.delete(merchantKey);
  }

  return true;
}

/**
 * List all keys in KV (for admin purposes)
 * Uses KV list API to enumerate all keys
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {Object} [options] - Options
 * @param {string} [options.status] - Filter by status (active, deprecated, destroyed)
 * @returns {Promise<Object[]>} - Array of SigningKey objects
 */
async function listAllKeys(KV, options = {}) {
  if (!KV) {
    throw new Error('KV namespace is required');
  }

  const keys = [];
  let cursor = null;

  // List all keys with 'key:' prefix
  do {
    const listResult = await KV.list({ prefix: 'key:', cursor });
    
    for (const item of listResult.keys) {
      const signingKey = await KV.get(item.name, { type: 'json' });
      if (signingKey) {
        // Apply status filter if specified
        if (options.status) {
          const status = getSigningKeyStatus(signingKey);
          if (status !== options.status) continue;
        }
        keys.push(signingKey);
      }
    }
    
    cursor = listResult.list_complete ? null : listResult.cursor;
  } while (cursor);

  return keys;
}

/**
 * Validate a plaintext key and return full auth result
 * Combines lookup + validation in one operation
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {string} plaintextKey - The plaintext API key
 * @returns {Promise<Object>} - Auth result with validity and metadata
 */
async function validateKey(KV, plaintextKey) {
  if (!KV) {
    return { valid: false, error: 'KV namespace not configured' };
  }
  if (!plaintextKey) {
    return { valid: false, error: 'No key provided' };
  }

  const signingKey = await lookupByPlaintext(KV, plaintextKey);
  
  if (!signingKey) {
    return { valid: false, error: 'Key not found', found: false };
  }

  const validity = isSigningKeyValid(signingKey);
  const status = getSigningKeyStatus(signingKey);

  return {
    valid: validity.valid,
    found: true,
    keyId: signingKey.keyId,
    status,
    merchantId: signingKey.metadata?.merchantId || null,
    environment: signingKey.metadata?.environment || null,
    isDeprecated: signingKey.deprecatedAt !== null,
    remainingMs: validity.remainingMs,
    reason: validity.reason
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH OPERATIONS (for CLI sync)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Push multiple keys to KV (for CLI sync)
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @param {Object[]} signingKeys - Array of SigningKey objects
 * @returns {Promise<{success: number, failed: number, errors: string[]}>}
 */
async function pushKeys(KV, signingKeys) {
  if (!KV) {
    throw new Error('KV namespace is required');
  }

  const results = { success: 0, failed: 0, errors: [] };

  for (const key of signingKeys) {
    try {
      await storeKey(KV, key);
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push(`${key.keyId}: ${error.message}`);
    }
  }

  return results;
}

/**
 * Pull all keys from KV (for CLI sync)
 * @param {KVNamespace} KV - Cloudflare KV namespace
 * @returns {Promise<Object[]>} - Array of SigningKey objects
 */
async function pullKeys(KV) {
  return await listAllKeys(KV);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export {
  // Key patterns (for testing/debugging)
  hashKeyPattern,
  keyIdPattern,
  merchantKeysPattern,

  // Core operations
  storeKey,
  updateKey,
  lookupByPlaintext,
  lookupByHash,
  lookupByKeyId,
  deleteKey,

  // List operations
  listMerchantKeyIds,
  listMerchantKeys,
  listAllKeys,

  // Validation
  validateKey,

  // Batch operations
  pushKeys,
  pullKeys
};

