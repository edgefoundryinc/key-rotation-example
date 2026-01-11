/**
 * Key Store KV Test
 * =================
 * 
 * Tests KV storage operations using a mock KV namespace.
 * Run: node src/tests/key-store-kv-test.js
 */

import {
  hashKeyPattern,
  keyIdPattern,
  merchantKeysPattern,
  storeKey,
  updateKey,
  lookupByPlaintext,
  lookupByHash,
  lookupByKeyId,
  deleteKey,
  listMerchantKeyIds,
  listMerchantKeys,
  validateKey
} from '../key-store-kv.js';

import {
  createSigningKey,
  deprecateSigningKey,
  hashKey
} from '../key-rotator.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK KV NAMESPACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a mock KV namespace for testing
 */
function createMockKV() {
  const store = new Map();

  return {
    async get(key, options = {}) {
      const value = store.get(key);
      if (!value) return null;

      if (options.type === 'json') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value;
    },

    async put(key, value) {
      store.set(key, value);
    },

    async delete(key) {
      store.delete(key);
    },

    async list({ prefix = '', cursor = null } = {}) {
      const keys = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          keys.push({ name: key });
        }
      }
      return { keys, list_complete: true, cursor: null };
    },

    // Test helper: get raw store
    _getStore() {
      return store;
    },

    // Test helper: clear store
    _clear() {
      store.clear();
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELF-TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function selfTest() {
  const results = {
    // Key patterns
    hashKeyPattern_format: { pass: false },
    keyIdPattern_format: { pass: false },
    merchantKeysPattern_format: { pass: false },
    merchantKeysPattern_global: { pass: false },

    // Store operations
    storeKey_creates_entries: { pass: false },
    storeKey_hash_lookup: { pass: false },
    storeKey_keyId_lookup: { pass: false },
    storeKey_merchant_list: { pass: false },

    // Lookup operations
    lookupByPlaintext_found: { pass: false },
    lookupByPlaintext_not_found: { pass: false },
    lookupByHash_found: { pass: false },
    lookupByKeyId_found: { pass: false },

    // Update operations
    updateKey_updates_entries: { pass: false },

    // Delete operations
    deleteKey_removes_entries: { pass: false },
    deleteKey_updates_merchant_list: { pass: false },

    // List operations
    listMerchantKeyIds_returns_ids: { pass: false },
    listMerchantKeys_returns_objects: { pass: false },

    // Validation
    validateKey_valid: { pass: false },
    validateKey_not_found: { pass: false },
    validateKey_deprecated: { pass: false }
  };

  const KV = createMockKV();

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Key Patterns
    // ─────────────────────────────────────────────────────────────────────────

    results.hashKeyPattern_format.pass =
      hashKeyPattern('abc123') === 'hash:abc123';

    results.keyIdPattern_format.pass =
      keyIdPattern('key_test123') === 'key:key_test123';

    results.merchantKeysPattern_format.pass =
      merchantKeysPattern('merchant_abc') === 'merchant:merchant_abc:keys';

    results.merchantKeysPattern_global.pass =
      merchantKeysPattern(null) === 'merchant:_global:keys';

    // ─────────────────────────────────────────────────────────────────────────
    // Store Operations
    // ─────────────────────────────────────────────────────────────────────────

    const { signingKey: sk1, plaintextKey: pk1 } = await createSigningKey({
      merchantId: 'merchant_test',
      environment: 'test'
    });

    await storeKey(KV, sk1);
    const store = KV._getStore();

    // Check entries created
    results.storeKey_creates_entries.pass =
      store.size >= 3; // hash, keyId, merchant list

    // Check hash lookup entry
    const hashEntry = await KV.get(hashKeyPattern(sk1.hash), { type: 'json' });
    results.storeKey_hash_lookup.pass =
      hashEntry !== null &&
      hashEntry.keyId === sk1.keyId;

    // Check keyId lookup entry
    const keyIdEntry = await KV.get(keyIdPattern(sk1.keyId), { type: 'json' });
    results.storeKey_keyId_lookup.pass =
      keyIdEntry !== null &&
      keyIdEntry.hash === sk1.hash;

    // Check merchant list
    const merchantList = await KV.get(merchantKeysPattern('merchant_test'), { type: 'json' });
    results.storeKey_merchant_list.pass =
      Array.isArray(merchantList) &&
      merchantList.includes(sk1.keyId);

    // ─────────────────────────────────────────────────────────────────────────
    // Lookup Operations
    // ─────────────────────────────────────────────────────────────────────────

    // Lookup by plaintext
    const foundByPlaintext = await lookupByPlaintext(KV, pk1);
    results.lookupByPlaintext_found.pass =
      foundByPlaintext !== null &&
      foundByPlaintext.keyId === sk1.keyId;

    // Lookup by plaintext (not found)
    const notFound = await lookupByPlaintext(KV, 'sk_test_invalid_key_12345678901234');
    results.lookupByPlaintext_not_found.pass = notFound === null;

    // Lookup by hash
    const foundByHash = await lookupByHash(KV, sk1.hash);
    results.lookupByHash_found.pass =
      foundByHash !== null &&
      foundByHash.keyId === sk1.keyId;

    // Lookup by keyId
    const foundByKeyId = await lookupByKeyId(KV, sk1.keyId);
    results.lookupByKeyId_found.pass =
      foundByKeyId !== null &&
      foundByKeyId.hash === sk1.hash;

    // ─────────────────────────────────────────────────────────────────────────
    // Update Operations
    // ─────────────────────────────────────────────────────────────────────────

    const deprecated = deprecateSigningKey(sk1);
    await updateKey(KV, deprecated);

    const updatedByHash = await lookupByHash(KV, deprecated.hash);
    const updatedByKeyId = await lookupByKeyId(KV, deprecated.keyId);

    results.updateKey_updates_entries.pass =
      updatedByHash.deprecatedAt !== null &&
      updatedByKeyId.deprecatedAt !== null;

    // ─────────────────────────────────────────────────────────────────────────
    // List Operations
    // ─────────────────────────────────────────────────────────────────────────

    // Add another key to same merchant
    const { signingKey: sk2 } = await createSigningKey({
      merchantId: 'merchant_test',
      environment: 'test'
    });
    await storeKey(KV, sk2);

    const keyIds = await listMerchantKeyIds(KV, 'merchant_test');
    results.listMerchantKeyIds_returns_ids.pass =
      Array.isArray(keyIds) &&
      keyIds.length === 2 &&
      keyIds.includes(sk1.keyId) &&
      keyIds.includes(sk2.keyId);

    const keys = await listMerchantKeys(KV, 'merchant_test');
    results.listMerchantKeys_returns_objects.pass =
      Array.isArray(keys) &&
      keys.length === 2 &&
      keys.every(k => k.keyId && k.hash);

    // ─────────────────────────────────────────────────────────────────────────
    // Delete Operations
    // ─────────────────────────────────────────────────────────────────────────

    const deleted = await deleteKey(KV, sk2.keyId);
    const afterDelete = await lookupByKeyId(KV, sk2.keyId);
    results.deleteKey_removes_entries.pass =
      deleted === true &&
      afterDelete === null;

    const merchantListAfterDelete = await listMerchantKeyIds(KV, 'merchant_test');
    results.deleteKey_updates_merchant_list.pass =
      merchantListAfterDelete.length === 1 &&
      !merchantListAfterDelete.includes(sk2.keyId);

    // ─────────────────────────────────────────────────────────────────────────
    // Validation
    // ─────────────────────────────────────────────────────────────────────────

    // Create fresh key for validation tests
    const { signingKey: sk3, plaintextKey: pk3 } = await createSigningKey({
      merchantId: 'merchant_validate'
    });
    await storeKey(KV, sk3);

    const validResult = await validateKey(KV, pk3);
    results.validateKey_valid.pass =
      validResult.valid === true &&
      validResult.keyId === sk3.keyId &&
      validResult.merchantId === 'merchant_validate' &&
      validResult.isDeprecated === false;

    const notFoundResult = await validateKey(KV, 'sk_live_notfound12345678901234567890');
    results.validateKey_not_found.pass =
      notFoundResult.valid === false &&
      notFoundResult.found === false;

    // Deprecate and validate
    const sk3Deprecated = deprecateSigningKey(sk3);
    await updateKey(KV, sk3Deprecated);

    const deprecatedResult = await validateKey(KV, pk3);
    results.validateKey_deprecated.pass =
      deprecatedResult.valid === true && // Still valid during overlap
      deprecatedResult.isDeprecated === true;

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
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  KEY STORE KV - MOCK TESTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const { pass, results, summary } = await selfTest();

  // Group results
  const categories = {
    'Key Patterns': ['hashKeyPattern_format', 'keyIdPattern_format', 'merchantKeysPattern_format', 'merchantKeysPattern_global'],
    'Store Operations': ['storeKey_creates_entries', 'storeKey_hash_lookup', 'storeKey_keyId_lookup', 'storeKey_merchant_list'],
    'Lookup Operations': ['lookupByPlaintext_found', 'lookupByPlaintext_not_found', 'lookupByHash_found', 'lookupByKeyId_found'],
    'Update Operations': ['updateKey_updates_entries'],
    'Delete Operations': ['deleteKey_removes_entries', 'deleteKey_updates_merchant_list'],
    'List Operations': ['listMerchantKeyIds_returns_ids', 'listMerchantKeys_returns_objects'],
    'Validation': ['validateKey_valid', 'validateKey_not_found', 'validateKey_deprecated']
  };

  for (const [category, tests] of Object.entries(categories)) {
    console.log(`  📁 ${category}`);
    for (const testName of tests) {
      const result = results[testName];
      if (result) {
        const status = result.pass ? '✅' : '❌';
        console.log(`     ${status} ${testName}`);
      }
    }
    console.log('');
  }

  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  ${pass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}: ${summary}`);
  console.log('───────────────────────────────────────────────────────────────');

  process.exit(pass ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

