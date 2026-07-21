import { graphQuery } from './graphql';
import {
    type OriginClientVariables,
    withOriginClientId
} from './origin-client';

export type PlaybackQueueRepeatMode = 'none' | 'one' | 'all';
export type PlaybackQueueContextType = 'album' | 'playlist' | 'queue';

export interface PlaybackQueueContext {
    type: PlaybackQueueContextType;
    id: string | null;
    title: string | null;
}

export interface PlaybackQueueSnapshot {
    id: string;
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex: number | null;
    contextType: PlaybackQueueContextType;
    contextId: string | null;
    contextTitle: string | null;
    shuffle: boolean;
    repeatMode: PlaybackQueueRepeatMode;
    revision: number;
    updatedAt: string;
}

export interface SavePlaybackQueueInput {
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex: number | null;
    contextType: PlaybackQueueContextType;
    contextId: string | null;
    contextTitle: string | null;
    shuffle: boolean;
    repeatMode: PlaybackQueueRepeatMode;
    expectedRevision: number;
}

export interface PlaybackQueueSaveResult {
    type: 'accepted' | 'conflict';
    queue: PlaybackQueueSnapshot;
    conflict: {
        reason: 'stale-revision';
        queue: PlaybackQueueSnapshot;
    } | null;
}

const PLAYBACK_QUEUE_FIELDS = `
    id
    musicIds
    sourceMusicIds
    currentIndex
    contextType
    contextId
    contextTitle
    shuffle
    repeatMode
    revision
    updatedAt
`;

export const fetchPlaybackQueue = (requestTimeoutMs?: number) => graphQuery<{
    playbackQueue: PlaybackQueueSnapshot | null;
}>({
    operationName: 'PlaybackQueue',
    requestTimeoutMs,
    query: `query PlaybackQueue {
        playbackQueue {
            ${PLAYBACK_QUEUE_FIELDS}
        }
    }`
});

export const savePlaybackQueue = (input: SavePlaybackQueueInput) => graphQuery<{
    savePlaybackQueue: PlaybackQueueSaveResult;
}, {
    input: SavePlaybackQueueInput;
} & OriginClientVariables>({
    operationName: 'SavePlaybackQueue',
    query: `mutation SavePlaybackQueue(
        $input: SavePlaybackQueueInput!
        $originClientId: String
    ) {
        savePlaybackQueue(
            input: $input
            originClientId: $originClientId
        ) {
            type
            queue {
                ${PLAYBACK_QUEUE_FIELDS}
            }
            conflict {
                reason
                queue {
                    ${PLAYBACK_QUEUE_FIELDS}
                }
            }
        }
    }`,
    variables: withOriginClientId({ input })
});
