import type { IResolvers } from '@graphql-tools/utils';

import models, { type Artist } from '~/models';
import { gql } from '~/modules/graphql';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import { albumType } from '../album';
import { musicType } from '../../features/music/graphql';

export const artistType: string = gql`
    type Artist {
        id: ID!
        name: String!
        latestAlbum: Album
        createdAt: String!
        albums: [Album!]!
        albumCount: Int!
        musics: [Music!]!
        musicCount: Int!
    }

    ${albumType}

    ${musicType}
`;

export const artistQuery = gql`
    type Query {
        allArtists: [Artist!]!
        artist(id: ID!): Artist!
    }
`;

export const artistTypeDefs = `
    ${artistType}
    ${artistQuery}
`;

export const artistResolvers: IResolvers = {
    Query: {
        allArtists: () => models.artist.findMany({
            where: { Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } } },
            orderBy: { Music: { _count: 'desc' } }
        }),
        artist: (_, { id }: Artist) => models.artist.findUnique({ where: { id: Number(id) } })
    },
    Artist: {
        latestAlbum: (artist: Artist) => models.album.findFirst({
            where: {
                artistId: artist.id,
                Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
            },
            orderBy: { publishedYear: 'desc' }
        }),
        albums: (artist: Artist) => models.album.findMany({
            where: {
                artistId: artist.id,
                Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
            },
            orderBy: { publishedYear: 'desc' }
        }),
        musics: (artist: Artist) => models.music.findMany({
            where: {
                artistId: artist.id,
                syncStatus: TRACK_SYNC_STATUS.active
            },
            orderBy: { playCount: 'desc' }
        }),
        albumCount: (artist: Artist) => models.album.count({
            where: {
                artistId: artist.id,
                Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
            }
        }),
        musicCount: (artist: Artist) => models.music.count({
            where: {
                artistId: artist.id,
                syncStatus: TRACK_SYNC_STATUS.active
            }
        })
    }
};
