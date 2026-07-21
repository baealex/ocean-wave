import {
    createPersonalListeningSession,
    type PersonalListeningSessionLength,
    type PersonalListeningSessionScope
} from '~/api/personal-listening-session';
import type { PlaybackQueueSnapshot } from '~/api/playback-queue';
import {
    beginPlaybackCommandBarrier,
    endPlaybackCommandBarrier
} from '~/modules/playback-command-barrier';
import { PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS } from '~/modules/playback-controller';
import { PERSONAL_LISTENING_SESSION_COMMAND_PREFIX } from '~/modules/personal-listening-session';
import { personalListeningSessionStore } from '~/store/personal-listening-session';
import { playbackQueueStore } from '~/store/playback-queue';
import { playbackSessionStore } from '~/store/playback-session';
import {
    type PersonalListeningSessionBarrierSettlement,
    type PersonalListeningSessionStartBlocker,
    queueStore
} from '~/store/queue';

export interface StartPersonalListeningSessionOptions {
    length: PersonalListeningSessionLength;
    scope: PersonalListeningSessionScope;
    startMusicId: string;
}

export type StartPersonalListeningSessionResult =
    | { type: 'started' | 'ready'; trackCount: number }
    | { type: 'conflict'; queue: PlaybackQueueSnapshot }
    | { type: 'blocked' | 'error'; message: string };

interface PersonalListeningSessionControllerDependencies {
    activateQueue: typeof queueStore.activatePersonalListeningSession;
    adoptQueue: typeof playbackQueueStore.adoptExternalSnapshot;
    beginBarrier: typeof beginPlaybackCommandBarrier;
    createSession: typeof createPersonalListeningSession;
    endBarrier: typeof endPlaybackCommandBarrier;
    getBlocker: typeof queueStore.getPersonalListeningSessionStartBlocker;
    getPlaybackFence: () => typeof playbackSessionStore.mutationFence;
    getQueueRevision: () => number;
    rememberSession: typeof personalListeningSessionStore.remember;
    settleBarrier: typeof queueStore.settlePersonalListeningSessionPlaybackBarrier;
}

const defaultDependencies: PersonalListeningSessionControllerDependencies = {
    activateQueue: snapshot => queueStore.activatePersonalListeningSession(snapshot),
    adoptQueue: snapshot => playbackQueueStore.adoptExternalSnapshot(snapshot),
    beginBarrier: beginPlaybackCommandBarrier,
    createSession: createPersonalListeningSession,
    endBarrier: endPlaybackCommandBarrier,
    getBlocker: () => queueStore.getPersonalListeningSessionStartBlocker(),
    getPlaybackFence: () => playbackSessionStore.mutationFence,
    getQueueRevision: () => playbackQueueStore.state.snapshot?.revision ?? 0,
    rememberSession: active => personalListeningSessionStore.remember(active),
    settleBarrier: replaceQueue => (
        queueStore.settlePersonalListeningSessionPlaybackBarrier(replaceQueue)
    )
};

const blockerMessages: Record<PersonalListeningSessionStartBlocker, string> = {
    'library-loading': 'The library is still loading. Try again in a moment.',
    'playback-sync': 'Playback ownership is still syncing. Try again in a moment.',
    'playback-transition': 'Another playback change is in progress. Try again when it finishes.',
    'queue-sync': 'The queue is still syncing. Try again when it finishes.',
    'remote-playback': 'Playback is active in another browser. Use Play Here before starting a local session.'
};

let operationSequence = 0;

export const startPersonalListeningSession = async (
    options: StartPersonalListeningSessionOptions,
    dependencies: PersonalListeningSessionControllerDependencies = defaultDependencies
): Promise<StartPersonalListeningSessionResult> => {
    const blocker = dependencies.getBlocker();

    if (blocker) {
        return { type: 'blocked', message: blockerMessages[blocker] };
    }

    const playbackFence = dependencies.getPlaybackFence();
    if (!playbackFence) {
        return { type: 'blocked', message: blockerMessages['playback-sync'] };
    }

    const commandKey = `${PERSONAL_LISTENING_SESSION_COMMAND_PREFIX}${++operationSequence}`;
    if (!dependencies.beginBarrier(commandKey)) {
        return {
            type: 'blocked',
            message: blockerMessages['playback-transition']
        };
    }

    let barrierActive = true;
    let barrierSettled = false;
    let barrierSettlement: PersonalListeningSessionBarrierSettlement = 'failed';
    const settleBarrier = () => {
        if (barrierActive) {
            dependencies.endBarrier(commandKey);
            barrierActive = false;
        }
        if (!barrierSettled) {
            dependencies.settleBarrier(barrierSettlement);
            barrierSettled = true;
        }
    };

    try {
        const response = await dependencies.createSession({
            ...options,
            ...playbackFence,
            expectedRevision: dependencies.getQueueRevision()
        }, PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS);

        if (response.type === 'error') {
            return {
                type: 'error',
                message: response.errors[0]?.message
                    ?? 'Unable to create this listening session.'
            };
        }

        const result = response.createPersonalListeningSession;
        const adopted = dependencies.adoptQueue(result.queue);

        if (
            result.type === 'conflict'
            || adopted.revision !== result.queue.revision
        ) {
            barrierSettlement = 'conflict';
            return { type: 'conflict', queue: adopted };
        }

        barrierSettlement = 'accepted';

        dependencies.rememberSession({
            items: result.items,
            length: options.length,
            queueRevision: result.queue.revision,
            scope: options.scope,
            startMusicId: options.startMusicId
        });
        settleBarrier();

        const activation = await dependencies.activateQueue(result.queue);
        if (activation === 'blocked') {
            return {
                type: 'error',
                message: 'The session was saved, but playback changed before it could start here.'
            };
        }

        return {
            type: activation === 'playing' ? 'started' : 'ready',
            trackCount: result.items.length
        };
    } catch {
        return {
            type: 'error',
            message: 'Unable to create this listening session.'
        };
    } finally {
        settleBarrier();
    }
};
