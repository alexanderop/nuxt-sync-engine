# Sync Engine Gotchas

Hard-won lessons from building the local-first sync engine.

## sql.js WASM Setup

The WASM file must be copied to `public/wasm/` before the app works:

```bash
pnpm setup:wasm
```

Without this, sql.js fails to initialize in the browser.

## COOP/COEP Headers Required

SharedArrayBuffer (needed for OPFS) requires these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Already configured in `nuxt.config.ts` under `nitro.routeRules`.

## sql.js Must Be Excluded from Vite Optimization

sql.js uses dynamic WASM loading that breaks with Vite's dependency optimization:

```ts
// nuxt.config.ts
vite: {
  optimizeDeps: {
    exclude: ["sql.js"],
  },
}
```

## WebSocket Experimental Flag

Nitro WebSockets are still experimental in Nuxt 4:

```ts
nitro: {
  experimental: {
    websocket: true,
  },
}
```
