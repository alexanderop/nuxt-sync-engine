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
import type { SyncItem } from '../../shared/types'

// Device ID
const deviceId = useDeviceId()

// Todo list state
const { items, status, error, create, update, remove, refresh } = useCoStateList<{
  text: string
  completed: boolean
}>('todos')

// Sync engine
const syncEngine = useSyncEngine({
  tableName: 'todos',
  autoSyncInterval: 30000,
  onRemoteChanges: (changes) => {
    console.info(`[app] Received ${changes.length} remote changes`)
    refresh()
  },
})

const syncState = computed(() => syncEngine.state.value)

// Real-time sync
const { connect, broadcast, isConnected: _isConnected } = useRealtimeSync({
  onChanges: (changes, schema) => {
    if (schema === 'todos') {
      syncEngine.applyWebSocketChanges(changes)
      refresh()
    }
  },
  onConnectionChange: (connected) => {
    syncEngine.setConnected(connected)
  },
})

// New todo input
const newTodoText = ref('')

// Computed
const completedCount = computed(
  () => items.value.filter(t => t.data.completed).length,
)

// Actions
async function handleAddTodo() {
  const text = newTodoText.value.trim()
  if (!text)
    return

  const todo = await create({ text, completed: false })
  newTodoText.value = ''

  // Broadcast to other devices
  broadcast('todos', [todo])

  // Trigger sync
  syncEngine.sync()
}

async function handleToggle(id: string) {
  const todo = items.value.find(t => t.id === id)
  if (!todo)
    return

  await update(id, { completed: !todo.data.completed })

  // Broadcast change
  const updatedTodo = items.value.find(t => t.id === id)
  if (updatedTodo) {
    broadcast('todos', [updatedTodo])
  }

  syncEngine.sync()
}

async function handleUpdate(id: string, text: string) {
  await update(id, { text })

  const updatedTodo = items.value.find(t => t.id === id)
  if (updatedTodo) {
    broadcast('todos', [updatedTodo])
  }

  syncEngine.sync()
}

async function handleDelete(id: string) {
  // Get the item before removing for broadcast
  const todo = items.value.find(t => t.id === id)
  if (!todo)
    return

  await remove(id)

  // Broadcast deletion
  broadcast('todos', [{
    ...todo,
    deleted: true,
    updatedAt: Date.now(),
    deviceId: deviceId.value,
  }])

  syncEngine.sync()
}

async function clearCompleted() {
  const completed = items.value.filter(t => t.data.completed)
  const deletedItems: SyncItem[] = []

  for (const todo of completed) {
    await remove(todo.id)
    deletedItems.push({
      ...todo,
      deleted: true,
      updatedAt: Date.now(),
      deviceId: deviceId.value,
    })
  }

  if (deletedItems.length > 0) {
    broadcast('todos', deletedItems)
    syncEngine.sync()
  }
}

// Initialize
onMounted(async () => {
  // Connect to WebSocket
  connect()

  // Initial sync
  await syncEngine.sync()
})
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
        <input
          v-model="newTodoText"
          type="text"
          class="flex-1 rounded-xl border-2 border-border bg-card px-4 py-3 text-text-base placeholder-text-base/40 outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="What needs to be done?"
          :disabled="status === 'loading'"
        >
        <button
          type="submit"
          class="rounded-xl bg-accent px-6 py-3 font-semibold text-fill transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/30 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          :disabled="!newTodoText.trim() || status === 'loading'"
        >
          Add
        </button>
      </form>

      <!-- Loading State -->
      <div v-if="status === 'loading'" class="flex items-center justify-center gap-3 py-12 text-text-base/60">
        <div class="size-6 animate-spin rounded-full border-2 border-card-muted border-t-accent" />
        <span>Loading todos...</span>
      </div>

      <!-- Error State -->
      <div v-else-if="status === 'error'" class="py-8 text-center">
        <p class="text-accent">Failed to load todos: {{ error }}</p>
        <button
          class="mt-4 rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm text-accent transition-colors hover:bg-accent/20"
          @click="refresh"
        >
          Retry
        </button>
      </div>

      <!-- Todo List -->
      <ul v-else class="overflow-hidden rounded-2xl bg-card shadow-lg">
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
      </ul>

      <!-- Stats -->
      <div v-if="items.length > 0" class="mt-2 flex items-center justify-between px-4 py-4 text-sm text-text-base/60">
        <span>{{ completedCount }} of {{ items.length }} completed</span>
        <button
          v-if="completedCount > 0"
          class="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-card hover:text-text-base"
          @click="clearCompleted"
        >
          Clear completed
        </button>
      </div>

      <!-- Footer -->
      <footer class="mt-8 border-t border-border pt-6 text-center text-sm text-text-base/60">
        <p>
          Open this page in another browser or device to see real-time sync.
        </p>
        <p class="mt-2 text-xs text-text-base/40">
          Device: <code class="rounded bg-card px-1.5 py-0.5 font-mono">{{ deviceId.slice(0, 8) }}...</code>
        </p>
        <div class="mt-6 rounded-xl bg-card-muted/20 p-4 text-sm">
          <strong class="text-text-base">Want production-ready sync?</strong>
          <a href="https://jazz.tools" target="_blank" rel="noopener" class="ml-1 font-semibold text-accent hover:underline">Try Jazz</a>
          - it handles encryption, permissions, and more!
        </div>
      </footer>
    </div>
  </div>
</template>
