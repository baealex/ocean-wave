import { graphQuery } from './graphql';
import {
    type OriginClientVariables,
    withOriginClientId
} from './origin-client';
import type { PlaybackQueueSnapshot } from './playback-queue';

export type PersonalListeningSessionLength = 'short' | 'standard' | 'long';
export type PersonalListeningSessionScope = 'focused' | 'explore';
export type PersonalListeningSessionReasonCode =
    | 'START_TRACK'
    | 'SAME_ALBUM'
    | 'SAME_ARTIST'
    | 'SHARED_SMART_VIEW'
    | 'SHARED_TAG'
    | 'SHARED_GENRE';

export interface CreatePersonalListeningSessionInput {
    startMusicId: string;
    length: PersonalListeningSessionLength;
    scope: PersonalListeningSessionScope;
    expectedRevision: number;
    expectedPlaybackSessionRevision: number;
    requestingEndpointId: string;
    registrationGeneration: number;
    registrationProof: string;
}

export interface PersonalListeningSessionItem {
    musicId: string;
    reasonCodes: PersonalListeningSessionReasonCode[];
}

export interface PersonalListeningSessionResult {
    type: 'accepted' | 'conflict';
    queue: PlaybackQueueSnapshot;
    conflict: {
        reason: 'stale-revision';
        queue: PlaybackQueueSnapshot;
    } | null;
    items: PersonalListeningSessionItem[];
    generatedAt: string;
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

export const createPersonalListeningSession = (
    input: CreatePersonalListeningSessionInput,
    requestTimeoutMs?: number
) => graphQuery<{
    createPersonalListeningSession: PersonalListeningSessionResult;
}, {
    input: CreatePersonalListeningSessionInput;
} & OriginClientVariables>({
    operationName: 'CreatePersonalListeningSession',
    requestTimeoutMs,
    query: `mutation CreatePersonalListeningSession(
        $input: CreatePersonalListeningSessionInput!
        $originClientId: String
    ) {
        createPersonalListeningSession(
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
            items {
                musicId
                reasonCodes
            }
            generatedAt
        }
    }`,
    variables: withOriginClientId({ input })
});
