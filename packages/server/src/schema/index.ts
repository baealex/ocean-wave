import { makeExecutableSchema } from '@graphql-tools/schema';
import { albumResolvers, albumTypeDefs } from './album';
import { artistResolvers, artistTypeDefs } from './artist';
import { musicResolvers, musicTypeDefs } from './music';
import { playlistResolvers, playlistTypeDefs } from './playlist';
import { syncReportResolvers, syncReportTypeDefs } from './sync-report';
import { tagResolvers, tagTypeDefs } from '../features/tag/graphql';

const schema = makeExecutableSchema({
    typeDefs: [
        albumTypeDefs,
        artistTypeDefs,
        musicTypeDefs,
        playlistTypeDefs,
        syncReportTypeDefs,
        tagTypeDefs
    ],
    resolvers: [
        albumResolvers,
        artistResolvers,
        musicResolvers,
        playlistResolvers,
        syncReportResolvers,
        tagResolvers
    ]
});

export default schema;
