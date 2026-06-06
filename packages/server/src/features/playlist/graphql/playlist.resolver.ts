import type { IResolvers } from '@graphql-tools/utils';

import { playlistFieldResolvers } from './playlist.field.resolver';
import { playlistMutationResolvers } from './playlist.mutation.resolver';
import { playlistQueryResolvers } from './playlist.query.resolver';

export const playlistResolvers: IResolvers = {
    Query: playlistQueryResolvers,
    Mutation: playlistMutationResolvers,
    Playlist: playlistFieldResolvers
};
