import type { IResolvers } from '@graphql-tools/utils';

import models, { type Playlist } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

type PlaylistFieldResolvers = NonNullable<IResolvers['Playlist']>;

const findPlaylistMusics = async (playlistId: number, take?: number) => {
    const entries = await models.playlistMusic.findMany({
        where: {
            playlistId,
            ReleaseTrack: {
                PhysicalFile: {
                    some: { syncStatus: TRACK_SYNC_STATUS.active }
                }
            }
        },
        orderBy: { order: 'asc' },
        select: { musicId: true },
        ...(take === undefined ? {} : { take })
    });
    const musicIds = entries.map(entry => entry.musicId);

    if (musicIds.length === 0) {
        return [];
    }

    const musics = await models.music.findMany({
        where: {
            id: { in: musicIds },
            syncStatus: TRACK_SYNC_STATUS.active
        }
    });
    const musicById = new Map(musics.map(music => [music.id, music]));

    return musicIds.flatMap(musicId => {
        const music = musicById.get(musicId);
        return music ? [music] : [];
    });
};

export const playlistFieldResolvers: PlaylistFieldResolvers = {
    musics: (playlist: Playlist) => findPlaylistMusics(playlist.id),
    headerMusics: async (playlist: Playlist & { headerMusics?: Array<{ id: string }> }) => {
        if (playlist.headerMusics) {
            return playlist.headerMusics;
        }

        return findPlaylistMusics(playlist.id, 4);
    },
    musicCount: (playlist: Playlist) => models.playlistMusic.count({
        where: {
            playlistId: playlist.id,
            ReleaseTrack: {
                PhysicalFile: {
                    some: { syncStatus: TRACK_SYNC_STATUS.active }
                }
            }
        }
    })
};
