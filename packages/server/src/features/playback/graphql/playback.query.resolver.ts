import type { IResolvers } from '@graphql-tools/utils';

import { getPlaybackSessionSnapshot } from '../services/playback-session';

type PlaybackQueryResolvers = NonNullable<IResolvers['Query']>;

export const playbackQueryResolvers: PlaybackQueryResolvers = {
    playbackSession: () => getPlaybackSessionSnapshot()
};
