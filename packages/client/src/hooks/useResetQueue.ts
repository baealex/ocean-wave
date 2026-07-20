import { useCallback } from 'react';

import { useModal } from '~/components/app/ModalProvider';
import {
    isRemotePlaybackOwnershipActive,
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE
} from '~/modules/playback-ownership';
import { toast } from '~/modules/toast';
import { playbackSessionStore } from '~/store/playback-session';
import { queueStore } from '~/store/queue';

export default function useResetQueue() {
    const { confirm } = useModal();

    return useCallback(async (ids: string[]) => {
        if (isRemotePlaybackOwnershipActive(
            playbackSessionStore.state.snapshot,
            playbackSessionStore.endpointId
        )) {
            toast(REMOTE_PLAYBACK_OWNERSHIP_MESSAGE);
            return false;
        }

        if (queueStore.state.items.length > 0 && !(await confirm({
            title: 'Reset queue?',
            description: 'Current queue will be replaced with the selected tracks.',
            confirmLabel: 'Reset queue',
            tone: 'danger'
        }))) {
            return false;
        }

        await queueStore.reset(ids);
        return true;
    }, [confirm]);
}
