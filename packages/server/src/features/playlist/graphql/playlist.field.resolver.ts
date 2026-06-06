import type { IResolvers } from '@graphql-tools/utils';

import models, { type Playlist } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

type PlaylistFieldResolvers = NonNullable<IResolvers['Playlist']>;

export const playlistFieldResolvers: PlaylistFieldResolvers = {
    musics: async (playlist: Playlist) => {
        const musics = await models.playlistMusic.findMany({
            where: {
                playlistId: playlist.id,
                Music: { syncStatus: TRACK_SYNC_STATUS.active }
            },
            orderBy: { order: 'asc' },
            include: { Music: true }
        });
        return musics.map((playlistMusic) => playlistMusic.Music);
    },
    headerMusics: async (playlist: Playlist & { headerMusics?: Array<{ id: string }> }) => {
        if (playlist.headerMusics) {
            return playlist.headerMusics;
        }

        const musics = await models.playlistMusic.findMany({
            where: {
                playlistId: playlist.id,
                Music: { syncStatus: TRACK_SYNC_STATUS.active }
            },
            orderBy: { order: 'asc' },
            include: { Music: true },
            take: 4
        });
        return musics.map((playlistMusic) => playlistMusic.Music);
    },
    musicCount: (playlist: Playlist) => models.music.count({
        where: {
            PlaylistMusic: { some: { playlistId: playlist.id } },
            syncStatus: TRACK_SYNC_STATUS.active
        }
    })
};
