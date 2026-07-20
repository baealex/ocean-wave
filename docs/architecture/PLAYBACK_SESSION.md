# Playback Session Architecture

Updated: 2026-07-20

## 1. Product Boundary

Ocean Wave should remember a listener's current flow across web tabs and devices without becoming a Spotify Connect clone.

The implemented foundation is intentionally web-only:

- One web player reports the current track, playback state, and position snapshot.
- Other web clients can display that snapshot read-only.
- GraphQL reads and persists the authoritative snapshot.
- Socket.IO announces committed snapshot changes.
- Local playback continues when the server or realtime channel is unavailable.

The next web phase adds acknowledged remote control for one active playback endpoint. Native mobile realtime participation, multi-room playback, and simultaneous players remain out of scope.

## 2. Current State

The web client currently owns playback through `queueStore`, `WebAudioChannel`, and `localStorage`.
It also keeps recoverable play-count checkpoints in IndexedDB. The server stores completed `PlaybackEvent` records, while the Socket.IO connector list represents live connections rather than playback devices.

These responsibilities remain separate:

| Concern | Current or planned owner |
| --- | --- |
| Audio element and immediate controls | Active web player |
| Reload-safe local queue and position | Web `queueStore` and `localStorage` |
| Recoverable play-count delivery | Existing IndexedDB playback checkpoints |
| Cross-client playback snapshot | Server `PlaybackSession` |
| Cross-client queue snapshot | Server `PlaybackQueue` |
| Connection presence | Existing Socket.IO connector registry |
| Realtime change notification | Socket.IO |
| Acknowledged live playback commands | Socket.IO command channel |

`PlaybackSession` is not a replacement for `PlaybackEvent`. A session describes what is happening now; an event records listening history after playback is committed.

## 3. Source of Truth and Transport

The server-side snapshot is the cross-client source of truth. Socket.IO is never the only copy of persisted playback state.

```text
Active web player
  -> GraphQL reportPlaybackState mutation
  -> validate and persist snapshot
  -> return committed snapshot
  -> best-effort playback:state-updated notification

Viewing web client
  -> GraphQL playbackSession query on entry or reconnect
  -> apply newer playback:state-updated notifications
```

The mutation succeeds or fails based on validation and persistence. A notification failure does not roll back a committed snapshot. A client that misses a notification recovers by querying the snapshot again.

Remote playback commands are an intentional exception because their target is a live player. Persisted snapshots remain authoritative, while the command lifecycle follows [Remote Playback Command Protocol](./PLAYBACK_COMMAND_PROTOCOL.md).

## 4. Playback Endpoint Identity

A playback endpoint is the exact web tab that owns an audio element, not a Socket.IO connection. Device, endpoint, and connection identity are separate:

- `deviceId` identifies a browser installation. It is stored in `localStorage`, survives browser restarts, and owns the friendly name and device metadata.
- `endpointId` identifies one tab and its audio element. It is stored in `sessionStorage`, survives reloads in that tab, and is the command target.
- `socketId` identifies one ephemeral Socket.IO connection. It is never persisted as a device or endpoint identity.
- `name`, `type`, and stable capabilities belong to the device; live capabilities and presence belong to the endpoint registration.
- A viewer does not become active merely by opening the app or restoring a paused local queue.

Each document lifetime also creates an in-memory `endpointInstanceId` used only to fence registrations. If another document inherits the same `endpointId`, the registry keeps the existing live binding and gives a normal reload one full lease-expiry grace to reclaim that id. Only a challenger that remains concurrent with a responsive incumbent rotates its endpoint id, so a duplicated tab cannot silently replace the command target. Reconnects advance a server-owned registration generation and fence the previous socket.

The current API fields named `deviceId` and `activeDeviceId` contain the tab-scoped endpoint id. The device-registry phase must introduce the explicit `endpointId` terminology without reinterpreting existing persisted values as installation ids.

## 5. Active Playback Endpoint

Only the active playback endpoint may advance the shared snapshot.

A report currently contains `deviceId`, a per-endpoint monotonic `sequence`, and `claimActive`. The explicit endpoint contract will rename the input to `endpointId`. The server applies these rules transactionally:

1. If no active endpoint exists, a user-initiated playback report may claim the session.
2. A report from the active endpoint is accepted when its sequence is newer than the last accepted sequence for that endpoint.
3. A different endpoint is rejected with the current authoritative snapshot unless `claimActive` is true.
4. `claimActive` is sent only after a local user action that starts or takes over playback. Page load, passive restore, and notification handling never claim it.
5. An accepted claim replaces the previous active endpoint and increments the session revision.
6. Disconnecting a socket does not immediately clear the active endpoint because reloads and brief network loss are normal. Presence is advisory; persisted state remains readable.

The read-only foundation has no remote command that can force another player to pause. The command phase may control only the current active endpoint. Moving playback to the requesting endpoint is a separate atomic handoff flow.

## 6. Playback Snapshot

The implemented persisted session model is:

```text
PlaybackSession
- id
- scopeKey (unique; `local` for the current single-listener installation)
- state: playing | paused | stopped
- activeDeviceId (nullable; current field name containing an endpoint id)
- activeDeviceSequence (current field name containing an endpoint sequence)
- currentMusicId (nullable)
- positionMs
- positionUpdatedAt
- startedAt (nullable)
- revision
- createdAt
- updatedAt
```

The queue is related to the session through `PlaybackQueue.sessionId` and is queried separately. The device-registry implementation may rename the active endpoint fields, but it must preserve their existing tab-scoped values during migration.

Every accepted report increments `revision`. Queries and notifications return the complete public snapshot, including the committed revision. Clients ignore a notification whose revision is not newer than the snapshot they already hold.

### Position calculation

Clients must not write once per second. Reports are sent on meaningful boundaries:

- play, pause, stop, seek, or track change;
- active-device claim;
- page hide or unload when delivery is possible;
- a coarse checkpoint while continuously playing, no more often than the existing 10-second checkpoint cadence.

For a `playing` snapshot, a viewer estimates the current position as:

```text
positionMs + max(serverNow - positionUpdatedAt, 0)
```

The result is clamped to the current track duration. Paused and stopped snapshots use `positionMs` directly. The GraphQL response includes `serverTime` so clients do not assume their wall clocks match the server.

## 7. Implemented Playback-State API Contract

The playback-state implementation exposes domain-owned GraphQL operations rather than adding another generic API barrel import.

```graphql
query PlaybackSession {
  playbackSession {
    id
    state
    activeDeviceId
    currentMusicId
    positionMs
    positionUpdatedAt
    revision
    serverTime
  }
}

mutation ReportPlaybackState($input: ReportPlaybackStateInput!) {
  reportPlaybackState(input: $input) {
    type
    session { ...PlaybackSessionFields }
    conflict { reason session { ...PlaybackSessionFields } }
  }
}
```

The input contains `deviceId`, `sequence`, `claimActive`, `state`, `currentMusicId`, `positionMs`, and the client observation time used only for validation and diagnostics. The server writes its own `positionUpdatedAt` and validates that the music exists and the position is finite and non-negative.

After commit, the server emits:

```text
playback:state-updated
```

The notification payload is the committed public snapshot. It may include `originClientId`; handlers must remain idempotent if that field is absent.

## 8. Implemented Queue Model and Revision Strategy

The normalized persisted queue state is:

```text
PlaybackQueue
- id
- sessionId (unique)
- currentIndex (nullable)
- revision
- shuffle
- repeatMode: none | one | all
- createdAt
- updatedAt

PlaybackQueueItem
- id
- queueId
- musicId
- order
- sourceOrder (nullable; preserves the pre-shuffle order)
```

The server owns the shared queue snapshot. The web client still owns immediate audio execution and keeps a local fallback copy.
`sourceOrder` is populated only while shuffle is enabled so disabling shuffle can restore the user's original sequence after a server round trip.

Queue writes replace the full ordered item list in one transaction. Every mutation includes `expectedRevision`:

- If it matches, the server applies the change and increments `revision` once.
- If it does not match, the server returns a conflict containing the authoritative snapshot.
- The server never silently overwrites a newer revision.

Delta commands and realtime queue patching can be added after snapshot behavior is stable. A full GraphQL snapshot remains the recovery path after missed notifications or ambiguous deltas.

When a queue is attached, `currentIndex` and `currentMusicId` must describe the same item. Removing the current item selects the next valid item or clears both fields when the queue becomes empty. Missing library tracks are pruned during server reads or writes using an explicit repair path rather than left as unplayable items.

## 9. Local Fallback and Reconciliation

Local playback is the availability boundary. Server synchronization must not make the play, pause, seek, next, or previous controls depend on network success.

On startup or reconnect:

1. Restore the safe local queue without auto-playing.
2. Query the server playback snapshot.
3. If this tab is not actively playing, show the server snapshot as shared read-only state without replacing its local queue in the playback-state phase.
4. If this tab is already playing because of a user action, report with `claimActive` and let the server decide ownership.
5. Apply only snapshots with a newer revision.

If reporting fails, keep the latest unsent snapshot in memory and retry only the newest state after reconnect. Do not replay an unbounded event log. Existing IndexedDB playback checkpoints continue to handle play-count delivery independently.

For the implemented server queue:

- A successful server queue read becomes the shared starting snapshot.
- `localStorage` remains a fallback when the server is unavailable or has no queue yet.
- A local fallback is not uploaded automatically over a newer server revision.
- Web clients debounce only structural queue changes; playback position updates do not write the queue.
- A server read repairs unavailable items and advances the queue revision once for the repaired snapshot.
- An explicit user playback or queue action may claim the active session and submit a mutation using the last observed revision.
- On conflict, preserve local playback, display or log the conflict, and refresh the shared snapshot. Automatic multi-way merge is out of scope.

## 10. Failure and Security Rules

- GraphQL and Socket.IO use the existing installation authentication boundary.
- Unknown music ids, invalid states, negative or non-finite positions, stale sequences, and stale revisions are rejected.
- Repeated reports with the same endpoint sequence are idempotent and return the current snapshot.
- Database commit is authoritative even when Socket.IO notification fails.
- Socket reconnect always triggers a GraphQL snapshot read before deltas are trusted.
- Server restart may lose connector presence but not the persisted session or queue.
- A disappeared active endpoint leaves a stale readable snapshot; it does not block an explicit local claim from another web player.
- Logs should include session revision, endpoint id, and rejection reason, but no audio file paths or authentication secrets.

## 11. Delivery Sequence

### Phase A: architecture decision (completed)

- Record the source-of-truth, identity, position, failure, mobile, and queue revision rules in this document.

### Phase B: web playback state sharing (completed)

- Add the persisted playback session and GraphQL snapshot operations.
- Add `playback:state-updated` after a successful report.
- Report meaningful web player transitions.
- Show another player's current track and state read-only.
- Refetch the snapshot on reconnect.

Acceptance evidence:

- A second web client sees the current track and playing, paused, or stopped state.
- Position advances from `positionMs` and `positionUpdatedAt` without per-second writes.
- Stale per-endpoint sequences cannot replace newer state.
- A missed Socket.IO event is repaired by a GraphQL query.
- Mobile behavior is unchanged.

### Phase C: server queue snapshot (completed)

- Add the queue and ordered item models.
- Add GraphQL queue read and revision-guarded snapshot write operations.
- Separate shared server state from the local playback fallback.
- Keep mobile outside mandatory synchronization.

Acceptance evidence:

- A web queue can be saved and restored from the server.
- A stale expected revision returns the authoritative queue without overwriting it.
- Server failure leaves local web playback usable.
- Missing tracks and invalid current indexes are repaired safely.

### Phase D: remote command contract

- Use the [Remote Playback Command Protocol](./PLAYBACK_COMMAND_PROTOCOL.md) for web-to-web play, pause, next, previous, and seek commands.
- Separate stable device identity, tab-scoped playback endpoints, and ephemeral Socket.IO connections.
- Fence commands with session and queue revisions, command ids, endpoint sequence, separate deadlines, and acknowledgements.
- Keep one active output endpoint and one in-flight command per playback session.

### Phase E: endpoint registry and remote command delivery

- Add persistent browser-device identity and tab-scoped endpoint registration.
- Track capabilities, heartbeat, TTL, and current endpoint-to-socket routing.
- Implement acknowledged command dispatch, completion, timeout, and idempotency against the Phase D contract.
- Add web controller UI without changing native mobile behavior.

### Phase F: handoff and recovery

- Add atomic `Play Here` ownership transfer.
- Verify stale state, offline, reconnect, simultaneous claim, and missed-event recovery with independent browser contexts.

### Deferred phases

- Realtime queue deltas after full snapshot behavior is proven.
- Foreground-only mobile state sharing, evaluated separately.
- Mobile background remote control, multi-room playback, and simultaneous playback.

## 12. Decision Summary

- Keep Socket.IO because playback state, acknowledged commands, and live endpoint presence benefit from a persistent channel.
- Keep persisted state and recovery in GraphQL and the database.
- Treat a web tab, not a browser installation or socket connection, as the playback endpoint.
- Make the current active endpoint the only normal snapshot writer and remote command target.
- Store position snapshots at meaningful boundaries and derive elapsed position for viewers.
- Move the web queue to the server through revision-guarded snapshots before designing deltas.
- Preserve local playback and local queue fallback when synchronization is unavailable.
- Keep mobile focused on offline and background listening until the web contract is stable.
