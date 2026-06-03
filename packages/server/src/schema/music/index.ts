import type { IResolvers } from '@graphql-tools/utils';

import models, { type Music } from '~/models';
import { gql } from '~/modules/graphql';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import { artistType } from '../artist';
import { albumType } from '../album';

type TagFilterMode = 'ALL' | 'ANY';

interface MusicFilterInput {
    tagIds?: string[];
    tagMode?: TagFilterMode;
}

const parseTagIds = (tagIds: string[] | undefined) => {
    if (!tagIds?.length) {
        return [];
    }

    return [...new Set(tagIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0))];
};

const buildMusicWhere = (filter?: MusicFilterInput) => {
    const tagIds = parseTagIds(filter?.tagIds);

    if (!tagIds.length) {
        return { syncStatus: TRACK_SYNC_STATUS.active };
    }

    if (filter?.tagMode === 'ANY') {
        return {
            syncStatus: TRACK_SYNC_STATUS.active,
            MusicTag: {
                some: {
                    tagId: { in: tagIds }
                }
            }
        };
    }

    return {
        syncStatus: TRACK_SYNC_STATUS.active,
        AND: tagIds.map((tagId) => ({
            MusicTag: {
                some: { tagId }
            }
        }))
    };
};

export const musicType: string = gql`
    type Music {
        id: ID!
        name: String!
        duration: Float!
        codec: String!
        bitrate: Float!
        sampleRate: Float!
        playCount: Int!
        lastPlayedAt: String
        totalPlayedMs: Float!
        trackNumber: Int!
        filePath: String!
        isLiked: Boolean!
        isHated: Boolean!
        createdAt: String!
        artist: Artist!
        album: Album!
        genres: [Genre!]!
        tags: [Tag!]!
    }

    type Genre {
        id: ID!
        name: String!
    }

    enum TagFilterMode {
        ALL
        ANY
    }

    input MusicFilterInput {
        tagIds: [ID!]
        tagMode: TagFilterMode
    }

    ${artistType}

    ${albumType}
`;

export const musicQuery = gql`
    type Query {
        allMusics(filter: MusicFilterInput): [Music!]!
        allHatedMusics: [Music!]!
        music(id: ID!): Music!
    }
`;

export const musicTypeDefs = `
    ${musicType}
    ${musicQuery}
`;

export const musicResolvers: IResolvers = {
    Query: {
        allMusics: (_, { filter }: { filter?: MusicFilterInput } = {}) => models.music.findMany({
            where: buildMusicWhere(filter),
            orderBy: { playCount: 'desc' }
        }),
        music: (_, { id }: Music) => models.music.findUnique({ where: { id: Number(id) } })
    },
    Music: {
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
    }
};
