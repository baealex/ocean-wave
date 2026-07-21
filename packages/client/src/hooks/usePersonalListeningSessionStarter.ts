import { useCallback, useState } from 'react';

import type {
    PersonalListeningSessionLength,
    PersonalListeningSessionScope
} from '~/api/personal-listening-session';
import { panel } from '~/modules/panel';
import { startPersonalListeningSession } from '~/modules/personal-listening-session-controller';
import { toast } from '~/modules/toast';

interface StarterState {
    message: string | null;
    starting: boolean;
}

export const usePersonalListeningSessionStarter = () => {
    const [state, setState] = useState<StarterState>({
        message: null,
        starting: false
    });

    const start = useCallback(async ({
        length,
        scope,
        startMusicId
    }: {
        length: PersonalListeningSessionLength;
        scope: PersonalListeningSessionScope;
        startMusicId: string;
    }) => {
        if (state.starting) {
            return;
        }

        setState({ message: null, starting: true });
        const result = await startPersonalListeningSession({
            length,
            scope,
            startMusicId
        });

        if (result.type === 'started') {
            panel.close();
            toast(`Started a ${result.trackCount}-track session`);
            return;
        }
        if (result.type === 'ready') {
            panel.close();
            toast(`Created a ${result.trackCount}-track session. Press Play when ready.`);
            return;
        }
        if (result.type === 'conflict') {
            setState({
                message: `The queue changed in another browser. Current playback is unchanged. The newest queue has ${result.queue.musicIds.length} tracks. Retry to use it.`,
                starting: false
            });
            return;
        }

        if (result.type === 'blocked' || result.type === 'error') {
            setState({ message: result.message, starting: false });
        }
    }, [state.starting]);

    return {
        message: state.message,
        start,
        starting: state.starting
    };
};
