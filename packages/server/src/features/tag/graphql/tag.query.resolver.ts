import type { IResolvers } from '@graphql-tools/utils';

import models, { type Prisma } from '~/models';

import {
    normalizeTagName,
    TAG_SCOPE_KEY
} from '../services/normalization';

interface PaginationInput {
    limit: number;
    offset: number;
}

interface SearchFilterInput {
    query: string;
}

type TagQueryResolvers = NonNullable<IResolvers['Query']>;

const resolvePagination = (pagination?: PaginationInput) => {
    const limit = pagination?.limit;
    const offset = pagination?.offset;

    return {
        take: typeof limit === 'number' && Number.isInteger(limit) && limit > 0
            ? Math.min(limit, 100)
            : 100,
        skip: typeof offset === 'number' && Number.isInteger(offset) && offset > 0
            ? offset
            : 0
    };
};

export const tagQueryResolvers: TagQueryResolvers = {
    allTags: async (_, {
        searchFilter,
        pagination
    }: {
        searchFilter?: SearchFilterInput;
        pagination?: PaginationInput;
    }) => {
        const query = searchFilter?.query ?? '';
        const hasQuery = query.trim().length > 0;
        const normalizedQuery = hasQuery ? normalizeTagName(query) : null;
        const { take, skip } = resolvePagination(pagination);

        if (hasQuery && !normalizedQuery) {
            return {
                totalCount: 0,
                tags: []
            };
        }

        const where: Prisma.TagWhereInput = {
            scopeKey: TAG_SCOPE_KEY,
            ...(normalizedQuery
                ? { normalizedName: { contains: normalizedQuery.normalizedName } }
                : {})
        };
        const tags = models.tag.findMany({
            where,
            orderBy: [
                { order: 'asc' },
                { name: 'asc' }
            ],
            take,
            skip
        });

        return {
            totalCount: await models.tag.count({ where }),
            tags: await tags
        };
    }
};
