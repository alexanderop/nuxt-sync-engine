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
import { useTimeAgo } from '@vueuse/core'

interface Props {
  isOnline: boolean
  isSyncing: boolean
  isConnected: boolean
  lastSyncAt: number
  error?: string | null
}

const { error, isSyncing, isOnline, isConnected, lastSyncAt } = defineProps<Props>()

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

const timeAgo = useTimeAgo(() => lastSyncAt)

const lastSyncText = computed(() => {
  if (!lastSyncAt || isSyncing)
    return ''
  return timeAgo.value
})

const dotClass = computed(() => {
  if (error)
    return 'bg-error'
  if (isSyncing)
    return 'bg-accent animate-pulse'
  if (!isOnline)
    return 'bg-warning'
  if (!isConnected)
    return 'bg-warning animate-pulse'
  return 'bg-success shadow-[0_0_0_2px_rgba(34,197,94,0.2)]'
})

const containerClass = computed(() => {
  if (error)
    return 'bg-error/10 text-error'
  if (!isOnline)
    return 'bg-warning/10 text-warning'
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
