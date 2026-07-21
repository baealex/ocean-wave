import type { IResolvers } from '@graphql-tools/utils';

import { connectors } from '~/socket/connectors';
import {
    MUSIC_COUNT,
    MUSIC_HATE,
    MUSIC_LIKE,
    MUSIC_UPDATED
} from '~/socket/music';
import { withOriginClientId } from '~/socket/origin-client';
import {
    isMusicMetadataServiceError,
    recoverMusicMetadataOperation,
    retryMusicMetadataOperation,
    updateMusicMetadata
} from '../services/metadata-editor';
import { recordPlayback } from '../services/playback-records';
import {
    isMusicPreferenceServiceError,
    setMusicHated,
    setMusicLiked
} from '../services/preferences';
import {
    groupMusicAsAlternateFile,
    isMusicVersionServiceError,
    linkMusicRecordings,
    setPreferredMusicFile,
    ungroupMusicFile,
    unlinkMusicRecording
} from '../services/version-groups';

class MusicGraphQLError extends Error {
    extensions: {
        code: string;
    };

    constructor(message: string, code: string) {
        super(message);
        this.name = 'MusicGraphQLError';
        this.extensions = { code };
    }
}

const toGraphQLError = (error: unknown) => {
    if (isMusicMetadataServiceError(error)) {
        return new MusicGraphQLError(error.message, error.code);
    }

    if (isMusicPreferenceServiceError(error)) {
        return new MusicGraphQLError(error.message, error.code);
    }

    if (isMusicVersionServiceError(error)) {
        return new MusicGraphQLError(error.message, error.code);
    }

    return error;
};


const notifySafely = async (callback: () => Promise<void> | void) => {
    try {
        await callback();
    } catch (error) {
        console.error(error);
    }
};

const withMusicErrorHandling = async <T>(callback: () => Promise<T>) => {
    try {
        return await callback();
    } catch (error) {
        throw toGraphQLError(error);
    }
};

export const createSetMusicLikedMutationResolver = (
    setLiked = setMusicLiked
) => {
    return async (_: unknown, {
        id,
        isLiked,
        originClientId
    }: { id: string; isLiked: boolean; originClientId?: string | null }) => withMusicErrorHandling(async () => {
        const result = await setLiked({ id, isLiked });

        await notifySafely(() => connectors.notify(MUSIC_LIKE, withOriginClientId(result, originClientId)));

        return result;
    });
};

export const createSetMusicHatedMutationResolver = (
    setHated = setMusicHated
) => {
    return async (_: unknown, {
        id,
        isHated,
        originClientId
    }: { id: string; isHated: boolean; originClientId?: string | null }) => withMusicErrorHandling(async () => {
        const result = await setHated({ id, isHated });

        await notifySafely(() => connectors.notify(MUSIC_HATE, withOriginClientId(result, originClientId)));

        return result;
    });
};


export const createRecordPlaybackMutationResolver = (
    record = recordPlayback
) => {
    return async (_: unknown, {
        input,
        originClientId
    }: { input: Parameters<typeof recordPlayback>[0]; originClientId?: string | null }) => withMusicErrorHandling(async () => {
        const result = await record(input);

        if (result && !result.deduped) {
            await notifySafely(() => connectors.notify(MUSIC_COUNT, withOriginClientId(result, originClientId)));
        }

        return result;
    });
};

export const createUpdateMusicMetadataMutationResolver = (
    updateMetadata = updateMusicMetadata
) => {
    return async (_: unknown, {
        input,
        previewToken,
        originClientId
    }: {
        input: Parameters<typeof updateMusicMetadata>[0];
        previewToken: string;
        originClientId?: string | null;
    }) => withMusicErrorHandling(async () => {
        const result = await updateMetadata(input, previewToken);

        if (result.music) {
            await notifySafely(() => connectors.notify(MUSIC_UPDATED, withOriginClientId({
                musicId: result.music!.id.toString()
            }, originClientId)));
        }

        return result;
    });
};

export const createRetryMusicMetadataOperationMutationResolver = (
    retryOperation = retryMusicMetadataOperation
) => async (_: unknown, {
    operationId,
    originClientId
}: {
    operationId: string;
    originClientId?: string | null;
}) => withMusicErrorHandling(async () => {
    const result = await retryOperation(operationId);

    if (result.music) {
        await notifySafely(() => connectors.notify(MUSIC_UPDATED, withOriginClientId({
            musicId: result.music!.id.toString()
        }, originClientId)));
    }

    return result;
});

export const createRecoverMusicMetadataOperationMutationResolver = (
    recoverOperation = recoverMusicMetadataOperation
) => async (_: unknown, {
    operationId,
    originClientId
}: {
    operationId: string;
    originClientId?: string | null;
}) => withMusicErrorHandling(async () => {
    const result = await recoverOperation(operationId);

    if (result.music) {
        await notifySafely(() => connectors.notify(MUSIC_UPDATED, withOriginClientId({
            musicId: result.music!.id.toString()
        }, originClientId)));
    }

    return result;
});

const createMusicVersionMutationResolver = <Input extends object>(
    mutate: (input: Input) => Promise<{ id: number }>
) => {
    return async (_: unknown, {
        originClientId,
        ...input
    }: Input & { originClientId?: string | null }) => withMusicErrorHandling(async () => {
        const result = await mutate(input as Input);

        await notifySafely(() => connectors.notify(MUSIC_UPDATED, withOriginClientId({
            musicId: result.id.toString()
        }, originClientId)));

        return result;
    });
};

type MusicMutationResolvers = NonNullable<IResolvers['Mutation']>;

export const musicMutationResolvers: MusicMutationResolvers = {
    setMusicLiked: createSetMusicLikedMutationResolver(),
    setMusicHated: createSetMusicHatedMutationResolver(),
    updateMusicMetadata: createUpdateMusicMetadataMutationResolver(),
    retryMusicMetadataOperation: createRetryMusicMetadataOperationMutationResolver(),
    recoverMusicMetadataOperation: createRecoverMusicMetadataOperationMutationResolver(),
    setPreferredMusicFile: createMusicVersionMutationResolver(setPreferredMusicFile),
    groupMusicAsAlternateFile: createMusicVersionMutationResolver(groupMusicAsAlternateFile),
    ungroupMusicFile: createMusicVersionMutationResolver(ungroupMusicFile),
    linkMusicRecordings: createMusicVersionMutationResolver(linkMusicRecordings),
    unlinkMusicRecording: createMusicVersionMutationResolver(unlinkMusicRecording),
    recordPlayback: createRecordPlaybackMutationResolver()
};
