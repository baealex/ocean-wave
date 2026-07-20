import { graphQuery } from './graphql';
import {
    type OriginClientVariables,
    withOriginClientId
} from './origin-client';

export type SharedPlaybackState = 'playing' | 'paused' | 'stopped';

export interface PlaybackSessionSnapshot {
    id: string;
    state: SharedPlaybackState;
    activeDeviceId: string | null;
    currentMusicId: string | null;
    positionMs: number;
    positionUpdatedAt: string;
    startedAt: string | null;
    revision: number;
    serverTime: string;
}

export interface ReportPlaybackStateInput {
    deviceId: string;
    registrationGeneration: number;
    registrationProof: string;
    sequence: number;
    claimActive: boolean;
    state: SharedPlaybackState;
    currentMusicId: string | null;
    positionMs: number;
    observedAt: string;
}

export interface PlaybackSessionReportResult {
    type: 'accepted' | 'conflict';
    session: PlaybackSessionSnapshot;
    conflict: {
        reason: 'active-device' | 'stale-sequence';
        session: PlaybackSessionSnapshot;
    } | null;
}

export const fetchPlaybackSession = () => {
    return graphQuery<{
        playbackSession: PlaybackSessionSnapshot | null;
    }>({
        operationName: 'PlaybackSession',
        query: `query PlaybackSession {
            playbackSession {
                id
                state
                activeDeviceId
                currentMusicId
                positionMs
                positionUpdatedAt
                startedAt
                revision
                serverTime
            }
        }`
    });
};

export const reportPlaybackState = (input: ReportPlaybackStateInput) => {
    return graphQuery<{
        reportPlaybackState: PlaybackSessionReportResult;
    }, {
        input: ReportPlaybackStateInput;
    } & OriginClientVariables>({
        operationName: 'ReportPlaybackState',
        query: `mutation ReportPlaybackState(
            $input: ReportPlaybackStateInput!
            $originClientId: String
        ) {
            reportPlaybackState(
                input: $input
                originClientId: $originClientId
            ) {
                type
                session {
                    id
                    state
                    activeDeviceId
                    currentMusicId
                    positionMs
                    positionUpdatedAt
                    startedAt
                    revision
                    serverTime
                }
                conflict {
                    reason
                    session {
                        id
                        state
                        activeDeviceId
                        currentMusicId
                        positionMs
                        positionUpdatedAt
                        startedAt
                        revision
                        serverTime
                    }
                }
            }
        }`,
        variables: withOriginClientId({ input })
    });
};
