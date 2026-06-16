import type { IResolvers } from '@graphql-tools/utils';

import models, { type SmartView } from '~/models';

type SmartViewSource =
    | Pick<SmartView, 'id'>
    | {
        id: string;
    };

type SmartViewFieldResolvers = NonNullable<IResolvers['SmartView']>;

const getSmartViewTags = async (viewId: string | number) => {
    const viewTags = await models.smartViewTag.findMany({
        where: { smartViewId: Number(viewId) },
        include: { Tag: true },
        orderBy: [
            { order: 'asc' },
            { Tag: { name: 'asc' } }
        ]
    });

    return viewTags.map(viewTag => viewTag.Tag);
};

export const smartViewFieldResolvers: SmartViewFieldResolvers = {
    tags: (view: SmartViewSource) => getSmartViewTags(view.id),
    tagIds: async (view: SmartViewSource) => {
        const viewTags = await models.smartViewTag.findMany({
            where: { smartViewId: Number(view.id) },
            orderBy: [
                { order: 'asc' },
                { Tag: { name: 'asc' } }
            ],
            select: {
                tagId: true
            }
        });

        return viewTags.map(viewTag => viewTag.tagId.toString());
    }
};
