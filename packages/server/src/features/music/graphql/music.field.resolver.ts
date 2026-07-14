import type { IResolvers } from '@graphql-tools/utils';

import models, { type Music } from '~/models';

type MusicFieldResolvers = NonNullable<IResolvers['Music']>;

export const musicFieldResolvers: MusicFieldResolvers = {
    hasMetadataOverride: (music: Music) => Boolean(music.metadataOverride),
    artist: (music: Music) => models.artist.findUnique({ where: { id: music.artistId } }),
    album: (music: Music) => models.album.findUnique({ where: { id: music.albumId } }),
    genres: (music: Music) => models.genre.findMany({ where: { Music: { some: { id: music.id } } } }),
    tags: (music: Music) => models.tag.findMany({
        where: { MusicTag: { some: { musicId: music.id } } },
        orderBy: [
            { order: 'asc' },
            { name: 'asc' }
        ]
    }),
    isLiked: (music: Music) => models.musicLike.findFirst({ where: { musicId: music.id } }).then((like) => !!like),
    isHated: (music: Music) => models.musicHate.findFirst({ where: { musicId: music.id } }).then((hate) => !!hate)
};
