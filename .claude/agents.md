# Agent Instructions

## After Completing a Task

After finishing any code changes, run these verification steps:

```bash
pnpm lint        # Run oxlint + eslint
pnpm typecheck   # Run vue-tsc type checking
pnpm test:run    # Run all tests
```

All three must pass before considering a task complete.
