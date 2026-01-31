<script setup lang="ts">
const {
  variant = 'primary',
  type = 'button',
  disabled = false,
} = defineProps<{
  variant?: 'primary' | 'secondary' | 'tertiary'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
}>()
</script>

<template>
  <button
    :type
    :disabled
    class="transition-all disabled:cursor-not-allowed disabled:opacity-50"
    :class="{
      'rounded-xl bg-accent px-6 py-3 font-semibold text-fill hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/30 disabled:translate-y-0 disabled:shadow-none': variant === 'primary',
      'rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm text-accent hover:bg-accent/20': variant === 'secondary',
      'rounded-md border border-border px-3 py-1.5 text-sm text-text-base/60 hover:bg-card hover:text-text-base': variant === 'tertiary',
    }"
  >
    <slot />
  </button>
</template>
