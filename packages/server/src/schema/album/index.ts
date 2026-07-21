import type { IResolvers } from '@graphql-tools/utils';

import models, { type Album } from '~/models';
import { getVersionedAlbumCoverPath } from '~/modules/album-cover-cache';
import {
    formatArtistCredits,
    getReleaseArtistCredits,
    toArtistCreditGraphQL,
    type ArtistCreditWithArtist
} from '~/modules/artist-credits';
import { gql } from '~/modules/graphql';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import { artistType } from '../artist';
import { artistCreditType } from '../artist-credit';
import { musicType } from '../../features/music/graphql';

export const albumType: string = gql`
    type Album {
        id: ID!
        name: String!
        cover: String!
        isCoverCustom: Boolean!
        artist: Artist! @deprecated(reason: "Use artistCredits or artistDisplayName; removal is planned for the next breaking schema version.")
        artistDisplayName: String!
        artistCredits: [ArtistCredit!]!
        publishedYear: String!
        createdAt: String!
        musics: [Music!]!
    }
    
    ${artistType}

    ${musicType}

    ${artistCreditType}
`;

export const albumQuery = gql`
    type Query {
        allAlbums: [Album!]!
        album(id: ID!): Album!
    }
`;

export const albumTypeDefs = `
    ${albumType}
    ${albumQuery}
`;

const artistCreditRequests = new WeakMap<object, Promise<ArtistCreditWithArtist[]>>();

const getArtistCredits = (album: Album) => {
    const existingRequest = artistCreditRequests.get(album);

    if (existingRequest) {
        return existingRequest;
    }

    const request = getReleaseArtistCredits(album.id);
    artistCreditRequests.set(album, request);
    return request;
};

export const albumResolvers: IResolvers = {
    Query: {
        allAlbums: () => models.album.findMany({
            where: { Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } } },
            orderBy: { name: 'asc' }
        }),
        album: (_, { id }: Album) => models.album.findUnique({ where: { id: Number(id) } })
    },
    Album: {
        cover: (album: Album) => {
            return album.cover
                ? getVersionedAlbumCoverPath(album.id, album.updatedAt)
                : '';
        },
        artist: (album: Album) => models.artist.findUnique({ where: { id: album.artistId } }),
        artistDisplayName: async (album: Album) => formatArtistCredits(await getArtistCredits(album)),
        artistCredits: async (album: Album) => (
            (await getArtistCredits(album)).map(toArtistCreditGraphQL)
        ),
        musics: (album: Album) => models.music.findMany({
            where: {
                Album: { id: album.id },
                syncStatus: TRACK_SYNC_STATUS.active
            },
            orderBy: { trackNumber: 'asc' }
        })
    }
};
