import type { IResolvers } from '@graphql-tools/utils';

import models, { type SmartView } from '~/models';

type TagViewSource =
    | Pick<SmartView, 'id'>
    | {
        id: string;
    };

type TagViewFieldResolvers = NonNullable<IResolvers['TagView']>;

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

export const tagViewFieldResolvers: TagViewFieldResolvers = {
    tags: (view: TagViewSource) => getSmartViewTags(view.id),
    tagIds: async (view: TagViewSource) => {
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
