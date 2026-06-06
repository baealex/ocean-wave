import { graphQuery } from './graphql';
import {
    type OriginClientVariables,
    withOriginClientId
} from './origin-client';

export function setMusicLiked({ id, isLiked }: { id: string; isLiked: boolean }) {
    return graphQuery<{
        setMusicLiked: { id: string; isLiked: boolean };
    }, { id: string; isLiked: boolean } & OriginClientVariables>(
        `mutation SetMusicLiked($id: ID!, $isLiked: Boolean!, $originClientId: String) {
            setMusicLiked(id: $id, isLiked: $isLiked, originClientId: $originClientId) {
                id
                isLiked
            }
        }`,
        withOriginClientId({ id, isLiked })
    );
}

export function setMusicHated({ id, isHated }: { id: string; isHated: boolean }) {
    return graphQuery<{
        setMusicHated: { id: string; isHated: boolean };
    }, { id: string; isHated: boolean } & OriginClientVariables>(
        `mutation SetMusicHated($id: ID!, $isHated: Boolean!, $originClientId: String) {
            setMusicHated(id: $id, isHated: $isHated, originClientId: $originClientId) {
                id
                isHated
            }
        }`,
        withOriginClientId({ id, isHated })
    );
}

export interface RecordPlaybackParams {
    id: string;
    playedMs: number;
    completionRate?: number;
    startedAt: string;
    source?: string;
    clientSessionId?: string;
}

export interface PlaybackRecordResult {
    id: string;
    playCount: number;
    lastPlayedAt: string | null;
    totalPlayedMs: number;
    countedAsPlay: boolean;
    deduped: boolean;
}

export function recordPlayback(input: RecordPlaybackParams) {
    return graphQuery<{
        recordPlayback: PlaybackRecordResult | null;
    }, { input: RecordPlaybackParams } & OriginClientVariables>(
        `mutation RecordPlayback($input: RecordPlaybackInput!, $originClientId: String) {
            recordPlayback(input: $input, originClientId: $originClientId) {
                id
                playCount
                lastPlayedAt
                totalPlayedMs
                countedAsPlay
                deduped
            }
        }`,
        withOriginClientId({ input })
    );
}
