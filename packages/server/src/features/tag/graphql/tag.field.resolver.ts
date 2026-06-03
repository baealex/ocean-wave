import type { IResolvers } from '@graphql-tools/utils';

import models, { type Tag } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

type TagSource =
    | Pick<Tag, 'id'>
    | {
        id: string;
    };

type TagFieldResolvers = NonNullable<IResolvers['Tag']>;

export const tagFieldResolvers: TagFieldResolvers = {
    musicCount: (tag: TagSource) => models.musicTag.count({
        where: {
            tagId: Number(tag.id),
            Music: { syncStatus: TRACK_SYNC_STATUS.active }
        }
    })
};
