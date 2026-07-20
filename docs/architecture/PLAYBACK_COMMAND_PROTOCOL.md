# Remote Playback Command Protocol

Updated: 2026-07-21

Status: architecture contract for the web-only, single-output remote playback phase.

Related foundation: [Playback Session Architecture](./PLAYBACK_SESSION.md)

## 1. Scope

This protocol lets one authenticated web client control the web tab that currently owns Ocean Wave audio. It records the implemented device registry, command transport, controller UI, handoff, and multi-browser recovery contract.

The first command set is:

- `play`
- `pause`
- `seek`
- `next`
- `previous`

The first implementation has one active playback endpoint and at most one in-flight command for the installation-wide playback session. A command controls the existing active endpoint; it never transfers playback ownership.

The following remain outside this protocol:

- native mobile background Socket.IO participation;
- multi-room or simultaneous output;
- Chromecast, AirPlay, or operating-system media routing;
- structural queue writes over Socket.IO;
- automatic playback ownership transfer;
- durable command history or replay after a server restart.

`Play Here` is a separate handoff transaction. It releases the previous endpoint and claims the new endpoint atomically instead of pretending to be a normal remote command.

A successful source release also transfers its cumulative playback-history
identity when one exists. The target continues that same `clientSessionId`,
track id, listened time, and seek flag on a new child branch rooted at the
source's cumulative baseline instead of creating a second logical playback.
Source and target branches contribute monotonic deltas to one event; the
detailed counting and terminal-signal rules live in
[Playback History and Listening Signals](./PLAYBACK_HISTORY.md).

The active endpoint also includes that lineage in periodic authoritative session
reports. If the source later becomes unreachable and the user confirms a forced
handoff, the server sends the last persisted lineage to the target. The offline
source's eventual checkpoint recovery and the target's terminal write therefore
use the same logical identity while retaining both post-baseline deltas rather
than incrementing playback twice. A committed command that selects another track
clears the previous track's persisted lineage in the same session transaction.

## 2. Authority and Roles

The protocol has three roles:

- **Controller endpoint**: the authenticated web tab that issues a user command and displays its progress.
- **Target endpoint**: the registered, online web tab that currently owns the audio element and matches the session's active endpoint.
- **Server coordinator**: the authority that validates revisions, selects the target connection, sequences commands, records short-lived outcomes, and commits the resulting session or queue state.

Authority stays divided by responsibility:

| Concern | Authority |
| --- | --- |
| Immediate audio execution | Target endpoint |
| Persisted playback snapshot | Server `PlaybackSession` |
| Persisted ordered queue | Server `PlaybackQueue` |
| Active endpoint selection | Server playback session |
| Live endpoint presence and capabilities | Server endpoint registry |
| Command lifecycle and deduplication | Server command coordinator |
| Missed-event recovery | GraphQL session and queue queries |

A Socket.IO acknowledgement is not an authoritative playback snapshot. A command is `completed` only after the target executes it and the server commits the resulting state through the command service. Notification delivery remains best effort after that commit.

The command-result handler is an intentional connection-bound control exception to the general GraphQL write rule. It must call the same domain validation and transaction services as other playback writes. It must not become a second generic mutation API.

## 3. Identity Model

The command phase uses three distinct identifiers:

| Identifier | Lifetime | Storage | Purpose |
| --- | --- | --- | --- |
| `deviceId` | Browser installation | `localStorage` | Friendly device identity and persistent metadata |
| `endpointId` | One browser tab | `sessionStorage` | Audio owner, command source, and command target |
| `socketId` | One connection | Socket.IO runtime | Ephemeral routing only |

One device may have several endpoints. One endpoint has at most one current Socket.IO connection. A reconnect rebinds the same endpoint to a new `socketId`; it does not create a new playback endpoint.

Each document lifetime also creates an `endpointInstanceId` UUID in memory. This is a registration-fencing nonce, not another persisted identity. It distinguishes concurrently live documents when a browser duplicates a tab and copies its `sessionStorage`, including `endpointId`.

The existing playback-state API uses `deviceId` for the tab-scoped endpoint id. The registry implementation must migrate to explicit `endpointId` fields or expose a compatibility alias. It must not reinterpret an existing `activeDeviceId` value as a stable browser-installation id.

Every connected web tab registers its endpoint before it can issue or receive playback commands. Registration binds these server-validated values to `socket.data`:

```text
deviceId
endpointId
endpointInstanceId
name
type: desktop-web | mobile-web
capabilities: play | pause | seek | next | previous
lastEndpointSequence
```

The server derives requester identity from the registered socket. It never trusts a requester endpoint id supplied as ordinary command data.

Registration returns a server-owned `registrationGeneration`, `commandEpoch`, and unpredictable `registrationProof`. The generation increments whenever an endpoint is rebound, while the command epoch is a random identifier created once per command-coordinator process. The proof exists only for that live registration, is never persisted or exposed by the registry query, and authorizes compatibility GraphQL playback-state reports from that exact generation.

Endpoint registration is fenced as follows:

- An unbound endpoint, or one whose previous socket is disconnected or lease-expired, may bind and advance `registrationGeneration`.
- A reconnect from the same live `endpointInstanceId` atomically advances the generation, binds the new socket, and fences the old socket before the acknowledgement is returned.
- A different live `endpointInstanceId` attempting to bind the same `endpointId` receives `ENDPOINT_ID_CONFLICT`; the existing binding is not replaced. On the first conflict, the server records the challenger and returns `retry-same-endpoint` rather than rotating immediately.
- The challenger retries the same endpoint after the returned relative delay. The server must observe this conflict for at least one full endpoint lease TTL plus its disconnect grace. If the incumbent disconnects or its lease expires during that window, the challenger binds the original `endpointId` and advances the generation. This is the normal reload-race path.
- Only when the incumbent remains responsive and renews its lease throughout that entire grace may the server return `rotate-endpoint`. That proves two live documents exist; the challenger then generates a new `endpointId` in its own `sessionStorage` and registers again.
- A persisted endpoint that belongs to a different installation id is an identity collision, not a reload race. The server never reparents that row; it returns `rotate-endpoint` immediately so the challenger creates a new tab identity.
- Every dispatch is bound to the exact target socket and registration generation. Rebinding terminalizes or times out commands from the fenced generation; the new registration never resumes or re-executes them.

These rules make a duplicated tab safe without allowing it to steal the active command route silently.

```ts
type PlaybackEndpointRegistrationAck =
    | {
        protocolVersion: 1;
        status: 'registered';
        endpointId: string;
        registrationGeneration: number;
        commandEpoch: string;
        registrationProof: string;
      }
    | {
        protocolVersion: 1;
        status: 'rejected';
        endpointId: string;
        code: 'ENDPOINT_ID_CONFLICT';
        resolution: 'retry-same-endpoint' | 'rotate-endpoint';
        retryAfterMs: number;
      }
    | {
        protocolVersion: 1;
        status: 'rejected';
        endpointId: string | null;
        code: 'INVALID_ENDPOINT_REGISTRATION';
        resolution: 'none';
        retryAfterMs: null;
      }
    | {
        protocolVersion: 1;
        status: 'rejected';
        endpointId: string | null;
        code: 'ENDPOINT_REGISTRATION_FAILED';
        resolution: 'retry-same-endpoint';
        retryAfterMs: number;
      }
    | {
        protocolVersion: 1;
        status: 'rejected';
        endpointId: string | null;
        code: 'PLAYBACK_ENDPOINT_CAPACITY_REACHED';
        resolution: 'none';
        retryAfterMs: null;
      };
```

Collision grace is measured and decided by the server. The registration acknowledgement supplies only a relative retry delay, so page reload recovery does not depend on synchronized clocks. A client never rotates while the server says `retry-same-endpoint`. Invalid payloads are terminal for that registration attempt, transient persistence failures return a bounded relative delay for retrying the same endpoint, and genuine all-live registry capacity returns a terminal response that tells the user to close another playback tab instead of retrying forever.

### Implemented endpoint registry baseline

The web registry persists browser installations and tab endpoints separately:

```text
PlaybackDevice
- id (localStorage installation id)
- name
- type: desktop-web | mobile-web
- lastSeenAt

PlaybackEndpoint
- id (sessionStorage tab id)
- deviceId
- capabilities
- lastSeenAt
```

Online presence, socket routing, `endpointInstanceId`, `registrationGeneration`, and `registrationProof` remain process-local lease state. They are never reconstructed from a stale database row. A reconnect registers again, advances the generation, rotates the proof, and refreshes the persisted observation time. Generations come from one bounded process-local counter rather than an endpoint-keyed history, so identity churn does not create unbounded memory; the exact socket and unpredictable proof remain the authorization fences if that GraphQL-Int counter eventually wraps. A user rename updates the device row, and later registrations preserve that friendly name instead of restoring the browser default.

The registry exposes a route lookup containing the exact Socket.IO socket, device and endpoint ids, registration generation, capabilities, and last endpoint sequence. Command delivery must snapshot that route and fence every later acknowledgement against its socket id and generation; `socket.data` is cleared with the generation when a route is removed and is never sufficient authority by itself.

The initial registry timing is fixed as follows:

```text
heartbeat interval = 15 seconds
endpoint lease TTL = 45 seconds
presence sweep interval = 5 seconds
collision retry delay = 1 second
registration persistence retry delay = 5 seconds
duplicated-tab collision grace = 50 seconds (TTL + 5-second disconnect grace)
```

A normal Socket.IO disconnect removes its route immediately. A missed disconnect is repaired by the TTL sweep, which fences the route and sends `playback:endpoint-lease-expired` to a still-connected document. That event is only a fast path: every heartbeat is also acknowledged, and a missing or expired generation receives `PLAYBACK_ENDPOINT_LEASE_EXPIRED` with `register-again`, so the next delivered heartbeat repairs a lost lease-expiry event. The document registers the same endpoint again to obtain a new generation and proof; a dead document remains offline. A heartbeat received after expiry cannot resurrect the old generation. The last observation is persisted on registration, when the route becomes offline, and at most once per 24 hours for a continuously live route. The coarse write keeps live metadata ahead of retention without writing every 15 seconds.

Registration intake counts every event, including malformed and in-flight duplicates, before validation. It is bounded per socket and globally, runs through an eight-slot concurrency pool, and rejects overlapping contenders for the same endpoint so one stalled persistence call cannot block unrelated endpoints. A socket may have one coalesced registration in flight, at most four retained acknowledgement waiters, and at most 70 attempts per minute; the global pending cap is 128. Admitted endpoint and device identities remain provisional capacity reservations until their persistence operation settles. Those reservations join live routes in every persistence-protection snapshot, and near a device or global capacity boundary only one provisional candidate proceeds at a time. Collision memory expires abandoned records after 100 seconds, removes resolved rotations, and is capped at 16 challengers per endpoint and 256 globally.

Persistence retains at most 128 browser devices and 32 endpoints per device, while recovery queries use the same finite limits. Devices unseen for 90 days and individual endpoints unseen for 30 days are pruned on registration. At either limit, the oldest device or endpoint that is neither protected by a current live route nor responsible for the active session is recycled before the new identity is stored. Capacity is terminal only when every relevant slot is protected as live or by the current active endpoint, and the client surfaces that state without automatic retry.

`playbackDeviceRegistry` is the GraphQL recovery query for devices, endpoints, online state, the active endpoint, registration generations, `commandEpoch`, and server time. `renamePlaybackDevice` is the user-facing metadata mutation and returns only the committed `{ deviceId, name }` patch, so a later recovery read cannot turn a successful rename into a failed mutation. After applying that patch, the origin starts a new recovery read that fences every pre-mutation request; a failed recovery keeps the committed name. The best-effort `playback:endpoints-invalidated` notification prompts other clients to refetch the complete registry snapshot after registration, offline detection, or rename; it is not itself authoritative. An accepted user claim also emits `active-changed`: origin and remote clients patch the active endpoint and device flags immediately, then start one fenced recovery read only when the active endpoint actually differs. Ordinary checkpoints do not invalidate the device registry.

`endpointSequence` is the explicit name for the existing playback report sequence. The endpoint owns this counter, stores it in `sessionStorage`, and increments it once for every state report or completed remote-command transition submitted for authoritative commit. Reload and reconnect preserve it. Heartbeats report `lastEndpointSequence` for diagnostics but never increment it. The server-owned `commandSequence` is a separate dispatch-order counter and never substitutes for `endpointSequence`.

Before returning `ready`, the target installs a command barrier keyed by command id, sequence, and registration generation. While that command is ready or accepted, the barrier serializes ordinary playback reports and command-originated queue snapshot saves. A completed execution consumes the next `endpointSequence`; any later checkpoint uses a larger value. This prevents a periodic position report or the current queue store's debounced persistence effect from racing and invalidating the command completion transaction.

The barrier is released only after the target has either received a terminal result acknowledgement or concluded a pre-execution/transport timeout, refetched the GraphQL session and queue, and reconciled them. Buffered reports and queue saves are discarded rather than flushed. If the endpoint remains active and its live audio differs after reconciliation, it samples one fresh ordinary report with the next endpoint sequence; it never replays the buffered snapshots.

## 4. Transport Boundary

Socket.IO is used because a command targets a live connection and needs acknowledgement. The persisted session and queue remain the recovery path.

Socket.IO guarantees event ordering on a connection but provides at-most-once arrival by default. The application therefore supplies command ids, expiry, acknowledgements, deduplication, and snapshot recovery. Global Socket.IO retries must not be enabled merely for this protocol because ordinary notification events have different delivery semantics.

Connection-state recovery, if enabled later, is only an optimization. Every unrecovered reconnect and every ambiguous command outcome still refetches the GraphQL playback session and queue before accepting later realtime events.

Protocol event names are fixed as follows:

| Event | Direction | Purpose |
| --- | --- | --- |
| `playback:endpoint-register` | Endpoint -> server, acknowledged | Bind device and endpoint identity to the current socket |
| `playback:endpoint-heartbeat` | Endpoint -> server, periodically acknowledged | Refresh endpoint presence or return a stale-generation recovery instruction without changing endpoint sequence |
| `playback:endpoint-lease-expired` | Server -> endpoint, best effort | Fence an expired generation and prompt a still-connected document to register again |
| `playback:endpoints-invalidated` | Server -> clients, best effort | Prompt a GraphQL registry refetch after presence or metadata changes |
| `playback:command-request` | Controller -> server, acknowledged | Submit one user intent |
| `playback:command-execute` | Server -> target, acknowledged | Deliver a validated command for target readiness checks |
| `playback:command-start` | Target -> server, acknowledged | Obtain the execution grant that permits local media work |
| `playback:command-result` | Target -> server, acknowledged | Report local execution outcome for authoritative commit |
| `playback:command-status` | Server -> controller | Deliver accepted or terminal command status |

Existing `playback:state-updated` remains a committed-snapshot notification. A queue notification may be added with the queue implementation, but clients must always be able to recover with the GraphQL queue query.

## 5. Versioned Command Schema

The initial protocol version is `1`. Unknown versions are rejected without dispatch.

### Controller request

```ts
interface PlaybackCommandRequest {
    protocolVersion: 1;
    commandId: string;
    targetEndpointId: string;
    expectedSessionRevision: number;
    expectedQueueRevision: number | null;
    command: PlaybackCommand;
}

type PlaybackCommand =
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'seek'; positionMs: number }
    | { type: 'next' }
    | { type: 'previous' };
```

Rules:

- `commandId` is a UUID generated once per user intent. A retry reuses the same id; a new interaction creates a new id.
- `targetEndpointId` must equal the authoritative active endpoint.
- `expectedSessionRevision` is required for every command.
- `expectedQueueRevision` is required for `next`, `previous`, and `play` from `stopped`, because those transitions depend on queue selection. It is `null` when the command does not read or change queue selection.
- `seek.positionMs` is finite and non-negative. The server resolves the final value against the current track duration.
- The controller does not provide requester identity, command sequence, timestamps, capabilities, or resulting playback state.

### Target dispatch

After validation, the server adds trusted routing and timing fields:

```ts
interface PlaybackCommandDispatch extends PlaybackCommandRequest {
    requesterEndpointId: string;
    targetEndpointId: string;
    targetRegistrationGeneration: number;
    commandSequence: number;
    issuedAt: string;
    readyBy: string;
    expectedSource: {
        sessionRevision: number;
        queueRevision: number | null;
        state: 'playing' | 'paused' | 'stopped';
        currentMusicId: string | null;
        currentIndex: number | null;
        positionMs: number;
    };
    desiredResult: {
        state: 'playing' | 'paused' | 'stopped';
        currentMusicId: string | null;
        currentIndex: number | null;
        position:
            | { mode: 'absolute'; positionMs: number }
            | { mode: 'capture-current' };
    };
}
```

`commandSequence` is monotonic for the active endpoint registration generation. The target rejects a sequence that is not newer than the last granted command sequence unless the `commandId` is already in its recent-result cache.

`expectedSource` and `desiredResult` are computed from authoritative server snapshots. For `seek`, `next`, and `previous`, `desiredResult` contains the exact destination that the target executes; it never asks the target to recompute queue or repeat behavior. `capture-current` is used when the target must report the actual live position, such as `pause`.

The target verifies the registration generation, session and queue revisions, playback state, current music, and queue index before declaring readiness. It does not require an exact position match while playback is advancing, but it rejects a different track, selection, or state and refetches instead.

`readyBy` is a server-clock deadline for receiving the target readiness acknowledgement. It is diagnostic data on the target and is enforced only by the server. The target never compares its wall clock with a server timestamp and never starts media work from this dispatch alone.

### Target readiness, execution grant, and result

The target acknowledges dispatch after synchronous validation but before performing asynchronous media work:

```ts
type PlaybackCommandExecuteAck =
    | {
        protocolVersion: 1;
        commandId: string;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        commandSequence: number;
        status: 'ready';
        lastEndpointSequence: number;
      }
    | {
        protocolVersion: 1;
        commandId: string;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        commandSequence: number;
        status: 'rejected';
        lastEndpointSequence: number;
        error: PlaybackCommandError;
      };
```

A readiness acknowledgement means the target verified `expectedSource`, recognized the command, and can attempt it. It is not a controller-visible `accepted` state and does not permit audio execution. When the server receives readiness in time, it sets an internal `startRequestBy` deadline; the session guard is released as `timed_out` if no current start request arrives before that deadline.

After readiness, the target sends exactly one acknowledged start request. It records a local monotonic timestamp immediately before emitting the request:

```ts
interface PlaybackCommandStartRequest {
    protocolVersion: 1;
    commandId: string;
    targetEndpointId: string;
    targetRegistrationGeneration: number;
    commandSequence: number;
    startRequestId: string;
}

type PlaybackCommandStartAck =
    | {
        protocolVersion: 1;
        commandId: string;
        status: 'granted';
        executionToken: string;
        startWithinMs: number;
        completeWithinMs: number;
      }
    | {
        protocolVersion: 1;
        commandId: string;
        status: 'rejected';
        error: PlaybackCommandError;
      };
```

The server grants the start only when the same command reservation, session guard, target socket, registration generation, and command sequence are still current. Granting atomically changes the command to `accepted`, creates an opaque `executionToken`, and extends the server guard through `startWithinMs + completeWithinMs` from grant issuance. The coordinator reserves `startRequestId` atomically; an identical duplicate receives the same grant without extending its deadline, while any second id for that command is rejected.

The target executes only when the grant acknowledgement arrives within `startWithinMs` of its locally measured monotonic send time. It checks the elapsed duration again immediately before invoking the media operation and starts that operation in the same callback task. A rejected, missing, or late grant is never executed, even if a late payload says `granted`; the target discards buffered barrier data, refetches both snapshots, reconciles, and then releases the barrier. The target does not retry a start request. This bounds delayed packets without comparing client and server clocks, and it prevents the server from releasing the guard before any valid late start can finish.

After local execution, the target reports either the resulting state or a rejection:

```ts
type PlaybackCommandExecutionResult =
    | {
        protocolVersion: 1;
        commandId: string;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        commandSequence: number;
        executionToken: string;
        status: 'completed';
        endpointSequence: number;
        observedAt: string;
        resultingState: {
            state: 'playing' | 'paused' | 'stopped';
            currentMusicId: string | null;
            currentIndex: number | null;
            positionMs: number;
        };
      }
    | {
        protocolVersion: 1;
        commandId: string;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        commandSequence: number;
        executionToken: string;
        status: 'rejected';
        lastEndpointSequence: number;
        observedAt: string;
        error: PlaybackCommandError;
      };
```

The server verifies that the reported transition is a valid result of the pending command. A target cannot use this result event to commit an unrelated track, queue index, or playback state. `observedAt` is diagnostic only; deadline and commit timestamps use the server clock.

The acknowledgement to `playback:command-result` is explicit and terminal for that submitted result:

```ts
interface PlaybackCommandResultAck {
    protocolVersion: 1;
    commandId: string;
    targetEndpointId: string;
    targetRegistrationGeneration: number;
    commandSequence: number;
    disposition: 'committed' | 'duplicate' | 'rejected' | 'expired';
    commandStatus: 'completed' | 'rejected' | 'timed_out';
    sessionRevision: number | null;
    queueRevision: number | null;
    occurredAt: string;
    error: PlaybackCommandError | null;
}
```

- `committed` means the result was accepted and its `completed` or target-reported `rejected` outcome was recorded.
- `duplicate` means the identical result already produced the returned cached terminal outcome and no revision changed again.
- `rejected` means result validation or authoritative commit failed and the command was terminalized as `rejected`.
- `expired` means the completion guard already timed out; the late result was not committed and the returned command status is `timed_out`.

Any received result acknowledgement stops retransmission. Its revision fields identify the committed versions but do not contain snapshots; the target queries GraphQL and reconciles to snapshots at or beyond those revisions before resuming ordinary persistence. Only a missing acknowledgement permits resending the identical result within the locally measured completion window.

### Controller acknowledgement and status envelope

Controller acknowledgements and later status events use one envelope:

```ts
interface PlaybackCommandStatus {
    protocolVersion: 1;
    commandEpoch: string;
    commandId: string;
    status: 'accepted' | 'completed' | 'rejected' | 'timed_out';
    deduplicated: boolean;
    targetEndpointId: string;
    commandSequence: number | null;
    sessionRevision: number | null;
    queueRevision: number | null;
    occurredAt: string;
    error: PlaybackCommandError | null;
}

type PlaybackCommandErrorCode =
    | 'INVALID_COMMAND'
    | 'UNAUTHORIZED_COMMAND'
    | 'SESSION_NOT_FOUND'
    | 'TARGET_NOT_ACTIVE'
    | 'TARGET_OFFLINE'
    | 'UNSUPPORTED_COMMAND'
    | 'STALE_SESSION_REVISION'
    | 'STALE_QUEUE_REVISION'
    | 'COMMAND_IN_PROGRESS'
    | 'COMMAND_EXPIRED'
    | 'TARGET_READY_TIMEOUT'
    | 'START_REQUEST_TIMEOUT'
    | 'COMMAND_COMPLETION_TIMEOUT'
    | 'TARGET_STATE_MISMATCH'
    | 'AUTOPLAY_BLOCKED'
    | 'MEDIA_NOT_READY'
    | 'MEDIA_UNAVAILABLE'
    | 'QUEUE_EMPTY'
    | 'STATE_COMMIT_FAILED';

interface PlaybackCommandError {
    code: PlaybackCommandErrorCode;
    retryable: boolean;
    message: string;
}

interface PlaybackCommandParseFailure {
    protocolVersion: 1;
    commandEpoch: string;
    commandId: string | null;
    targetEndpointId: string | null;
    status: 'rejected';
    occurredAt: string;
    error: PlaybackCommandError & { code: 'INVALID_COMMAND' };
}

type PlaybackCommandRequestAck = PlaybackCommandStatus | PlaybackCommandParseFailure;
```

`message` is an English diagnostic string, not localized UI copy. UI behavior is keyed by the stable error `code`.

A duplicate request returns the latest cached status with `deduplicated: true`. It does not introduce a separate lifecycle state and never executes the audio action twice.

Malformed requests that cannot be correlated safely return `PlaybackCommandParseFailure`. The server echoes a command or target id only when that individual field parsed successfully; malformed requests are not inserted into the deduplication cache.

## 6. Validation and Fencing

The server validates and reserves a request in this order before dispatch:

1. The socket is authenticated and has a current endpoint registration.
2. The protocol version, command id, revisions, command type, and payload are valid.
3. In one coordinator critical section, atomically create-or-read a command reservation keyed by command epoch, installation scope, and command id. The reservation stores the requester and an immutable request fingerprint before any asynchronous snapshot lookup begins.
4. If an existing reservation has a different requester or fingerprint, reject the new payload as `INVALID_COMMAND`. If it matches, join its singleflight validation or return its cached status; never start a second validation or dispatch.
5. The target endpoint equals the session's active endpoint.
6. The target endpoint is online and bound to exactly one current socket and registration generation.
7. The target advertises the requested capability.
8. `expectedSessionRevision` equals the authoritative session revision.
9. Commands whose transition depends on queue selection have an `expectedQueueRevision` equal to the authoritative queue revision.
10. In one coordinator critical section, atomically acquire the playback-session command guard for this reservation, allocate the command sequence and readiness deadline, and transition the reservation to `dispatched`. If another reservation owns the guard, terminalize this reservation with `COMMAND_IN_PROGRESS`.

Revision conflicts return the current session and queue revision in the status envelope. The controller refetches before offering a retry. It never silently rewrites the request with a newer revision because the user may have been looking at a different track or active endpoint.

The command-id reservation and session-guard acquisition must use compare-and-set semantics or the equivalent single-threaded critical section; separate check-then-set calls are not sufficient. Terminal outcomes remain attached to the reservation through the deduplication retention window.

The server allocates `commandSequence`, `issuedAt`, and `readyBy` only after validation. The completion deadline is allocated when the execution grant is issued. Client wall clocks are not used for server deadlines or ordering.

## 7. Command Lifecycle

The lifecycle is:

```text
request
  -> rejected                         validation, stale state, or offline target
  -> dispatched
       -> rejected                    target refuses during readiness validation
       -> timed_out                   target did not become ready in time
       -> ready                       internal; no audio work is permitted yet
            -> timed_out              target did not request a grant in time
            -> accepted               server issued a current execution grant
                 -> completed         execution and authoritative commit succeeded
                 -> rejected          execution or authoritative commit failed
                 -> timed_out         terminal result was not committed in time
```

Definitions:

- `ready`: an internal coordinator state after the target validates the dispatch. It is not sent to the controller and does not permit execution.
- `accepted`: the server granted execution after rechecking the reservation and guard. It is not playback success.
- `completed`: local execution succeeded and the server committed the resulting playback session and, when applicable, queue selection.
- `rejected`: validation, capability, local media execution, or authoritative commit failed with a known reason.
- `timed_out`: the server could not determine a terminal result within the contract window. The actual audio outcome may be ambiguous, so the controller refetches instead of assuming failure or sending a new command automatically.

The target acknowledges `playback:command-execute` with `ready` or an immediate terminal `rejected` result. The server enforces `readyBy`. A ready target must receive a timely `playback:command-start` grant before execution and sends `playback:command-result` only after that grant. The server validates the result against the pending command, execution token, target socket, endpoint id, registration generation, command sequence, and server completion deadline before committing it.

The server emits `playback:command-status` to the controller for `accepted` and every terminal state. The original `playback:command-request` acknowledgement returns the first available status so the controller can distinguish request delivery from execution completion.

Only terminal states release the one-command in-flight guard.

## 8. Session State Transitions

The server resolves each command against the authoritative session and queue before dispatch. The target executes only the resolved transition.

| Command | Valid starting state | Result |
| --- | --- | --- |
| `play` | `paused` | Keep track and position; transition to `playing` |
| `play` | `playing` | Idempotent completion with no second audio start |
| `play` | `stopped` with a valid queue selection | Load the selected track at position `0`; transition to `playing` |
| `pause` | `playing` | Capture actual position; transition to `paused` |
| `pause` | `paused` | Idempotent completion |
| `seek` | `playing` or `paused` | Clamp to track duration; preserve playback state |
| `next` | Any state with a valid queue selection | Select the next queue item, wrap at the end, reset position to `0`, and transition to `playing` |
| `previous` | Any state with a valid queue selection | Restart the current track or select the previous item with wrap, matching local controls |

Additional transition rules:

- `pause` and `seek` reject a `stopped` session. `play`, `next`, and `previous` reject when the queue is empty or its current selection does not match `currentMusicId`.
- Manual `next` and track-switching `previous` intentionally match the existing local web controls: they wrap regardless of repeat mode and transition to `playing`.
- Manual `previous` restarts the current track at position `0` and preserves the current playback state when the authoritative position is greater than `10_000ms`. At or below that threshold it selects the previous item with wrap, resets position to `0`, and transitions to `playing`.
- Natural track completion is not a remote command. Repeat mode continues to govern it but does not change manual `next` or `previous` behavior.
- An idempotent `play` or `pause` still returns `completed`, but it need not advance the persisted revision when no authoritative value changed.
- A remote command never sets `claimActive` and never changes the active endpoint.

## 9. Queue Coordination

Structural queue changes continue through the revision-guarded GraphQL queue mutation. These include adding, removing, reordering, replacing, shuffling, and changing repeat mode. They are not tunneled through `playback:command-request`.

Every command completion conditionally fences the session revision and source state. `next` and `previous` are live commands that also change `PlaybackQueue.currentIndex`, so their completion transaction updates the queue and session together. `play` from `stopped` uses the same queue fence without changing the selected index. The result transaction follows these rules:

1. In the coordinator singleflight section, change the accepted result to `committing` only when its guard, execution token, socket, registration generation, and command sequence still match. Identical concurrent results join that commit.
2. Begin one serializable database transaction. On SQLite this requires an immediate write transaction or an equivalent write fence, not a deferred read followed by unconditional writes.
3. Conditionally fence or update the queue row where its id, expected revision, current index, and resolved source item still match. Increment queue revision once only when the index changes; use a conditional no-op write fence when it does not.
4. Conditionally update the session row where its id, expected revision, active endpoint, previous endpoint sequence, source state, and current music still match. The result sequence must be the exact next endpoint sequence.
5. Verify that every conditional predicate matched exactly one row. If either record changed, roll back both records and terminalize with the corresponding stale-state error; never commit a partial queue or session update.
6. Commit current music, position, playback state, endpoint sequence, and revisions atomically.
7. Emit best-effort session and queue notifications.
8. Return `completed` with the committed revisions.

An earlier validation read is advisory. Only the conditional predicates inside this transaction authorize the commit, so a concurrent GraphQL queue mutation or playback report cannot land between a check and an unconditional overwrite.

The target must apply a remotely resolved `next` or `previous` transition through a command-aware queue path. That path may update the in-memory selection needed for audio, but it suppresses the ordinary debounced `savePlaybackQueue` effect and any session checkpoint until `PlaybackCommandResultAck` arrives. It must not reuse a local transition path that performs an independent GraphQL queue mutation before command completion.

For every result acknowledgement disposition, the target discards the suppressed command-originated save, refetches both authoritative snapshots, reconciles local playback, and only then resumes ordinary persistence. `committed` and `duplicate` may keep displaying the just-executed state optimistically while that read completes, but the returned revision numbers are not treated as snapshots. `rejected` and `expired` display an ambiguous or failed state until the read completes. The target never flushes the command-originated queue save after the guard ends.

If every result acknowledgement is missing until the local completion window expires, the outcome is ambiguous. The target stops retransmitting, discards the suppressed queue save and queued session checkpoints, refetches both snapshots, reconciles, and only then re-enables ordinary persistence. It does not flush stale queued writes merely because its local timer ended.

If the target executes audio but the transaction fails, the command is rejected with `STATE_COMMIT_FAILED`. Local audio is not forcibly stopped. The target and controller both refetch and reconcile; the server snapshots remain authoritative for subsequent remote commands.

A structural queue mutation that arrives while a command is in flight either completes before command validation or changes the queue revision and causes the command result to be rejected as stale. The server never silently merges both writes.

## 10. Timing, Retry, and Deduplication

Initial timing constants are centralized and covered by tests:

```text
CONTROLLER_REQUEST_ACK_TIMEOUT_MS = 5_000
TARGET_READY_TIMEOUT_MS = 2_000
START_REQUEST_TIMEOUT_MS = 2_000
EXECUTION_GRANT_TTL_MS = 2_000
COMMAND_COMPLETION_TIMEOUT_MS = 10_000
CONTROLLER_RECOVERY_WINDOW_MS = 60_000
COMMAND_RESULT_RETENTION_MS = 120_000
```

At dispatch, `readyBy = issuedAt + TARGET_READY_TIMEOUT_MS`. On timely readiness, `startRequestBy = readyReceivedAt + START_REQUEST_TIMEOUT_MS`. When a current start request is granted, the server sets its internal completion deadline to `grantIssuedAt + EXECUTION_GRANT_TTL_MS + COMMAND_COMPLETION_TIMEOUT_MS`. The grant returns the two relative durations, not a client-enforced server timestamp. `CONTROLLER_REQUEST_ACK_TIMEOUT_MS` covers the normal readiness and start-request windows so the first acknowledgement usually contains `accepted`, `rejected`, or `timed_out`.

Rules:

- The controller may repeat the same request after a request-ack timeout or a missing terminal status only while its locally measured `CONTROLLER_RECOVERY_WINDOW_MS` from the original user intent remains open and the registration reports the same `commandEpoch`. It uses the same `commandId`, requester, target, revisions, type, and payload. This is a status recovery attempt, not a new user command.
- After the recovery window, an unrecovered reconnect, or a changed `commandEpoch`, the controller never transmits that old request again. It discards the pending intent and repairs UI state from GraphQL snapshots.
- It must not automatically retry a `rejected` or `timed_out` command with a new id.
- The server keeps every reservation until it is terminal, then keeps its status for at least the result-retention window. This is longer than the controller recovery window.
- The target keeps its recent command ids and results for at least the same window while the tab remains alive.
- A duplicate reservation that has not reached `accepted` joins the original singleflight request and never fabricates an accepted status.
- A duplicate accepted command returns `accepted` with `deduplicated: true`.
- A duplicate terminal command returns the original terminal outcome with `deduplicated: true`.
- A duplicate target result after commit receives a `duplicate` result acknowledgement and never increments session or queue revision again.
- If the target does not receive `PlaybackCommandResultAck`, it may resend the identical result only until `completeWithinMs` has elapsed locally from grant receipt.
- A delayed dispatch cannot execute by itself. A start request received after readiness expiry or after guard release is rejected, and a grant acknowledgement received outside its local `startWithinMs` is discarded by the target.
- A target result received after the server completion deadline receives an `expired` result acknowledgement and is not committed through the command path. Normal playback reporting may still expose the target's actual later state after reconciliation.
- Server restart clears the short-lived command registry and changes `commandEpoch`. It also disconnects target sockets, so pending commands become ambiguous and controllers recover from persisted snapshots rather than replaying them.

Command result retention is not an audit log. No durable table is required for the first implementation.

## 11. Error Contract

Error codes are stable protocol values. New codes may be added within protocol version 1; an existing code must not change meaning.

| Code | Source | Retryable | Meaning |
| --- | --- | --- | --- |
| `INVALID_COMMAND` | Server | No | Version, id, revision, type, or payload is invalid |
| `UNAUTHORIZED_COMMAND` | Server | No | The authenticated connection cannot issue this command |
| `SESSION_NOT_FOUND` | Server | Yes | No authoritative playback session exists |
| `TARGET_NOT_ACTIVE` | Server | Yes | Requested endpoint is not the active endpoint |
| `TARGET_OFFLINE` | Server | Yes | Active endpoint has no current online registration |
| `UNSUPPORTED_COMMAND` | Server or target | No | Target did not advertise or implement the capability |
| `STALE_SESSION_REVISION` | Server | Yes | Expected session changed before dispatch or conditional completion |
| `STALE_QUEUE_REVISION` | Server | Yes | Expected queue changed before dispatch or conditional completion |
| `COMMAND_IN_PROGRESS` | Server | Yes | Another command currently owns the session guard |
| `COMMAND_EXPIRED` | Server | Yes | Start request or execution result arrived after its server guard expired |
| `TARGET_READY_TIMEOUT` | Server | Yes | Target did not acknowledge readiness in time |
| `START_REQUEST_TIMEOUT` | Server | Yes | Ready target did not request an execution grant in time |
| `COMMAND_COMPLETION_TIMEOUT` | Server | Yes | Accepted command did not produce a terminal result in time |
| `TARGET_STATE_MISMATCH` | Target | Yes | Target local track, queue, or sequence did not match dispatch |
| `AUTOPLAY_BLOCKED` | Target | No | Browser policy rejected remote `play` |
| `MEDIA_NOT_READY` | Target | Yes | Audio element could not perform the action yet |
| `MEDIA_UNAVAILABLE` | Target | No | Resolved track cannot be loaded or played |
| `QUEUE_EMPTY` | Server | No | Command needs a queue item but none exists |
| `STATE_COMMIT_FAILED` | Server | Yes | Local execution succeeded but authoritative commit failed |

`retryable: true` means the UI may offer retry after refetching. It does not authorize automatic replay.

Authentication rejection during the Socket.IO handshake remains a connection error. `UNAUTHORIZED_COMMAND` covers an authenticated connection that lacks a valid endpoint registration or violates the installation command boundary.

## 12. Reconnect and Recovery

Reconnect recovery follows this order:

1. Re-establish Socket.IO authentication.
2. Register the existing `deviceId` and `endpointId` on the new socket.
3. Compare the returned `commandEpoch` with the previous registration.
4. Query the GraphQL playback session and queue.
5. Replace presence-only assumptions with the authoritative revisions.
6. Re-enable controls only when the active endpoint is online and the local snapshots match.
7. Ignore command status events that are older than the controller's known terminal result.

Registration readiness may race the session, queue, and registry stores' own reconnect reads. A superseded or concurrently replaced readiness read is accepted only when the current snapshots prove the exact registration generation and command epoch; otherwise the controller performs one bounded fresh read. Controls remain disabled until that fence is satisfied.

Ordinary playback reconciliation uses the same registration boundary:

- The active endpoint stores only its latest unsent media snapshot and latest unsent queue snapshot, not an event log.
- Each snapshot retains the session or queue revision observed when its local action occurred. A reconnect read does not rewrite that expected revision.
- Session reports hold their matching endpoint generation and proof authorization through the database transaction, so disconnect or registration rotation cannot interleave after authorization but before commit.
- Queue writers atomically claim the expected revision before replacing items; concurrent and initial-create losers receive the authoritative queue as a conflict.
- A stale media report applies the authoritative session and cannot restore ownership to the old endpoint.
- A stale queue save leaves current playback untouched and retains both snapshots until the user chooses the server queue or intentionally retries the local queue against the latest revision.
- Socket loss pauses a possible active source before any force handoff can claim a different endpoint.

A target endpoint never resumes or re-executes a pending command after reconnect. A controller may retrieve a cached terminal result with the same id only when the command epoch is unchanged and its local recovery window is still open. Otherwise it treats the outcome as unknown and uses snapshots without transmitting the old request.

A previously active endpoint that reconnects after ownership changed may register as online, but it cannot report state or accept commands as active. Endpoint presence never grants playback ownership.

Socket.IO recovery flags and missed packets do not replace this sequence. Recovery can fail, a server can restart, and server-to-client events are not durably buffered by default.

## 13. Security and Observability

- Socket.IO uses the existing installation authentication boundary before endpoint registration.
- The server routes by its registered endpoint-to-socket map, never by a client-supplied socket id.
- Payloads contain music ids and positions, not file paths, credentials, tokens, or arbitrary URLs.
- Command ids, endpoint ids, revisions, type, timing, status, and error code are logged as structured fields.
- Friendly device names and user agents are metadata, not authorization inputs.
- Invalid or repeated command traffic is rate-limited per registered endpoint.
- A target result is accepted only from the socket and registration generation to which the command was dispatched and with its execution token.
- Logs do not record audio file paths or authentication secrets.

Recommended metrics:

```text
playback_command_requests_total{type,status,error_code}
playback_command_duration_ms{type,status}
playback_command_deduplicated_total{type}
playback_command_in_flight
playback_endpoint_online
```

## 14. Implementation Sequence (completed)

The P0 work follows this dependency order:

1. **Protocol and state machine**: this document and the terminology updates in `PLAYBACK_SESSION.md`.
2. **Endpoint registry**: stable devices, tab endpoints, capabilities, heartbeat, TTL, and list/rename API.
3. **Command coordinator**: typed event schemas, revision fencing, idempotency cache, target execution, authoritative completion transaction, and integration tests.
4. **Controller UI**: active device display, target selection, command progress, failures, accessibility, and responsive layout.
5. **Atomic handoff**: release the old endpoint before claiming and starting the new endpoint.
6. **Recovery and E2E**: two independent browser contexts covering command, handoff, offline, reconnect, and stale-event paths.

The implementation must keep event literals, status values, and error codes identical on client and server. Prefer a shared typed contract module. If build boundaries require mirrored definitions, add parity tests that fail when either side drifts.

## 15. Protocol Decision Acceptance

The protocol-and-state-machine task is complete when:

- `PLAYBACK_SESSION.md` links to this protocol and uses device, endpoint, and connection terminology consistently;
- authority for audio execution, persisted state, presence, command coordination, and recovery is explicit;
- registration-ack, request, dispatch, execute-ack, start-grant, execution-result, result-ack, controller-status, and parse-failure schemas are defined;
- source and destination state are unambiguous for every command;
- manual command transitions intentionally match existing local web controls;
- readiness, execution-grant, and completion deadlines, bounded same-id recovery, atomic deduplication, and late-result behavior are defined;
- stable error codes cover validation, stale state, offline target, unsupported command, target failure, timeout, and commit failure;
- the remaining P0 implementation tasks can proceed in dependency order without redefining this contract.

## 16. P0 End-State Acceptance (completed)

The complete P0 command program is not finished until automated tests prove:

- every dispatched command ends as an immediate target rejection, a readiness/start-request timeout, or an execution grant followed by `accepted` and a terminal result, while pre-dispatch validation failures report terminal `rejected` directly;
- stale session and queue revisions are rejected before target dispatch;
- an offline or non-active endpoint is never commanded;
- concurrent duplicate requests join one atomic reservation, and duplicate dispatch or result delivery executes audio and commits state at most once;
- readiness, execution grant, and command completion have finite server and target-side windows without requiring synchronized clocks;
- a completed `next` or `previous` commits queue and session changes atomically;
- command-originated queue saves and ordinary playback reports cannot race that completion transaction;
- a missed status notification is repaired by GraphQL snapshot reads;
- reconnect does not restore ownership or replay a command implicitly;
- duplicated-tab endpoint identity collisions cannot replace a live registration silently;
- controller and target display the same committed track, state, position, and queue after recovery;
- native mobile behavior remains unchanged.

Automated browser verification uses two independent Playwright contexts, not two pages that share browser storage. It covers normal playback and remote commands, an offline source, force handoff, stale session and queue recovery, reconnect, and final authoritative convergence. Unit and server integration suites retain the rejection, timeout, duplicate, and concurrent-command coverage that does not require real media contexts.

## 17. References

- [Socket.IO acknowledgements and per-event timeouts](https://socket.io/docs/v4/emitting-events/)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees)
- [Socket.IO connection-state recovery](https://socket.io/docs/v4/connection-state-recovery)
