# Project Issues

No critical issues at this time.

## Resolved

### ✅ formatDuration edge case (2025-12-09)
- **Issue:** `formatDuration(86400000)` returned "1d" instead of "24h"
- **Fix:** Changed `< 86400000` to `<= 86400000` for hour threshold
- **Test:** Added to self-test suite, all 20 tests now pass

## Pending Decisions

### Storage Strategy (Phase 2)
- Confirmed: Using Durable Object with SQLite
- Need to decide: Single DO instance vs per-tenant DOs

### Key Naming Convention
- Current: `key_{8-char-random}` for IDs
- Consider: Version-based IDs (`key_v1`, `key_v2`) for easier tracking

## Known Limitations

- No npm dependencies (by design - matches traceOS architecture)
- Keys stored as hashes only - plaintext returned once on creation
- No built-in key export/backup mechanism yet
