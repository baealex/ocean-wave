import type { Socket } from 'socket.io';

import {
    addMusicToPlaylist,
    createPlaylist,
    deletePlaylist,
    moveMusicToPlaylist,
    removeMusicFromPlaylist,
    renamePlaylist,
    reorderPlaylistMusics,
    reorderPlaylists,
    resolvePlaylistSummary
} from '~/features/playlist/services/playlists';

import { connectors } from './connectors';

export const PLAYLIST_CREATE = 'playlist-create';
export const PLAYLIST_DELETE = 'playlist-delete';
export const PLAYLIST_UPDATE = 'playlist-update';
export const PLAYLIST_CHANGE_ORDER = 'playlist-change-order';
export const PLAYLIST_ADD_MUSIC = 'playlist-add-music';
export const PLAYLIST_MOVE_MUSIC = 'playlist-move-music';
export const PLAYLIST_REMOVE_MUSIC = 'playlist-remove-music';
export const PLAYLIST_CHANGE_MUSIC_ORDER = 'playlist-change-music-order';

type PlaylistCreatePayload = {
    name?: string;
    musics?: string[];
};

type PlaylistIdPayload = {
    id?: string;
};

type PlaylistUpdatePayload = PlaylistIdPayload & {
    name?: string;
};

type PlaylistMusicIdsPayload = PlaylistIdPayload & {
    musicIds?: string[];
};

type PlaylistMoveMusicPayload = {
    toId?: string;
    fromId?: string;
    musicIds?: string[];
};

type PlaylistOrderPayload = {
    ids?: string[];
};

export const playlistListener = (socket: Socket) => {
    socket.on(PLAYLIST_CREATE, handleCreatePlaylist);
    socket.on(PLAYLIST_DELETE, handleDeletePlaylist);
    socket.on(PLAYLIST_UPDATE, handleUpdatePlaylist);
    socket.on(PLAYLIST_CHANGE_ORDER, handleChangePlaylistOrder);
    socket.on(PLAYLIST_ADD_MUSIC, handleAddMusicToPlaylist);
    socket.on(PLAYLIST_MOVE_MUSIC, handleMoveMusicToPlaylist);
    socket.on(PLAYLIST_REMOVE_MUSIC, handleRemoveMusicFromPlaylist);
    socket.on(PLAYLIST_CHANGE_MUSIC_ORDER, handleChangePlaylistMusicOrder);
};

const handleCreatePlaylist = async ({ name = '', musics = [] }: PlaylistCreatePayload) => {
    const playlist = await createPlaylist({ name, musicIds: musics });

    connectors.notify(PLAYLIST_CREATE, await resolvePlaylistSummary(playlist));
};

const handleDeletePlaylist = async ({ id = '' }: PlaylistIdPayload) => {
    try {
        const result = await deletePlaylist({ id });

        connectors.notify(PLAYLIST_DELETE, result.id);
    } catch (e) {
        console.error(e);
    }
};

const handleChangePlaylistMusicOrder = async ({ id = '', musicIds = [] }: PlaylistMusicIdsPayload) => {
    if (!id || !musicIds.length) {
        return;
    }

    const result = await reorderPlaylistMusics({ id, musicIds });

    connectors.notify(PLAYLIST_CHANGE_MUSIC_ORDER, result);
};

const handleUpdatePlaylist = async ({
    id = '',
    name = ''
}: PlaylistUpdatePayload) => {
    if (!id || !name) {
        return;
    }

    const result = await renamePlaylist({ id, name });

    connectors.notify(PLAYLIST_UPDATE, result);
};

const handleAddMusicToPlaylist = async ({
    id = '',
    musicIds = []
}: PlaylistMusicIdsPayload) => {
    if (!id || !musicIds.length) {
        return;
    }

    const result = await addMusicToPlaylist({ id, musicIds });

    connectors.notify(PLAYLIST_ADD_MUSIC, result);
};

const handleMoveMusicToPlaylist = async ({
    toId = '',
    fromId = '',
    musicIds = []
}: PlaylistMoveMusicPayload) => {
    if (!toId || !fromId || !musicIds.length) {
        return;
    }

    const result = await moveMusicToPlaylist({ fromId, toId, musicIds });

    connectors.notify(PLAYLIST_MOVE_MUSIC, result);
};

const handleRemoveMusicFromPlaylist = async ({
    id = '',
    musicIds = []
}: PlaylistMusicIdsPayload) => {
    if (!id || !musicIds.length) {
        return;
    }

    const result = await removeMusicFromPlaylist({ id, musicIds });

    connectors.notify(PLAYLIST_REMOVE_MUSIC, result);
};

const handleChangePlaylistOrder = async ({ ids = [] }: PlaylistOrderPayload) => {
    if (!ids.length) {
        return;
    }

    const result = await reorderPlaylists({ ids });

    connectors.notify(PLAYLIST_CHANGE_ORDER, result.ids);
};
