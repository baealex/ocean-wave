import type { IResolvers } from '@graphql-tools/utils';

import { connectors } from '~/socket/connectors';
import {
    MUSIC_COUNT,
    MUSIC_HATE,
    MUSIC_LIKE
} from '~/socket/music';
import { withOriginClientId } from '~/socket/origin-client';
import { recordPlayback } from '../services/playback-records';
import {
    isMusicPreferenceServiceError,
    setMusicHated,
    setMusicLiked
} from '../services/preferences';

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
    if (isMusicPreferenceServiceError(error)) {
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

type MusicMutationResolvers = NonNullable<IResolvers['Mutation']>;

export const musicMutationResolvers: MusicMutationResolvers = {
    setMusicLiked: createSetMusicLikedMutationResolver(),
    setMusicHated: createSetMusicHatedMutationResolver(),
    recordPlayback: createRecordPlaybackMutationResolver()
};
