import { useMemo } from 'react';

import { resolvePlaybackSignal } from '~/modules/playback-signal';
import { playbackSessionStore } from '~/store/playback-session';
import { queueStore } from '~/store/queue';
import useStoreValue from './useStoreValue';

export default function usePlaybackSignal() {
    const [snapshot] = useStoreValue(playbackSessionStore, 'snapshot');
    const [localDeviceId] = useStoreValue(playbackSessionStore, 'endpointId');
    const [currentTrackId] = useStoreValue(queueStore, 'currentTrackId');
    const [isPlaying] = useStoreValue(queueStore, 'isPlaying');

    return useMemo(() => resolvePlaybackSignal({
        currentTrackId,
        isPlaying,
        localDeviceId,
        snapshot
    }), [currentTrackId, isPlaying, localDeviceId, snapshot]);
}
