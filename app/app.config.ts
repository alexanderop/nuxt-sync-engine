/**
 * App Configuration
 * =================
 *
 * Static configuration values that don't need runtime overrides.
 * Use runtimeConfig for values that may change per environment.
 */
export default defineAppConfig({
  storage: {
    deviceIdKey: 'sync-engine-device-id',
    syncMetaKey: 'sync_meta',
  },
  sync: {
    allowedTables: ['todos', 'projects'] as const,
    maxBatchSize: 100,
    protocolVersion: '1.0.0',
  },
})
