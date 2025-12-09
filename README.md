# Key Rotator System

A generic, enterprise-aligned API key rotation system for Cloudflare Workers with zero-downtime support.

## Overview

This system provides secure API key management with:
- **SigningKey Interface** - Tim Cook's enterprise-aligned design
- **Dual-key validity window** (overlap period) for zero-downtime rotation
- **Multi-tenant support** - merchantId for tenant isolation
- **Audit trail** - createdBy tracking (system/auto-rotation/user)
- **Pure JavaScript** with zero npm dependencies

---

## SigningKey Interface

```typescript
interface SigningKey {
  keyId: string;               // stable identifier (key_xxxxxxxx)
  hash: string;                // SHA-256 hash of plaintext
  createdAt: number;           // epoch ms
  expiresAt: number;           // epoch ms (TTL expiry)
  deprecatedAt?: number;       // soft cutoff (overlap starts)
  destroyedAt?: number;        // hard cutoff (invalid)
  rotationPolicy: {
    ttlMs: number;             // key lifetime (default 30 days)
    overlapMs: number;         // grace period (default 24h)
  };
  metadata?: {
    merchantId: string;        // multi-tenant support
    environment: "live" | "test";
    createdBy: "system" | "auto-rotation" | "user";
  };
}
```

**Key Lifecycle:**
```
active ──[deprecate]──► deprecated ──[overlap ends]──► destroyed
                        (still valid)                 (invalid)
```

---

## Quick Start

```javascript
import { 
  createSigningKey, 
  deprecateSigningKey, 
  rotateSigningKey,
  isSigningKeyValid 
} from './src/key-rotator.js';

// Create a new key (plaintext returned ONCE)
const { signingKey, plaintextKey } = await createSigningKey({
  merchantId: 'merchant_abc',
  environment: 'live'
});
// plaintextKey: "sk_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

// Check validity
const { valid, status, remainingMs } = isSigningKeyValid(signingKey);

// Rotate when needed (deprecates old, creates new)
const { oldKey, newKey, plaintextKey: newPlaintext } = await rotateSigningKey(signingKey);
```

---

## Implementation Phases

### Phase 1: Core Module (`src/key-rotator.js`) ✅ COMPLETE

| Function | Purpose |
|----------|---------|
| `createSigningKey(options)` | Generate new SigningKey + plaintext |
| `deprecateSigningKey(key)` | Start overlap period (soft cutoff) |
| `destroySigningKey(key)` | Immediate invalidation (hard cutoff) |
| `isSigningKeyValid(key)` | Check validity + remaining time |
| `getSigningKeyStatus(key)` | Get current status |
| `needsRotation(key)` | Check if past TTL |
| `rotateSigningKey(key)` | Full rotation workflow |

**Tests:** 44 total (26 core + 18 interface validation)

---

### Phase 2: Durable Object (`src/durable-objects/KeyRotatorDO.js`)

SQLite-backed storage for key state:

```sql
CREATE TABLE signing_keys (
  key_id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  deprecated_at INTEGER,
  destroyed_at INTEGER,
  ttl_ms INTEGER NOT NULL,
  overlap_ms INTEGER NOT NULL,
  merchant_id TEXT,
  environment TEXT NOT NULL,
  created_by TEXT NOT NULL
);
```

---

### Phase 3: Worker Handler (`src/handlers/key-admin.js`)

REST API for key management:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/keys` | POST | Create new key |
| `/api/keys` | GET | List all keys |
| `/api/keys/:keyId` | GET | Get key status |
| `/api/keys/:keyId/rotate` | POST | Trigger rotation |
| `/api/keys/:keyId` | DELETE | Destroy key |

---

### Phase 4: Auth Integration

Update `auth.js` to validate against SigningKey records.

---

### Phase 5: Auto-Rotation

Cloudflare Cron Trigger for automatic rotation of expiring keys.

---

## Files Overview

| File | Status | Purpose |
|------|--------|---------|
| `src/key-rotator.js` | ✅ Complete | SigningKey functions (v2.0) |
| `src/tests/key-rotator-test.js` | ✅ Complete | Core tests (26) |
| `src/tests/signing-key-shape-test.js` | ✅ Complete | Interface tests (18) |
| `src/durable-objects/KeyRotatorDO.js` | ⏳ Phase 2 | SQLite storage |
| `src/handlers/key-admin.js` | ⏳ Phase 3 | REST API |
| `auth.js` | ⏳ Phase 4 | Auth integration |

---

## Security

- Keys stored as **SHA-256 hashes only** (plaintext returned once on creation)
- **Timing-safe comparison** for validation
- **Overlap period** prevents outages during rotation (default 24h)
- **Immediate destroy** available for emergency revocation

---

## Test Commands

```bash
npm test                   # Core tests
npm run test:signing-key   # Interface validation
npm run test:all           # All 44 tests
```

---

## Industry Alignment

| System | Overlap Window |
|--------|---------------|
| Stripe | ~12–24 hours |
| AWS IAM | Up to 24 hours |
| Google Cloud | 48 hours |
| Okta JWT | 12 hours |
| **This System** | **24h default** (5min → 7 days) |

---

## License

MIT
