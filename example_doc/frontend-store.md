# Frontend Store Design (Two Layers)

## Goal

- Follow data-driven pattern from `react-comp-misc`: render components stay loyal to input data and emit change requests upward.
- Keep store split into two layers:
  - upper layer: UI-facing state and actions
  - lower layer: collaboration, lock arbitration, remote sync, unsent-change buffer

## Layer Responsibility

### Upper Layer: `DocStore`

- No direct websocket logic.
- No HTTP request logic except bootstrap call delegated to lower layer.
- Owns view/runtime state only.
- For each user action, calls lower-layer API, then reflects accepted updates.

Main variables:

- `currentGroupId: string`
- `currentDocId: string`
- `docItems: Array<{ id: string; name: string; groupId: string }>`
- `metadata: { compIds: string[] }`
- `compDataById: Record<string, any>`
- `selectedCompId: string`
- `editingCompId: string`
- `isDocInitializing: boolean`
- `isDocSwitching: boolean`
- `isPersisting: boolean`
- `persistFailureMessage: string`
- `storeVersion: number` (simple rerender signal for derived selectors)

Main APIs:

- `initDocShell(): Promise<void>`
- `switchDoc(docId: string): Promise<void>`
- `requestCreateTextBasic(anchorIndex?: number): Promise<{ ok: boolean; compId?: string }>`
- `requestDeleteComp(compId: string): Promise<{ ok: boolean; message?: string }>`
- `requestEditText(compId: string, nextText: string, caret: any): Promise<{ ok: boolean; message?: string }>`
- `requestAcquireLock(compId: string): Promise<{ ok: boolean; message?: string }>`
- `requestReleaseLock(compId: string): Promise<{ ok: boolean; message?: string }>`
- `applyRemotePatch(patch: any): void` (called only by lower layer callbacks)
- `setSelectedComp(compId: string): void`
- `setEditingComp(compId: string): void`

### Lower Layer: `DocPersistStore`

- Owns durable snapshot cache.
- Owns unsent-change buffer for the current editor.
- Owns websocket connection and remote event handling.
- Decides lock status for every component based on websocket events plus server ack.
- Publishes accepted updates to upper layer for all clients, including viewers.

Main variables:

- `snapshotByDocId: Record<string, any>`
- `dirtyPatchQueueByDocId: Record<string, any[]>`
- `pendingRequestMap: Record<string, { createdAt: number; kind: string }>`
- `lockStateByCompId: Record<string, { isLocked: boolean; ownerClientId: string; ownerUserId: string; expiresAt?: number }>`
- `wsSessionState: { isConnected: boolean; clientId: string; serverTimeOffsetMs: number }`
- `lastAppliedServerSeqByDocId: Record<string, number>`
- `lastSentClientSeqByDocId: Record<string, number>`
- `isReconnecting: boolean`
- `lastSyncError: string`

Main APIs:

- `listDocs(groupId: string): Promise<{ ok: boolean; docs: any[]; message?: string }>`
- `getDocData(docId: string): Promise<{ ok: boolean; data: any; message?: string }>`
- `createDoc(groupId: string, name: string): Promise<{ ok: boolean; doc?: any; message?: string }>`
- `saveDirtyPatch(docId: string, patch: any): Promise<{ ok: boolean; message?: string }>`
- `acquireCompLock(docId: string, compId: string): Promise<{ ok: boolean; message?: string }>`
- `releaseCompLock(docId: string, compId: string): Promise<{ ok: boolean; message?: string }>`
- `connectDocChannel(docId: string, onEvent: (event: any) => void): void`
- `disconnectDocChannel(docId: string): void`
- `flushDirtyQueue(docId: string): Promise<{ ok: boolean; message?: string }>`

## Change Flow

1. `TextBasic` emits `onRequestChange({ compId, nextText, caret })`.
2. `DocStore.requestEditText` checks if local user owns lock for `compId`.
3. If lock is valid, `DocStore` asks `DocPersistStore.saveDirtyPatch`.
4. `DocPersistStore`:
   - appends patch to `dirtyPatchQueueByDocId`
   - sends patch to server through HTTP or websocket command
   - applies optimistic update to local cache
   - emits normalized patch to `DocStore.applyRemotePatch`
5. Server broadcasts accepted patch through websocket.
6. Every client (including non-editor viewers) receives patch and updates local view data.

## Lock Flow

1. User focuses a `TextBasic` and requests lock.
2. `DocPersistStore.acquireCompLock` sends lock request.
3. On success, websocket broadcasts lock state to all clients.
4. `DocPersistStore` updates `lockStateByCompId`, then notifies `DocStore`.
5. Non-owner clients keep receiving text updates but `TextBasic` remains read-only.
6. Lock owner sends periodic heartbeat; timeout or explicit release clears lock.

## Websocket Event Contract

Recommended events:

- `doc.snapshot`
  - full doc snapshot for initial join or fast recovery
- `doc.patch`
  - incremental data update with server sequence
- `doc.lock.changed`
  - lock owner, lock status, expiry
- `doc.presence.changed`
  - optional online user list
- `doc.error`
  - server-side rejection with reason

Required fields for `doc.patch`:

- `docId: string`
- `serverSeq: number`
- `clientId: string`
- `timestamp: number`
- `patch: { op: string; compId: string; text?: string; caret?: any }`

## Viewer-While-Locked Requirement

- Lock only blocks edit requests from non-owner users.
- It does not block data reception.
- Non-owner clients must apply all incoming `doc.patch` events immediately.
- Result: viewers see the active editor typing in near real time.

## TypeScript and Lint Policy

- Use TypeScript for important data contracts:
  - doc identity
  - component identity
  - lock state
  - websocket event shape
- Keep other dynamic areas as `any` when schema is still moving fast.
- Lint should be tolerant during early iteration:
  - keep `no-explicit-any` disabled
  - keep strict null checks relaxed
  - allow incremental typing
- Add strict rules later only after event schema and data fields stabilize.
