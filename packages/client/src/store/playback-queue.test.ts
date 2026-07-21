import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchPlaybackQueue: vi.fn(),
    savePlaybackQueue: vi.fn(),
    socketOn: vi.fn(),
    socketOff: vi.fn()
}));

vi.mock('~/api/playback-queue', () => ({
    fetchPlaybackQueue: mocks.fetchPlaybackQueue,
    savePlaybackQueue: mocks.savePlaybackQueue
}));

vi.mock('~/socket', () => ({
    PLAYBACK_QUEUE_INVALIDATED: 'playback:queue-invalidated',
    isOwnRealtimeNotification: (notification: { originClientId?: string | null }) => (
        notification.originClientId === 'origin-local'
    ),
    socket: {
        on: mocks.socketOn,
        off: mocks.socketOff
    }
}));

import type { PlaybackQueueSnapshot } from '~/api/playback-queue';
import {
    beginPlaybackCommandBarrier,
    endPlaybackCommandBarrier
} from '~/modules/playback-command-barrier';
import { PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS } from '~/modules/playback-controller';
import {
    type LocalPlaybackQueueSnapshot,
    PlaybackQueueStore
} from './playback-queue';

const createSnapshot = (
    overrides: Partial<PlaybackQueueSnapshot> = {}
): PlaybackQueueSnapshot => ({
    id: '1',
    musicIds: ['42'],
    sourceMusicIds: [],
    currentIndex: 0,
    contextType: 'queue',
    contextId: null,
    contextTitle: null,
    shuffle: false,
    repeatMode: 'none',
    revision: 1,
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides
});

const localSnapshot: LocalPlaybackQueueSnapshot = {
    musicIds: ['42'],
    sourceMusicIds: [],
    currentIndex: 0,
    context: {
        type: 'queue',
        id: null,
        title: null
    },
    shuffle: false,
    repeatMode: 'none'
};

const toSaveInput = (
    snapshot: LocalPlaybackQueueSnapshot,
    expectedRevision: number
) => ({
    musicIds: snapshot.musicIds,
    sourceMusicIds: snapshot.sourceMusicIds,
    currentIndex: snapshot.currentIndex,
    contextType: snapshot.context.type,
    contextId: snapshot.context.id,
    contextTitle: snapshot.context.title,
    shuffle: snapshot.shuffle,
    repeatMode: snapshot.repeatMode,
    expectedRevision
});

describe('PlaybackQueueStore', () => {
    beforeEach(() => {
        mocks.fetchPlaybackQueue.mockReset();
        mocks.savePlaybackQueue.mockReset();
        mocks.socketOn.mockReset();
        mocks.socketOff.mockReset();
    });

    it('loads the server snapshot as a restore candidate', async () => {
        const snapshot = createSnapshot({ revision: 4 });
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: snapshot
        });
        const store = new PlaybackQueueStore();

        store.connect();
        await vi.waitFor(() => expect(store.state.loading).toBe(false));
        expect(mocks.fetchPlaybackQueue).toHaveBeenCalledWith(
            PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
        );

        expect(store.state).toMatchObject({
            snapshot,
            restoreVersion: 1,
            initialized: true,
            error: null
        });
        store.disconnect();
        expect(mocks.socketOff).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(mocks.socketOff).toHaveBeenCalledWith(
            'playback:queue-invalidated',
            expect.any(Function)
        );
    });

    it('refreshes an initially empty queue when another tab saves a newer revision', async () => {
        const remoteSnapshot = createSnapshot({ revision: 2, musicIds: ['7'] });
        mocks.fetchPlaybackQueue
            .mockResolvedValueOnce({ type: 'success', playbackQueue: null })
            .mockResolvedValueOnce({
                type: 'success',
                playbackQueue: remoteSnapshot
            });
        const store = new PlaybackQueueStore();

        store.connect();
        await vi.waitFor(() => expect(store.state.initialized).toBe(true));
        const notificationHandler = mocks.socketOn.mock.calls.find(
            ([event]) => event === 'playback:queue-invalidated'
        )?.[1] as ((notification: {
            originClientId?: string;
            revision: number;
        }) => void) | undefined;

        notificationHandler?.({ originClientId: 'origin-remote', revision: 2 });

        await vi.waitFor(() => expect(store.state.snapshot).toEqual(remoteSnapshot));
        expect(store.state.restoreVersion).toBe(2);
        store.disconnect();
    });

    it('ignores own and stale queue invalidations', async () => {
        const snapshot = createSnapshot({ revision: 4 });
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: snapshot
        });
        const store = new PlaybackQueueStore();

        store.connect();
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(snapshot));
        const notificationHandler = mocks.socketOn.mock.calls.find(
            ([event]) => event === 'playback:queue-invalidated'
        )?.[1] as ((notification: {
            originClientId?: string;
            revision: number;
        }) => void) | undefined;

        notificationHandler?.({ originClientId: 'origin-local', revision: 5 });
        notificationHandler?.({ originClientId: 'origin-remote', revision: 4 });

        expect(mocks.fetchPlaybackQueue).toHaveBeenCalledOnce();
        store.disconnect();
    });

    it('does not let a delayed refresh regress a newly accepted save', async () => {
        const initial = createSnapshot({ revision: 2 });
        const accepted = createSnapshot({ revision: 3, repeatMode: 'all' });
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: initial
        });
        mocks.savePlaybackQueue.mockResolvedValue({
            type: 'success',
            savePlaybackQueue: {
                type: 'accepted',
                queue: accepted,
                conflict: null
            }
        });
        const store = new PlaybackQueueStore();
        await store.refresh();

        let resolveRefresh: ((value: unknown) => void) | undefined;
        mocks.fetchPlaybackQueue.mockReturnValueOnce(new Promise((resolve) => {
            resolveRefresh = resolve;
        }));
        const refresh = store.refresh();
        store.save({ ...localSnapshot, repeatMode: 'all' });
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(accepted));
        resolveRefresh?.({ type: 'success', playbackQueue: initial });

        await expect(refresh).resolves.toEqual({
            type: 'success',
            snapshot: accepted
        });
        expect(store.state.snapshot).toEqual(accepted);
    });

    it('adopts a session mutation snapshot without restoring over current playback', async () => {
        const initial = createSnapshot({ revision: 2 });
        const sessionQueue = createSnapshot({
            musicIds: ['7', '42'],
            revision: 3
        });
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: initial
        });
        const store = new PlaybackQueueStore();
        await store.refresh();
        const restoreVersion = store.state.restoreVersion;

        expect(store.adoptExternalSnapshot(sessionQueue)).toEqual(sessionQueue);
        expect(store.state).toMatchObject({
            snapshot: sessionQueue,
            restoreVersion,
            initialized: true,
            loading: false,
            error: null
        });
        expect(store.adoptExternalSnapshot(initial)).toEqual(sessionQueue);
        expect(store.state.snapshot).toEqual(sessionQueue);
    });

    it('does not let a delayed refresh regress conflict recovery authority', async () => {
        const initial = createSnapshot({ revision: 2 });
        const authoritative = createSnapshot({
            musicIds: ['7'],
            revision: 4
        });
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: initial
        });
        mocks.savePlaybackQueue.mockResolvedValue({
            type: 'success',
            savePlaybackQueue: {
                type: 'conflict',
                queue: authoritative,
                conflict: { reason: 'stale-revision', queue: authoritative }
            }
        });
        const store = new PlaybackQueueStore();
        await store.refresh();

        let resolveRefresh: ((value: unknown) => void) | undefined;
        mocks.fetchPlaybackQueue.mockReturnValueOnce(new Promise((resolve) => {
            resolveRefresh = resolve;
        }));
        const refresh = store.refresh();
        store.save(localSnapshot);
        await vi.waitFor(() => expect(store.state.conflict).not.toBeNull());
        resolveRefresh?.({ type: 'success', playbackQueue: initial });

        await refresh;
        expect(store.state.snapshot).toEqual(authoritative);
        expect(store.state.conflict).toEqual({
            authoritative,
            local: localSnapshot
        });
    });

    it('reports a bounded recovery read failure without reusing it as success', async () => {
        const snapshot = createSnapshot({ revision: 4 });
        mocks.fetchPlaybackQueue.mockResolvedValueOnce({
            type: 'success',
            playbackQueue: snapshot
        });
        const store = new PlaybackQueueStore();
        await expect(store.refresh()).resolves.toEqual({
            type: 'success',
            snapshot
        });
        mocks.fetchPlaybackQueue.mockResolvedValueOnce({
            type: 'error',
            category: 'network',
            errors: [{ code: 'ECONNABORTED', message: 'timed out' }]
        });

        await expect(store.refresh(5_000)).resolves.toEqual({ type: 'error' });
        expect(mocks.fetchPlaybackQueue).toHaveBeenLastCalledWith(5_000);
        expect(store.state.snapshot).toEqual(snapshot);
    });

    it('does not rebase a pre-load local change over an existing server queue', async () => {
        const serverSnapshot = createSnapshot({ revision: 4 });
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: serverSnapshot
        });
        mocks.savePlaybackQueue.mockResolvedValue({
            type: 'success',
            savePlaybackQueue: {
                type: 'conflict',
                queue: serverSnapshot,
                conflict: { reason: 'stale-revision', queue: serverSnapshot }
            }
        });
        const store = new PlaybackQueueStore();

        store.save({ ...localSnapshot, repeatMode: 'all' });
        expect(mocks.savePlaybackQueue).not.toHaveBeenCalled();
        store.connect();

        await vi.waitFor(() => expect(mocks.savePlaybackQueue).toHaveBeenCalledOnce());
        expect(mocks.savePlaybackQueue).toHaveBeenCalledWith(toSaveInput({
            ...localSnapshot,
            repeatMode: 'all'
        }, 0));
        await vi.waitFor(() => expect(store.state.conflict).toEqual({
            authoritative: serverSnapshot,
            local: { ...localSnapshot, repeatMode: 'all' }
        }));
    });

    it('drops command-originated queue saves while the barrier is active', () => {
        const store = new PlaybackQueueStore();
        beginPlaybackCommandBarrier('queue-command-test');

        try {
            store.save(localSnapshot);
            expect(store.hasPendingSave).toBe(false);
            expect(mocks.savePlaybackQueue).not.toHaveBeenCalled();
        } finally {
            endPlaybackCommandBarrier('queue-command-test');
        }
    });

    it('quiesces queued writes and does not retry them through the command barrier', async () => {
        let resolveSave: ((value: unknown) => void) | undefined;
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: createSnapshot()
        });
        mocks.savePlaybackQueue.mockReturnValue(new Promise((resolve) => {
            resolveSave = resolve;
        }));
        const store = new PlaybackQueueStore();
        await store.refresh();
        store.save(localSnapshot);
        store.save({ ...localSnapshot, repeatMode: 'all' });
        await vi.waitFor(() => expect(mocks.savePlaybackQueue).toHaveBeenCalledOnce());

        beginPlaybackCommandBarrier('queue-recovery-test');
        try {
            expect(store.quiesceForPlaybackCommandRecovery()).toBe(false);
            resolveSave?.({
                type: 'error',
                category: 'network',
                errors: [{ code: 'NETWORK_ERROR', message: 'offline' }]
            });
            await vi.waitFor(() => expect(store.state.error).toBe('offline'));

            expect(mocks.savePlaybackQueue).toHaveBeenCalledOnce();
            expect(store.hasPendingSave).toBe(true);
            expect(store.quiesceForPlaybackCommandRecovery()).toBe(true);
            expect(store.hasPendingSave).toBe(false);
        } finally {
            endPlaybackCommandBarrier('queue-recovery-test');
        }
    });

    it('keeps only the latest local snapshot while a save is in flight', async () => {
        let resolveFirst: ((value: unknown) => void) | undefined;
        const firstRequest = new Promise(resolve => {
            resolveFirst = resolve;
        });
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: createSnapshot()
        });
        mocks.savePlaybackQueue
            .mockReturnValueOnce(firstRequest)
            .mockResolvedValueOnce({
                type: 'success',
                savePlaybackQueue: {
                    type: 'accepted',
                    queue: createSnapshot({ revision: 3, repeatMode: 'all' }),
                    conflict: null
                }
            });
        const store = new PlaybackQueueStore();

        await store.refresh();
        store.save(localSnapshot);
        store.save({ ...localSnapshot, repeatMode: 'one' });
        store.save({ ...localSnapshot, repeatMode: 'all' });
        resolveFirst?.({
            type: 'success',
            savePlaybackQueue: {
                type: 'accepted',
                queue: createSnapshot({ revision: 2 }),
                conflict: null
            }
        });

        await vi.waitFor(() => expect(mocks.savePlaybackQueue).toHaveBeenCalledTimes(2));
        expect(mocks.savePlaybackQueue.mock.calls[1]?.[0]).toEqual(toSaveInput({
            ...localSnapshot,
            repeatMode: 'all'
        }, 2));
    });

    it('keeps local playback unchanged when a stale revision is rejected', async () => {
        const authoritative = createSnapshot({ revision: 8, musicIds: ['7'] });
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: createSnapshot({ revision: 7 })
        });
        mocks.savePlaybackQueue.mockResolvedValue({
            type: 'success',
            savePlaybackQueue: {
                type: 'conflict',
                queue: authoritative,
                conflict: { reason: 'stale-revision', queue: authoritative }
            }
        });
        const store = new PlaybackQueueStore();

        await store.refresh();
        store.save(localSnapshot);
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(authoritative));

        expect(store.state.restoreVersion).toBe(1);
        expect(store.state.error).toContain('another web player');
        expect(store.hasPendingSave).toBe(true);
        expect(store.state.conflict).toEqual({
            authoritative,
            local: localSnapshot
        });

        expect(store.acceptServerConflict()).toBe(true);
        expect(store.state.restoreVersion).toBe(2);
        expect(store.state.conflict).toBeNull();
        expect(store.hasPendingSave).toBe(false);
    });

    it('retries only the latest queue after reconnecting from a network failure', async () => {
        const initial = createSnapshot({ revision: 2 });
        const reconnected = createSnapshot({ revision: 4 });
        const accepted = createSnapshot({ revision: 5, repeatMode: 'all' });
        mocks.fetchPlaybackQueue
            .mockResolvedValueOnce({ type: 'success', playbackQueue: initial })
            .mockResolvedValueOnce({ type: 'success', playbackQueue: reconnected });
        mocks.savePlaybackQueue
            .mockResolvedValueOnce({
                type: 'error',
                category: 'network',
                errors: [{ code: 'NETWORK_ERROR', message: 'offline' }]
            })
            .mockResolvedValueOnce({
                type: 'success',
                savePlaybackQueue: {
                    type: 'conflict',
                    queue: reconnected,
                    conflict: { reason: 'stale-revision', queue: reconnected }
                }
            })
            .mockResolvedValueOnce({
                type: 'success',
                savePlaybackQueue: {
                    type: 'accepted',
                    queue: accepted,
                    conflict: null
                }
            });
        const store = new PlaybackQueueStore();

        store.connect();
        await vi.waitFor(() => expect(store.state.initialized).toBe(true));
        store.save({ ...localSnapshot, repeatMode: 'one' });
        store.save({ ...localSnapshot, repeatMode: 'all' });
        await vi.waitFor(() => expect(store.state.error).toBe('offline'));
        expect(store.hasPendingSave).toBe(true);

        const reconnect = mocks.socketOn.mock.calls.find(
            ([event]) => event === 'connect'
        )?.[1] as (() => void) | undefined;
        reconnect?.();

        await vi.waitFor(() => expect(mocks.savePlaybackQueue).toHaveBeenCalledTimes(2));
        expect(mocks.savePlaybackQueue.mock.calls[1]?.[0]).toEqual(toSaveInput({
            ...localSnapshot,
            repeatMode: 'all'
        }, 2));

        await vi.waitFor(() => expect(store.state.conflict).not.toBeNull());
        expect(store.retryConflict()).toBe(true);
        await vi.waitFor(() => expect(mocks.savePlaybackQueue).toHaveBeenCalledTimes(3));
        expect(mocks.savePlaybackQueue.mock.calls[2]?.[0]).toEqual(toSaveInput({
            ...localSnapshot,
            repeatMode: 'all'
        }, 4));
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(accepted));
    });
});
