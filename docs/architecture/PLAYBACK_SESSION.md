# Playback Session Architecture

Updated: 2026-07-14

## 1. Product Boundary

Ocean Wave should remember a listener's current flow across web tabs and devices without becoming a Spotify Connect clone.

The first implementation is intentionally web-only:

- One web player reports the current track, playback state, and position snapshot.
- Other web clients can display that snapshot read-only.
- GraphQL reads and persists the authoritative snapshot.
- Socket.IO announces committed snapshot changes.
- Local playback continues when the server or realtime channel is unavailable.

The first implementation does not include remote control, mobile realtime participation, multi-room playback, or simultaneous players.

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

Remote playback commands are a later exception: they may use Socket.IO because their target is a live player. They do not belong in the read-only first phase.

## 4. Playback Endpoint Identity

A playback endpoint is the exact web tab that owns an audio element, not a Socket.IO connection.

- `deviceId` is generated once per tab and stored in `sessionStorage`, so it survives reloads in that tab but does not make two tabs the same player.
- `socketId` is ephemeral connection metadata and must not be persisted as the endpoint identity.
- `name`, `type`, and `capabilities` are descriptive metadata.
- A viewer does not become active merely by opening the app or restoring a paused local queue.

The existing connector registry can expose presence, but connector identity and playback endpoint identity stay distinct. A later device registry may associate the current socket with a `deviceId` while connected.

## 5. Active Playback Device

Only the active playback device may advance the shared snapshot.

A report contains `deviceId`, a per-device monotonic `sequence`, and `claimActive`. The server applies these rules transactionally:

1. If no active device exists, a user-initiated playback report may claim the session.
2. A report from the active device is accepted when its sequence is newer than the last accepted sequence for that device.
3. A different device is rejected with the current authoritative snapshot unless `claimActive` is true.
4. `claimActive` is sent only after a local user action that starts or takes over playback. Page load, passive restore, and notification handling never claim it.
5. An accepted claim replaces the previous active device and increments the session revision.
6. Disconnecting a socket does not immediately clear the active device because reloads and brief network loss are normal. Presence is advisory; persisted state remains readable.

Phase one has no remote command that can force another player to pause. Taking over on a second device only changes which device may publish subsequent shared state.

## 6. Playback Snapshot

The persisted session draft is:

```text
PlaybackSession
- id
- scopeKey (unique; `local` for the current single-listener installation)
- state: playing | paused | stopped
- activeDeviceId (nullable)
- activeDeviceSequence
- currentMusicId (nullable)
- queueId (nullable)
- queueRevision (nullable)
- positionMs
- positionUpdatedAt
- startedAt (nullable)
- revision
- createdAt
- updatedAt
```

The first playback-state PR needs the session fields but does not create the queue relation until the queue phase. Nullable queue fields in the API may therefore resolve to `null` initially.

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

## 7. First-Phase API Contract

The playback-state implementation should expose domain-owned GraphQL operations rather than adding another generic API barrel import.

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

## 8. Queue Model and Revision Strategy

The queue phase introduces normalized persisted state:

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
```

The server owns the shared queue snapshot. The web client still owns immediate audio execution and keeps a local fallback copy.

First-phase queue writes may replace the full ordered item list in one transaction. Every mutation includes `expectedRevision`:

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

During the queue phase:

- A successful server queue read becomes the shared starting snapshot.
- `localStorage` remains a fallback when the server is unavailable or has no queue yet.
- A local fallback is not uploaded automatically over a newer server revision.
- An explicit user playback or queue action may claim the active session and submit a mutation using the last observed revision.
- On conflict, preserve local playback, display or log the conflict, and refresh the shared snapshot. Automatic multi-way merge is out of scope.

## 10. Failure and Security Rules

- GraphQL and Socket.IO use the existing installation authentication boundary.
- Unknown music ids, invalid states, negative or non-finite positions, stale sequences, and stale revisions are rejected.
- Repeated reports with the same device sequence are idempotent and return the current snapshot.
- Database commit is authoritative even when Socket.IO notification fails.
- Socket reconnect always triggers a GraphQL snapshot read before deltas are trusted.
- Server restart may lose connector presence but not the persisted session or queue.
- A disappeared active device leaves a stale readable snapshot; it does not block an explicit claim from another web player.
- Logs should include session revision, device id, and rejection reason, but no audio file paths or authentication secrets.

## 11. Delivery Sequence

### Phase A: architecture decision

- Record the source-of-truth, identity, position, failure, mobile, and queue revision rules in this document.

### Phase B: web playback state sharing

- Add the persisted playback session and GraphQL snapshot operations.
- Add `playback:state-updated` after a successful report.
- Report meaningful web player transitions.
- Show another player's current track and state read-only.
- Refetch the snapshot on reconnect.

Acceptance evidence:

- A second web client sees the current track and playing, paused, or stopped state.
- Position advances from `positionMs` and `positionUpdatedAt` without per-second writes.
- Stale per-device sequences cannot replace newer state.
- A missed Socket.IO event is repaired by a GraphQL query.
- Mobile behavior is unchanged.

### Phase C: server queue snapshot

- Add the queue and ordered item models.
- Add GraphQL queue read and revision-guarded snapshot write operations.
- Separate shared server state from the local playback fallback.
- Keep mobile outside mandatory synchronization.

Acceptance evidence:

- A web queue can be saved and restored from the server.
- A stale expected revision returns the authoritative queue without overwriting it.
- Server failure leaves local web playback usable.
- Missing tracks and invalid current indexes are repaired safely.

### Deferred phases

- Web-to-web play, pause, next, previous, and seek commands with command ids and acknowledgements.
- A richer playback device registry and friendly device management.
- Realtime queue deltas after full snapshot behavior is proven.
- Foreground-only mobile state sharing, evaluated separately.
- Mobile background remote control, multi-room playback, and simultaneous playback.

## 12. Decision Summary

- Keep Socket.IO because playback state, future acknowledged commands, and live device presence benefit from a persistent channel.
- Keep persisted state and recovery in GraphQL and the database.
- Treat a web tab, not a socket connection, as the first playback endpoint.
- Make the current active device the only normal snapshot writer.
- Store position snapshots at meaningful boundaries and derive elapsed position for viewers.
- Move the web queue to the server through revision-guarded snapshots before designing deltas.
- Preserve local playback and local queue fallback when synchronization is unavailable.
- Keep mobile focused on offline and background listening until the web contract is stable.
