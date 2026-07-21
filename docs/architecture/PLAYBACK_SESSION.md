# Playback Session Architecture

Updated: 2026-07-21

## 1. Product Boundary

Ocean Wave should remember a listener's current flow across web tabs and devices without becoming a Spotify Connect clone.

The implemented shared-playback program is intentionally web-only:

- One web player reports the current track, playback state, and position snapshot.
- Other web clients can display that snapshot read-only.
- GraphQL reads and persists the authoritative snapshot.
- Socket.IO announces committed snapshot changes.
- The local queue remains available when server synchronization fails, while an active player pauses fail-closed when its realtime control route disconnects.
- Acknowledged remote commands and atomic `Play Here` handoff operate only between registered web endpoints.

Native mobile realtime participation, multi-room playback, and simultaneous players remain out of scope.

## 2. Current State

The web client currently owns playback through `queueStore`, `WebAudioChannel`, and `localStorage`.
It also keeps branch-aware cumulative playback-history checkpoints in IndexedDB and reload lineage in `sessionStorage`. The server stores monotonic `PlaybackEvent` records and persistent playback-device metadata. The legacy Socket.IO connector list still represents raw connections, while the playback endpoint registry separately represents browser devices and tab leases. Listening, skip, completion, seek, replay, and deduplication rules are defined in [Playback History and Listening Signals](./PLAYBACK_HISTORY.md).

These responsibilities remain separate:

| Concern | Current or planned owner |
| --- | --- |
| Audio element and immediate controls | Active web player |
| Reload-safe local queue and position | Web `queueStore` and `localStorage` |
| Recoverable playback-history delivery | Branch-keyed IndexedDB checkpoints and tab-scoped reload lineage |
| Cross-client playback snapshot | Server `PlaybackSession` |
| Cross-client queue snapshot | Server `PlaybackQueue` |
| Playback device metadata | Server `PlaybackDevice` and `PlaybackEndpoint` records |
| Live endpoint presence | Server endpoint lease registry |
| Raw connection presence | Existing Socket.IO connector registry |
| Realtime change notification | Socket.IO |
| Acknowledged live playback commands | Socket.IO command channel |

`PlaybackSession` is not a replacement for `PlaybackEvent`. A session describes what is happening now; an event records cumulative listening history after playback is committed. The session also retains the current track-fenced canonical history identity, active branch, branch parent and baseline, cumulative time, seek flag, and timestamps reported by the active endpoint. A normal `Play Here` release refreshes that lineage, while an explicit forced handoff creates a child branch from the last authoritative offline-source baseline. Delayed source and target recovery can then contribute to one event without losing either branch or counting the baseline twice. A server-committed command that changes tracks clears the old track's lineage atomically before another forced handoff can read it.

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

The current playback-state API fields named `deviceId` and `activeDeviceId` contain the tab-scoped endpoint id. The registry uses explicit installation `deviceId` and tab `endpointId` fields, while the playback-state API keeps its compatibility field until a dedicated migration. Existing persisted active ids are never reinterpreted as installation ids.

## 5. Active Playback Endpoint

Only a currently registered active playback endpoint may advance the shared snapshot.

A report currently contains `deviceId`, a per-endpoint monotonic `sequence`, `expectedRevision`, `claimActive`, and the current `registrationGeneration` plus unpredictable `registrationProof`. The explicit endpoint contract will rename the input to `endpointId`. The server first verifies the process-local registration proof and then applies these rules transactionally:

1. If no active endpoint exists, a user-initiated playback report may claim the session.
2. A report from the active endpoint is accepted only when its session revision fence still matches and its sequence is newer than the last accepted sequence for that endpoint.
3. A different endpoint is rejected with the current authoritative snapshot unless `claimActive` is true.
4. `claimActive` is sent only after a local user action that starts or takes over playback. Page load, passive restore, and notification handling never claim it.
5. An accepted claim replaces the previous active endpoint and increments the session revision.
6. Disconnecting a socket does not immediately clear the active endpoint because reloads and brief network loss are normal. Presence is advisory; persisted state remains readable.
7. A tab without an acknowledged registration buffers only its latest local media snapshot. Unresolved takeover authority is tracked separately: an explicit user claim remains sticky across later checkpoints and network failures until an authoritative accepted or conflict response. A formerly active endpoint may also buffer pause or stop during a registration gap. Registration loss or endpoint rotation fences any old in-flight response and rebuilds exactly one report from the newest local values with the new endpoint identity, sequence, generation, proof, and claim when required; it never reports as an incumbent copied through `sessionStorage`.
8. After registration or reconnect, the client completes a fresh session read before flushing that one buffered snapshot. The buffered report keeps the revision against which the user action occurred; a newer reconnect read never silently rebases it.
9. The server fences the final update by session id, revision, active endpoint, and endpoint sequence. A concurrent winner returns the latest authoritative snapshot instead of allowing a late write to replace it.
10. The endpoint registry holds the matching generation and proof authority through the report transaction. Disconnect, lease expiry, and endpoint rotation cannot invalidate that registration in the middle of its commit; they serialize after it, while new reports fail closed once invalidation begins.

The original read-only foundation had no remote command that could force another player to pause. The implemented command layer controls only the current active endpoint. Moving playback to the requesting endpoint remains a separate atomic handoff flow.

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
- historyMusicId (nullable; fences lineage to the current track)
- historySessionId, historyBranchId, historyParentBranchId (nullable)
- historyBranchBasePlayedMs, historyPlayedMs
- historyStartedAt, historyUpdatedAt (nullable)
- historyHadSeek
- revision
- createdAt
- updatedAt
```

The queue is related to the session through `PlaybackQueue.sessionId` and is queried separately. The registry exposes `activeEndpointId` by reading the existing tab-scoped `activeDeviceId`; it preserves that value rather than changing its meaning during the identity migration.

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
    activeDeviceSequence
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

The input contains `deviceId`, `registrationGeneration`, `registrationProof`, `sequence`, `expectedRevision`, `claimActive`, `state`, `currentMusicId`, `positionMs`, and the client observation time used only for validation and diagnostics. The proof is a live authorization secret, not persisted domain data. The server writes its own `positionUpdatedAt` and validates that the endpoint registration is current, the revision and endpoint sequence are current, the music exists, and the position is finite and non-negative.

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
- contextType: album | playlist | queue
- contextId (nullable)
- contextTitle (nullable; bounded label snapshot)
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
The context fields remember which album or playlist started the queue. A manual structural edit, such as adding, removing, or reordering a track, changes the context to a general queue. Older clients may omit the context fields; the server treats those snapshots as general queues.

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
6. Do not flush buffered state or queue writes until the new endpoint registration has completed its authoritative reads.

If reporting fails, keep the latest unsent snapshot in memory and retry only the newest state after reconnect. Do not replay an unbounded event log. Existing IndexedDB playback checkpoints continue to handle play-count delivery independently.

For the implemented server queue:

- A successful server queue read becomes the shared starting snapshot.
- `localStorage` remains a fallback when the server is unavailable or has no queue yet.
- A local fallback is not uploaded automatically over a newer server revision.
- Web clients debounce only structural queue changes; playback position updates do not write the queue.
- A server read repairs unavailable items and advances the queue revision once for the repaired snapshot.
- An explicit user playback or queue action may claim the active session and submit a mutation using the last observed revision.
- The server atomically claims the expected queue revision before replacing queue items. Exactly one concurrent writer can advance a revision, and an initial-create race becomes an explicit conflict instead of a raw uniqueness error.
- Every accepted queue save emits `playback:queue-invalidated` with the committed revision and optional origin client id. Other web tabs refetch the authoritative GraphQL snapshot; the origin tab and clients already holding that revision skip the read.
- On conflict, preserve local playback and keep both the latest local queue and the authoritative server queue. The queue page offers explicit **Keep newer queue** and **Replace with this queue** actions; it never silently rebases or multi-way merges.

### Library continuation surface

The Library page owns the compact cross-device continuation surface. It does not add a separate Now page or navigation item.

- A playing or paused session shows its current track, output device, and live online status.
- A deliberately stopped session may show the selected track from a queue updated within the last 30 days. A final track that reaches its exact duration with repeat disabled is treated as natural queue completion and is not offered as interrupted playback. Album and playlist labels come from the bounded queue-origin snapshot; a general or manually edited queue is labeled as a saved queue.
- Remote command buttons always name and affect the remote output. **Play Here** is a separate action that moves the queue and position to the current browser through the existing handoff protocol, and it is shown only when both endpoints and the complete saved queue satisfy handoff preflight.
- An offline endpoint disables remote commands but keeps handoff recovery available, including the explicit force flow when the source cannot release ownership.
- Session notifications, queue invalidations, and endpoint-registry invalidations update the surface in place. When an interrupted session stops, the active view becomes a recovery view; when an endpoint expires, its status becomes offline.
- The surface renders below the sticky Library header, stays compact on small screens, and disappears when there is no active output or usable recovery data.

### Track-started personal listening sessions

The web track action panel can build a playable queue from one owned track
without external charts, recommendation services, audio embeddings, or random
sampling. **Start a session** uses the default standard length and exploratory
range in one action. **Session options** exposes only two choices: short,
standard, or long length (8, 15, or 25 tracks), and focused or exploratory
range.

`createPersonalListeningSession` performs candidate selection and the
revision-guarded full queue replacement inside one database transaction. The
input includes the start track, length preset, range, and last observed queue
revision. It also carries the last observed playback-session revision and the
current registered endpoint authority. The server rejects stale or remote-owned
playback before changing the queue. The start track is always first. Follow-up
candidates can be related by artist, album, genre, tag, or a saved Smart View
that both tracks match. Missing and hated tracks are ineligible. Tracks played
within the previous seven days and tracks already present in the prior queue are
skipped. Candidate reads continue in deterministic pages until the requested
length is available or all related candidates are exhausted. The selector keeps
identifiers unique, avoids consecutive artists when alternatives exist, allows
at most two tracks from one artist or album, and returns a shorter session rather
than filling it with repeated choices.

Every returned item carries stable internal reason codes:

- `START_TRACK`
- `SAME_ALBUM`
- `SAME_ARTIST`
- `SHARED_SMART_VIEW`
- `SHARED_TAG`
- `SHARED_GENRE`

The originating client maps the strongest code to short queue copy while the
returned item order still matches the exact committed queue revision. A later
queue edit, reload, or revision change removes that temporary explanation
instead of showing stale reasons. Reason codes are not persisted in the queue
schema.

If the expected queue revision is stale, the mutation returns the newest
authoritative queue and does not change playback. The action remains open,
shows the newest queue size, and retries against that observed revision. A
conflicted local player cannot publish ordinary queue saves until a retry or
authoritative restore aligns it with the server queue. A
successful result is adopted without an extra queue save, then the local player
loads the committed snapshot and attempts playback. Browser autoplay rejection
leaves the session ready and paused rather than rolling back the server queue.
The action waits for endpoint registration plus the initial playback and queue
reads, and its request has a bounded timeout. Explicit playback changes are
barred during that request; if the current track ends naturally, the transition
is replayed after an error or conflict and discarded only when the accepted
session replaces the queue.

## 10. Failure and Security Rules

- GraphQL and Socket.IO use the existing installation authentication boundary.
- Unknown music ids, invalid states, negative or non-finite positions, stale sequences, and stale revisions are rejected.
- Repeated reports with the same endpoint sequence are idempotent and return the current snapshot.
- Database commit is authoritative even when Socket.IO notification fails.
- Socket reconnect always triggers GraphQL session, queue, and endpoint-registry reads before buffered writes or later realtime assumptions are trusted.
- A stale playback report returns the authoritative session, clears any chained local report, and cannot reclaim the active endpoint.
- A stale queue write returns both the authoritative and latest local snapshots for explicit recovery without interrupting current playback.
- Server restart may lose connector presence but not the persisted session or queue.
- A disappeared active endpoint leaves a stale readable snapshot; it does not block an explicit local claim from another web player.
- Logs should include session revision, endpoint id, and rejection reason, but no audio file paths, authentication secrets, or registration proofs.

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

### Phase D: remote command contract (completed)

- Use the [Remote Playback Command Protocol](./PLAYBACK_COMMAND_PROTOCOL.md) for web-to-web play, pause, next, previous, and seek commands.
- Separate stable device identity, tab-scoped playback endpoints, and ephemeral Socket.IO connections.
- Fence commands with session and queue revisions, command ids, endpoint sequence, separate deadlines, and acknowledgements.
- Keep one active output endpoint and one in-flight command per playback session.

### Phase E1: endpoint registry (completed)

- Add persistent browser-device identity and tab-scoped endpoint registration.
- Track capabilities, heartbeat, TTL, and current endpoint-to-socket routing.
- Expose the complete registry and active endpoint through GraphQL.
- Show registered desktop and mobile web devices with online, offline, active, and rename states.

Acceptance evidence:

- One `localStorage` installation owns multiple `sessionStorage` tab endpoints without duplicate device rows.
- Reconnect advances the registration generation and fences the previous socket.
- A heartbeat miss becomes offline through a finite TTL sweep.
- A duplicated tab cannot replace a responsive endpoint silently and rotates only after the server proves a live collision.
- A duplicated challenger cannot report playback state with the incumbent endpoint id before registration succeeds.
- A missed presence notification is repaired by the GraphQL registry query.
- A missed lease-expiry event is repaired by an acknowledged heartbeat response.

### Phase E2: remote command delivery (completed)

- Implement acknowledged command dispatch, completion, timeout, and idempotency against the Phase D contract.
- Add web controller UI without changing native mobile behavior.

### Phase F: handoff and recovery (completed)

- Add atomic `Play Here` ownership transfer.
- Verify stale state, offline, reconnect, simultaneous claim, and missed-event recovery with independent browser contexts.

Acceptance evidence:

- An active source pauses fail-closed when its socket route disappears, and an offline source can be replaced only through the explicit force-handoff flow.
- Reconnecting the old endpoint submits its buffered pause against the original revision, receives an authoritative conflict, and does not reclaim ownership.
- A stale offline queue write preserves local playback and requires an explicit server-queue or retry choice.
- A Playwright suite uses two independent browser contexts to exercise playback, remote pause/resume, offline queue divergence, force handoff, reconnect conflict recovery, and final session/queue convergence.
- Client store tests and server integration tests cover stale revision and endpoint-sequence rejection in addition to the multi-context browser flow.

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
