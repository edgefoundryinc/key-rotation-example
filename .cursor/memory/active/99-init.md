# Project Initialization

## Quick Start

```bash
# Run tests
npm test

# Or directly
node src/tests/key-rotator-test.js
```

## Project Context

This is a **standalone key rotation system** designed to be:
1. Generic - usable across multiple projects
2. Enterprise-aligned - follows industry standards (Stripe, AWS, Google Cloud patterns)
3. Cloudflare-native - optimized for Workers + Durable Objects

## Related Projects

This key rotator will integrate with:
- **ShopTrack (traceOS)** - Server-side Shopify tracking system
- **Shopify App (shop-v1)** - Shopify app integration layer

Both projects use the same tech stack:
- Cloudflare Workers
- Durable Objects (SQLite-backed)
- Zero npm dependencies
- Pure JavaScript ES modules

## Design Decisions

### Why Durable Objects over KV?
- Transactional guarantees for key state
- SQLite queries for complex operations
- Consistent with existing traceOS architecture

### Why 24h default grace period?
- Industry standard (Stripe, AWS IAM)
- Long enough for distributed client updates
- Short enough for security compliance

### Why hash-only storage?
- Plaintext keys are security liability
- Keys returned once on creation only
- Clients responsible for secure storage

## Memory Structure

| File | Purpose |
|------|---------|
| `00-project-summary.md` | Overview, status, file structure |
| `01-project-issues.md` | Bugs, pending decisions, limitations |
| `02-recent-work.md` | Changelog, session notes |
| `03-tech-stack.md` | Technologies, patterns, conventions |
| `04-api-reference.md` | Function signatures, API endpoints |
| `99-init.md` | This file - project context |
