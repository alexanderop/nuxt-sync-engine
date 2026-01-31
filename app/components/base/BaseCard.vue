<script setup lang="ts">
const {
  variant = 'elevated',
  padding = 'none',
  tag = 'div',
} = defineProps<{
  variant?: 'elevated' | 'flat'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  tag?: string
}>()
</script>

<template>
  <component
    :is="tag"
    class="overflow-hidden rounded-2xl transition-all"
    :class="{
      // Variant
      'bg-card shadow-lg': variant === 'elevated',
      'bg-card-muted/20': variant === 'flat',
      // Padding
      'p-0': padding === 'none',
      'p-2': padding === 'sm',
      'p-4': padding === 'md',
      'p-6': padding === 'lg',
    }"
  >
    <slot />
  </component>
</template>
