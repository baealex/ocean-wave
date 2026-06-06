import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const {
    emitMock,
    recordPlaybackMock,
    setMusicHatedMock,
    setMusicLikedMock,
    toastErrorMock
} = vi.hoisted(() => ({
    emitMock: vi.fn(),
    recordPlaybackMock: vi.fn(),
    setMusicHatedMock: vi.fn(),
    setMusicLikedMock: vi.fn(),
    toastErrorMock: vi.fn()
}));

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
    socket: {
        connected: true,
        on: vi.fn(),
        off: vi.fn(),
        emit: emitMock
    }
}));

import {
    clearPlaybackCheckpoints,
    getPlaybackCheckpoint,
    savePlaybackCheckpoint
} from '~/modules/playback-checkpoint-store';
import { socket } from './socket';
import { MusicListener } from './music-listener';

const createCheckpoint = () => ({
    clientSessionId: 'session-1',
    trackId: 'track-1',
    startedAt: '2026-04-10T10:00:00.000Z',
    accumulatedPlayedMs: 12_000,
    lastResumedAt: '2026-04-10T10:00:05.000Z',
    active: false,
    updatedAt: '2026-04-10T10:00:12.000Z',
    source: 'queue-pagehide'
});

describe('MusicListener playback recovery', () => {
    beforeEach(async () => {
        await clearPlaybackCheckpoints();
        MusicListener.pendingCountEvents = [];
        MusicListener.isFlushing = false;
        MusicListener.isRecovering = false;
        socket.connected = true;
        emitMock.mockReset();
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
            startedAt: '2026-04-10T10:00:00.000Z'
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
            startedAt: '2026-04-10T10:00:00.000Z'
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
            playedMs: 12_000,
            source: 'queue-recovery'
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
