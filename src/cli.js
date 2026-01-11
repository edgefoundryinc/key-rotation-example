#!/usr/bin/env node
/**
 * Key Rotator CLI - CRUD & KV Management
 * =======================================
 * 
 * Local CRUD:
 *   node src/cli.js create [--merchant <id>] [--env <live|test>]
 *   node src/cli.js list
 *   node src/cli.js read <keyId>
 *   node src/cli.js deprecate <keyId>
 *   node src/cli.js destroy <keyId>
 *   node src/cli.js rotate <keyId>
 *   node src/cli.js validate <plaintextKey>
 *   node src/cli.js clear
 * 
 * KV Sync:
 *   node src/cli.js kv:export          Export .keys.json to KV bulk format
 *   node src/cli.js kv:status          Show KV sync status
 *   node src/cli.js kv:push --preview  Preview what would be pushed
 *   node src/cli.js kv:push --execute  Push to KV via wrangler
 * 
 * Keys are stored in .keys.json for local testing.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
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

import {
  hashKeyPattern,
  keyIdPattern,
  merchantKeysPattern
} from './key-store-kv.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE (JSON file for testing)
// ═══════════════════════════════════════════════════════════════════════════════

const STORE_FILE = '.keys.json';
const KV_EXPORT_FILE = '.keys-kv-export.json';

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
// CLI COMMANDS - LOCAL CRUD
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
  store.plaintextKeys[signingKey.keyId] = plaintextKey;
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
  console.log('  📋 SIGNING KEYS (Local Store)');
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
  console.log('  🗑️  All keys cleared from local store');
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI COMMANDS - KV SYNC
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build KV entries from local store
 */
function buildKvEntries(store) {
  const entries = [];
  const merchantLists = {};

  for (const key of Object.values(store.keys)) {
    const keyJson = JSON.stringify(key);

    // Entry by hash (primary lookup)
    entries.push({
      key: hashKeyPattern(key.hash),
      value: keyJson
    });

    // Entry by keyId (admin lookup)
    entries.push({
      key: keyIdPattern(key.keyId),
      value: keyJson
    });

    // Build merchant list
    const merchantId = key.metadata?.merchantId || '_global';
    if (!merchantLists[merchantId]) {
      merchantLists[merchantId] = [];
    }
    merchantLists[merchantId].push(key.keyId);
  }

  // Add merchant list entries
  for (const [merchantId, keyIds] of Object.entries(merchantLists)) {
    entries.push({
      key: merchantKeysPattern(merchantId === '_global' ? null : merchantId),
      value: JSON.stringify(keyIds)
    });
  }

  return entries;
}

async function cmdKvExport() {
  const store = loadStore();
  const keys = Object.values(store.keys);

  if (keys.length === 0) {
    console.log('');
    console.log('  ❌ No keys to export. Create some keys first.');
    console.log('');
    return;
  }

  const entries = buildKvEntries(store);
  writeFileSync(KV_EXPORT_FILE, JSON.stringify(entries, null, 2));

  console.log('');
  console.log('  📤 KV EXPORT');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  Keys exported:    ${keys.length}`);
  console.log(`  KV entries:       ${entries.length}`);
  console.log(`  Export file:      ${KV_EXPORT_FILE}`);
  console.log('');
  console.log('  Entry types:');

  const hashEntries = entries.filter(e => e.key.startsWith('hash:'));
  const keyEntries = entries.filter(e => e.key.startsWith('key:'));
  const merchantEntries = entries.filter(e => e.key.startsWith('merchant:'));

  console.log(`    hash:*          ${hashEntries.length} (primary lookup)`);
  console.log(`    key:*           ${keyEntries.length} (admin lookup)`);
  console.log(`    merchant:*      ${merchantEntries.length} (merchant lists)`);
  console.log('');
  console.log('  To push to KV, run:');
  console.log('    npx wrangler kv:bulk put --namespace-id <ID> .keys-kv-export.json');
  console.log('');
}

async function cmdKvStatus() {
  const store = loadStore();
  const keys = Object.values(store.keys);

  console.log('');
  console.log('  📊 KV SYNC STATUS');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  Local keys:       ${keys.length}`);
  console.log(`  Store file:       ${STORE_FILE}`);
  console.log(`  Export file:      ${existsSync(KV_EXPORT_FILE) ? KV_EXPORT_FILE : '(not created)'}`);
  console.log('');

  // Group by merchant
  const byMerchant = {};
  for (const key of keys) {
    const merchantId = key.metadata?.merchantId || '_global';
    if (!byMerchant[merchantId]) {
      byMerchant[merchantId] = { active: 0, deprecated: 0, destroyed: 0 };
    }
    const status = getSigningKeyStatus(key);
    byMerchant[merchantId][status]++;
  }

  if (Object.keys(byMerchant).length > 0) {
    console.log('  Keys by merchant:');
    for (const [merchantId, counts] of Object.entries(byMerchant)) {
      const display = merchantId === '_global' ? '(global)' : merchantId;
      console.log(`    ${display}: ${counts.active} active, ${counts.deprecated} deprecated, ${counts.destroyed} destroyed`);
    }
    console.log('');
  }

  console.log('  Commands:');
  console.log('    node src/cli.js kv:export     Export to KV bulk format');
  console.log('    node src/cli.js kv:push       Push to KV (requires wrangler)');
  console.log('');
}

async function cmdKvPush(args) {
  const preview = args.includes('--preview');
  const execute = args.includes('--execute');
  const namespaceId = getArg(args, '--namespace') || getArg(args, '-n');

  const store = loadStore();
  const keys = Object.values(store.keys);

  if (keys.length === 0) {
    console.log('');
    console.log('  ❌ No keys to push. Create some keys first.');
    console.log('');
    return;
  }

  const entries = buildKvEntries(store);

  console.log('');
  console.log('  🚀 KV PUSH');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  Keys to push:     ${keys.length}`);
  console.log(`  KV entries:       ${entries.length}`);
  console.log('');

  if (preview) {
    console.log('  Preview of KV entries:');
    for (const entry of entries.slice(0, 10)) {
      console.log(`    ${entry.key}`);
    }
    if (entries.length > 10) {
      console.log(`    ... and ${entries.length - 10} more`);
    }
    console.log('');
    console.log('  To execute, run:');
    console.log('    node src/cli.js kv:push --execute --namespace <KV_NAMESPACE_ID>');
    console.log('');
    return;
  }

  if (execute) {
    if (!namespaceId) {
      console.error('  ❌ --namespace <ID> is required for --execute');
      console.error('');
      console.error('  Find your namespace ID with:');
      console.error('    npx wrangler kv:namespace list');
      console.error('');
      process.exit(1);
    }

    // Write export file
    writeFileSync(KV_EXPORT_FILE, JSON.stringify(entries, null, 2));
    console.log(`  Exported to:      ${KV_EXPORT_FILE}`);

    // Execute wrangler command
    console.log(`  Pushing to KV namespace: ${namespaceId}`);
    console.log('');

    try {
      const cmd = `npx wrangler kv:bulk put --namespace-id ${namespaceId} ${KV_EXPORT_FILE}`;
      console.log(`  Running: ${cmd}`);
      console.log('');
      execSync(cmd, { stdio: 'inherit' });
      console.log('');
      console.log('  ✅ Push complete!');
    } catch (error) {
      console.error('');
      console.error('  ❌ Push failed. Make sure wrangler is configured.');
      process.exit(1);
    }
    console.log('');
    return;
  }

  // Default: show help
  console.log('  Usage:');
  console.log('    node src/cli.js kv:push --preview              Preview entries');
  console.log('    node src/cli.js kv:push --execute -n <ID>      Push to KV');
  console.log('');
  console.log('  Find your KV namespace ID:');
  console.log('    npx wrangler kv:namespace list');
  console.log('');
}

async function cmdKvList(args) {
  const namespaceId = getArg(args, '--namespace') || getArg(args, '-n');

  if (!namespaceId) {
    console.log('');
    console.log('  📋 KV LIST');
    console.log('  ═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('  Usage:');
    console.log('    node src/cli.js kv:list --namespace <ID>');
    console.log('');
    console.log('  Find your KV namespace ID:');
    console.log('    npx wrangler kv:namespace list');
    console.log('');
    return;
  }

  console.log('');
  console.log('  📋 KV KEYS');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  Namespace: ${namespaceId}`);
  console.log('');

  try {
    const cmd = `npx wrangler kv:key list --namespace-id ${namespaceId}`;
    execSync(cmd, { stdio: 'inherit' });
  } catch (error) {
    console.error('');
    console.error('  ❌ Failed to list keys. Make sure wrangler is configured.');
    process.exit(1);
  }
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELP
// ═══════════════════════════════════════════════════════════════════════════════

function cmdHelp() {
  console.log(`
  Key Rotator CLI
  ═══════════════════════════════════════════════════════════════

  Usage:
    node src/cli.js <command> [options]

  Local CRUD Commands:
    create                Create a new SigningKey
      --merchant, -m      Merchant ID (optional)
      --env, -e           Environment: live|test (default: live)
      --by                Created by: system|auto-rotation|user (default: user)

    list                  List all keys in local store
    read <keyId>          Read key details
    deprecate <keyId>     Deprecate a key (start overlap period)
    destroy <keyId>       Destroy a key (immediate invalidation)
    rotate <keyId>        Rotate a key (deprecate old, create new)
    validate <plaintext>  Validate a plaintext key
    clear                 Clear all keys from local store

  KV Sync Commands:
    kv:status             Show KV sync status
    kv:export             Export local keys to KV bulk format
    kv:push --preview     Preview what would be pushed to KV
    kv:push --execute     Push to KV (requires --namespace <ID>)
    kv:list               List keys in KV (requires --namespace <ID>)

  Examples:
    # Local workflow
    node src/cli.js create --merchant acme_corp --env live
    node src/cli.js list
    node src/cli.js rotate key_abc12345

    # KV workflow
    node src/cli.js kv:status
    node src/cli.js kv:push --preview
    node src/cli.js kv:push --execute -n <NAMESPACE_ID>

  Files:
    .keys.json            Local key store (gitignored)
    .keys-kv-export.json  KV bulk export format

  Note: Local store includes plaintext keys for testing.
  In production, only hashes are stored in KV.
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
      // Local CRUD
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

      // KV Sync
      case 'kv:status':
        await cmdKvStatus();
        break;
      case 'kv:export':
        await cmdKvExport();
        break;
      case 'kv:push':
        await cmdKvPush(args.slice(1));
        break;
      case 'kv:list':
        await cmdKvList(args.slice(1));
        break;

      // Help
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
