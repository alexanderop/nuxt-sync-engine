# Testing Strategy

## Overview

This project uses Vitest with @nuxt/test-utils to test both native Node.js modules and Nuxt integration.

## Test Structure

```
tests/
├── server/
│   └── database.test.ts    # Native module & DB operations
├── unit/
│   └── (future: co.test.ts, sync-protocol.test.ts)
└── nuxt/
    └── api/
        └── sync.test.ts    # API endpoint integration
```

## Test Commands

| Command | Purpose |
|---------|---------|
| `pnpm test` | Watch mode for development |
| `pnpm test:run` | Run all unit/server tests once |
| `pnpm test:native` | Fast native module check |
| `pnpm test:server` | All server-side tests |
| `pnpm test:nuxt` | Nuxt integration tests (starts server) |

## Configuration

Two Vitest configs are used:

- **`vitest.config.ts`** - Base config for server/unit tests (Node environment)
- **`vitest.nuxt.config.ts`** - Nuxt integration tests with happy-dom

## Native Module Testing

The `tests/server/database.test.ts` test is critical for catching better-sqlite3 binding issues early:

```typescript
import Database from 'better-sqlite3'

it('should load native bindings', () => {
  expect(() => {
    db = new Database(':memory:')
  }).not.toThrow()
})
```

This test will fail immediately if:
- Native bindings aren't compiled
- Node.js version mismatch
- Platform-specific build issues

## CI Pipeline Recommendation

Run native module tests first to fail fast:

```yaml
steps:
  - name: Install dependencies
    run: pnpm install

  - name: Build native modules
    run: npm rebuild better-sqlite3

  - name: Native module check
    run: pnpm test:native

  - name: Server tests
    run: pnpm test:run

  - name: Integration tests
    run: pnpm test:nuxt
```

## Adding New Tests

### Server/Unit Tests

Add to `tests/server/` or `tests/unit/`:

```typescript
import { describe, expect, it } from 'vitest'

describe('my feature', () => {
  it('should work', () => {
    expect(true).toBe(true)
  })
})
```

### Nuxt Integration Tests

Add to `tests/nuxt/`:

```typescript
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

describe('My API', async () => {
  await setup({ server: true })

  it('GET /api/endpoint works', async () => {
    const res = await $fetch('/api/endpoint')
    expect(res).toHaveProperty('expected')
  })
})
```

## Health Check Endpoint

A `/api/health` endpoint is available for runtime verification:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","sqlite":"3.46.0","timestamp":1706789012345}
```

## Troubleshooting

### "Could not locate the bindings file"

Native module not compiled. Run:

```bash
npm rebuild better-sqlite3
```

### Nuxt tests fail with environment errors

Ensure `@vue/test-utils` and `happy-dom` are installed:

```bash
pnpm add -D @vue/test-utils happy-dom
```

### Tests timeout

Nuxt integration tests start a real server. Increase timeout if needed:

```typescript
describe('Slow API', async () => {
  await setup({ server: true })
  // tests...
}, { timeout: 30000 })
```
