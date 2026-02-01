# Jazz vs Nuxt Sync Engine: Comparison & Improvement Roadmap

This document compares our simplified sync engine with Jazz, a production-grade local-first framework, and outlines concrete improvements we can implement.

## Executive Summary

| Aspect | Our Implementation | Jazz |
|--------|-------------------|------|
| **Complexity** | ~2k LOC | ~50k+ LOC |
| **CRDT Model** | Entity-level LWW | Operation-based with sessions |
| **Conflict Resolution** | Timestamp + deviceId | Causal ordering + signatures |
| **Browser Storage** | IndexedDB | IndexedDB |
| **Security** | None | End-to-end encryption + signatures |
| **Sync Tracking** | Single timestamp per schema | Per-transaction per-session per-peer |

---

## Detailed Differences

### 1. CRDT Implementation

#### Our Approach (Last-Write-Wins)
```typescript
// utils/co.ts - Simple metadata
CoValueMeta = {
  id: string,           // Random UUID
  createdAt: number,    // Timestamp
  updatedAt: number,    // Timestamp
  deviceId: string,     // Origin device
  deleted: boolean      // Soft delete
}

// Conflict resolution: compare timestamps
function shouldIncomingWin(incoming, existing): boolean {
  if (incoming.updated_at > existing.updated_at) return true
  if (incoming.updated_at === existing.updated_at) {
    return incoming.device_id > existing.device_id  // Tiebreaker
  }
  return false
}
```

#### Jazz Approach (Session-Based Operations)
```typescript
// Each change is a transaction in a session
Transaction = {
  sessionID: SessionID,      // e.g., "alice_session_z123"
  txIndex: number,           // Sequence within session
  madeAt: number,            // Timestamp
  changes: Change[],         // Array of operations
  signature: Signature       // Ed25519 signature
}

// Known state tracks per-session transaction counts
CoValueKnownState = {
  id: RawCoID,
  header: boolean,
  sessions: { [sessionID]: transactionCount }
}
```

**Key Insight:** Jazz preserves the *order of operations* (causality), while we only compare *final timestamps*. This matters when multiple users edit the same field simultaneously.

---

### 2. Sync Protocol

#### Our Approach (Broadcast + HTTP Polling)
```
Client A edits → WebSocket broadcast to ALL clients
                → HTTP push/pull every 30s for reliability
                → LWW conflict resolution on server
```

**Messages:**
- `sync` - Broadcast changes to everyone
- `push` - Send local changes to server
- `pull` - Get changes since timestamp

#### Jazz Approach (Targeted + Known State)
```
Client A edits → Send only to peers that need it
              → Track what each peer knows
              → Send minimal delta
```

**Messages:**
1. `load` - "I want this CoValue"
2. `known` - "I have transactions up to index X for each session"
3. `content` - "Here are transactions you're missing"
4. `done` - "Sync complete"

**Key Insight:** Jazz sends *only what each peer is missing* by tracking known state per-peer, per-CoValue, per-session.

---

### 3. Storage Architecture

#### Our Approach (IndexedDB)
- Native browser API (no WASM overhead)
- Multiple object stores for structured data
- Good browser compatibility

#### Jazz Approach (IndexedDB)
- Native browser API (no WASM overhead)
- 6 object stores for granular data
- Better browser compatibility

**Note:** Both approaches now use IndexedDB. We previously used sql.js WASM but migrated to IndexedDB for simpler setup and better performance.

---

### 4. Security

#### Our Approach
- No encryption
- No signatures
- Trusts all participants

#### Jazz Approach
- Ed25519 signatures on every transaction
- XSalsa20 symmetric encryption
- X25519 key exchange
- Group-based access control with roles

---

## Improvement Roadmap

### Phase 1: Quick Wins (Low Effort, High Impact)

#### 1.1 Add Message Batching
Combine multiple WebSocket messages to reduce overhead.

```typescript
// app/composables/useRealtimeSync.ts

const BATCH_SIZE_BYTES = 25_000  // 25KB threshold
const BATCH_INTERVAL_MS = 50     // Max wait time

class MessageBatcher {
  private buffer: string[] = []
  private bufferSize = 0
  private timer: NodeJS.Timeout | null = null

  send(message: object) {
    const json = JSON.stringify(message)

    // Flush if adding this would exceed threshold
    if (this.bufferSize + json.length > BATCH_SIZE_BYTES) {
      this.flush()
    }

    this.buffer.push(json)
    this.bufferSize += json.length

    // Set timer for auto-flush
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), BATCH_INTERVAL_MS)
    }
  }

  private flush() {
    if (this.buffer.length === 0) return

    // Send as newline-delimited JSON
    this.ws.send(this.buffer.join('\n'))
    this.buffer = []
    this.bufferSize = 0

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
```

#### 1.2 Exponential Backoff for Reconnection
Replace fixed reconnection intervals with exponential backoff.

```typescript
// app/composables/useRealtimeSync.ts

const BASE_RECONNECT_MS = 500
const MAX_RECONNECT_MS = 30_000

function getReconnectDelay(attempt: number): number {
  const delay = BASE_RECONNECT_MS * Math.pow(2, attempt)
  const jitter = Math.random() * 1000  // Add jitter to prevent thundering herd
  return Math.min(delay + jitter, MAX_RECONNECT_MS)
}

// In reconnection logic:
let reconnectAttempts = 0

function scheduleReconnect() {
  const delay = getReconnectDelay(reconnectAttempts++)
  setTimeout(connect, delay)
}

function onConnected() {
  reconnectAttempts = 0  // Reset on successful connection
}
```

#### 1.3 Add Backpressure Handling
Check WebSocket buffer before sending more messages.

```typescript
// app/composables/useRealtimeSync.ts

const BUFFER_LIMIT = 100_000  // 100KB

async function sendWithBackpressure(ws: WebSocket, data: string) {
  // Wait if buffer is too full
  while (ws.bufferedAmount > BUFFER_LIMIT) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  ws.send(data)
}
```

---

### Phase 2: Better Sync Tracking (Medium Effort)

#### 2.1 Per-Entity Known State
Track sync state per entity instead of a single timestamp.

```typescript
// New type for known state
interface EntityKnownState {
  id: string
  version: number      // Increment on each change
  syncedToPeers: Set<string>  // Which peers have this version
}

// Track in sync_meta table
CREATE TABLE entity_sync_state (
  entity_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  known_version INTEGER NOT NULL,
  PRIMARY KEY (entity_id, peer_id)
);
```

#### 2.2 Implement "Have" Message
Before sending data, ask what the peer already has.

```typescript
// New message types
interface HaveMessage {
  type: 'have'
  schema: string
  entities: { [id: string]: number }  // id → version map
}

interface NeedMessage {
  type: 'need'
  schema: string
  ids: string[]  // IDs the peer needs
}

// Sync flow becomes:
// 1. Client sends 'have' with their known versions
// 2. Server responds with 'need' list
// 3. Client sends only needed entities
```

---

### Phase 3: Session-Based Ordering (Higher Effort)

#### 3.1 Add Session Concept
Each device gets a session ID, and changes are ordered within sessions.

```typescript
// Generate session ID on app start
const sessionId = `${deviceId}_session_${crypto.randomUUID().slice(0, 8)}`

// Track transaction index per session
let txIndex = 0

interface Transaction {
  sessionId: string
  txIndex: number
  madeAt: number
  changes: Change[]
}

// Modify todos table
ALTER TABLE todos ADD COLUMN session_id TEXT;
ALTER TABLE todos ADD COLUMN tx_index INTEGER;
```

#### 3.2 Session-Aware Conflict Resolution
When comparing changes, consider session ordering.

```typescript
function compareChanges(a: Transaction, b: Transaction): number {
  // First compare by timestamp
  if (a.madeAt !== b.madeAt) {
    return a.madeAt - b.madeAt
  }

  // Same session: use transaction index
  if (a.sessionId === b.sessionId) {
    return a.txIndex - b.txIndex
  }

  // Different sessions, same time: use session ID as tiebreaker
  return a.sessionId.localeCompare(b.sessionId)
}
```

---

### Phase 4: Security (Production Requirement)

#### 4.1 Add Message Signing
Sign each sync message to prevent tampering.

```typescript
// Use Web Crypto API
async function signMessage(message: object, privateKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(message))
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    data
  )
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

// Add signature to sync messages
interface SignedSyncMessage extends WebSocketSyncMessage {
  signature: string
  publicKey: string  // For verification
}
```

#### 4.2 Add Encryption (Optional)
For sensitive data, encrypt before syncing.

```typescript
// Encrypt data field before sync
async function encryptData(data: object, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(data))

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )

  // Combine IV + encrypted data
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)))
}
```

---

## Implementation Priority

| Improvement | Effort | Impact | Priority |
|-------------|--------|--------|----------|
| Message batching | Low | Medium | **P1** |
| Exponential backoff | Low | Medium | **P1** |
| Backpressure handling | Low | High | **P1** |
| Per-entity known state | Medium | High | **P2** |
| "Have/Need" protocol | Medium | High | **P2** |
| Session-based ordering | High | High | **P3** |
| Message signing | Medium | High | **P3** |
| Encryption | High | Medium | **P4** |

---

## When to Use Which

### Our Current Solution is Good For:
- Personal todo apps
- Single-user applications
- Trusted multi-user scenarios
- Learning sync patterns
- Rapid prototyping

### Consider Jazz (or Jazz-like improvements) When:
- Multiple users editing same data simultaneously
- Need audit trail of who changed what
- Security/privacy is critical
- Building production collaborative apps
- Need field-level conflict resolution

---

## Unique Advantages of Our Approach

1. **IndexedDB**: Native browser API with no WASM overhead
2. **Simplicity**: Easier to understand and modify (~2k LOC vs ~50k+ LOC)
3. **Nuxt integration**: Native Vue 3 reactivity with VueUse composables
4. **Lightweight**: Minimal dependencies, no complex build setup
5. **Educational**: Clear sync patterns for learning local-first architecture

---

## References

- Jazz GitHub: https://github.com/garden-co/jazz
- Jazz Documentation: https://jazz.tools
- CRDT Research: https://crdt.tech
- Our sync architecture: `docs/sync-engine-architecture.md`
- Our CRDT implementation: `utils/co.ts`
