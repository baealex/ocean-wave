import models, { type Playlist } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

export const PLAYLIST_ERROR_CODE = {
    invalidPlaylistId: 'INVALID_PLAYLIST_ID',
    invalidMusicId: 'INVALID_MUSIC_ID',
    invalidPlaylistName: 'INVALID_PLAYLIST_NAME',
    playlistNotFound: 'PLAYLIST_NOT_FOUND'
} as const;

export class PlaylistServiceError extends Error {
    code: typeof PLAYLIST_ERROR_CODE[keyof typeof PLAYLIST_ERROR_CODE];

    constructor(code: typeof PLAYLIST_ERROR_CODE[keyof typeof PLAYLIST_ERROR_CODE], message: string) {
        super(message);
        this.name = 'PlaylistServiceError';
        this.code = code;
    }
}

export interface PlaylistDeleteResult {
    id: string;
}

export interface PlaylistUpdateResult {
    id: string;
    name: string;
}

export interface PlaylistOrderResult {
    ids: string[];
}

export interface PlaylistMusicChangeResult {
    id: string;
    musicIds: string[];
    musicCount: number;
    headerMusics: Array<{ id: string }>;
}

export interface PlaylistMoveMusicResult {
    fromId: string;
    formHeaderMusics: Array<{ id: string }>;
    toId: string;
    toMusicCount: number;
    toHeaderMusics: Array<{ id: string }>;
    musicIds: string[];
}

export interface PlaylistMusicOrderResult {
    id: string;
    musicIds: string[];
    headerMusics: Array<{ id: string }>;
}

const parseId = (
    value: string | number,
    errorCode: typeof PLAYLIST_ERROR_CODE.invalidPlaylistId | typeof PLAYLIST_ERROR_CODE.invalidMusicId,
    errorMessage: string
) => {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new PlaylistServiceError(errorCode, errorMessage);
    }

    return id;
};

const parseIds = (
    values: Array<string | number>,
    errorCode: typeof PLAYLIST_ERROR_CODE.invalidPlaylistId | typeof PLAYLIST_ERROR_CODE.invalidMusicId,
    errorMessage: string
) => values.map((value) => parseId(value, errorCode, errorMessage));

const getPlaylistOrThrow = async (playlistId: number) => {
    const playlist = await models.playlist.findUnique({ where: { id: playlistId } });

    if (!playlist) {
        throw new PlaylistServiceError(PLAYLIST_ERROR_CODE.playlistNotFound, 'Playlist not found.');
    }

    return playlist;
};

const getHeaderMusics = async (playlistId: number) => {
    const headerMusics = await models.playlistMusic.findMany({
        where: {
            playlistId,
            Music: { syncStatus: TRACK_SYNC_STATUS.active }
        },
        take: 4,
        orderBy: { order: 'asc' }
    });

    return headerMusics.map((music) => ({ id: music.musicId.toString() }));
};

const getActiveMusicCount = (playlistId: number) => models.music.count({
    where: {
        PlaylistMusic: { some: { playlistId } },
        syncStatus: TRACK_SYNC_STATUS.active
    }
});

export const createPlaylist = async ({
    name,
    musicIds = []
}: {
    name: string;
    musicIds?: string[];
}): Promise<Playlist> => {
    const playlistName = name.trim();

    if (!playlistName) {
        throw new PlaylistServiceError(PLAYLIST_ERROR_CODE.invalidPlaylistName, 'Playlist name is invalid.');
    }

    const parsedMusicIds = parseIds(musicIds, PLAYLIST_ERROR_CODE.invalidMusicId, 'Music id is invalid.');

    return models.playlist.create({
        data: {
            name: playlistName,
            PlaylistMusic: {
                create: parsedMusicIds.map((musicId, index) => ({
                    order: index,
                    musicId
                }))
            }
        }
    });
};


export const resolvePlaylistSummary = async (playlist: Playlist) => ({
    ...playlist,
    id: playlist.id.toString(),
    musicCount: await getActiveMusicCount(playlist.id),
    headerMusics: await getHeaderMusics(playlist.id)
});

export const deletePlaylist = async ({ id }: { id: string }): Promise<PlaylistDeleteResult> => {
    const playlistId = parseId(id, PLAYLIST_ERROR_CODE.invalidPlaylistId, 'Playlist id is invalid.');

    await getPlaylistOrThrow(playlistId);

    await models.$transaction([
        models.playlistMusic.deleteMany({ where: { playlistId } }),
        models.playlist.delete({ where: { id: playlistId } })
    ]);

    return { id: playlistId.toString() };
};

export const renamePlaylist = async ({
    id,
    name
}: {
    id: string;
    name: string;
}): Promise<PlaylistUpdateResult> => {
    const playlistId = parseId(id, PLAYLIST_ERROR_CODE.invalidPlaylistId, 'Playlist id is invalid.');
    const playlistName = name.trim();

    if (!playlistName) {
        throw new PlaylistServiceError(PLAYLIST_ERROR_CODE.invalidPlaylistName, 'Playlist name is invalid.');
    }

    await getPlaylistOrThrow(playlistId);

    const playlist = await models.playlist.update({
        where: { id: playlistId },
        data: { name: playlistName }
    });

    return {
        id: playlist.id.toString(),
        name: playlist.name
    };
};

export const reorderPlaylists = async ({ ids }: { ids: string[] }): Promise<PlaylistOrderResult> => {
    if (!ids.length) {
        return { ids: [] };
    }

    const playlistIds = parseIds(ids, PLAYLIST_ERROR_CODE.invalidPlaylistId, 'Playlist id is invalid.');
    const playlists = await models.playlist.findMany({ where: { id: { in: playlistIds } } });

    await models.$transaction(playlists.map((playlist) => {
        const order = ids.indexOf(playlist.id.toString());

        return models.playlist.update({
            where: { id: playlist.id },
            data: { order }
        });
    }));

    return { ids };
};

export const addMusicToPlaylist = async ({
    id,
    musicIds
}: {
    id: string;
    musicIds: string[];
}): Promise<PlaylistMusicChangeResult> => {
    const playlistId = parseId(id, PLAYLIST_ERROR_CODE.invalidPlaylistId, 'Playlist id is invalid.');
    const parsedMusicIds = parseIds(musicIds, PLAYLIST_ERROR_CODE.invalidMusicId, 'Music id is invalid.');

    if (!parsedMusicIds.length) {
        return {
            id,
            musicIds,
            musicCount: await getActiveMusicCount(playlistId),
            headerMusics: await getHeaderMusics(playlistId)
        };
    }

    await getPlaylistOrThrow(playlistId);

    const lastOrder = await models.playlistMusic.findFirst({
        where: { playlistId },
        orderBy: { order: 'desc' }
    });

    for (const [index, musicId] of parsedMusicIds.entries()) {
        const existing = await models.playlistMusic.findFirst({
            where: {
                playlistId,
                musicId
            }
        });

        if (existing) {
            continue;
        }

        await models.playlistMusic.create({
            data: {
                order: lastOrder ? lastOrder.order + index + 1 : index,
                playlistId,
                musicId
            }
        });
    }

    return {
        id,
        musicIds,
        musicCount: await getActiveMusicCount(playlistId),
        headerMusics: await getHeaderMusics(playlistId)
    };
};

export const moveMusicToPlaylist = async ({
    fromId,
    toId,
    musicIds
}: {
    fromId: string;
    toId: string;
    musicIds: string[];
}): Promise<PlaylistMoveMusicResult> => {
    const fromPlaylistId = parseId(fromId, PLAYLIST_ERROR_CODE.invalidPlaylistId, 'Source playlist id is invalid.');
    const toPlaylistId = parseId(toId, PLAYLIST_ERROR_CODE.invalidPlaylistId, 'Target playlist id is invalid.');
    const parsedMusicIds = parseIds(musicIds, PLAYLIST_ERROR_CODE.invalidMusicId, 'Music id is invalid.');

    await Promise.all([
        getPlaylistOrThrow(fromPlaylistId),
        getPlaylistOrThrow(toPlaylistId)
    ]);

    await models.playlistMusic.deleteMany({
        where: {
            playlistId: fromPlaylistId,
            musicId: { in: parsedMusicIds }
        }
    });

    const lastOrder = await models.playlistMusic.findFirst({
        where: { playlistId: toPlaylistId },
        orderBy: { order: 'desc' }
    });

    for (const [index, musicId] of parsedMusicIds.entries()) {
        const existing = await models.playlistMusic.findFirst({
            where: {
                playlistId: toPlaylistId,
                musicId
            }
        });

        if (existing) {
            continue;
        }

        await models.playlistMusic.create({
            data: {
                order: lastOrder ? lastOrder.order + index + 1 : index,
                playlistId: toPlaylistId,
                musicId
            }
        });
    }

    return {
        fromId,
        formHeaderMusics: await getHeaderMusics(fromPlaylistId),
        toId,
        toMusicCount: await getActiveMusicCount(toPlaylistId),
        toHeaderMusics: await getHeaderMusics(toPlaylistId),
        musicIds
    };
};

export const removeMusicFromPlaylist = async ({
    id,
    musicIds
}: {
    id: string;
    musicIds: string[];
}): Promise<PlaylistMusicChangeResult> => {
    const playlistId = parseId(id, PLAYLIST_ERROR_CODE.invalidPlaylistId, 'Playlist id is invalid.');
    const parsedMusicIds = parseIds(musicIds, PLAYLIST_ERROR_CODE.invalidMusicId, 'Music id is invalid.');

    await getPlaylistOrThrow(playlistId);

    await models.playlistMusic.deleteMany({
        where: {
            playlistId,
            musicId: { in: parsedMusicIds }
        }
    });

    return {
        id,
        musicIds,
        musicCount: await getActiveMusicCount(playlistId),
        headerMusics: await getHeaderMusics(playlistId)
    };
};

export const reorderPlaylistMusics = async ({
    id,
    musicIds
}: {
    id: string;
    musicIds: string[];
}): Promise<PlaylistMusicOrderResult> => {
    const playlistId = parseId(id, PLAYLIST_ERROR_CODE.invalidPlaylistId, 'Playlist id is invalid.');

    await getPlaylistOrThrow(playlistId);

    const playlistMusics = await models.playlistMusic.findMany({
        where: { playlistId },
        orderBy: { order: 'asc' }
    });

    await models.$transaction(playlistMusics.map((playlistMusic) => {
        const order = musicIds.indexOf(playlistMusic.musicId.toString());

        return models.playlistMusic.update({
            where: { id: playlistMusic.id },
            data: { order }
        });
    }));

    return {
        id,
        musicIds,
        headerMusics: await getHeaderMusics(playlistId)
    };
};

export const isPlaylistServiceError = (error: unknown): error is PlaylistServiceError => {
    return error instanceof PlaylistServiceError;
};
