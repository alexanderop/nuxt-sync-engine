<script setup lang="ts">
const {
  variant = 'default',
  modelValue = '',
  placeholder = '',
  disabled = false,
  type = 'text',
} = defineProps<{
  variant?: 'default' | 'inline'
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  type?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'blur': [event: FocusEvent]
  'keydown': [event: KeyboardEvent]
}>()

const inputRef = useTemplateRef<HTMLInputElement>('inputRef')

function handleInput(event: Event) {
  if (event.target instanceof HTMLInputElement) {
    emit('update:modelValue', event.target.value)
  }
}

function focus() {
  inputRef.value?.focus()
}

function select() {
  inputRef.value?.select()
}

defineExpose({ focus, select })
</script>

<template>
  <input
    ref="inputRef"
    :type
    :value="modelValue"
    :placeholder
    :disabled
    class="text-text-base outline-none transition-all disabled:cursor-not-allowed disabled:opacity-50"
    :class="{
      'flex-1 rounded-xl border-2 border-border bg-card px-4 py-3 placeholder-text-base/40 focus:border-accent focus:ring-2 focus:ring-accent/20': variant === 'default',
      'w-full rounded-md border-2 border-accent bg-card px-3 py-2': variant === 'inline',
    }"
    @input="handleInput"
    @blur="emit('blur', $event)"
    @keydown="emit('keydown', $event)"
  >
</template>
