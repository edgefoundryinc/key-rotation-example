# Project Summary

- **Project:** Key Rotator System
- **Purpose:** Generic, enterprise-aligned API key rotation for Cloudflare Workers with zero-downtime support
- **Architecture:** Edge-first (Cloudflare Workers) with Durable Object (SQLite-backed) storage
- **Status:** Phase 1 Complete (v2.0 - SigningKey Interface + CLI), Phase 2-5 Pending

## SigningKey Interface (Tim Cook Design)

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

## Key Lifecycle

```
active ──[deprecate]──► deprecated ──[overlap ends]──► destroyed
                        (still valid)                 (invalid)
```

## File Structure

| File | Purpose |
|------|---------|
| `src/key-rotator.js` | Core module - SigningKey functions (v2.0) |
| `src/cli.js` | CLI tool for CRUD testing |
| `src/tests/key-rotator-test.js` | Core self-test (26 tests) |
| `src/tests/signing-key-shape-test.js` | Interface validation (18 tests) |
| `.keys.json` | Local key store (testing only, gitignored) |
| `src/durable-objects/KeyRotatorDO.js` | *Phase 2* - SQLite storage |
| `src/handlers/key-admin.js` | *Phase 3* - REST API endpoints |
| `auth.js` | Existing auth module (to integrate Phase 4) |

## Implementation Phases

1. ✅ **Phase 1:** Core module + CLI (44 tests, CRUD verified)
2. ⏳ **Phase 2:** Durable Object with SQLite schema
3. ⏳ **Phase 3:** REST API handler (`/api/keys/*`)
4. ⏳ **Phase 4:** Integration with existing `auth.js`
5. ⏳ **Phase 5:** Auto-rotation via Cron Trigger
