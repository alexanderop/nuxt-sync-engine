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

function handleEditBlur() {
  // Small delay to allow for submit
  setTimeout(() => {
    if (isEditing.value) {
      handleEditSubmit()
    }
  }, 100)
}

function handleEditCancel() {
  isEditing.value = false
  editText.value = todo.data.text
}

function handleDelete() {
  emit('delete', todo.id)
}
</script>

<template>
  <li class="todo-item" :class="{ completed: todo.data.completed, editing: isEditing }">
    <!-- Checkbox -->
    <button
      class="checkbox"
      :class="{ checked: todo.data.completed }"
      :aria-label="todo.data.completed ? 'Mark as incomplete' : 'Mark as complete'"
      @click="handleToggle"
    >
      <svg
        v-if="todo.data.completed"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="check-icon"
      >
        <path
          fill-rule="evenodd"
          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
          clip-rule="evenodd"
        />
      </svg>
    </button>

    <!-- Text / Edit input -->
    <div class="content">
      <input
        v-if="isEditing"
        ref="editInput"
        v-model="editText"
        class="edit-input"
        type="text"
        @blur="handleEditBlur"
        @keydown.enter="handleEditSubmit"
        @keydown.escape="handleEditCancel"
      >
      <span v-else class="text" @dblclick="startEdit">
        {{ todo.data.text }}
      </span>
    </div>

    <!-- Device indicator -->
    <span class="device-id" :title="`Last edited by: ${todo.deviceId}`">
      {{ todo.deviceId.slice(0, 4) }}
    </span>

    <!-- Delete button -->
    <button
      class="delete-btn"
      aria-label="Delete todo"
      @click="handleDelete"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="delete-icon"
      >
        <path
          d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
        />
      </svg>
    </button>
  </li>
</template>

<style scoped>
.todo-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
  transition: background-color 0.15s ease;
}

.todo-item:hover {
  background: #f9fafb;
}

.todo-item:last-child {
  border-bottom: none;
}

.todo-item.completed {
  opacity: 0.6;
}

.todo-item.editing {
  background: #eff6ff;
}

/* Checkbox */
.checkbox {
  width: 24px;
  height: 24px;
  border: 2px solid #d1d5db;
  border-radius: 50%;
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.checkbox:hover {
  border-color: #3b82f6;
}

.checkbox.checked {
  background: #3b82f6;
  border-color: #3b82f6;
}

.check-icon {
  width: 14px;
  height: 14px;
  color: white;
}

/* Content */
.content {
  flex: 1;
  min-width: 0;
}

.text {
  font-size: 1rem;
  color: #1f2937;
  cursor: text;
  word-break: break-word;
}

.completed .text {
  text-decoration: line-through;
  color: #9ca3af;
}

.edit-input {
  width: 100%;
  padding: 0.5rem;
  font-size: 1rem;
  border: 2px solid #3b82f6;
  border-radius: 0.375rem;
  outline: none;
  background: white;
}

/* Device indicator */
.device-id {
  font-size: 0.625rem;
  color: #9ca3af;
  font-family: monospace;
  background: #f3f4f6;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  flex-shrink: 0;
}

/* Delete button */
.delete-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 0.375rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
  opacity: 0;
}

.todo-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #fef2f2;
  color: #ef4444;
}

.delete-icon {
  width: 16px;
  height: 16px;
}
</style>
