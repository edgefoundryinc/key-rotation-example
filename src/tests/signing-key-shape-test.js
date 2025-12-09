/**
 * SigningKey Shape Test
 * =====================
 * 
 * Validates Tim Cook's SigningKey interface implementation.
 * This test imports from the main module (key-rotator.js) which now
 * implements SigningKey as the primary interface.
 * 
 * Run: node src/tests/signing-key-shape-test.js
 */

import {
  createSigningKey,
  deprecateSigningKey,
  destroySigningKey,
  isSigningKeyValid,
  getSigningKeyStatus,
  rotateSigningKey,
  needsRotation,
  KEY_STATUS,
  DEFAULT_TTL_MS,
  DEFAULT_OVERLAP_MS
} from '../key-rotator.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SELF-TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function selfTest() {
  const results = {
    // Shape validation
    interface_keyId: { pass: false },
    interface_hash: { pass: false },
    interface_timestamps: { pass: false },
    interface_rotationPolicy: { pass: false },
    interface_metadata: { pass: false },

    // Lifecycle
    lifecycle_active: { pass: false },
    lifecycle_deprecate: { pass: false },
    lifecycle_overlap_valid: { pass: false },
    lifecycle_overlap_expired: { pass: false },
    lifecycle_destroy: { pass: false },

    // Multi-tenant
    tenant_merchantId: { pass: false },
    tenant_environment: { pass: false },

    // Audit trail
    audit_createdBy_system: { pass: false },
    audit_createdBy_auto: { pass: false },
    audit_createdBy_user: { pass: false },

    // Rotation
    rotation_check: { pass: false },
    rotation_execute: { pass: false },
    rotation_inherits_config: { pass: false }
  };

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Shape Validation
    // ─────────────────────────────────────────────────────────────────────────

    const { signingKey: sk } = await createSigningKey();

    // Interface: keyId
    results.interface_keyId.pass =
      typeof sk.keyId === 'string' &&
      sk.keyId.startsWith('key_') &&
      sk.keyId.length === 12;
    results.interface_keyId.details = { keyId: sk.keyId };

    // Interface: hash
    results.interface_hash.pass =
      typeof sk.hash === 'string' &&
      sk.hash.length === 64 &&
      /^[a-f0-9]+$/.test(sk.hash);

    // Interface: timestamps
    results.interface_timestamps.pass =
      typeof sk.createdAt === 'number' &&
      typeof sk.expiresAt === 'number' &&
      sk.expiresAt > sk.createdAt &&
      sk.deprecatedAt === null &&
      sk.destroyedAt === null;

    // Interface: rotationPolicy
    results.interface_rotationPolicy.pass =
      typeof sk.rotationPolicy === 'object' &&
      typeof sk.rotationPolicy.ttlMs === 'number' &&
      typeof sk.rotationPolicy.overlapMs === 'number' &&
      sk.rotationPolicy.ttlMs === DEFAULT_TTL_MS &&
      sk.rotationPolicy.overlapMs === DEFAULT_OVERLAP_MS;

    // Interface: metadata
    results.interface_metadata.pass =
      typeof sk.metadata === 'object' &&
      'merchantId' in sk.metadata &&
      'environment' in sk.metadata &&
      'createdBy' in sk.metadata;

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    // Active status
    results.lifecycle_active.pass =
      getSigningKeyStatus(sk) === KEY_STATUS.ACTIVE &&
      isSigningKeyValid(sk).valid === true;

    // Deprecate
    const deprecated = deprecateSigningKey(sk);
    results.lifecycle_deprecate.pass =
      typeof deprecated.deprecatedAt === 'number' &&
      deprecated.destroyedAt === null &&
      getSigningKeyStatus(deprecated) === KEY_STATUS.DEPRECATED;

    // Overlap still valid
    const validity1 = isSigningKeyValid(deprecated);
    results.lifecycle_overlap_valid.pass =
      validity1.valid === true &&
      validity1.status === KEY_STATUS.DEPRECATED &&
      validity1.remainingMs > 0;

    // Overlap expired
    const futureTime = deprecated.deprecatedAt + deprecated.rotationPolicy.overlapMs + 1;
    const validity2 = isSigningKeyValid(deprecated, futureTime);
    results.lifecycle_overlap_expired.pass =
      validity2.valid === false &&
      validity2.reason === 'Overlap period has ended';

    // Destroy
    const destroyed = destroySigningKey(deprecated);
    results.lifecycle_destroy.pass =
      typeof destroyed.destroyedAt === 'number' &&
      getSigningKeyStatus(destroyed) === KEY_STATUS.DESTROYED &&
      isSigningKeyValid(destroyed).valid === false;

    // ─────────────────────────────────────────────────────────────────────────
    // Multi-tenant
    // ─────────────────────────────────────────────────────────────────────────

    const { signingKey: tenantKey } = await createSigningKey({
      merchantId: 'merchant_abc123',
      environment: 'test'
    });
    results.tenant_merchantId.pass = tenantKey.metadata.merchantId === 'merchant_abc123';
    results.tenant_environment.pass = tenantKey.metadata.environment === 'test';

    // ─────────────────────────────────────────────────────────────────────────
    // Audit trail
    // ─────────────────────────────────────────────────────────────────────────

    const { signingKey: sysKey } = await createSigningKey({ createdBy: 'system' });
    results.audit_createdBy_system.pass = sysKey.metadata.createdBy === 'system';

    const { signingKey: autoKey } = await createSigningKey({ createdBy: 'auto-rotation' });
    results.audit_createdBy_auto.pass = autoKey.metadata.createdBy === 'auto-rotation';

    const { signingKey: userKey } = await createSigningKey({ createdBy: 'user' });
    results.audit_createdBy_user.pass = userKey.metadata.createdBy === 'user';

    // ─────────────────────────────────────────────────────────────────────────
    // Rotation
    // ─────────────────────────────────────────────────────────────────────────

    // Check rotation needed
    const expiredKey = { ...sk, expiresAt: Date.now() - 1000 };
    results.rotation_check.pass =
      needsRotation(sk) === false &&
      needsRotation(expiredKey) === true;

    // Execute rotation
    const { oldKey, newKey, plaintextKey } = await rotateSigningKey(tenantKey);
    results.rotation_execute.pass =
      oldKey.deprecatedAt !== null &&
      newKey.deprecatedAt === null &&
      plaintextKey.includes('_test_');

    // Rotation inherits config
    results.rotation_inherits_config.pass =
      newKey.metadata.merchantId === 'merchant_abc123' &&
      newKey.metadata.environment === 'test' &&
      newKey.metadata.createdBy === 'auto-rotation';

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
  console.log('  SIGNING KEY INTERFACE VALIDATION');
  console.log('  Tim Cook\'s Enterprise-Aligned Design');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const { pass, results, summary } = await selfTest();

  // Group results
  const categories = {
    'Interface Shape': ['interface_keyId', 'interface_hash', 'interface_timestamps', 'interface_rotationPolicy', 'interface_metadata'],
    'Lifecycle': ['lifecycle_active', 'lifecycle_deprecate', 'lifecycle_overlap_valid', 'lifecycle_overlap_expired', 'lifecycle_destroy'],
    'Multi-Tenant': ['tenant_merchantId', 'tenant_environment'],
    'Audit Trail': ['audit_createdBy_system', 'audit_createdBy_auto', 'audit_createdBy_user'],
    'Rotation': ['rotation_check', 'rotation_execute', 'rotation_inherits_config']
  };

  for (const [category, tests] of Object.entries(categories)) {
    console.log(`  📁 ${category}`);
    for (const testName of tests) {
      const result = results[testName];
      if (result) {
        const status = result.pass ? '✅' : '❌';
        const details = result.details ? ` → ${JSON.stringify(result.details)}` : '';
        console.log(`     ${status} ${testName}${details}`);
      }
    }
    console.log('');
  }

  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  ${pass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}: ${summary}`);
  console.log('───────────────────────────────────────────────────────────────');

  // Show interface
  console.log('');
  console.log('  📋 SigningKey Interface:');
  const { signingKey } = await createSigningKey({ merchantId: 'demo_merchant' });
  console.log(JSON.stringify(signingKey, null, 4).split('\n').map(l => '     ' + l).join('\n'));

  process.exit(pass ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
