<!--
  Root App Component
  ==================

  The root component for our Nuxt app.
  Provides the IndexedDB sync engine to all child components.
-->

<script setup lang="ts">
import { useIDBSyncEngineProvider } from '~/composables/useIDBSyncEngine'

// Provide the IndexedDB sync engine to all child components
// Configure WebSocket URL for sync (optional - can be undefined for offline-only mode)
const wsUrl = typeof window !== 'undefined'
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/_ws`
  : undefined

useIDBSyncEngineProvider({ peer: wsUrl })
</script>

<template>
  <NuxtPage />
</template>
