import type {
    PlaybackSessionSnapshot,
    SharedPlaybackState
} from '~/api/playback-session';
import { isRemotePlaybackOwnershipActive } from '~/modules/playback-ownership';
import { useAppStore as useStore } from '~/store/base-store';
import { playbackSessionStore } from '~/store/playback-session';

export interface RemotePlaybackOwnership {
    state: SharedPlaybackState;
    targetEndpointId: string;
}

export const resolveRemotePlaybackOwnership = (
    session: PlaybackSessionSnapshot | null,
    localEndpointId: string | null
): RemotePlaybackOwnership | null => {
    if (
        !isRemotePlaybackOwnershipActive(session, localEndpointId)
        || !session?.activeDeviceId
    ) {
        return null;
    }

    return {
        state: session.state,
        targetEndpointId: session.activeDeviceId
    };
};

export default function useRemotePlaybackOwnership() {
    const [{ snapshot, endpointId }] = useStore(playbackSessionStore);

    return resolveRemotePlaybackOwnership(snapshot, endpointId);
}
