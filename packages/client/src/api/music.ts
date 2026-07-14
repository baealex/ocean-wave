import axios from 'axios';

import type { Music } from '~/models/type';
import { getOriginClientId } from '~/socket/socket';

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

export interface UpdateMusicMetadataInput {
    id: string;
    title: string;
    artist: string;
    album: string;
    albumArtist?: string | null;
    publishedYear: string;
    trackNumber: number;
    genres: string[];
}

export interface AlbumArtworkResult {
    albumId: string;
    cover: string;
    isCoverCustom: boolean;
}

export function updateMusicMetadata(input: UpdateMusicMetadataInput) {
    return graphQuery<{
        updateMusicMetadata: Pick<Music, 'id' | 'name'>;
    }, { input: UpdateMusicMetadataInput } & OriginClientVariables>(
        `mutation UpdateMusicMetadata($input: UpdateMusicMetadataInput!, $originClientId: String) {
            updateMusicMetadata(input: $input, originClientId: $originClientId) {
                id
                name
            }
        }`,
        withOriginClientId({ input })
    );
}

const getArtworkHeaders = (contentType?: string) => {
    const originClientId = getOriginClientId();

    return {
        ...(contentType ? { 'Content-Type': contentType } : {}),
        ...(originClientId ? { 'X-Ocean-Origin-Client-Id': originClientId } : {})
    };
};

export async function uploadMusicArtwork(id: string, file: File) {
    const { data } = await axios.put<AlbumArtworkResult>(
        `/api/music/${encodeURIComponent(id)}/artwork`,
        file,
        { headers: getArtworkHeaders(file.type) }
    );

    return data;
}

export async function restoreMusicArtwork(id: string) {
    const { data } = await axios.delete<AlbumArtworkResult>(
        `/api/music/${encodeURIComponent(id)}/artwork`,
        { headers: getArtworkHeaders() }
    );

    return data;
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
