import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // Required: Pin behavior to a specific date
  compatibilityDate: '2024-11-01',

  // Enable Nuxt 4 features
  future: {
    compatibilityVersion: 4,
  },

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  // Runtime configuration
  runtimeConfig: {
    // Server-only (not exposed to client)
    databasePath: './data/sync.db',

    // Public (accessible on client via useRuntimeConfig().public)
    public: {
      syncInterval: 30000, // Auto-sync interval (ms)
      wsReconnectDelay: 3000, // WebSocket reconnect delay (ms)
      wsPingInterval: 30000, // WebSocket ping interval (ms)
    },
  },

  // Nitro server configuration
  nitro: {
    // Enable WebSocket support (still experimental in Nuxt 4)
    experimental: {
      websocket: true,
    },
    // Required headers for OPFS and SharedArrayBuffer support
    routeRules: {
      '**': {
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
      },
    },
  },

  // Vite configuration for sql.js WASM support
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      // Include sql.js for pre-bundling to handle CommonJS->ESM conversion
      include: ['sql.js'],
      // Force re-optimization to apply changes
      force: true,
    },
    build: {
      // Ensure WASM files are properly handled
      target: 'esnext',
      commonjsOptions: {
        // Ensure proper default export for CommonJS modules
        defaultIsModuleExports: true,
      },
    },
    // sql.js is browser-only (WASM) - keep external for SSR
    ssr: {
      external: ['sql.js'],
    },
  },

  // Auto-import composables from these directories
  imports: {
    dirs: ['composables', 'utils'],
  },

  // TypeScript configuration
  typescript: {
    strict: true,
  },
})
