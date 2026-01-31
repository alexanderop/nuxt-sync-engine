# System Knowledge Map

## Architecture Overview

```mermaid
flowchart TB
    subgraph Browser
        Vue[Vue App<br/>pages/]
        Composables
        SqlJs[sql.js<br/>WASM]
        Vue --> Composables --> SqlJs
    end

    subgraph Server
        Nitro[Nitro<br/>routes/]
        SyncAPI[Sync API<br/>server/]
        BetterSqlite[better-sqlite3]
        Nitro --> SyncAPI --> BetterSqlite
    end

    Composables <-->|WebSocket| SyncAPI
```

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Vue as Vue Component
    participant Composable
    participant LocalDB as sql.js (local)
    participant WS as WebSocket
    participant ServerDB as better-sqlite3

    User->>Vue: Action (add/edit/delete)
    Vue->>Composable: Update state
    Composable->>LocalDB: Write with CRDT metadata
    Composable->>WS: Send changes
    WS->>ServerDB: Merge using CRDT rules
    ServerDB->>WS: Broadcast to other clients
    WS->>Composable: Receive remote changes
    Composable->>LocalDB: Merge incoming changes
    Composable->>Vue: Reactive update
```

## Sync Protocol Flow

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> Connecting: connect()
    Connecting --> Connected: WebSocket open
    Connected --> Syncing: changes detected
    Syncing --> Connected: sync complete
    Connected --> Disconnected: connection lost
    Disconnected --> Connecting: auto-reconnect
```

## Key Files

| File | Purpose |
|------|---------|
| `utils/co.ts` | CRDT operations - conflict resolution logic |
| `utils/sync-protocol.ts` | WebSocket sync protocol |
| `utils/schema.ts` | Shared database schema |
| `server/routes/` | WebSocket handlers |
| `server/database/` | Server-side SQLite setup |
