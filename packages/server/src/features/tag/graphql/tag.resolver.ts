import type { IResolvers } from '@graphql-tools/utils';

import { tagFieldResolvers } from './tag.field.resolver';
import { tagMutationResolvers } from './tag.mutation.resolver';
import { tagQueryResolvers } from './tag.query.resolver';
import { tagViewFieldResolvers } from './tag-view.field.resolver';
import { tagViewMutationResolvers } from './tag-view.mutation.resolver';
import { tagViewQueryResolvers } from './tag-view.query.resolver';

const queryResolvers = {
    ...(tagQueryResolvers as Record<string, unknown>),
    ...(tagViewQueryResolvers as Record<string, unknown>)
} as NonNullable<IResolvers['Query']>;

const mutationResolvers = {
    ...(tagMutationResolvers as Record<string, unknown>),
    ...(tagViewMutationResolvers as Record<string, unknown>)
} as NonNullable<IResolvers['Mutation']>;

export const tagResolvers: IResolvers = {
    Query: queryResolvers,
    Mutation: mutationResolvers,
    Tag: tagFieldResolvers,
    TagView: tagViewFieldResolvers
};
