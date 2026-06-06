import type { IResolvers } from '@graphql-tools/utils';

import { musicFieldResolvers } from './music.field.resolver';
import { musicMutationResolvers } from './music.mutation.resolver';
import { musicQueryResolvers } from './music.query.resolver';

export const musicResolvers: IResolvers = {
    Query: musicQueryResolvers,
    Mutation: musicMutationResolvers,
    Music: musicFieldResolvers
};
