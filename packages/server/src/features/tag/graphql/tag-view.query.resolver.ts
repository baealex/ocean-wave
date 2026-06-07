import type { IResolvers } from '@graphql-tools/utils';

import { listTagViews } from '../services/tag-views';

type TagViewQueryResolvers = NonNullable<IResolvers['Query']>;

export const tagViewQueryResolvers: TagViewQueryResolvers = {
    tagViews: async () => {
        const views = await listTagViews();

        return {
            totalCount: views.length,
            views
        };
    }
};
