<!--
  Sync Status Component
  =====================

  Displays the current sync status with visual indicator.

  > **What Jazz Does Better**
  >
  > Jazz provides:
  > - Per-document sync status
  > - Sync progress indicators
  > - Conflict notifications
  > - Presence awareness (who's online)
  >
  > We show a simple global status.
-->

<script setup lang="ts">
interface Props {
  isOnline: boolean
  isSyncing: boolean
  isConnected: boolean
  lastSyncAt: number
  error?: string | null
}

const props = defineProps<Props>()

const statusClass = computed(() => ({
  'status-syncing': props.isSyncing,
  'status-online': props.isOnline && props.isConnected && !props.isSyncing && !props.error,
  'status-offline': !props.isOnline,
  'status-disconnected': props.isOnline && !props.isConnected && !props.isSyncing,
  'status-error': !!props.error,
}))

const statusText = computed(() => {
  if (props.error)
    return 'Sync error'
  if (props.isSyncing)
    return 'Syncing...'
  if (!props.isOnline)
    return 'Offline'
  if (!props.isConnected)
    return 'Connecting...'
  return 'Synced'
})

const lastSyncText = computed(() => {
  if (!props.lastSyncAt || props.isSyncing)
    return ''

  const diff = Date.now() - props.lastSyncAt
  if (diff < 5000)
    return 'just now'
  if (diff < 60000)
    return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000)
    return `${Math.floor(diff / 60000)}m ago`
  return `${Math.floor(diff / 3600000)}h ago`
})
</script>

<template>
  <div class="sync-status" :class="statusClass">
    <span class="status-dot" />
    <span class="status-text">{{ statusText }}</span>
    <span v-if="lastSyncText" class="last-sync">
      {{ lastSyncText }}
    </span>
  </div>
</template>

<style scoped>
.sync-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #6b7280;
  padding: 0.5rem 0.75rem;
  border-radius: 9999px;
  background: #f3f4f6;
  transition: all 0.2s ease;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
  transition: all 0.2s ease;
}

.status-text {
  font-weight: 500;
}

.last-sync {
  color: #9ca3af;
  font-size: 0.75rem;
}

/* Status variants */
.status-online .status-dot {
  background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

.status-syncing .status-dot {
  background: #3b82f6;
  animation: pulse 1.5s ease-in-out infinite;
}

.status-offline {
  background: #fef3c7;
  color: #92400e;
}

.status-offline .status-dot {
  background: #f59e0b;
}

.status-disconnected .status-dot {
  background: #f59e0b;
  animation: pulse 2s ease-in-out infinite;
}

.status-error {
  background: #fef2f2;
  color: #dc2626;
}

.status-error .status-dot {
  background: #ef4444;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(1.2);
  }
}
</style>
