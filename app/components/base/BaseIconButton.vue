<script setup lang="ts">
const {
  variant = 'action',
  active = false,
  ghost = false,
  label,
} = defineProps<{
  variant?: 'checkbox' | 'action'
  active?: boolean
  ghost?: boolean
  label: string
}>()
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    class="flex shrink-0 items-center justify-center transition-all"
    :class="{
      // Checkbox variant
      'size-6 rounded-full border-2': variant === 'checkbox',
      'border-accent bg-accent': variant === 'checkbox' && active,
      'border-border bg-transparent hover:border-accent': variant === 'checkbox' && !active,
      // Action variant
      'size-7 rounded-md text-text-base/40 hover:bg-accent/20 hover:text-accent': variant === 'action',
      // Ghost modifier (show on hover only)
      'opacity-0 group-hover:opacity-100': ghost,
    }"
  >
    <slot />
  </button>
</template>
