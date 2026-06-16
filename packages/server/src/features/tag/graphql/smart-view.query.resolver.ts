import type { IResolvers } from '@graphql-tools/utils';

import { listSmartViews } from '../services/smart-views';

type SmartViewQueryResolvers = NonNullable<IResolvers['Query']>;

export const smartViewQueryResolvers: SmartViewQueryResolvers = {
    smartViews: async () => {
        const views = await listSmartViews();

        return {
            totalCount: views.length,
            views
        };
    }
};
