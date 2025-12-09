/**
 * Key Rotator Test Runner
 * =======================
 * 
 * Run: node src/tests/key-rotator-test.js
 * 
 * Tests all functions in key-rotator.js (SigningKey interface)
 */

import { selfTest } from '../key-rotator.js';

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  KEY ROTATOR v2.0 - SIGNING KEY INTERFACE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const { pass, results, summary } = await selfTest();

  // Group results by category
  const categories = {
    'Utility Functions': ['generateKey_valid', 'generateKey_invalid_prefix', 'generateKey_invalid_env', 'generateKeyId', 'hashKey_valid', 'hashKey_deterministic', 'validateKeyFormat_valid', 'validateKeyFormat_invalid', 'formatDuration', 'clampOverlap_min', 'clampOverlap_max'],
    'SigningKey Creation': ['createSigningKey_shape', 'createSigningKey_hash', 'createSigningKey_policy', 'createSigningKey_metadata', 'createSigningKey_custom_merchant', 'createSigningKey_custom_createdBy'],
    'SigningKey Lifecycle': ['deprecate_sets_timestamp', 'deprecate_still_valid', 'deprecate_overlap_expires', 'destroy_sets_timestamp', 'destroy_immediately_invalid', 'status_transitions'],
    'Rotation': ['needsRotation_active', 'needsRotation_expired', 'rotateSigningKey']
  };

  for (const [category, tests] of Object.entries(categories)) {
    console.log(`  📁 ${category}`);
    for (const testName of tests) {
      const result = results[testName];
      if (result) {
        const status = result.pass ? '✅' : '❌';
        const details = result.details ? ` (${JSON.stringify(result.details)})` : '';
        console.log(`     ${status} ${testName}${details}`);
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
