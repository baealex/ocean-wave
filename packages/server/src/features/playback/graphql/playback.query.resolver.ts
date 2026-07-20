import type { IResolvers } from '@graphql-tools/utils';

import { playbackEndpointRegistry } from '~/socket/playback-endpoints';

import { getPlaybackDeviceRegistrySnapshot } from '../services/playback-device';
import { getPlaybackSessionSnapshot } from '../services/playback-session';
import { getPlaybackQueueSnapshot } from '../services/playback-queue';

type PlaybackQueryResolvers = NonNullable<IResolvers['Query']>;

export const playbackQueryResolvers: PlaybackQueryResolvers = {
    playbackSession: () => getPlaybackSessionSnapshot(),
    playbackQueue: () => getPlaybackQueueSnapshot(),
    playbackDeviceRegistry: () => getPlaybackDeviceRegistrySnapshot(
        playbackEndpointRegistry.getOnlineEndpoints(),
        playbackEndpointRegistry.commandEpoch
    )
};
