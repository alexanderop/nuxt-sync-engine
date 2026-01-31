<!--
  Todo Item Component
  ===================

  Individual todo item with edit, complete, and delete actions.

  > **What Jazz Does Better**
  >
  > With Jazz's useCoState, mutations are automatic:
  > ```typescript
  > const todo = useCoState(Todo, () => props.id);
  > todo.completed = true; // Auto-syncs!
  > ```
  >
  > We use explicit update functions.
-->

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { SyncItem } from '../../shared/types'

interface Props {
  todo: SyncItem & { data: { text: string, completed: boolean } }
}

const { todo } = defineProps<Props>()

const emit = defineEmits<{
  toggle: [id: string]
  update: [id: string, text: string]
  delete: [id: string]
}>()

const isEditing = ref(false)
const editText = ref('')
const editInput = useTemplateRef<HTMLInputElement>('editInput')

function handleToggle() {
  emit('toggle', todo.id)
}

function startEdit() {
  isEditing.value = true
  editText.value = todo.data.text

  // Focus input on next tick
  nextTick(() => {
    editInput.value?.focus()
    editInput.value?.select()
  })
}

function handleEditSubmit() {
  const trimmed = editText.value.trim()
  if (trimmed && trimmed !== todo.data.text) {
    emit('update', todo.id, trimmed)
  }
  isEditing.value = false
}

const handleEditBlur = useDebounceFn(() => {
  if (isEditing.value) {
    handleEditSubmit()
  }
}, 100)

function handleEditCancel() {
  isEditing.value = false
  editText.value = todo.data.text
}

function handleDelete() {
  emit('delete', todo.id)
}
</script>

<template>
  <li
    class="group flex items-center gap-3 border-b border-border px-4 py-4 transition-colors last:border-b-0 hover:bg-fill/50"
    :class="{ 'opacity-60': todo.data.completed, 'bg-card-muted/20': isEditing }"
  >
    <!-- Checkbox -->
    <button
      class="flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-all"
      :class="todo.data.completed
        ? 'border-accent bg-accent'
        : 'border-border bg-transparent hover:border-accent'"
      :aria-label="todo.data.completed ? 'Mark as incomplete' : 'Mark as complete'"
      @click="handleToggle"
    >
      <svg
        v-if="todo.data.completed"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="size-3.5 text-fill"
      >
        <path
          fill-rule="evenodd"
          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
          clip-rule="evenodd"
        />
      </svg>
    </button>

    <!-- Text / Edit input -->
    <div class="min-w-0 flex-1">
      <input
        v-if="isEditing"
        ref="editInput"
        v-model="editText"
        class="w-full rounded-md border-2 border-accent bg-card px-3 py-2 text-text-base outline-none"
        type="text"
        @blur="handleEditBlur"
        @keydown.enter="handleEditSubmit"
        @keydown.escape="handleEditCancel"
      >
      <span
        v-else
        class="cursor-text break-words text-text-base"
        :class="{ 'line-through text-text-base/50': todo.data.completed }"
        @dblclick="startEdit"
      >
        {{ todo.data.text }}
      </span>
    </div>

    <!-- Device indicator -->
    <span
      class="shrink-0 rounded bg-fill px-1.5 py-0.5 font-mono text-[10px] text-text-base/40"
      :title="`Last edited by: ${todo.deviceId}`"
    >
      {{ todo.deviceId.slice(0, 4) }}
    </span>

    <!-- Delete button -->
    <button
      class="flex size-7 shrink-0 items-center justify-center rounded-md text-text-base/40 opacity-0 transition-all group-hover:opacity-100 hover:bg-accent/20 hover:text-accent"
      aria-label="Delete todo"
      @click="handleDelete"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="size-4"
      >
        <path
          d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
        />
      </svg>
    </button>
  </li>
</template>
