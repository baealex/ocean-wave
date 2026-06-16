import type { IResolvers } from '@graphql-tools/utils';

import { tagFieldResolvers } from './tag.field.resolver';
import { tagMutationResolvers } from './tag.mutation.resolver';
import { tagQueryResolvers } from './tag.query.resolver';
import { smartViewFieldResolvers } from './smart-view.field.resolver';
import { smartViewMutationResolvers } from './smart-view.mutation.resolver';
import { smartViewQueryResolvers } from './smart-view.query.resolver';

const queryResolvers = {
    ...(tagQueryResolvers as Record<string, unknown>),
    ...(smartViewQueryResolvers as Record<string, unknown>)
} as NonNullable<IResolvers['Query']>;

const mutationResolvers = {
    ...(tagMutationResolvers as Record<string, unknown>),
    ...(smartViewMutationResolvers as Record<string, unknown>)
} as NonNullable<IResolvers['Mutation']>;

export const tagResolvers: IResolvers = {
    Query: queryResolvers,
    Mutation: mutationResolvers,
    Tag: tagFieldResolvers,
    SmartView: smartViewFieldResolvers
};
