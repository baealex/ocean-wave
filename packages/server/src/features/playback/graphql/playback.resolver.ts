import type { IResolvers } from '@graphql-tools/utils';

import { playbackMutationResolvers } from './playback.mutation.resolver';
import { playbackQueryResolvers } from './playback.query.resolver';

export const playbackResolvers: IResolvers = {
    Query: playbackQueryResolvers,
    Mutation: playbackMutationResolvers
};
