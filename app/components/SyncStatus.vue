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

const { isSyncing, isOnline, isConnected, error, lastSyncAt } = defineProps<Props>()

const statusText = computed(() => {
  if (error)
    return 'Sync error'
  if (isSyncing)
    return 'Syncing...'
  if (!isOnline)
    return 'Offline'
  if (!isConnected)
    return 'Connecting...'
  return 'Synced'
})

const lastSyncText = computed(() => {
  if (!lastSyncAt || isSyncing)
    return ''

  const diff = Date.now() - lastSyncAt
  if (diff < 5000)
    return 'just now'
  if (diff < 60000)
    return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000)
    return `${Math.floor(diff / 60000)}m ago`
  return `${Math.floor(diff / 3600000)}h ago`
})

const dotClass = computed(() => {
  if (error)
    return 'bg-red-500'
  if (isSyncing)
    return 'bg-accent animate-pulse'
  if (!isOnline)
    return 'bg-amber-500'
  if (!isConnected)
    return 'bg-amber-500 animate-pulse'
  return 'bg-green-500 shadow-[0_0_0_2px_rgba(34,197,94,0.2)]'
})

const containerClass = computed(() => {
  if (error)
    return 'bg-red-500/10 text-red-400'
  if (!isOnline)
    return 'bg-amber-500/10 text-amber-400'
  return 'bg-card text-text-base/60'
})
</script>

<template>
  <div
    class="flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-all"
    :class="containerClass"
  >
    <span
      class="size-2 shrink-0 rounded-full transition-all"
      :class="dotClass"
    />
    <span class="font-medium">{{ statusText }}</span>
    <span v-if="lastSyncText" class="text-xs text-text-base/40">
      {{ lastSyncText }}
    </span>
  </div>
</template>
