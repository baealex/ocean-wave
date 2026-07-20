import type { PlaybackSessionSnapshot } from '~/api/playback-session';

export const REMOTE_PLAYBACK_OWNERSHIP_MESSAGE = (
    'Another device owns playback. Open the player for remote controls.'
);

export const REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID = (
    'remote-playback-ownership-notice'
);

export const isRemotePlaybackOwnershipActive = (
    session: PlaybackSessionSnapshot | null,
    localEndpointId: string | null
) => Boolean(
    session?.activeDeviceId
    && localEndpointId
    && session.activeDeviceId !== localEndpointId
);
