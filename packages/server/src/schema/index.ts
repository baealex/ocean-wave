import { makeExecutableSchema } from '@graphql-tools/schema';
import { albumResolvers, albumTypeDefs } from './album';
import { artistResolvers, artistTypeDefs } from './artist';
import { musicResolvers, musicTypeDefs } from '../features/music/graphql';
import { playlistResolvers, playlistTypeDefs } from '../features/playlist/graphql';
import { playbackResolvers, playbackTypeDefs } from '../features/playback/graphql';
import { syncReportResolvers, syncReportTypeDefs } from './sync-report';
import { tagResolvers, tagTypeDefs } from '../features/tag/graphql';

const schema = makeExecutableSchema({
    typeDefs: [
        albumTypeDefs,
        artistTypeDefs,
        musicTypeDefs,
        playlistTypeDefs,
        playbackTypeDefs,
        syncReportTypeDefs,
        tagTypeDefs
    ],
    resolvers: [
        albumResolvers,
        artistResolvers,
        musicResolvers,
        playlistResolvers,
        playbackResolvers,
        syncReportResolvers,
        tagResolvers
    ]
});

export default schema;
