# Playback History and Listening Signals

Updated: 2026-07-21

## 1. Purpose and Boundary

Playback history exists to support explainable library rediscovery. It records
actual listening, not media-position movement, and it must never become a reason
to pause or reject audio playback.

`PlaybackSession` remains the authoritative description of what is playing now.
`PlaybackEvent` is the cumulative, recoverable history record for one logical
playback of one track. GraphQL commits history; Socket.IO only notifies other
clients after that commit.

## 2. Signal Definitions

The following rules are product contracts:

- **Play start**: a logical playback starts only after the audio channel emits an
  actual play transition. Selecting or preloading a track is not a play start.
- **Actual listening time**: only wall-clock time while audio is actively playing
  is accumulated. Paused and actual `waiting` gaps and media-position jumps are
  excluded. A `stalled` network event alone does not pause tracking while
  buffered media continues to advance. During a crossfade, the outgoing track
  receives only its measured media-time advance, capped by the configured fade,
  elapsed fade time, and remaining track duration. An early end or stalled
  outgoing element therefore cannot add silent tail time. A persisted page hide
  pauses both audio and tracking before the document enters the back/forward
  cache. A restored document clears its lifecycle guard and remains paused until
  a real play transition, so frozen cache time is never counted as listening.
- **Meaningful play**: a playback increments `playCount` after actual listening
  reaches `min(30 seconds, 50% of track duration)`. A missing or non-positive
  duration uses 30 seconds.
- **Completion rate**: `min(actual listened milliseconds / track duration, 1)`.
  The client-reported media position never contributes to this value.
- **Unknown duration**: a missing, non-finite, or non-positive duration cannot
  prove completion, so its completion rate remains `0`. It can still cross the
  30-second meaningful-play fallback.
- **Complete**: a terminal `ended`, `skipped`, or `stopped` report is complete at
  a 90% actual-listening rate. This treats a near-end Next action as complete.
- **Skip**: an explicit Next, Previous, or direct track selection below the 90%
  completion boundary is a skip. If playback already started, an immediate skip
  is recorded even when less than one millisecond of listening has accrued.
- **Seek**: seeking sets `hadSeek`, but the seek distance does not increase actual
  listening time. A natural end reached after seeking is not complete unless the
  90% actual-listening boundary was also reached.
- **Replay**: after a terminal commit, replaying the same track creates a new
  logical playback identity.
- **Interruption**: handoff, unload, and recovery reports are non-terminal listens.
  A later cumulative terminal report may finish the same logical playback.

The percentage rules apply to short tracks without a separate absolute-duration
exception. For example, a 20-second track becomes a meaningful play at 10 seconds
and complete at 18 seconds of actual listening.

## 3. Identity, Recovery, and Deduplication

`clientSessionId` identifies one logical playback, not one HTTP request or one
browser document. It is fenced to one track.

Each device continuation also has a `branchId`, optional `parentBranchId`, and
`branchBasePlayedMs`. A handoff keeps the canonical `clientSessionId` but starts
a child branch at the authoritative cumulative baseline. The initial branch id
equals `clientSessionId`; every continuation names that canonical root as its
parent, so sequential branches still reconcile when intermediate devices never
deliver a checkpoint. The branch contributes only progress after its baseline.
This matters for a forced handoff: if the
offline source listened beyond its last server checkpoint while the target also
continued, both post-baseline deltas are retained without counting the baseline
or the logical play twice.

- IndexedDB keeps the latest cumulative checkpoint for each
  `(clientSessionId, branchId)` pair, so one successful delivery cannot remove
  an undelivered sibling branch. Deletion also compares the delivered snapshot,
  so a late acknowledgement cannot remove newer progress from the same branch.
- `sessionStorage` keeps the same cumulative identity across a reload in one tab.
- Periodic authoritative `PlaybackSession` reports persist the current identity,
  cumulative listened time, seek flag, and lineage timestamps. An explicit
  forced handoff can therefore recover the offline source identity instead of
  creating a second logical listen.
- A successful `Play Here` handoff transfers the source checkpoint to the target.
  The target continues the same canonical identity and cumulative listened time
  on a new child branch.
- Reconnect and retry may report the same identity repeatedly.

The server stores at most one `PlaybackEvent` for that identity and monotonic
progress per branch. `PlaybackEventBranch` rows let it sum unique post-handoff
deltas and use a missing parent's baseline until that delayed parent report
arrives. A child baseline also remains the minimum parent contribution when a
stale parent checkpoint arrives below that already-authoritative handoff point.
Each cumulative branch report is a lower bound for the event, so a known root
cannot make a later continuation appear shorter while an intermediate branch is
still missing. It adds only the resulting positive event delta to
`Music.totalPlayedMs`, crosses the meaningful-play boundary at most once, and
records the first terminal reason. A delayed branch can promote that reason's
outcome from listen to complete when the combined actual listening crosses 90%.
An explicit first skip remains a skip, and a completed terminal event never
demotes if track metadata later changes. No later reason replaces either
terminal intent. A lower or identical branch report is idempotent unless it
supplies that first terminal reason or a new seek diagnostic. Reusing an event or
branch identity with conflicting track or lineage metadata is rejected.

Client `startedAt` and `endedAt` values are not used for aggregate recency or
server ordering, and signal timestamps use server receipt time. For a branch
without a seek, one report can contribute at most one track duration beyond its
handoff baseline. A seek-aware branch can legitimately exceed that duration
because actual listening may revisit media. These bounds allow delayed offline
recovery without letting client clock skew erase, backdate, or truncate a valid
cumulative completion.

This means a source checkpoint and target completion can arrive in either order
without producing a second play count or double-counting listening time.

## 4. Persisted Rediscovery Signals

New `PlaybackEvent` rows store:

- `playedMs` and server-derived `completionRate`;
- `countedAsPlay`;
- `outcome`: `listen`, `skip`, `complete`, or `legacy`;
- `endReason` and `hadSeek`;
- the cumulative logical playback identity.

`PlaybackEventBranch` stores the branch identity, parent identity, handoff
baseline, and greatest cumulative report used to derive the event total.

`Music` exposes safe aggregate inputs for later rediscovery scoring:

- `playCount`, `lastPlayedAt`, and `totalPlayedMs`;
- `skipCount` and `lastSkippedAt`;
- `completionCount` and `lastCompletedAt`.

Mutation responses and `music:play-count-updated` notifications carry the full
aggregate patch so every loaded web client can apply the same committed values.
Because responses and notifications can arrive out of order, clients merge
increase-only values with `max` and keep the latest signal timestamp.

## 5. Existing Data and Migration

Historical rows do not contain trustworthy user intent. The migration therefore
does not infer skips or completions from old `source`, `completionRate`, or
`countedAsPlay` values:

- existing events receive `outcome=legacy`, `endReason=legacy`, and `hadSeek=false`;
- existing `playCount`, `lastPlayedAt`, and `totalPlayedMs` remain unchanged;
- no branch rows are invented for finalized historical events;
- new skip/completion counts start at `0`, with nullable last-signal timestamps.

Rediscovery code can safely treat missing timestamps and zero counts as “no
reliable signal” rather than negative preference.

The deterministic consumer of these aggregates is documented in
`docs/architecture/LIBRARY_REDISCOVERY.md`.

## 6. Failure Boundary

History writes remain best effort from the audio player's perspective. A final
checkpoint stores the original `endedAt`, `endReason`, and seek flag before the
GraphQL request. A failed or timed-out request therefore replays the same skip,
completion, handoff, stop, or unload signal on recovery instead of degrading it
to a generic recovery listen. It does not stop, pause, seek, or roll back media
playback. Realtime notification failure also does not roll back a committed
event.
