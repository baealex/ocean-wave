import { graphQuery } from './graphql';

export function setMusicLiked({ id, isLiked }: { id: string; isLiked: boolean }) {
    return graphQuery<{ setMusicLiked: { id: string; isLiked: boolean } }, { id: string; isLiked: boolean }>(
        `mutation SetMusicLiked($id: ID!, $isLiked: Boolean!) {
            setMusicLiked(id: $id, isLiked: $isLiked) {
                id
                isLiked
            }
        }`,
        { id, isLiked }
    );
}

export function setMusicHated({ id, isHated }: { id: string; isHated: boolean }) {
    return graphQuery<{ setMusicHated: { id: string; isHated: boolean } }, { id: string; isHated: boolean }>(
        `mutation SetMusicHated($id: ID!, $isHated: Boolean!) {
            setMusicHated(id: $id, isHated: $isHated) {
                id
                isHated
            }
        }`,
        { id, isHated }
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
    }, { input: RecordPlaybackParams }>(
        `mutation RecordPlayback($input: RecordPlaybackInput!) {
            recordPlayback(input: $input) {
                id
                playCount
                lastPlayedAt
                totalPlayedMs
                countedAsPlay
                deduped
            }
        }`,
        { input }
    );
}
