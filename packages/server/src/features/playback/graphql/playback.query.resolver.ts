import type { IResolvers } from '@graphql-tools/utils';

import { getPlaybackSessionSnapshot } from '../services/playback-session';
import { getPlaybackQueueSnapshot } from '../services/playback-queue';

type PlaybackQueryResolvers = NonNullable<IResolvers['Query']>;

export const playbackQueryResolvers: PlaybackQueryResolvers = {
    playbackSession: () => getPlaybackSessionSnapshot(),
    playbackQueue: () => getPlaybackQueueSnapshot()
};
