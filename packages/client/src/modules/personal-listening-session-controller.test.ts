import { describe, expect, it, vi } from 'vitest';

import type { PlaybackQueueSnapshot } from '~/api/playback-queue';

vi.mock('~/modules/playback-command-barrier', () => ({
    beginPlaybackCommandBarrier: vi.fn(),
    endPlaybackCommandBarrier: vi.fn()
}));

vi.mock('~/store/personal-listening-session', () => ({
    personalListeningSessionStore: { remember: vi.fn() }
}));

vi.mock('~/store/playback-queue', () => ({
    playbackQueueStore: {
        state: { snapshot: null },
        adoptExternalSnapshot: vi.fn()
    }
}));

vi.mock('~/store/playback-session', () => ({
    playbackSessionStore: { mutationFence: null }
}));

vi.mock('~/store/queue', () => ({
    queueStore: {
        activatePersonalListeningSession: vi.fn(),
        getPersonalListeningSessionStartBlocker: vi.fn(),
        settlePersonalListeningSessionPlaybackBarrier: vi.fn()
    }
}));

import { startPersonalListeningSession } from './personal-listening-session-controller';

const queue = (revision: number): PlaybackQueueSnapshot => ({
    id: '1',
    musicIds: ['42', '7'],
    sourceMusicIds: [],
    currentIndex: 0,
    contextType: 'queue',
    contextId: null,
    contextTitle: null,
    shuffle: false,
    repeatMode: 'none',
    revision,
    updatedAt: '2026-07-21T00:00:00.000Z'
});

const options = {
    length: 'standard' as const,
    scope: 'explore' as const,
    startMusicId: '42'
};

const dependencies = () => {
    const snapshot = queue(4);
    return {
        activateQueue: vi.fn().mockResolvedValue('playing' as const),
        adoptQueue: vi.fn().mockReturnValue(snapshot),
        beginBarrier: vi.fn().mockReturnValue(true),
        createSession: vi.fn().mockResolvedValue({
            type: 'success' as const,
            createPersonalListeningSession: {
                type: 'accepted' as const,
                queue: snapshot,
                conflict: null,
                generatedAt: '2026-07-21T00:00:00.000Z',
                items: [
                    { musicId: '42', reasonCodes: ['START_TRACK' as const] },
                    { musicId: '7', reasonCodes: ['SHARED_TAG' as const] }
                ]
            }
        }),
        endBarrier: vi.fn(),
        getBlocker: vi.fn().mockReturnValue(null),
        getPlaybackFence: vi.fn().mockReturnValue({
            expectedPlaybackSessionRevision: 6,
            registrationGeneration: 3,
            registrationProof: 'proof-local-tab',
            requestingEndpointId: 'local-tab'
        }),
        getQueueRevision: vi.fn().mockReturnValue(3),
        rememberSession: vi.fn(),
        settleBarrier: vi.fn()
    };
};

describe('personal listening session controller', () => {
    it('uses the observed revision, adopts the committed queue, and starts playback', async () => {
        const deps = dependencies();

        await expect(startPersonalListeningSession(options, deps))
            .resolves.toEqual({ type: 'started', trackCount: 2 });
        expect(deps.createSession).toHaveBeenCalledWith({
            ...options,
            expectedPlaybackSessionRevision: 6,
            expectedRevision: 3,
            registrationGeneration: 3,
            registrationProof: 'proof-local-tab',
            requestingEndpointId: 'local-tab'
        }, 5_000);
        expect(deps.adoptQueue).toHaveBeenCalledWith(queue(4));
        expect(deps.rememberSession).toHaveBeenCalledWith(expect.objectContaining({
            queueRevision: 4,
            startMusicId: '42'
        }));
        expect(deps.activateQueue).toHaveBeenCalledWith(queue(4));
        expect(deps.endBarrier).toHaveBeenCalledOnce();
        expect(deps.settleBarrier).toHaveBeenCalledWith('accepted');
    });

    it('keeps current playback untouched and exposes the newest queue on conflict', async () => {
        const deps = dependencies();
        const latest = queue(5);
        deps.createSession.mockResolvedValue({
            type: 'success',
            createPersonalListeningSession: {
                type: 'conflict',
                queue: latest,
                conflict: { reason: 'stale-revision', queue: latest },
                generatedAt: '2026-07-21T00:00:00.000Z',
                items: [{ musicId: '42', reasonCodes: ['START_TRACK'] }]
            }
        });
        deps.adoptQueue.mockReturnValue(latest);

        await expect(startPersonalListeningSession(options, deps))
            .resolves.toEqual({ type: 'conflict', queue: latest });
        expect(deps.adoptQueue).toHaveBeenCalledWith(latest);
        expect(deps.activateQueue).not.toHaveBeenCalled();
        expect(deps.rememberSession).not.toHaveBeenCalled();
        expect(deps.endBarrier).toHaveBeenCalledOnce();
        expect(deps.settleBarrier).toHaveBeenCalledWith('conflict');
    });

    it('blocks before the request while the queue is still syncing', async () => {
        const deps = dependencies();
        deps.getBlocker.mockReturnValue('queue-sync');

        await expect(startPersonalListeningSession(options, deps)).resolves.toEqual({
            type: 'blocked',
            message: 'The queue is still syncing. Try again when it finishes.'
        });
        expect(deps.createSession).not.toHaveBeenCalled();
        expect(deps.beginBarrier).not.toHaveBeenCalled();
    });

    it('blocks before the barrier until playback registration and revision are ready', async () => {
        const deps = dependencies();
        deps.getPlaybackFence.mockReturnValue(null);

        await expect(startPersonalListeningSession(options, deps)).resolves.toEqual({
            type: 'blocked',
            message: 'Playback ownership is still syncing. Try again in a moment.'
        });
        expect(deps.beginBarrier).not.toHaveBeenCalled();
        expect(deps.createSession).not.toHaveBeenCalled();
    });

    it('replays deferred playback settlement after a failed request', async () => {
        const deps = dependencies();
        deps.createSession.mockResolvedValue({
            type: 'error',
            category: 'network',
            errors: [{ code: 'ECONNABORTED', message: 'timed out' }]
        });

        await expect(startPersonalListeningSession(options, deps)).resolves.toEqual({
            type: 'error',
            message: 'timed out'
        });
        expect(deps.endBarrier).toHaveBeenCalledOnce();
        expect(deps.settleBarrier).toHaveBeenCalledWith('failed');
    });

    it('treats an accepted result superseded by a newer snapshot as a conflict', async () => {
        const deps = dependencies();
        const newest = queue(5);
        deps.adoptQueue.mockReturnValue(newest);

        await expect(startPersonalListeningSession(options, deps))
            .resolves.toEqual({ type: 'conflict', queue: newest });
        expect(deps.activateQueue).not.toHaveBeenCalled();
        expect(deps.rememberSession).not.toHaveBeenCalled();
        expect(deps.settleBarrier).toHaveBeenCalledWith('conflict');
    });
});
