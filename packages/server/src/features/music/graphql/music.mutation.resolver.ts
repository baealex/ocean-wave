import type { IResolvers } from '@graphql-tools/utils';

import { connectors } from '~/socket/connectors';
import {
    MUSIC_HATE,
    MUSIC_LIKE
} from '~/socket/music';

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
    return async (_: unknown, { id, isLiked }: { id: string; isLiked: boolean }) => withMusicErrorHandling(async () => {
        const result = await setLiked({ id, isLiked });

        connectors.broadcast(MUSIC_LIKE, result);

        return result;
    });
};

export const createSetMusicHatedMutationResolver = (
    setHated = setMusicHated
) => {
    return async (_: unknown, { id, isHated }: { id: string; isHated: boolean }) => withMusicErrorHandling(async () => {
        const result = await setHated({ id, isHated });

        connectors.broadcast(MUSIC_HATE, result);

        return result;
    });
};

type MusicMutationResolvers = NonNullable<IResolvers['Mutation']>;

export const musicMutationResolvers: MusicMutationResolvers = {
    setMusicLiked: createSetMusicLikedMutationResolver(),
    setMusicHated: createSetMusicHatedMutationResolver()
};
