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
    socket: {
        on: mocks.socketOn,
        off: mocks.socketOff
    }
}));

import type { PlaybackQueueSnapshot } from '~/api/playback-queue';
import {
    PlaybackQueueStore,
    type LocalPlaybackQueueSnapshot
} from './playback-queue';

const createSnapshot = (
    overrides: Partial<PlaybackQueueSnapshot> = {}
): PlaybackQueueSnapshot => ({
    id: '1',
    musicIds: ['42'],
    sourceMusicIds: [],
    currentIndex: 0,
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
    shuffle: false,
    repeatMode: 'none'
};

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

        expect(store.state).toMatchObject({
            snapshot,
            restoreVersion: 1,
            initialized: true,
            error: null
        });
        store.disconnect();
        expect(mocks.socketOff).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('holds a local change until the server revision is known', async () => {
        const serverSnapshot = createSnapshot({ revision: 4 });
        const accepted = createSnapshot({ revision: 5, repeatMode: 'all' });
        mocks.fetchPlaybackQueue.mockResolvedValue({
            type: 'success',
            playbackQueue: serverSnapshot
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

        store.save({ ...localSnapshot, repeatMode: 'all' });
        expect(mocks.savePlaybackQueue).not.toHaveBeenCalled();
        store.connect();

        await vi.waitFor(() => expect(mocks.savePlaybackQueue).toHaveBeenCalledOnce());
        expect(mocks.savePlaybackQueue).toHaveBeenCalledWith({
            ...localSnapshot,
            repeatMode: 'all',
            expectedRevision: 4
        });
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(accepted));
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
        expect(mocks.savePlaybackQueue.mock.calls[1]?.[0]).toEqual({
            ...localSnapshot,
            repeatMode: 'all',
            expectedRevision: 2
        });
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
        expect(mocks.savePlaybackQueue.mock.calls[1]?.[0]).toEqual({
            ...localSnapshot,
            repeatMode: 'all',
            expectedRevision: 4
        });
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(accepted));
    });
});
