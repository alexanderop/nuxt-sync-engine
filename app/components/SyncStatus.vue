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

const props = defineProps<Props>()

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

const timeAgo = useTimeAgo(() => props.lastSyncAt)

const lastSyncText = computed(() => {
  if (!props.lastSyncAt || props.isSyncing)
    return ''
  return timeAgo.value
})

const dotClass = computed(() => {
  if (props.error)
    return 'bg-red-500'
  if (props.isSyncing)
    return 'bg-accent animate-pulse'
  if (!props.isOnline)
    return 'bg-amber-500'
  if (!props.isConnected)
    return 'bg-amber-500 animate-pulse'
  return 'bg-green-500 shadow-[0_0_0_2px_rgba(34,197,94,0.2)]'
})

const containerClass = computed(() => {
  if (props.error)
    return 'bg-red-500/10 text-red-400'
  if (!props.isOnline)
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
