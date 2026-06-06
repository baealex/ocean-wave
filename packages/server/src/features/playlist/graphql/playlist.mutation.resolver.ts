import type { IResolvers } from '@graphql-tools/utils';

import { connectors } from '~/socket/connectors';
import { withOriginClientId } from '~/socket/origin-client';
import {
    PLAYLIST_ADD_MUSIC,
    PLAYLIST_CHANGE_MUSIC_ORDER,
    PLAYLIST_CHANGE_ORDER,
    PLAYLIST_CREATE,
    PLAYLIST_DELETE,
    PLAYLIST_MOVE_MUSIC,
    PLAYLIST_REMOVE_MUSIC,
    PLAYLIST_UPDATE
} from '~/socket/playlist';

import {
    addMusicToPlaylist,
    createPlaylist,
    deletePlaylist,
    isPlaylistServiceError,
    moveMusicToPlaylist,
    removeMusicFromPlaylist,
    renamePlaylist,
    reorderPlaylistMusics,
    reorderPlaylists,
    resolvePlaylistSummary
} from '../services/playlists';

class PlaylistGraphQLError extends Error {
    extensions: {
        code: string;
    };

    constructor(message: string, code: string) {
        super(message);
        this.name = 'PlaylistGraphQLError';
        this.extensions = { code };
    }
}

const toGraphQLError = (error: unknown) => {
    if (isPlaylistServiceError(error)) {
        return new PlaylistGraphQLError(error.message, error.code);
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

const withPlaylistErrorHandling = async <T>(callback: () => Promise<T>) => {
    try {
        return await callback();
    } catch (error) {
        throw toGraphQLError(error);
    }
};

export const createCreatePlaylistMutationResolver = (
    create = createPlaylist
) => {
    return async (_: unknown, {
        name,
        musicIds = [],
        originClientId
    }: { name: string; musicIds?: string[]; originClientId?: string | null }) => withPlaylistErrorHandling(async () => {
        const playlist = await create({ name, musicIds });

        await notifySafely(async () => {
            connectors.notify(PLAYLIST_CREATE, withOriginClientId(await resolvePlaylistSummary(playlist), originClientId));
        });

        return playlist;
    });
};

export const createDeletePlaylistMutationResolver = (
    deleteById = deletePlaylist
) => {
    return async (_: unknown, {
        id,
        originClientId
    }: { id: string; originClientId?: string | null }) => withPlaylistErrorHandling(async () => {
        const result = await deleteById({ id });

        await notifySafely(() => connectors.notify(PLAYLIST_DELETE, withOriginClientId(result, originClientId)));

        return result;
    });
};

export const createRenamePlaylistMutationResolver = (
    rename = renamePlaylist
) => {
    return async (_: unknown, {
        id,
        name,
        originClientId
    }: { id: string; name: string; originClientId?: string | null }) => withPlaylistErrorHandling(async () => {
        const result = await rename({ id, name });

        await notifySafely(() => connectors.notify(PLAYLIST_UPDATE, withOriginClientId(result, originClientId)));

        return result;
    });
};

export const createReorderPlaylistsMutationResolver = (
    reorder = reorderPlaylists
) => {
    return async (_: unknown, {
        ids,
        originClientId
    }: { ids: string[]; originClientId?: string | null }) => withPlaylistErrorHandling(async () => {
        const result = await reorder({ ids });

        await notifySafely(() => connectors.notify(PLAYLIST_CHANGE_ORDER, withOriginClientId(result, originClientId)));

        return result;
    });
};

export const createAddMusicToPlaylistMutationResolver = (
    add = addMusicToPlaylist
) => {
    return async (_: unknown, {
        id,
        musicIds,
        originClientId
    }: { id: string; musicIds: string[]; originClientId?: string | null }) => withPlaylistErrorHandling(async () => {
        const result = await add({ id, musicIds });

        await notifySafely(() => connectors.notify(PLAYLIST_ADD_MUSIC, withOriginClientId(result, originClientId)));

        return result;
    });
};

export const createMoveMusicToPlaylistMutationResolver = (
    move = moveMusicToPlaylist
) => {
    return async (_: unknown, {
        fromId,
        toId,
        musicIds,
        originClientId
    }: { fromId: string; toId: string; musicIds: string[]; originClientId?: string | null }) => withPlaylistErrorHandling(async () => {
        const result = await move({ fromId, toId, musicIds });

        await notifySafely(() => connectors.notify(PLAYLIST_MOVE_MUSIC, withOriginClientId(result, originClientId)));

        return result;
    });
};

export const createRemoveMusicFromPlaylistMutationResolver = (
    remove = removeMusicFromPlaylist
) => {
    return async (_: unknown, {
        id,
        musicIds,
        originClientId
    }: { id: string; musicIds: string[]; originClientId?: string | null }) => withPlaylistErrorHandling(async () => {
        const result = await remove({ id, musicIds });

        await notifySafely(() => connectors.notify(PLAYLIST_REMOVE_MUSIC, withOriginClientId(result, originClientId)));

        return result;
    });
};

export const createReorderPlaylistMusicsMutationResolver = (
    reorder = reorderPlaylistMusics
) => {
    return async (_: unknown, {
        id,
        musicIds,
        originClientId
    }: { id: string; musicIds: string[]; originClientId?: string | null }) => withPlaylistErrorHandling(async () => {
        const result = await reorder({ id, musicIds });

        await notifySafely(() => connectors.notify(PLAYLIST_CHANGE_MUSIC_ORDER, withOriginClientId(result, originClientId)));

        return result;
    });
};

type PlaylistMutationResolvers = NonNullable<IResolvers['Mutation']>;

export const playlistMutationResolvers: PlaylistMutationResolvers = {
    createPlaylist: createCreatePlaylistMutationResolver(),
    deletePlaylist: createDeletePlaylistMutationResolver(),
    renamePlaylist: createRenamePlaylistMutationResolver(),
    reorderPlaylists: createReorderPlaylistsMutationResolver(),
    addMusicToPlaylist: createAddMusicToPlaylistMutationResolver(),
    moveMusicToPlaylist: createMoveMusicToPlaylistMutationResolver(),
    removeMusicFromPlaylist: createRemoveMusicFromPlaylistMutationResolver(),
    reorderPlaylistMusics: createReorderPlaylistMusicsMutationResolver()
};
