import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const {
    emitMock,
    setMusicHatedMock,
    setMusicLikedMock,
    toastErrorMock
} = vi.hoisted(() => ({
    emitMock: vi.fn(),
    setMusicHatedMock: vi.fn(),
    setMusicLikedMock: vi.fn(),
    toastErrorMock: vi.fn()
}));

vi.mock('~/api/music', () => ({
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
import { MUSIC_COUNT, MusicListener } from './music-listener';

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
        socket.connected = true;
        emitMock.mockReset();
        setMusicHatedMock.mockReset();
        setMusicLikedMock.mockReset();
        toastErrorMock.mockReset();
    });

    it('flushes pending count events and reports successful delivery after ack', async () => {
        emitMock.mockImplementation((_event, _payload, ack) => {
            ack?.({ ok: true });
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
        expect(emitMock).toHaveBeenCalledWith(
            MUSIC_COUNT,
            expect.objectContaining({
                id: 'track-1',
                clientSessionId: 'session-1'
            }),
            expect.any(Function)
        );
    });

    it('deletes recovered checkpoints after a successful recovery ack', async () => {
        emitMock.mockImplementation((_event, _payload, ack) => {
            ack?.({ ok: true });
        });
        await savePlaybackCheckpoint(createCheckpoint());

        await MusicListener.recoverPlaybackCheckpoints();

        expect(emitMock).toHaveBeenCalledWith(
            MUSIC_COUNT,
            expect.objectContaining({
                id: 'track-1',
                clientSessionId: 'session-1',
                playedMs: 12_000,
                source: 'queue-recovery'
            }),
            expect.any(Function)
        );
        expect(await getPlaybackCheckpoint('session-1')).toBeNull();
    });

    it('keeps checkpoints for the next startup when recovery delivery fails', async () => {
        emitMock.mockImplementation((_event, _payload, ack) => {
            ack?.({ ok: false });
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
