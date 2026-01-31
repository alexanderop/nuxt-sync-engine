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
    console.log(`[app] Received ${changes.length} remote changes`)
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
  <div class="container">
    <!-- Header -->
    <header class="header">
      <div class="header-content">
        <h1 class="title">
          <span class="title-icon">&#x2713;</span>
          Sync Engine Demo
        </h1>
        <p class="subtitle">
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
    <form class="add-form" @submit.prevent="handleAddTodo">
      <input
        v-model="newTodoText"
        type="text"
        class="add-input"
        placeholder="What needs to be done?"
        :disabled="status === 'loading'"
      >
      <button
        type="submit"
        class="add-button"
        :disabled="!newTodoText.trim() || status === 'loading'"
      >
        Add
      </button>
    </form>

    <!-- Loading State -->
    <div v-if="status === 'loading'" class="loading">
      <div class="loading-spinner" />
      <span>Loading todos...</span>
    </div>

    <!-- Error State -->
    <div v-else-if="status === 'error'" class="error">
      <p>Failed to load todos: {{ error }}</p>
      <button class="retry-button" @click="refresh">
        Retry
      </button>
    </div>

    <!-- Todo List -->
    <ul v-else class="todo-list">
      <TodoItem
        v-for="todo in items"
        :key="todo.id"
        :todo="todo"
        @toggle="handleToggle"
        @update="handleUpdate"
        @delete="handleDelete"
      />

      <!-- Empty State -->
      <li v-if="items.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path fill-rule="evenodd" d="M7.502 6h7.128A3.375 3.375 0 0118 9.375v9.375a3 3 0 003-3V6.108c0-1.505-1.125-2.811-2.664-2.94a48.972 48.972 0 00-.673-.05A3 3 0 0015 1.5h-1.5a3 3 0 00-2.663 1.618c-.225.015-.45.032-.673.05C8.662 3.295 7.554 4.542 7.502 6zM13.5 3A1.5 1.5 0 0012 4.5h4.5A1.5 1.5 0 0015 3h-1.5z" clip-rule="evenodd" />
            <path fill-rule="evenodd" d="M3 9.375C3 8.339 3.84 7.5 4.875 7.5h9.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 013 20.625V9.375zm9.586 4.594a.75.75 0 00-1.172-.938l-2.476 3.096-.908-.907a.75.75 0 00-1.06 1.06l1.5 1.5a.75.75 0 001.116-.062l3-3.75z" clip-rule="evenodd" />
          </svg>
        </div>
        <p>No todos yet!</p>
        <p class="empty-hint">
          Add one above to get started.
        </p>
      </li>
    </ul>

    <!-- Stats -->
    <div v-if="items.length > 0" class="stats">
      <span>{{ completedCount }} of {{ items.length }} completed</span>
      <button v-if="completedCount > 0" class="clear-button" @click="clearCompleted">
        Clear completed
      </button>
    </div>

    <!-- Footer -->
    <footer class="footer">
      <p>
        Open this page in another browser or device to see real-time sync.
      </p>
      <p class="device-info">
        Device: <code>{{ deviceId.slice(0, 8) }}...</code>
      </p>
      <div class="jazz-callout">
        <strong>Want production-ready sync?</strong>
        <a href="https://jazz.tools" target="_blank" rel="noopener">Try Jazz</a>
        - it handles encryption, permissions, and more!
      </div>
    </footer>
  </div>
</template>

<style scoped>
.container {
  max-width: 640px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
  gap: 1rem;
}

.header-content {
  flex: 1;
}

.title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  color: #1f2937;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  color: white;
  border-radius: 0.5rem;
  font-size: 1.25rem;
}

.subtitle {
  margin: 0.5rem 0 0;
  color: #6b7280;
  font-size: 0.875rem;
}

/* Add Form */
.add-form {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.add-input {
  flex: 1;
  padding: 0.875rem 1rem;
  font-size: 1rem;
  border: 2px solid #e5e7eb;
  border-radius: 0.75rem;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.add-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.add-input:disabled {
  background: #f3f4f6;
  cursor: not-allowed;
}

.add-button {
  padding: 0.875rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: white;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  border: none;
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.add-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* Loading */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3rem;
  color: #6b7280;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Error */
.error {
  text-align: center;
  padding: 2rem;
  color: #dc2626;
}

.retry-button {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 0.5rem;
  cursor: pointer;
}

.retry-button:hover {
  background: #fee2e2;
}

/* Todo List */
.todo-list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: white;
  border-radius: 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 3rem 1rem;
  color: #9ca3af;
}

.empty-icon {
  width: 64px;
  height: 64px;
  margin-bottom: 1rem;
  color: #d1d5db;
}

.empty-icon svg {
  width: 100%;
  height: 100%;
}

.empty-hint {
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

/* Stats */
.stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: #6b7280;
}

.clear-button {
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  color: #6b7280;
  background: transparent;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.clear-button:hover {
  background: #f3f4f6;
  color: #374151;
}

/* Footer */
.footer {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e5e7eb;
  text-align: center;
  font-size: 0.875rem;
  color: #6b7280;
}

.footer p {
  margin: 0.5rem 0;
}

.device-info {
  font-size: 0.75rem;
  color: #9ca3af;
}

.device-info code {
  background: #f3f4f6;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-family: monospace;
}

.jazz-callout {
  margin-top: 1.5rem;
  padding: 1rem;
  background: linear-gradient(135deg, #eff6ff, #f5f3ff);
  border-radius: 0.75rem;
  font-size: 0.875rem;
}

.jazz-callout a {
  color: #3b82f6;
  font-weight: 600;
  text-decoration: none;
}

.jazz-callout a:hover {
  text-decoration: underline;
}
</style>
