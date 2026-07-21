import axios from 'axios';

import type {
    ArtistCreditRole,
    Music,
    ReleaseType
} from '~/models/type';
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
    endedAt: string;
    endReason: 'ended' | 'skipped' | 'stopped' | 'handoff' | 'unload' | 'recovery';
    hadSeek: boolean;
    source?: string;
    clientSessionId?: string;
    branchId?: string;
    parentBranchId?: string | null;
    branchBasePlayedMs?: number;
}

export interface UpdateMusicMetadataInput {
    id: string;
    title: string;
    titleOverride?: string | null;
    recordingVersionTitle?: string | null;
    artist?: string | null;
    artistCredits?: Array<{
        name: string;
        role: ArtistCreditRole;
        creditedName?: string | null;
        joinPhrase?: string | null;
    }>;
    recordingArtistCredits?: MusicMetadataArtistCreditInput[];
    releaseTrackArtistCredits?: MusicMetadataArtistCreditInput[] | null;
    album: string;
    albumArtist?: string | null;
    albumArtistCredits?: Array<{
        name: string;
        role: ArtistCreditRole;
        creditedName?: string | null;
        joinPhrase?: string | null;
    }>;
    publishedYear: string;
    releaseType?: ReleaseType;
    totalDiscs?: number | null;
    releaseVersionTitle?: string | null;
    discNumber?: number | null;
    trackNumber: number | null;
    genres: string[];
}

export interface MusicMetadataArtistCreditInput {
    name: string;
    role: ArtistCreditRole;
    creditedName?: string | null;
    joinPhrase?: string | null;
}

export type MusicMetadataStorage = 'FILE_AND_DATABASE' | 'DATABASE_ONLY';
export type MusicMetadataOwner = 'RECORDING' | 'RELEASE' | 'RELEASE_TRACK';

export interface MusicMetadataChange {
    field: string;
    label: string;
    before: string;
    after: string;
    owner: MusicMetadataOwner;
    storage: MusicMetadataStorage;
}

export interface MusicMetadataFilePreview {
    fileId: string;
    stableId: string;
    filePath: string;
    syncStatus: string;
    willWrite: boolean;
    changes: MusicMetadataChange[];
}

export interface MusicMetadataPreviewIssue {
    code: string;
    message: string;
    blocking: boolean;
    fileId: string | null;
}

export interface MusicMetadataPreview {
    token: string;
    hasChanges: boolean;
    changes: MusicMetadataChange[];
    files: MusicMetadataFilePreview[];
    issues: MusicMetadataPreviewIssue[];
    preservedPolicies: string[];
}

export interface MusicMetadataOperationTarget {
    fileId: string;
    filePath: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
}

export interface MusicMetadataOperation {
    operationId: string;
    status: string;
    retryable: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    music: Pick<Music, 'id' | 'name'> | null;
    targets: MusicMetadataOperationTarget[];
    createdAt: string | null;
    updatedAt: string | null;
}

export interface AlbumArtworkResult {
    albumId: string;
    cover: string;
    isCoverCustom: boolean;
}

export function previewMusicMetadataUpdate(input: UpdateMusicMetadataInput) {
    return graphQuery<{
        previewMusicMetadataUpdate: MusicMetadataPreview;
    }, { input: UpdateMusicMetadataInput }>(
        `query PreviewMusicMetadataUpdate($input: UpdateMusicMetadataInput!) {
            previewMusicMetadataUpdate(input: $input) {
                token
                hasChanges
                changes {
                    field
                    label
                    before
                    after
                    owner
                    storage
                }
                files {
                    fileId
                    stableId
                    filePath
                    syncStatus
                    willWrite
                    changes {
                        field
                        label
                        before
                        after
                        owner
                        storage
                    }
                }
                issues {
                    code
                    message
                    blocking
                    fileId
                }
                preservedPolicies
            }
        }`,
        { input }
    );
}

export function updateMusicMetadata(
    input: UpdateMusicMetadataInput,
    previewToken: string
) {
    return graphQuery<{
        updateMusicMetadata: MusicMetadataOperation;
    }, {
        input: UpdateMusicMetadataInput;
        previewToken: string;
    } & OriginClientVariables>(
        `mutation UpdateMusicMetadata($input: UpdateMusicMetadataInput!, $previewToken: String!, $originClientId: String) {
            updateMusicMetadata(input: $input, previewToken: $previewToken, originClientId: $originClientId) {
                operationId
                status
                retryable
                errorCode
                errorMessage
                music {
                    id
                    name
                }
                targets {
                    fileId
                    filePath
                    status
                    errorCode
                    errorMessage
                }
                createdAt
                updatedAt
            }
        }`,
        withOriginClientId({ input, previewToken })
    );
}

export function getMusicMetadataOperations(musicId: string) {
    return graphQuery<{
        musicMetadataOperations: MusicMetadataOperation[];
    }, { musicId: string }>(
        `query MusicMetadataOperations($musicId: ID!) {
            musicMetadataOperations(musicId: $musicId) {
                operationId
                status
                retryable
                errorCode
                errorMessage
                music {
                    id
                    name
                }
                targets {
                    fileId
                    filePath
                    status
                    errorCode
                    errorMessage
                }
                createdAt
                updatedAt
            }
        }`,
        { musicId }
    );
}

export function retryMusicMetadataOperation(operationId: string) {
    return graphQuery<{
        retryMusicMetadataOperation: MusicMetadataOperation;
    }, { operationId: string } & OriginClientVariables>(
        `mutation RetryMusicMetadataOperation($operationId: ID!, $originClientId: String) {
            retryMusicMetadataOperation(operationId: $operationId, originClientId: $originClientId) {
                operationId
                status
                retryable
                errorCode
                errorMessage
                music {
                    id
                    name
                }
                targets {
                    fileId
                    filePath
                    status
                    errorCode
                    errorMessage
                }
                createdAt
                updatedAt
            }
        }`,
        withOriginClientId({ operationId })
    );
}

export function recoverMusicMetadataOperation(operationId: string) {
    return graphQuery<{
        recoverMusicMetadataOperation: MusicMetadataOperation;
    }, { operationId: string } & OriginClientVariables>(
        `mutation RecoverMusicMetadataOperation($operationId: ID!, $originClientId: String) {
            recoverMusicMetadataOperation(operationId: $operationId, originClientId: $originClientId) {
                operationId
                status
                retryable
                errorCode
                errorMessage
                music {
                    id
                    name
                }
                targets {
                    fileId
                    filePath
                    status
                    errorCode
                    errorMessage
                }
                createdAt
                updatedAt
            }
        }`,
        withOriginClientId({ operationId })
    );
}

export function setPreferredMusicFile(input: {
    musicId: string;
    fileId: string | null;
}) {
    return graphQuery<{
        setPreferredMusicFile: Pick<Music, 'id' | 'name'>;
    }, typeof input & OriginClientVariables>(
        `mutation SetPreferredMusicFile($musicId: ID!, $fileId: ID, $originClientId: String) {
            setPreferredMusicFile(musicId: $musicId, fileId: $fileId, originClientId: $originClientId) {
                id
                name
            }
        }`,
        withOriginClientId(input)
    );
}

export function groupMusicAsAlternateFile(input: {
    musicId: string;
    targetMusicId: string;
}) {
    return graphQuery<{
        groupMusicAsAlternateFile: Pick<Music, 'id' | 'name'>;
    }, typeof input & OriginClientVariables>(
        `mutation GroupMusicAsAlternateFile($musicId: ID!, $targetMusicId: ID!, $originClientId: String) {
            groupMusicAsAlternateFile(musicId: $musicId, targetMusicId: $targetMusicId, originClientId: $originClientId) {
                id
                name
            }
        }`,
        withOriginClientId(input)
    );
}

export function ungroupMusicFile(input: { musicId: string; fileId: string }) {
    return graphQuery<{
        ungroupMusicFile: Pick<Music, 'id' | 'name'>;
    }, typeof input & OriginClientVariables>(
        `mutation UngroupMusicFile($musicId: ID!, $fileId: ID!, $originClientId: String) {
            ungroupMusicFile(musicId: $musicId, fileId: $fileId, originClientId: $originClientId) {
                id
                name
            }
        }`,
        withOriginClientId(input)
    );
}

export function linkMusicRecordings(input: {
    musicId: string;
    targetMusicId: string;
}) {
    return graphQuery<{
        linkMusicRecordings: Pick<Music, 'id' | 'name'>;
    }, typeof input & OriginClientVariables>(
        `mutation LinkMusicRecordings($musicId: ID!, $targetMusicId: ID!, $originClientId: String) {
            linkMusicRecordings(musicId: $musicId, targetMusicId: $targetMusicId, originClientId: $originClientId) {
                id
                name
            }
        }`,
        withOriginClientId(input)
    );
}

export function unlinkMusicRecording(input: { musicId: string }) {
    return graphQuery<{
        unlinkMusicRecording: Pick<Music, 'id' | 'name'>;
    }, typeof input & OriginClientVariables>(
        `mutation UnlinkMusicRecording($musicId: ID!, $originClientId: String) {
            unlinkMusicRecording(musicId: $musicId, originClientId: $originClientId) {
                id
                name
            }
        }`,
        withOriginClientId(input)
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
    skipCount: number;
    lastSkippedAt: string | null;
    completionCount: number;
    lastCompletedAt: string | null;
    countedAsPlay: boolean;
    completionRate: number;
    outcome: 'listen' | 'skip' | 'complete' | 'legacy';
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
                skipCount
                lastSkippedAt
                completionCount
                lastCompletedAt
                countedAsPlay
                completionRate
                outcome
                deduped
            }
        }`,
        withOriginClientId({ input })
    );
}
