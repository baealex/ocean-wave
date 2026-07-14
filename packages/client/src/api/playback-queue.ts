import { graphQuery } from './graphql';

export type PlaybackQueueRepeatMode = 'none' | 'one' | 'all';

export interface PlaybackQueueSnapshot {
    id: string;
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex: number | null;
    shuffle: boolean;
    repeatMode: PlaybackQueueRepeatMode;
    revision: number;
    updatedAt: string;
}

export interface SavePlaybackQueueInput {
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex: number | null;
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
    shuffle
    repeatMode
    revision
    updatedAt
`;

export const fetchPlaybackQueue = () => graphQuery<{
    playbackQueue: PlaybackQueueSnapshot | null;
}>({
    operationName: 'PlaybackQueue',
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
}>({
    operationName: 'SavePlaybackQueue',
    query: `mutation SavePlaybackQueue($input: SavePlaybackQueueInput!) {
        savePlaybackQueue(input: $input) {
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
    variables: { input }
});
