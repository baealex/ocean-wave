import type { IResolvers } from '@graphql-tools/utils';

import { connectors } from '~/socket/connectors';
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
    resolvePlaylistSummary,
    reorderPlaylistMusics,
    reorderPlaylists
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
    return async (_: unknown, { name, musicIds = [] }: { name: string; musicIds?: string[] }) => withPlaylistErrorHandling(async () => {
        const playlist = await create({ name, musicIds });

        connectors.broadcast(PLAYLIST_CREATE, await resolvePlaylistSummary(playlist));

        return playlist;
    });
};

export const createDeletePlaylistMutationResolver = (
    deleteById = deletePlaylist
) => {
    return async (_: unknown, { id }: { id: string }) => withPlaylistErrorHandling(async () => {
        const result = await deleteById({ id });

        connectors.broadcast(PLAYLIST_DELETE, result.id);

        return result;
    });
};

export const createRenamePlaylistMutationResolver = (
    rename = renamePlaylist
) => {
    return async (_: unknown, { id, name }: { id: string; name: string }) => withPlaylistErrorHandling(async () => {
        const result = await rename({ id, name });

        connectors.broadcast(PLAYLIST_UPDATE, result);

        return result;
    });
};

export const createReorderPlaylistsMutationResolver = (
    reorder = reorderPlaylists
) => {
    return async (_: unknown, { ids }: { ids: string[] }) => withPlaylistErrorHandling(async () => {
        const result = await reorder({ ids });

        connectors.broadcast(PLAYLIST_CHANGE_ORDER, result.ids);

        return result;
    });
};

export const createAddMusicToPlaylistMutationResolver = (
    add = addMusicToPlaylist
) => {
    return async (_: unknown, { id, musicIds }: { id: string; musicIds: string[] }) => withPlaylistErrorHandling(async () => {
        const result = await add({ id, musicIds });

        connectors.broadcast(PLAYLIST_ADD_MUSIC, result);

        return result;
    });
};

export const createMoveMusicToPlaylistMutationResolver = (
    move = moveMusicToPlaylist
) => {
    return async (_: unknown, { fromId, toId, musicIds }: { fromId: string; toId: string; musicIds: string[] }) => withPlaylistErrorHandling(async () => {
        const result = await move({ fromId, toId, musicIds });

        connectors.broadcast(PLAYLIST_MOVE_MUSIC, result);

        return result;
    });
};

export const createRemoveMusicFromPlaylistMutationResolver = (
    remove = removeMusicFromPlaylist
) => {
    return async (_: unknown, { id, musicIds }: { id: string; musicIds: string[] }) => withPlaylistErrorHandling(async () => {
        const result = await remove({ id, musicIds });

        connectors.broadcast(PLAYLIST_REMOVE_MUSIC, result);

        return result;
    });
};

export const createReorderPlaylistMusicsMutationResolver = (
    reorder = reorderPlaylistMusics
) => {
    return async (_: unknown, { id, musicIds }: { id: string; musicIds: string[] }) => withPlaylistErrorHandling(async () => {
        const result = await reorder({ id, musicIds });

        connectors.broadcast(PLAYLIST_CHANGE_MUSIC_ORDER, result);

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
