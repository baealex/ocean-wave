# Ocean Wave API and Realtime Convention

Updated: 2026-06-05

## 1. Purpose

Ocean Wave uses GraphQL and Socket.IO together. This document defines their roles so new features do not invent a different write path each time.

The core rule is simple:

- GraphQL is the source-of-truth API for ordinary data reads and writes.
- Socket.IO is the realtime channel for change notifications, playback state, remote control commands, and long-running task progress.

## 2. Role Boundaries

| Responsibility | Default owner | Notes |
| --- | --- | --- |
| Fetch ordinary app data | GraphQL query | Library, playlist, tag, smart view, playback snapshot, sync report. |
| Change ordinary persisted data | GraphQL mutation | Tags, playlists, likes, hidden state, smart views, playback records. |
| Notify other clients that data changed | Socket.IO notification | Send a small patch or an invalidation event after the server-side mutation succeeds. |
| Share realtime playback state | Socket.IO notification | Current track, playback state, position snapshot, active playback device. |
| Send remote playback commands | Socket.IO command | Only for realtime playback control. Commands require acknowledgement. |
| Report long-running progress | Socket.IO notification or job polling | Sync progress may stay on Socket.IO until a job polling model exists. |

Do not use Socket.IO as the primary API for ordinary database writes unless the feature is explicitly realtime playback control.

## 3. GraphQL Write Rules

1. New ordinary writes must be GraphQL mutations.
2. Mutation resolvers should call service functions instead of writing Prisma logic directly in the resolver.
3. Socket.IO handlers that still perform ordinary writes should be treated as legacy paths and migrated behind the same service functions.
4. Mutation payloads should return enough data for the requesting client to update the current UI without a broad refetch.
5. Callers must handle `response.type === 'error'` and show or recover from normalized errors.
6. Dynamic GraphQL values must use variables; follow `docs/process/GRAPHQL_VARIABLES_CONVENTION.md`.

Recommended mutation response pattern:

```graphql
mutation AddTagToMusic($musicId: ID!, $tagId: ID!) {
  addTagToMusic(musicId: $musicId, tagId: $tagId) {
    id
    tags { id name normalizedName musicCount }
  }
}
```

## 4. Socket.IO Notification Rules

Socket.IO events used after ordinary data writes are notifications, not write commands.

A notification should answer one of two questions:

1. What exact small piece changed?
2. Which GraphQL data should be refetched?

### 4-1. Patch Notifications

Use patch notifications when the changed data is small and safe to apply locally.

Examples:

- `music:like-updated`
- `music:hate-updated`
- `music:play-count-updated`
- `music:tags-updated`
- `playlist:summary-updated`
- `tag:renamed`
- `playback:state-updated`

Example payload:

```ts
interface MusicTagsUpdatedNotification {
    type: 'music:tags-updated';
    originClientId?: string;
    musicId: string;
    tags: Array<{
        id: string;
        name: string;
        normalizedName: string;
        musicCount?: number;
    }>;
}
```

### 4-2. Invalidation Notifications

Use invalidation notifications when the affected surface is wide, ambiguous, or more expensive to patch correctly than to refetch.

Examples:

- `library:invalidated`
- `playlist:list-invalidated`
- `playlist:detail-invalidated`
- `tag:list-invalidated`
- `smart-view:list-invalidated`

Example payload:

```ts
interface TagListInvalidatedNotification {
    type: 'tag:list-invalidated';
    originClientId?: string;
    reason: 'tag-created' | 'tag-renamed' | 'tag-deleted' | 'music-tags-changed';
    affectedTagIds?: string[];
    affectedMusicIds?: string[];
}
```

Client handlers should map invalidation notifications to the narrowest safe query key invalidation.

## 5. Patch vs Invalidate Decision

Prefer patch when all are true:

- The changed entity and fields are known.
- The payload is small.
- The client can update local state without duplicating server business logic.
- The change does not affect many lists with different filters or counts.

Prefer invalidate when any are true:

- The change affects many entities or computed counts.
- The change affects filtered lists where local recomputation would duplicate server logic.
- The payload would need a large snapshot.
- Correct patching depends on hidden server rules.

Examples:

| Trigger | Preferred notification | Reason |
| --- | --- | --- |
| Like one track | Patch `music:like-updated` | Single boolean field. |
| Add tag to one track | Patch `music:tags-updated` plus optional tag list invalidate | Track tag chips can patch; tag counts may need refetch. |
| Rename a tag | Patch `tag:renamed` plus tag list invalidate when counts/search are visible | Name is small; lists may need resort. |
| Delete a tag | Invalidate `tag:list-invalidated` and affected music tags | Many tracks and smart views can be affected. |
| Reorder playlist tracks | Invalidate playlist detail or send ordered id patch | Choose based on payload size and UI needs. |
| Library sync completed | Invalidate `library:invalidated` | Broad library changes. |

## 6. Origin Client Handling

When a GraphQL mutation triggers a Socket.IO notification, the requesting client may receive both:

1. The mutation response.
2. The realtime notification.

To avoid duplicate work, notification payloads should include `originClientId` when the client can provide one.

Rules:

- The origin client should update immediate UI from the mutation response.
- The origin client may ignore matching notifications when `originClientId` matches its client id.
- Other clients should apply the patch or invalidate queries.
- If `originClientId` is missing, handlers must remain idempotent.

## 7. Event Naming

Use namespaced event names:

```text
<domain>:<past-tense-change>
<domain>:<scope>-invalidated
playback:<state-or-command>
```

Allowed examples:

- `tag:created`
- `tag:renamed`
- `tag:list-invalidated`
- `music:tags-updated`
- `playlist:detail-invalidated`
- `playback:state-updated`
- `playback:command`

Avoid reusing the same event name for both client commands and server notifications. Legacy events such as `playlist-add-music` currently do both and should not be copied for new features.

## 8. Playback Realtime Exception

Playback control is the intentional exception to the “GraphQL for writes” rule.

Socket.IO may carry realtime playback commands because the target is an active playback device, not just a database row.

Rules:

1. The server-side playback session is the state source of truth.
2. Socket.IO carries commands and state broadcasts.
3. Commands must include a `commandId` and require acknowledgement from the active playback device.
4. The server should broadcast the new playback state only after the active playback device reports that it applied the command.
5. Playback position should be sent as `positionMs` plus `positionUpdatedAt`; do not write position every second.

## 9. Mobile Scope

Mobile should use GraphQL as its default API contract.

Current mobile scope is intentionally limited to:

- Server and playlist selection.
- Offline playlist save, refresh, and delete.
- Offline or streaming playback.
- Background playback.
- Minimal player and queue controls.

Do not require mobile to keep a long-lived Socket.IO connection for ordinary data freshness. Realtime playback control for mobile should be designed separately and only after web behavior is stable.

## 10. Migration Guidance

When touching a legacy Socket.IO write path:

1. Extract Prisma logic into a service function.
2. Add or use a GraphQL mutation that calls the service.
3. Make the client call the GraphQL mutation for the write.
4. Emit a Socket.IO patch or invalidation notification after the write succeeds.
5. Keep the legacy Socket.IO command only as a temporary compatibility path if needed.
6. Remove or deprecate the legacy command when no client uses it.

Suggested migration order:

1. Tags: keep GraphQL mutations and add realtime notifications where useful.
2. Playlists: move create/update/delete/reorder/add/remove writes to GraphQL mutations.
3. Music preferences: move like/hidden writes to target-state GraphQL mutations.
4. Playback records: move to GraphQL only if acknowledgement and checkpoint recovery stay reliable.
5. Playback session: design separately as realtime state, not ordinary CRUD.

## 11. Review Checklist

Before adding a new data-changing feature, answer:

1. Is this an ordinary persisted data write?
   - If yes, use GraphQL mutation.
2. Is this an active playback command?
   - If yes, Socket.IO command may be appropriate.
3. What should the mutation return for the origin client?
4. Should other clients receive a patch or an invalidation?
5. Which query keys are invalidated, and is the invalidation exact or prefix?
6. Does mobile need this as GraphQL only, or does it truly need realtime behavior?
7. Are errors normalized and visible to the caller?
