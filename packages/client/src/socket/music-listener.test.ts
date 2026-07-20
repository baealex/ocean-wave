import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const {
    emitMock,
    offMock,
    onMock,
    recordPlaybackMock,
    setMusicHatedMock,
    setMusicLikedMock,
    socketMock,
    toastErrorMock
} = vi.hoisted(() => {
    const socketMock = {
        id: 'client-1',
        connected: true,
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn()
    };

    return {
        emitMock: socketMock.emit,
        offMock: socketMock.off,
        onMock: socketMock.on,
        recordPlaybackMock: vi.fn(),
        setMusicHatedMock: vi.fn(),
        setMusicLikedMock: vi.fn(),
        socketMock,
        toastErrorMock: vi.fn()
    };
});

vi.mock('~/api/music', () => ({
    recordPlayback: recordPlaybackMock,
    setMusicHated: setMusicHatedMock,
    setMusicLiked: setMusicLikedMock
}));

vi.mock('~/modules/toast', () => ({
    toast: {
        error: toastErrorMock
    }
}));

vi.mock('./socket', () => ({
    socket: socketMock,
    isOwnRealtimeNotification: (payload?: { originClientId?: string | null }) => {
        return Boolean(payload?.originClientId && payload.originClientId === socketMock.id);
    }
}));

import {
    clearPlaybackCheckpoints,
    getPlaybackCheckpoint,
    savePlaybackCheckpoint
} from '~/modules/playback-checkpoint-store';
import type { PlaybackSessionCheckpoint } from '~/modules/playback-session';
import {
    MUSIC_LIKE,
    MusicListener
} from './music-listener';
import { socket } from './socket';

const createCheckpoint = (
    overrides: Partial<PlaybackSessionCheckpoint> = {}
): PlaybackSessionCheckpoint => ({
    clientSessionId: 'session-1',
    branchId: 'target-branch-1',
    parentBranchId: 'session-1',
    branchBasePlayedMs: 8_000,
    trackId: 'track-1',
    startedAt: '2026-04-10T10:00:00.000Z',
    accumulatedPlayedMs: 12_000,
    hadSeek: true,
    lastResumedAt: '2026-04-10T10:00:05.000Z',
    active: false,
    updatedAt: '2026-04-10T10:00:12.000Z',
    source: 'queue-pagehide',
    ...overrides
});

describe('MusicListener playback recovery', () => {
    beforeEach(async () => {
        await clearPlaybackCheckpoints();
        MusicListener.pendingCountEvents = [];
        MusicListener.isFlushing = false;
        MusicListener.isRecovering = false;
        socket.id = 'client-1';
        socket.connected = true;
        emitMock.mockReset();
        onMock.mockReset();
        offMock.mockReset();
        recordPlaybackMock.mockReset();
        setMusicHatedMock.mockReset();
        setMusicLikedMock.mockReset();
        toastErrorMock.mockReset();
    });

    it('flushes pending count events and reports successful delivery after GraphQL success', async () => {
        const onCount = vi.fn();
        const listener = new MusicListener();
        recordPlaybackMock.mockResolvedValue({
            type: 'success',
            recordPlayback: {
                id: 'track-1',
                playCount: 1,
                lastPlayedAt: '2026-04-10T10:00:15.000Z',
                totalPlayedMs: 15_000,
                countedAsPlay: true,
                deduped: false
            }
        });
        listener.connect({
            onLike: vi.fn(),
            onHate: vi.fn(),
            onCount
        });

        const delivered = await MusicListener.count({
            id: 'track-1',
            clientSessionId: 'session-1',
            playedMs: 15_000,
            completionRate: 0.25,
            startedAt: '2026-04-10T10:00:00.000Z',
            endedAt: '2026-04-10T10:00:15.000Z',
            endReason: 'skipped',
            hadSeek: false,
            source: 'queue-track-change'
        });

        expect(delivered).toBe(true);
        expect(MusicListener.pendingCountEvents).toEqual([]);
        expect(recordPlaybackMock).toHaveBeenCalledWith(expect.objectContaining({
            id: 'track-1',
            clientSessionId: 'session-1'
        }));
        expect(onCount).toHaveBeenCalledWith(expect.objectContaining({
            id: 'track-1',
            playCount: 1
        }));
        listener.disconnect();
    });

    it('records playback through GraphQL even when the socket is disconnected', async () => {
        const onCount = vi.fn();
        const listener = new MusicListener();
        socket.connected = false;
        recordPlaybackMock.mockResolvedValue({
            type: 'success',
            recordPlayback: {
                id: 'track-1',
                playCount: 2,
                lastPlayedAt: '2026-04-10T10:00:15.000Z',
                totalPlayedMs: 30_000,
                countedAsPlay: true,
                deduped: false
            }
        });
        listener.connect({
            onLike: vi.fn(),
            onHate: vi.fn(),
            onCount
        });

        const delivered = await MusicListener.count({
            id: 'track-1',
            clientSessionId: 'session-1',
            playedMs: 15_000,
            startedAt: '2026-04-10T10:00:00.000Z',
            endedAt: '2026-04-10T10:00:15.000Z',
            endReason: 'stopped',
            hadSeek: false
        });

        expect(delivered).toBe(true);
        expect(recordPlaybackMock).toHaveBeenCalledWith(expect.objectContaining({
            id: 'track-1',
            clientSessionId: 'session-1'
        }));
        expect(onCount).toHaveBeenCalledWith(expect.objectContaining({
            id: 'track-1',
            playCount: 2
        }));
        listener.disconnect();
    });

    it('requeues playback count when the GraphQL record request times out', async () => {
        vi.useFakeTimers();
        const payload = {
            id: 'track-1',
            clientSessionId: 'session-timeout',
            playedMs: 15_000,
            startedAt: '2026-04-10T10:00:00.000Z',
            endedAt: '2026-04-10T10:00:15.000Z',
            endReason: 'unload' as const,
            hadSeek: false
        };
        recordPlaybackMock.mockReturnValue(new Promise(() => {}));

        try {
            const deliveredPromise = MusicListener.count(payload);

            await vi.advanceTimersByTimeAsync(5_000);

            await expect(deliveredPromise).resolves.toBe(false);
            expect(MusicListener.pendingCountEvents).toEqual([payload]);
            expect(MusicListener.isFlushing).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('runs only one checkpoint recovery at a time', async () => {
        let resolveRecord: (value: unknown) => void = () => {};
        recordPlaybackMock.mockReturnValue(new Promise((resolve) => {
            resolveRecord = resolve;
        }));
        await savePlaybackCheckpoint(createCheckpoint());

        const firstRecovery = MusicListener.recoverPlaybackCheckpoints();
        const secondRecovery = MusicListener.recoverPlaybackCheckpoints();

        await vi.waitFor(() => {
            expect(recordPlaybackMock).toHaveBeenCalledTimes(1);
        });

        resolveRecord({
            type: 'success',
            recordPlayback: {
                id: 'track-1',
                playCount: 0,
                lastPlayedAt: '2026-04-10T10:00:12.000Z',
                totalPlayedMs: 12_000,
                countedAsPlay: false,
                deduped: false
            }
        });
        await Promise.all([firstRecovery, secondRecovery]);

        expect(await getPlaybackCheckpoint('session-1')).toBeNull();
    });

    it('deletes recovered checkpoints after a successful recovery commit', async () => {
        recordPlaybackMock.mockResolvedValue({
            type: 'success',
            recordPlayback: {
                id: 'track-1',
                playCount: 0,
                lastPlayedAt: '2026-04-10T10:00:12.000Z',
                totalPlayedMs: 12_000,
                countedAsPlay: false,
                deduped: false
            }
        });
        await savePlaybackCheckpoint(createCheckpoint());

        await MusicListener.recoverPlaybackCheckpoints();

        expect(recordPlaybackMock).toHaveBeenCalledWith(expect.objectContaining({
            id: 'track-1',
            clientSessionId: 'session-1',
            branchId: 'target-branch-1',
            parentBranchId: 'session-1',
            branchBasePlayedMs: 8_000,
            playedMs: 12_000,
            endedAt: '2026-04-10T10:00:12.000Z',
            endReason: 'recovery',
            hadSeek: true,
            source: 'queue-recovery'
        }));
        expect(await getPlaybackCheckpoint('session-1')).toBeNull();
    });

    it('keeps a newer branch snapshot when sibling recovery acknowledgements arrive late', async () => {
        let resolveFirstRecord: (value: unknown) => void = () => {};
        const successfulRecord = {
            type: 'success',
            recordPlayback: {
                id: 'track-1',
                playCount: 1,
                lastPlayedAt: '2026-04-10T10:00:20.000Z',
                totalPlayedMs: 50_000,
                countedAsPlay: true,
                deduped: false
            }
        };
        recordPlaybackMock
            .mockReturnValueOnce(new Promise((resolve) => {
                resolveFirstRecord = resolve;
            }))
            .mockResolvedValue(successfulRecord);
        const rootCheckpoint = createCheckpoint({
            clientSessionId: 'shared-session',
            branchId: 'shared-session',
            parentBranchId: null,
            branchBasePlayedMs: 0,
            accumulatedPlayedMs: 39_000,
            updatedAt: '2026-04-10T10:00:12.000Z'
        });
        const targetCheckpoint = createCheckpoint({
            clientSessionId: 'shared-session',
            branchId: 'target-branch',
            parentBranchId: 'shared-session',
            branchBasePlayedMs: 30_000,
            accumulatedPlayedMs: 50_000,
            updatedAt: '2026-04-10T10:00:15.000Z'
        });
        const newerRootCheckpoint = createCheckpoint({
            ...rootCheckpoint,
            accumulatedPlayedMs: 45_000,
            updatedAt: '2026-04-10T10:00:20.000Z',
            source: 'queue-checkpoint'
        });
        await savePlaybackCheckpoint(rootCheckpoint);
        await savePlaybackCheckpoint(targetCheckpoint);

        const recovery = MusicListener.recoverPlaybackCheckpoints();
        await vi.waitFor(() => {
            expect(recordPlaybackMock).toHaveBeenCalledTimes(1);
        });
        await savePlaybackCheckpoint(newerRootCheckpoint);
        resolveFirstRecord(successfulRecord);
        await recovery;

        expect(recordPlaybackMock).toHaveBeenCalledTimes(2);
        expect(await getPlaybackCheckpoint(
            'shared-session',
            'shared-session'
        )).toEqual(newerRootCheckpoint);
        expect(await getPlaybackCheckpoint(
            'shared-session',
            'target-branch'
        )).toBeNull();
    });

    it('replays the original terminal signal after a failed delivery', async () => {
        recordPlaybackMock.mockResolvedValue({
            type: 'success',
            recordPlayback: {
                id: 'track-1',
                playCount: 1,
                lastPlayedAt: '2026-04-10T10:00:12.000Z',
                totalPlayedMs: 12_000,
                countedAsPlay: true,
                deduped: false
            }
        });
        await savePlaybackCheckpoint({
            ...createCheckpoint(),
            endedAt: '2026-04-10T10:00:13.000Z',
            endReason: 'skipped',
            source: 'queue-track-change'
        });

        await MusicListener.recoverPlaybackCheckpoints();

        expect(recordPlaybackMock).toHaveBeenCalledWith(expect.objectContaining({
            clientSessionId: 'session-1',
            endedAt: '2026-04-10T10:00:13.000Z',
            endReason: 'skipped',
            hadSeek: true,
            source: 'queue-track-change'
        }));
        expect(await getPlaybackCheckpoint('session-1')).toBeNull();
    });

    it('keeps checkpoints for the next startup when recovery delivery fails', async () => {
        recordPlaybackMock.mockResolvedValue({
            type: 'error',
            category: 'network',
            errors: [{
                code: 'NETWORK_ERROR',
                message: 'Network request failed'
            }]
        });
        await savePlaybackCheckpoint(createCheckpoint());

        await MusicListener.recoverPlaybackCheckpoints();

        expect(await getPlaybackCheckpoint('session-1')).toEqual(createCheckpoint());
    });
});

describe('MusicListener music preference writes', () => {
    beforeEach(() => {
        socket.id = 'client-1';
        onMock.mockReset();
        offMock.mockReset();
        setMusicHatedMock.mockReset();
        setMusicLikedMock.mockReset();
        toastErrorMock.mockReset();
    });

    it('applies liked mutation response to connected handlers', async () => {
        const onLike = vi.fn();
        const listener = new MusicListener();
        setMusicLikedMock.mockResolvedValue({
            type: 'success',
            setMusicLiked: {
                id: 'track-1',
                isLiked: true
            }
        });

        listener.connect({
            onLike,
            onHate: vi.fn(),
            onCount: vi.fn()
        });

        MusicListener.like('track-1', true);

        await vi.waitFor(() => {
            expect(onLike).toHaveBeenCalledWith({
                id: 'track-1',
                isLiked: true
            });
        });
        listener.disconnect();
    });



    it('ignores realtime preference notifications from the same socket client', () => {
        const onLike = vi.fn();
        const listener = new MusicListener();

        listener.connect({
            onLike,
            onHate: vi.fn(),
            onCount: vi.fn()
        });

        const likeHandler = onMock.mock.calls.find(([event]) => event === MUSIC_LIKE)?.[1] as (
            payload: { id: string; isLiked: boolean; originClientId?: string }
        ) => void;

        likeHandler({
            id: 'track-1',
            isLiked: true,
            originClientId: 'client-1'
        });
        likeHandler({
            id: 'track-1',
            isLiked: true,
            originClientId: 'client-2'
        });

        expect(onLike).toHaveBeenCalledTimes(1);
        expect(onLike).toHaveBeenCalledWith({
            id: 'track-1',
            isLiked: true,
            originClientId: 'client-2'
        });
        listener.disconnect();
    });

    it('shows mutation errors without applying hated state', async () => {
        const onHate = vi.fn();
        const listener = new MusicListener();
        setMusicHatedMock.mockResolvedValue({
            type: 'error',
            category: 'graphql',
            errors: [{
                code: 'MUSIC_NOT_FOUND',
                message: 'Music not found.'
            }]
        });

        listener.connect({
            onLike: vi.fn(),
            onHate,
            onCount: vi.fn()
        });

        MusicListener.hate('track-1', true);

        await vi.waitFor(() => {
            expect(toastErrorMock).toHaveBeenCalledWith('Music not found.');
        });
        expect(onHate).not.toHaveBeenCalled();
        listener.disconnect();
    });
});
