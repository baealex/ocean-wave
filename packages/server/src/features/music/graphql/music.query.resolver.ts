import type { IResolvers } from '@graphql-tools/utils';

import models, { type Music } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

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

type MusicQueryResolvers = NonNullable<IResolvers['Query']>;

export const musicQueryResolvers: MusicQueryResolvers = {
    allMusics: (_, { filter }: { filter?: MusicFilterInput } = {}) => models.music.findMany({
        where: buildMusicWhere(filter),
        orderBy: { playCount: 'desc' }
    }),
    music: (_, { id }: Music) => models.music.findUnique({ where: { id: Number(id) } })
};
