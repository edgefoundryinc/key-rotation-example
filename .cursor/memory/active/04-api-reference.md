# API Reference

## CLI Tool: `src/cli.js`

### Commands

```bash
# Create new key
node src/cli.js create [options]
  --merchant, -m    Merchant ID (optional)
  --env, -e         Environment: live|test (default: live)
  --by              Created by: system|auto-rotation|user (default: user)

# List all keys
node src/cli.js list

# Read key details
node src/cli.js read <keyId>

# Deprecate key (start overlap period)
node src/cli.js deprecate <keyId>

# Destroy key (immediate invalidation)
node src/cli.js destroy <keyId>

# Rotate key (deprecate old, create new)
node src/cli.js rotate <keyId>

# Validate plaintext key
node src/cli.js validate <plaintextKey>

# Clear all keys
node src/cli.js clear

# Show help
node src/cli.js help
```

### npm Scripts

```bash
npm run cli           # Run CLI
npm run key:create    # Create new key
npm run key:list      # List all keys
npm run key:clear     # Clear store
```

---

## Core Module: `src/key-rotator.js` (v2.0)

### SigningKey Interface

```typescript
interface SigningKey {
  keyId: string;               // "key_xxxxxxxx"
  hash: string;                // 64-char SHA-256 hex
  createdAt: number;           // epoch ms
  expiresAt: number;           // epoch ms (TTL expiry)
  deprecatedAt: number | null; // soft cutoff
  destroyedAt: number | null;  // hard cutoff
  rotationPolicy: {
    ttlMs: number;             // default: 2592000000 (30 days)
    overlapMs: number;         // default: 86400000 (24 hours)
  };
  metadata: {
    merchantId: string | null;
    environment: "live" | "test" | "dev" | "staging";
    createdBy: "system" | "auto-rotation" | "user";
  };
}
```

### Constants

```javascript
import {
  KEY_STATUS,           // { ACTIVE, DEPRECATED, DESTROYED }
  VALID_PREFIXES,       // ['sk', 'pk', 'ak', 'tk']
  VALID_ENVIRONMENTS,   // ['live', 'test', 'dev', 'staging']
  VALID_CREATED_BY,     // ['system', 'auto-rotation', 'user']
  DEFAULT_TTL_MS,       // 2592000000 (30 days)
  DEFAULT_OVERLAP_MS,   // 86400000 (24 hours)
  MIN_OVERLAP_MS,       // 300000 (5 minutes)
  MAX_OVERLAP_MS,       // 604800000 (7 days)
  KEY_RANDOM_LENGTH     // 32
} from './src/key-rotator.js';
```

### SigningKey Functions

```javascript
// Create new SigningKey (returns plaintext once!)
const { signingKey, plaintextKey } = await createSigningKey({
  prefix: 'sk',
  environment: 'live',
  merchantId: 'merchant_x',
  createdBy: 'system',
  ttlMs: 2592000000,
  overlapMs: 86400000
});

// Deprecate (start overlap period)
const deprecated = deprecateSigningKey(signingKey);

// Destroy (immediate invalidation)
const destroyed = destroySigningKey(signingKey);

// Check validity
const { valid, status, reason, remainingMs } = isSigningKeyValid(signingKey);

// Get status
const status = getSigningKeyStatus(signingKey);

// Check if rotation needed
const needsIt = needsRotation(signingKey);

// Rotate (deprecate old, create new)
const { oldKey, newKey, plaintextKey } = await rotateSigningKey(currentKey);
```

### Utility Functions

```javascript
generateKey('sk', 'live')     // => "sk_live_a1b2c3d4..."
generateKeyId()               // => "key_abc12345"
await hashKey(plaintextKey)   // => "64-char hex SHA-256"
validateKeyFormat(key)        // => { valid, error, parts }
formatDuration(86400000)      // => "24h"
clampOverlap(1000)            // => MIN_OVERLAP_MS
```

---

## Test Commands

```bash
npm test                   # Core tests (26)
npm run test:signing-key   # Interface tests (18)
npm run test:all           # All tests (44)
```

---

## Storage

| Environment | Storage |
|-------------|---------|
| CLI Testing | `.keys.json` (local file, gitignored) |
| Production | Cloudflare Durable Object (Phase 2) |
