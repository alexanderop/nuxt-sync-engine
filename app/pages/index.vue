<!--
  Main Todo Page
  ==============

  The main application page with Jazz-like sync.

  > **What Jazz Does Better**
  >
  > With Jazz, this entire component would be:
  > ```typescript
  > const { me } = useAccount();
  > const todos = useCoState(TodoList, me?.root?.todoList);
  >
  > // Create
  > todos.push(Todo.create({ text: 'New todo', completed: false }));
  >
  > // Update (auto-syncs!)
  > todos[0].completed = true;
  > ```
  >
  > Our version requires more boilerplate but teaches the concepts.
-->

<script setup lang="ts">
import { useCoList } from '~/composables/useIDBCoList'
import { useIDBSyncEngine } from '~/composables/useIDBSyncEngine'
import { useIDBSyncStatus } from '~/composables/useIDBSyncStatus'

// Get device ID and connection status from IDB sync engine
const { deviceId, isOnline, wsStatus } = useIDBSyncEngine()

// Todo list state with full CRUD operations
const { items, isLoading, error, create, update, remove, refresh } = useCoList<{
  id: string
  text: string
  completed: boolean
}>('todos')

// Sync status for UI feedback
const { statusMessage } = useIDBSyncStatus()

// Computed sync state for the SyncStatus component
const syncState = computed(() => ({
  isOnline: isOnline.value,
  isSyncing: statusMessage.value.type === 'syncing',
  isConnected: wsStatus.value === 'OPEN',
  lastSyncAt: 0, // Not tracked in new implementation
  error: statusMessage.value.type === 'error' ? statusMessage.value.message : null,
}))

// New todo input
const newTodoText = ref('')

// Computed
const completedCount = computed(
  () => items.value.filter(t => t.completed).length,
)

// Loading state for compatibility with template
const status = computed(() => isLoading.value ? 'loading' : 'ready')

// Actions
async function handleAddTodo() {
  const text = newTodoText.value.trim()
  if (!text)
    return

  await create({ text, completed: false })
  newTodoText.value = ''
}

async function handleToggle(id: string) {
  const todo = items.value.find(t => t.id === id)
  if (!todo)
    return

  await update(id, { completed: !todo.completed })
}

async function handleUpdate(id: string, text: string) {
  await update(id, { text })
}

async function handleDelete(id: string) {
  await remove(id)
}

async function clearCompleted() {
  const completed = items.value.filter(t => t.completed)

  for (const todo of completed) {
    await remove(todo.id)
  }
}
</script>

<template>
  <div class="min-h-screen bg-fill text-text-base">
    <div class="mx-auto max-w-2xl px-4 py-8">
      <!-- Header -->
      <header class="mb-8 flex items-start justify-between gap-4">
        <div class="flex-1">
          <h1 class="flex items-center gap-3 text-2xl font-bold">
            <span class="flex size-9 items-center justify-center rounded-lg bg-accent text-xl text-fill">
              &#x2713;
            </span>
            Sync Engine Demo
          </h1>
          <p class="mt-2 text-sm text-text-base/60">
            A Jazz-inspired local-first todo app
          </p>
        </div>
        <SyncStatus
          :is-online="syncState.isOnline"
          :is-syncing="syncState.isSyncing"
          :is-connected="syncState.isConnected"
          :last-sync-at="syncState.lastSyncAt"
          :error="syncState.error"
        />
      </header>

      <!-- Add Todo Form -->
      <form class="mb-6 flex gap-3" @submit.prevent="handleAddTodo">
        <BaseInput
          v-model="newTodoText"
          placeholder="What needs to be done?"
          :disabled="status === 'loading'"
        />
        <BaseButton
          type="submit"
          :disabled="!newTodoText.trim() || status === 'loading'"
        >
          Add
        </BaseButton>
      </form>

      <!-- Loading State -->
      <div v-if="status === 'loading'" class="flex items-center justify-center gap-3 py-12 text-text-base/60">
        <div class="size-6 animate-spin rounded-full border-2 border-card-muted border-t-accent" />
        <span>Loading todos...</span>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="py-8 text-center">
        <p class="text-accent">
          Failed to load todos: {{ error.message }}
        </p>
        <BaseButton variant="secondary" class="mt-4" @click="refresh">
          Retry
        </BaseButton>
      </div>

      <!-- Todo List -->
      <BaseCard v-else tag="ul">
        <TodoItem
          v-for="todo in items"
          :key="todo.id"
          :todo="todo"
          @toggle="handleToggle"
          @update="handleUpdate"
          @delete="handleDelete"
        />

        <!-- Empty State -->
        <li v-if="items.length === 0" class="flex flex-col items-center px-4 py-12 text-text-base/40">
          <div class="mb-4 size-16 text-card-muted">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" d="M7.502 6h7.128A3.375 3.375 0 0118 9.375v9.375a3 3 0 003-3V6.108c0-1.505-1.125-2.811-2.664-2.94a48.972 48.972 0 00-.673-.05A3 3 0 0015 1.5h-1.5a3 3 0 00-2.663 1.618c-.225.015-.45.032-.673.05C8.662 3.295 7.554 4.542 7.502 6zM13.5 3A1.5 1.5 0 0012 4.5h4.5A1.5 1.5 0 0015 3h-1.5z" clip-rule="evenodd" />
              <path fill-rule="evenodd" d="M3 9.375C3 8.339 3.84 7.5 4.875 7.5h9.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 013 20.625V9.375zm9.586 4.594a.75.75 0 00-1.172-.938l-2.476 3.096-.908-.907a.75.75 0 00-1.06 1.06l1.5 1.5a.75.75 0 001.116-.062l3-3.75z" clip-rule="evenodd" />
            </svg>
          </div>
          <p>No todos yet!</p>
          <p class="mt-1 text-sm">
            Add one above to get started.
          </p>
        </li>
      </BaseCard>

      <!-- Stats -->
      <div v-if="items.length > 0" class="mt-2 flex items-center justify-between px-4 py-4 text-sm text-text-base/60">
        <span>{{ completedCount }} of {{ items.length }} completed</span>
        <BaseButton
          v-if="completedCount > 0"
          variant="tertiary"
          @click="clearCompleted"
        >
          Clear completed
        </BaseButton>
      </div>

      <!-- Footer -->
      <footer class="mt-8 border-t border-border pt-6 text-center text-sm text-text-base/60">
        <p>
          Open this page in another browser or device to see real-time sync.
        </p>
        <p class="mt-2 text-xs text-text-base/40">
          Device: <code class="rounded bg-card px-1.5 py-0.5 font-mono">{{ deviceId.slice(0, 8) }}...</code>
        </p>
        <BaseCard variant="flat" padding="md" class="mt-6 text-sm">
          <strong class="text-text-base">Want production-ready sync?</strong>
          <a href="https://jazz.tools" target="_blank" rel="noopener" class="ml-1 font-semibold text-accent hover:underline">Try Jazz</a>
          - it handles encryption, permissions, and more!
        </BaseCard>
      </footer>
    </div>
  </div>
</template>
