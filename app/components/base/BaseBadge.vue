<script setup lang="ts">
const {
  variant = 'default',
  size = 'md',
  dot = false,
  pulse = false,
} = defineProps<{
  variant?: 'default' | 'success' | 'warning' | 'error'
  size?: 'sm' | 'md'
  dot?: boolean
  pulse?: boolean
}>()
</script>

<template>
  <span
    class="inline-flex items-center gap-2 rounded-full transition-all"
    :class="{
      // Size
      'px-1.5 py-0.5 text-[10px]': size === 'sm',
      'px-3 py-2 text-sm': size === 'md',
      // Variant
      'bg-card text-text-base/60': variant === 'default',
      'bg-green-500/10 text-green-400': variant === 'success',
      'bg-amber-500/10 text-amber-400': variant === 'warning',
      'bg-red-500/10 text-red-400': variant === 'error',
    }"
  >
    <span
      v-if="dot"
      class="size-2 shrink-0 rounded-full"
      :class="{
        'bg-text-base/40': variant === 'default',
        'bg-green-500 shadow-[0_0_0_2px_rgba(34,197,94,0.2)]': variant === 'success',
        'bg-amber-500': variant === 'warning',
        'bg-red-500': variant === 'error',
        'animate-pulse': pulse,
      }"
    />
    <span class="font-medium"><slot /></span>
  </span>
</template>
