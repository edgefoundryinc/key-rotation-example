# API Reference

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
  prefix: 'sk',              // optional, default 'sk'
  environment: 'live',       // optional, default 'live'
  merchantId: 'merchant_x',  // optional, for multi-tenant
  createdBy: 'system',       // optional, audit trail
  ttlMs: 2592000000,         // optional, 30 days default
  overlapMs: 86400000        // optional, 24h default
});

// Deprecate (start overlap period)
const deprecated = deprecateSigningKey(signingKey);

// Destroy (immediate invalidation)
const destroyed = destroySigningKey(signingKey);

// Check validity
const { valid, status, reason, remainingMs } = isSigningKeyValid(signingKey);

// Get status
const status = getSigningKeyStatus(signingKey);
// => 'active' | 'deprecated' | 'destroyed'

// Check if rotation needed
const needsIt = needsRotation(signingKey);
// => true if past TTL

// Rotate (deprecate old, create new)
const { oldKey, newKey, plaintextKey } = await rotateSigningKey(currentKey, {
  createdBy: 'auto-rotation'  // optional overrides
});
```

### Utility Functions

```javascript
// Generate key string
const key = generateKey('sk', 'live');
// => "sk_live_a1b2c3d4..."

// Generate key ID
const id = generateKeyId();
// => "key_abc12345"

// Hash for storage
const hash = await hashKey(plaintextKey);
// => "64-char hex SHA-256"

// Validate format
const { valid, error, parts } = validateKeyFormat(key);

// Format duration
formatDuration(86400000);  // => "24h"

// Clamp overlap to valid range
const clamped = clampOverlap(1000);  // => MIN_OVERLAP_MS
```

---

## REST API (Phase 3 - Planned)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/keys` | POST | Create new SigningKey |
| `/api/keys` | GET | List all keys |
| `/api/keys/:keyId` | GET | Get key status |
| `/api/keys/:keyId/rotate` | POST | Trigger rotation |
| `/api/keys/:keyId` | DELETE | Destroy key |

### Create Key Request
```json
POST /api/keys
{
  "prefix": "sk",
  "environment": "live",
  "merchantId": "merchant_abc",
  "ttlMs": 2592000000,
  "overlapMs": 86400000
}
```

### Create Key Response
```json
{
  "keyId": "key_abc12345",
  "key": "sk_live_xxxxx...",
  "expiresAt": 1767908963308,
  "rotationPolicy": {
    "ttlMs": 2592000000,
    "overlapMs": 86400000
  }
}
```

### Key Status Response
```json
{
  "keyId": "key_abc12345",
  "status": "active",
  "createdAt": 1765316963308,
  "expiresAt": 1767908963308,
  "deprecatedAt": null,
  "destroyedAt": null,
  "isValid": true,
  "needsRotation": false,
  "remainingTtlMs": 2591999000
}
```

---

## Test Commands

```bash
npm run test:key-rotator   # Core tests (26)
npm run test:signing-key   # Interface tests (18)
npm run test:all           # All tests (44)
```
