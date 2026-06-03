import type { IResolvers } from '@graphql-tools/utils';

import { tagFieldResolvers } from './tag.field.resolver';
import { tagMutationResolvers } from './tag.mutation.resolver';
import { tagQueryResolvers } from './tag.query.resolver';

export const tagResolvers: IResolvers = {
    Query: tagQueryResolvers,
    Mutation: tagMutationResolvers,
    Tag: tagFieldResolvers
};
