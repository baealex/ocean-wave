import type { IResolvers } from '@graphql-tools/utils';

import models, { type Album, type Release } from '~/models';
import { getVersionedAlbumCoverPath } from '~/modules/album-cover-cache';
import {
    formatArtistCredits,
    getReleaseArtistCredits,
    toArtistCreditGraphQL,
    type ArtistCreditWithArtist
} from '~/modules/artist-credits';
import { gql } from '~/modules/graphql';
import {
    compareReleaseTrackPositions,
    toGraphQLReleaseType
} from '~/modules/release-metadata';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import { artistType } from '../artist';
import { artistCreditType } from '../artist-credit';
import { musicType } from '../../features/music/graphql';

export const albumType: string = gql`
    enum ReleaseType {
        ALBUM
        EP
        SINGLE
        COMPILATION
        LIVE
        UNKNOWN
    }

    type Album {
        id: ID!
        name: String!
        cover: String!
        isCoverCustom: Boolean!
        artist: Artist! @deprecated(reason: "Use artistCredits or artistDisplayName; removal is planned for the next breaking schema version.")
        artistDisplayName: String!
        artistCredits: [ArtistCredit!]!
        publishedYear: String!
        releaseType: ReleaseType!
        totalDiscs: Int
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
const releaseRequests = new WeakMap<object, Promise<Release | null>>();

const getArtistCredits = (album: Album) => {
    const existingRequest = artistCreditRequests.get(album);

    if (existingRequest) {
        return existingRequest;
    }

    const request = getReleaseArtistCredits(album.id);
    artistCreditRequests.set(album, request);
    return request;
};

const getRelease = (album: Album) => {
    const existingRequest = releaseRequests.get(album);

    if (existingRequest) return existingRequest;

    const request = models.release.findUnique({ where: { id: album.id } });
    releaseRequests.set(album, request);
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
        releaseType: async (album: Album) => toGraphQLReleaseType(
            (await getRelease(album))?.releaseType ?? 'unknown'
        ),
        totalDiscs: async (album: Album) => (await getRelease(album))?.totalDiscs ?? null,
        musics: async (album: Album) => {
            const positions = await models.releaseTrack.findMany({
                where: {
                    releaseId: album.id,
                    PhysicalFile: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
                },
                select: {
                    id: true,
                    discNumber: true,
                    trackNumber: true
                }
            });
            const orderedIds = positions
                .sort(compareReleaseTrackPositions)
                .map(({ id }) => id);
            const musics = await models.music.findMany({
                where: {
                    id: { in: orderedIds },
                    syncStatus: TRACK_SYNC_STATUS.active
                }
            });
            const musicById = new Map(musics.map(music => [music.id, music]));

            return orderedIds.flatMap(id => {
                const music = musicById.get(id);
                return music ? [music] : [];
            });
        }
    }
};
