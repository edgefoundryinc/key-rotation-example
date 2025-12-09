# Tech Stack

## Core Runtime

**Cloudflare Workers**  
Serverless JavaScript runtime for key management API and storage.

**JavaScript (ES Modules)**  
Pure JavaScript with async/await, Web-standard APIs. No TypeScript, **zero npm dependencies**.

**Node.js (Local Testing)**  
Used for running test suites locally via `npm test`.

---

## Data & State Layer

**Cloudflare Durable Objects (SQLite-backed)** *(Phase 2)*  
Stateful isolated instance with embedded SQLite for key storage.

**Schema (Planned):**
```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER,
  expires_at INTEGER,
  metadata TEXT
);
```

---

## Cryptography

**Web Crypto API**  
- `crypto.getRandomValues()` - CSPRNG for key generation
- `crypto.subtle.digest('SHA-256')` - Key hashing for storage

**No External Dependencies**  
All crypto via browser/Worker built-in APIs.

---

## Testing

**Self-Test Pattern**  
Each module exports a `selfTest()` function with fake inputs.

**Run Tests:**
```bash
npm test
# or
node src/tests/key-rotator-test.js
```

---

## Build & Deployment

**Wrangler CLI**  
Development, deployment, DO management.

**GitHub**  
Source control, CI integration.

---

## Architectural Principles

- **Edge-native** execution (Cloudflare Workers)
- **Serverless** compute (no backend servers)
- **Pure JavaScript** - zero npm dependencies
- **Timing-safe** comparisons to prevent timing attacks
- **Hash-only storage** - plaintext keys never persisted
- **Grace period** rotation for zero-downtime

---

## Shell Notes

⚠️ **Windows PowerShell:** Use `;` not `&&` to chain commands
```powershell
# Good
cd src; node test.js

# Bad (doesn't work reliably)
cd src && node test.js
```
