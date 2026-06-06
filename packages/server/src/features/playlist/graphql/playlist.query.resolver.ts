import type { IResolvers } from '@graphql-tools/utils';

import models, { type Playlist } from '~/models';

type PlaylistQueryResolvers = NonNullable<IResolvers['Query']>;

export const playlistQueryResolvers: PlaylistQueryResolvers = {
    allPlaylist: () => models.playlist.findMany({
        orderBy: [
            { order: 'asc' },
            { createdAt: 'desc' }
        ]
    }),
    playlist: (_, { id }: Playlist) => models.playlist.findUnique({ where: { id: Number(id) } })
};
