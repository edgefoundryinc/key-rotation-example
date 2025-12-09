#!/usr/bin/env node
/**
 * Key Rotator CLI - CRUD Testing
 * ===============================
 * 
 * Usage:
 *   node src/cli.js create [--merchant <id>] [--env <live|test>]
 *   node src/cli.js list
 *   node src/cli.js read <keyId>
 *   node src/cli.js deprecate <keyId>
 *   node src/cli.js destroy <keyId>
 *   node src/cli.js rotate <keyId>
 *   node src/cli.js validate <plaintextKey>
 *   node src/cli.js clear
 * 
 * Keys are stored in .keys.json for testing purposes.
 */

import {existsSync,readFileSync,writeFileSync} from 'fs';
import {
  createSigningKey,
  deprecateSigningKey,
  destroySigningKey,
  formatDuration,
  getSigningKeyStatus,
  hashKey,
  isSigningKeyValid,
  needsRotation,
  rotateSigningKey
} from './key-rotator.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE (JSON file for testing - will be Durable Object in production)
// ═══════════════════════════════════════════════════════════════════════════════

const STORE_FILE = '.keys.json';

function loadStore() {
  if (!existsSync(STORE_FILE)) {
    return { keys: {}, plaintextKeys: {} };
  }
  try {
    return JSON.parse(readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return { keys: {}, plaintextKeys: {} };
  }
}

function saveStore(store) {
  writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

async function cmdCreate(args) {
  const merchantId = getArg(args, '--merchant') || getArg(args, '-m') || null;
  const environment = getArg(args, '--env') || getArg(args, '-e') || 'live';
  const createdBy = getArg(args, '--by') || 'user';

  const { signingKey, plaintextKey } = await createSigningKey({
    merchantId,
    environment,
    createdBy
  });

  const store = loadStore();
  store.keys[signingKey.keyId] = signingKey;
  store.plaintextKeys[signingKey.keyId] = plaintextKey; // Store for testing only!
  saveStore(store);

  console.log('');
  console.log('  ✅ KEY CREATED');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  Key ID:      ${signingKey.keyId}`);
  console.log(`  Plaintext:   ${plaintextKey}`);
  console.log(`  Hash:        ${signingKey.hash.substring(0, 16)}...`);
  console.log(`  Environment: ${signingKey.metadata.environment}`);
  console.log(`  Merchant:    ${signingKey.metadata.merchantId || '(none)'}`);
  console.log(`  Created By:  ${signingKey.metadata.createdBy}`);
  console.log(`  Expires:     ${new Date(signingKey.expiresAt).toISOString()}`);
  console.log(`  TTL:         ${formatDuration(signingKey.rotationPolicy.ttlMs)}`);
  console.log(`  Overlap:     ${formatDuration(signingKey.rotationPolicy.overlapMs)}`);
  console.log('');
  console.log('  ⚠️  Save the plaintext key! It won\'t be shown again in production.');
  console.log('');
}

async function cmdList() {
  const store = loadStore();
  const keys = Object.values(store.keys);

  console.log('');
  console.log('  📋 SIGNING KEYS');
  console.log('  ═══════════════════════════════════════════════════════════');

  if (keys.length === 0) {
    console.log('  (no keys found)');
    console.log('');
    return;
  }

  for (const key of keys) {
    const status = getSigningKeyStatus(key);
    const validity = isSigningKeyValid(key);
    const statusIcon = status === 'active' ? '🟢' : status === 'deprecated' ? '🟡' : '🔴';
    
    console.log(`  ${statusIcon} ${key.keyId}`);
    console.log(`     Status: ${status} | Valid: ${validity.valid}`);
    console.log(`     Env: ${key.metadata.environment} | Merchant: ${key.metadata.merchantId || '-'}`);
    if (validity.reason) {
      console.log(`     Note: ${validity.reason}`);
    }
    console.log('');
  }
}

async function cmdRead(keyId) {
  if (!keyId) {
    console.error('  ❌ Usage: node src/cli.js read <keyId>');
    process.exit(1);
  }

  const store = loadStore();
  const key = store.keys[keyId];

  if (!key) {
    console.error(`  ❌ Key not found: ${keyId}`);
    process.exit(1);
  }

  const validity = isSigningKeyValid(key);
  const status = getSigningKeyStatus(key);
  const needs = needsRotation(key);

  console.log('');
  console.log('  📖 KEY DETAILS');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  Key ID:        ${key.keyId}`);
  console.log(`  Status:        ${status}`);
  console.log(`  Valid:         ${validity.valid}`);
  console.log(`  Needs Rotation: ${needs}`);
  console.log('');
  console.log('  Timestamps:');
  console.log(`    Created:     ${new Date(key.createdAt).toISOString()}`);
  console.log(`    Expires:     ${new Date(key.expiresAt).toISOString()}`);
  console.log(`    Deprecated:  ${key.deprecatedAt ? new Date(key.deprecatedAt).toISOString() : '-'}`);
  console.log(`    Destroyed:   ${key.destroyedAt ? new Date(key.destroyedAt).toISOString() : '-'}`);
  console.log('');
  console.log('  Policy:');
  console.log(`    TTL:         ${formatDuration(key.rotationPolicy.ttlMs)}`);
  console.log(`    Overlap:     ${formatDuration(key.rotationPolicy.overlapMs)}`);
  console.log('');
  console.log('  Metadata:');
  console.log(`    Environment: ${key.metadata.environment}`);
  console.log(`    Merchant:    ${key.metadata.merchantId || '(none)'}`);
  console.log(`    Created By:  ${key.metadata.createdBy}`);
  console.log('');
  console.log(`  Hash:          ${key.hash}`);
  
  // Show plaintext for testing
  if (store.plaintextKeys[keyId]) {
    console.log(`  Plaintext:     ${store.plaintextKeys[keyId]}`);
  }
  console.log('');

  if (validity.reason) {
    console.log(`  ℹ️  ${validity.reason}`);
    console.log('');
  }
}

async function cmdDeprecate(keyId) {
  if (!keyId) {
    console.error('  ❌ Usage: node src/cli.js deprecate <keyId>');
    process.exit(1);
  }

  const store = loadStore();
  const key = store.keys[keyId];

  if (!key) {
    console.error(`  ❌ Key not found: ${keyId}`);
    process.exit(1);
  }

  if (key.deprecatedAt) {
    console.error(`  ❌ Key already deprecated`);
    process.exit(1);
  }

  if (key.destroyedAt) {
    console.error(`  ❌ Key already destroyed`);
    process.exit(1);
  }

  const deprecated = deprecateSigningKey(key);
  store.keys[keyId] = deprecated;
  saveStore(store);

  const overlapEnds = new Date(deprecated.deprecatedAt + deprecated.rotationPolicy.overlapMs);

  console.log('');
  console.log('  🟡 KEY DEPRECATED');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  Key ID:        ${keyId}`);
  console.log(`  Deprecated At: ${new Date(deprecated.deprecatedAt).toISOString()}`);
  console.log(`  Overlap Ends:  ${overlapEnds.toISOString()}`);
  console.log(`  Still Valid:   Yes (for ${formatDuration(deprecated.rotationPolicy.overlapMs)})`);
  console.log('');
}

async function cmdDestroy(keyId) {
  if (!keyId) {
    console.error('  ❌ Usage: node src/cli.js destroy <keyId>');
    process.exit(1);
  }

  const store = loadStore();
  const key = store.keys[keyId];

  if (!key) {
    console.error(`  ❌ Key not found: ${keyId}`);
    process.exit(1);
  }

  if (key.destroyedAt) {
    console.error(`  ❌ Key already destroyed`);
    process.exit(1);
  }

  const destroyed = destroySigningKey(key);
  store.keys[keyId] = destroyed;
  saveStore(store);

  console.log('');
  console.log('  🔴 KEY DESTROYED');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  Key ID:        ${keyId}`);
  console.log(`  Destroyed At:  ${new Date(destroyed.destroyedAt).toISOString()}`);
  console.log(`  Valid:         No (immediately invalid)`);
  console.log('');
}

async function cmdRotate(keyId) {
  if (!keyId) {
    console.error('  ❌ Usage: node src/cli.js rotate <keyId>');
    process.exit(1);
  }

  const store = loadStore();
  const key = store.keys[keyId];

  if (!key) {
    console.error(`  ❌ Key not found: ${keyId}`);
    process.exit(1);
  }

  if (key.destroyedAt) {
    console.error(`  ❌ Cannot rotate destroyed key`);
    process.exit(1);
  }

  const { oldKey, newKey, plaintextKey } = await rotateSigningKey(key);
  
  store.keys[oldKey.keyId] = oldKey;
  store.keys[newKey.keyId] = newKey;
  store.plaintextKeys[newKey.keyId] = plaintextKey;
  saveStore(store);

  console.log('');
  console.log('  🔄 KEY ROTATED');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Old Key (deprecated):');
  console.log(`    ID:          ${oldKey.keyId}`);
  console.log(`    Status:      deprecated`);
  console.log(`    Valid Until: ${new Date(oldKey.deprecatedAt + oldKey.rotationPolicy.overlapMs).toISOString()}`);
  console.log('');
  console.log('  New Key (active):');
  console.log(`    ID:          ${newKey.keyId}`);
  console.log(`    Plaintext:   ${plaintextKey}`);
  console.log(`    Expires:     ${new Date(newKey.expiresAt).toISOString()}`);
  console.log('');
  console.log('  ⚠️  Save the new plaintext key!');
  console.log('');
}

async function cmdValidate(plaintextKey) {
  if (!plaintextKey) {
    console.error('  ❌ Usage: node src/cli.js validate <plaintextKey>');
    process.exit(1);
  }

  const hash = await hashKey(plaintextKey);
  const store = loadStore();

  // Find key by hash
  let foundKey = null;
  for (const key of Object.values(store.keys)) {
    if (key.hash === hash) {
      foundKey = key;
      break;
    }
  }

  console.log('');
  console.log('  🔐 KEY VALIDATION');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  Input:    ${plaintextKey.substring(0, 20)}...`);
  console.log(`  Hash:     ${hash.substring(0, 16)}...`);

  if (!foundKey) {
    console.log(`  Found:    No`);
    console.log(`  Valid:    ❌ Key not found in store`);
    console.log('');
    process.exit(1);
  }

  const validity = isSigningKeyValid(foundKey);
  const status = getSigningKeyStatus(foundKey);

  console.log(`  Found:    Yes (${foundKey.keyId})`);
  console.log(`  Status:   ${status}`);
  console.log(`  Valid:    ${validity.valid ? '✅ Yes' : '❌ No'}`);
  
  if (validity.reason) {
    console.log(`  Note:     ${validity.reason}`);
  }
  console.log('');
}

async function cmdClear() {
  saveStore({ keys: {}, plaintextKeys: {} });
  console.log('');
  console.log('  🗑️  All keys cleared from store');
  console.log('');
}

function cmdHelp() {
  console.log(`
  Key Rotator CLI - CRUD Testing
  ═══════════════════════════════════════════════════════════════

  Usage:
    node src/cli.js <command> [options]

  Commands:
    create                Create a new SigningKey
      --merchant, -m      Merchant ID (optional)
      --env, -e           Environment: live|test (default: live)
      --by                Created by: system|auto-rotation|user (default: user)

    list                  List all keys

    read <keyId>          Read key details

    deprecate <keyId>     Deprecate a key (start overlap period)

    destroy <keyId>       Destroy a key (immediate invalidation)

    rotate <keyId>        Rotate a key (deprecate old, create new)

    validate <plaintext>  Validate a plaintext key

    clear                 Clear all keys from store

    help                  Show this help message

  Examples:
    node src/cli.js create --merchant acme_corp --env live
    node src/cli.js list
    node src/cli.js read key_abc12345
    node src/cli.js deprecate key_abc12345
    node src/cli.js rotate key_abc12345
    node src/cli.js validate sk_live_a1b2c3d4e5f6...

  Note: Keys are stored in .keys.json for testing. In production,
  keys will be stored in Cloudflare Durable Objects.
`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getArg(args, flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'create':
        await cmdCreate(args.slice(1));
        break;
      case 'list':
        await cmdList();
        break;
      case 'read':
        await cmdRead(args[1]);
        break;
      case 'deprecate':
        await cmdDeprecate(args[1]);
        break;
      case 'destroy':
        await cmdDestroy(args[1]);
        break;
      case 'rotate':
        await cmdRotate(args[1]);
        break;
      case 'validate':
        await cmdValidate(args[1]);
        break;
      case 'clear':
        await cmdClear();
        break;
      case 'help':
      case '--help':
      case '-h':
        cmdHelp();
        break;
      default:
        if (!command) {
          cmdHelp();
        } else {
          console.error(`  ❌ Unknown command: ${command}`);
          console.error('  Run: node src/cli.js help');
          process.exit(1);
        }
    }
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();

