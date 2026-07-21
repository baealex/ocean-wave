import type { IResolvers } from '@graphql-tools/utils';

import models, { type Artist } from '~/models';
import {
    findActiveAlbumIdsForArtist,
    findActiveAppearsOnAlbumIdsForArtist,
    findActiveCreditedArtistIds,
    findActiveMusicIdsForArtist
} from '~/modules/artist-credits';
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
        appearsOn: [Album!]!
        appearsOnCount: Int!
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

const activeMusicIdRequests = new WeakMap<object, Promise<number[]>>();
const activeAlbumIdRequests = new WeakMap<object, Promise<number[]>>();
const activeAppearsOnAlbumIdRequests = new WeakMap<object, Promise<number[]>>();

const getActiveMusicIds = (artist: Artist) => {
    const existingRequest = activeMusicIdRequests.get(artist);

    if (existingRequest) return existingRequest;

    const request = findActiveMusicIdsForArtist(artist.id);
    activeMusicIdRequests.set(artist, request);
    return request;
};

const getActiveAppearsOnAlbumIds = (artist: Artist) => {
    const existingRequest = activeAppearsOnAlbumIdRequests.get(artist);

    if (existingRequest) return existingRequest;

    const request = findActiveAppearsOnAlbumIdsForArtist(artist.id);
    activeAppearsOnAlbumIdRequests.set(artist, request);
    return request;
};

const getActiveAlbumIds = (artist: Artist) => {
    const existingRequest = activeAlbumIdRequests.get(artist);

    if (existingRequest) return existingRequest;

    const request = findActiveAlbumIdsForArtist(artist.id);
    activeAlbumIdRequests.set(artist, request);
    return request;
};

export const artistResolvers: IResolvers = {
    Query: {
        allArtists: async () => {
            const artistIds = await findActiveCreditedArtistIds();
            const artists = await models.artist.findMany({
                where: { id: { in: artistIds } }
            });
            const artistsWithCounts = await Promise.all(artists.map(async artist => ({
                artist,
                musicCount: (await getActiveMusicIds(artist)).length
            })));

            return artistsWithCounts
                .sort((left, right) => (
                    right.musicCount - left.musicCount
                    || left.artist.name.localeCompare(right.artist.name)
                ))
                .map(({ artist }) => artist);
        },
        artist: (_, { id }: Artist) => models.artist.findUnique({ where: { id: Number(id) } })
    },
    Artist: {
        latestAlbum: async (artist: Artist) => models.album.findFirst({
            where: {
                id: { in: await getActiveAlbumIds(artist) },
                Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
            },
            orderBy: { publishedYear: 'desc' }
        }),
        albums: async (artist: Artist) => models.album.findMany({
            where: {
                id: { in: await getActiveAlbumIds(artist) },
                Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
            },
            orderBy: { publishedYear: 'desc' }
        }),
        appearsOn: async (artist: Artist) => models.album.findMany({
            where: {
                id: { in: await getActiveAppearsOnAlbumIds(artist) },
                Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
            },
            orderBy: { publishedYear: 'desc' }
        }),
        musics: async (artist: Artist) => models.music.findMany({
            where: {
                id: { in: await getActiveMusicIds(artist) },
                syncStatus: TRACK_SYNC_STATUS.active
            },
            orderBy: { playCount: 'desc' }
        }),
        albumCount: async (artist: Artist) => models.album.count({
            where: {
                id: { in: await getActiveAlbumIds(artist) },
                Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
            }
        }),
        appearsOnCount: async (artist: Artist) => models.album.count({
            where: {
                id: { in: await getActiveAppearsOnAlbumIds(artist) },
                Music: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
            }
        }),
        musicCount: async (artist: Artist) => models.music.count({
            where: {
                id: { in: await getActiveMusicIds(artist) },
                syncStatus: TRACK_SYNC_STATUS.active
            }
        })
    }
};
