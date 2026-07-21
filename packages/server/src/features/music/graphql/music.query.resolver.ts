import type { IResolvers } from '@graphql-tools/utils';

import models, { type Music, type Prisma } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import { getLibraryRediscovery } from '../services/library-rediscovery';

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

const buildMusicWhere = (filter?: MusicFilterInput): Prisma.MusicWhereInput => {
    const tagIds = parseTagIds(filter?.tagIds);

    if (!tagIds.length) {
        return { syncStatus: TRACK_SYNC_STATUS.active };
    }

    if (filter?.tagMode === 'ANY') {
        return {
            syncStatus: TRACK_SYNC_STATUS.active,
            Recording: {
                MusicTag: {
                    some: {
                        tagId: { in: tagIds }
                    }
                }
            }
        };
    }

    return {
        syncStatus: TRACK_SYNC_STATUS.active,
        AND: tagIds.map((tagId) => ({
            Recording: {
                MusicTag: {
                    some: { tagId }
                }
            }
        }))
    };
};

type MusicQueryResolvers = NonNullable<IResolvers['Query']>;

type LibraryRediscoveryReader = typeof getLibraryRediscovery;

export const createLibraryRediscoveryQueryResolver = (
    readLibraryRediscovery: LibraryRediscoveryReader = getLibraryRediscovery
) => (_: unknown, { limit }: { limit?: number } = {}) => (
    readLibraryRediscovery({ limit })
);

export const musicQueryResolvers: MusicQueryResolvers = {
    allMusics: (_, { filter }: { filter?: MusicFilterInput } = {}) => models.music.findMany({
        where: buildMusicWhere(filter),
        orderBy: { playCount: 'desc' }
    }),
    libraryRediscovery: createLibraryRediscoveryQueryResolver(),
    music: (_, { id }: Music) => models.music.findUnique({ where: { id: Number(id) } })
};
