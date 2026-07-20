import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    audio: {
        load: vi.fn(),
        play: vi.fn(),
        playWithResult: vi.fn().mockResolvedValue(undefined),
        getCurrentTime: vi.fn().mockReturnValue(12),
        pause: vi.fn(),
        stop: vi.fn(),
        seek: vi.fn(),
        seekWithResult: vi.fn().mockReturnValue(true),
        download: vi.fn(),
        dispose: vi.fn()
    },
    musicMap: new Map<string, Record<string, unknown>>(),
    sessionState: {
        snapshot: {
            id: '1',
            state: 'paused',
            activeDeviceId: 'target-tab',
            currentMusicId: '1',
            positionMs: 1_000,
            positionUpdatedAt: '2026-07-20T00:00:00.000Z',
            startedAt: '2026-07-20T00:00:00.000Z',
            revision: 3,
            serverTime: '2026-07-20T00:00:00.000Z'
        },
        receivedAtMs: Date.parse('2026-07-20T00:00:00.000Z')
    },
    endpointId: 'target-tab' as string | null,
    sessionQuiesce: vi.fn().mockReturnValue(true),
    queueQuiesce: vi.fn().mockReturnValue(true),
    queueState: {
        snapshot: {
            id: '1',
            musicIds: ['1', '2'],
            sourceMusicIds: [],
            currentIndex: 0,
            shuffle: false,
            repeatMode: 'none',
            revision: 2,
            updatedAt: '2026-07-20T00:00:00.000Z'
        },
        restoreVersion: 1,
        initialized: true,
        loading: false,
        error: null
    },
    sessionRefresh: vi.fn(),
    queueRefresh: vi.fn(),
    musicSubscriber: null as null | ((state: { loaded: boolean }) => Promise<void>),
    queueSubscriber: null as null | ((
        state: unknown,
        previousState: unknown
    ) => void)
}));

vi.mock('~/modules/audio-channel', () => ({
    WebAudioChannel: class {
        constructor() {
            return mocks.audio;
        }
    }
}));

vi.mock('./music', () => ({
    musicStore: {
        state: {
            get musicMap() {
                return mocks.musicMap;
            },
            loaded: false
        },
        subscribe: (subscriber: typeof mocks.musicSubscriber) => {
            mocks.musicSubscriber = subscriber;
            return vi.fn();
        }
    }
}));

vi.mock('./playback-session', () => ({
    playbackSessionStore: {
        get state() {
            return mocks.sessionState;
        },
        get endpointId() {
            return mocks.endpointId;
        },
        hasPendingReport: false,
        report: vi.fn(),
        refresh: mocks.sessionRefresh,
        quiesceForPlaybackCommandRecovery: mocks.sessionQuiesce
    }
}));

vi.mock('./playback-queue', () => ({
    playbackQueueStore: {
        get state() {
            return mocks.queueState;
        },
        hasPendingSave: false,
        subscribe: (subscriber: typeof mocks.queueSubscriber) => {
            mocks.queueSubscriber = subscriber;
            return vi.fn();
        },
        save: vi.fn(),
        refresh: mocks.queueRefresh,
        quiesceForPlaybackCommandRecovery: mocks.queueQuiesce
    }
}));

vi.mock('~/socket', () => ({
    MusicListener: {
        count: vi.fn().mockResolvedValue(true)
    }
}));

vi.mock('~/modules/playback-checkpoint-store', () => ({
    deletePlaybackCheckpoint: vi.fn().mockResolvedValue(undefined),
    savePlaybackCheckpoint: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('~/modules/toast', () => ({ toast: vi.fn() }));

import type { PlaybackCommandDispatch } from '~/socket/playback-command-contract';
import {
    beginPlaybackCommandBarrier,
    endPlaybackCommandBarrier
} from '~/modules/playback-command-barrier';

const baseDispatch: PlaybackCommandDispatch = {
    protocolVersion: 1,
    commandId: '10000000-0000-4000-8000-000000000001',
    targetEndpointId: 'target-tab',
    expectedSessionRevision: 3,
    expectedQueueRevision: null,
    command: { type: 'play' },
    requesterEndpointId: 'controller-tab',
    targetRegistrationGeneration: 1,
    commandSequence: 1,
    issuedAt: '2026-07-20T00:00:00.000Z',
    readyBy: '2026-07-20T00:00:02.000Z',
    expectedSource: {
        sessionRevision: 3,
        queueRevision: 2,
        state: 'paused',
        currentMusicId: '1',
        currentIndex: 0,
        positionMs: 1_000
    },
    desiredResult: {
        state: 'playing',
        currentMusicId: '1',
        currentIndex: 0,
        position: { mode: 'absolute', positionMs: 1_000 }
    }
};

describe('queue playback command adapter', () => {
    let queueStore: typeof import('./queue').queueStore;

    beforeAll(async () => {
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        });
        vi.stubGlobal('document', {
            title: '',
            hidden: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        });
        vi.stubGlobal('localStorage', {
            getItem: vi.fn().mockReturnValue(null),
            setItem: vi.fn()
        });
        queueStore = (await import('./queue')).queueStore;
        await mocks.musicSubscriber?.({ loaded: true });
    });

    afterAll(() => {
        queueStore?.dispose();
        vi.unstubAllGlobals();
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        beginPlaybackCommandBarrier('queue-adapter-test');
        mocks.endpointId = 'target-tab';
        mocks.sessionQuiesce.mockReturnValue(true);
        mocks.queueQuiesce.mockReturnValue(true);
        mocks.audio.playWithResult.mockResolvedValue(undefined);
        mocks.musicMap = new Map([
            ['1', {
                id: '1',
                name: 'First',
                duration: 60,
                artist: { name: 'Artist' }
            }],
            ['2', {
                id: '2',
                name: 'Second',
                duration: 90,
                artist: { name: 'Artist' }
            }]
        ]);
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'target-tab',
            currentMusicId: '1',
            revision: 3
        };
        mocks.queueState.snapshot = {
            ...mocks.queueState.snapshot,
            musicIds: ['1', '2'],
            currentIndex: 0,
            revision: 2
        };
        mocks.sessionRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });
        mocks.queueRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.queueState.snapshot
        });
        await queueStore.set({
            selected: 0,
            currentTrackId: '1',
            queueLength: 2,
            isPlaying: false,
            currentTime: 1,
            progress: 1.67,
            items: ['1', '2'],
            sourceItems: []
        });
    });

    afterEach(() => {
        endPlaybackCommandBarrier('queue-adapter-test');
    });

    it('accepts only matching authoritative and local source snapshots', () => {
        expect(queueStore.preparePlaybackCommand(baseDispatch)).toBeNull();

        expect(queueStore.preparePlaybackCommand({
            ...baseDispatch,
            expectedSource: {
                ...baseDispatch.expectedSource,
                sessionRevision: 4
            }
        })).toEqual(expect.objectContaining({
            code: 'TARGET_STATE_MISMATCH',
            retryable: true
        }));
    });

    it('plays, pauses, seeks, and switches queue items through resolved transitions', async () => {
        const play = await queueStore.executePlaybackCommand(baseDispatch);
        expect(play).toEqual({
            status: 'completed',
            resultingState: {
                state: 'playing',
                currentMusicId: '1',
                currentIndex: 0,
                positionMs: 1_000
            }
        });
        expect(mocks.audio.seekWithResult).toHaveBeenCalledWith(1);
        expect(mocks.audio.playWithResult).toHaveBeenCalledTimes(1);

        await queueStore.set({ isPlaying: true, currentTime: 12 });
        const pause = await queueStore.executePlaybackCommand({
            ...baseDispatch,
            command: { type: 'pause' },
            expectedSource: {
                ...baseDispatch.expectedSource,
                state: 'playing',
                positionMs: 12_000
            },
            desiredResult: {
                state: 'paused',
                currentMusicId: '1',
                currentIndex: 0,
                position: { mode: 'capture-current' }
            }
        });
        expect(pause).toEqual({
            status: 'completed',
            resultingState: {
                state: 'paused',
                currentMusicId: '1',
                currentIndex: 0,
                positionMs: 12_000
            }
        });
        expect(mocks.audio.pause).toHaveBeenCalledTimes(1);

        const seek = await queueStore.executePlaybackCommand({
            ...baseDispatch,
            command: { type: 'seek', positionMs: 20_000 },
            desiredResult: {
                state: 'paused',
                currentMusicId: '1',
                currentIndex: 0,
                position: { mode: 'absolute', positionMs: 20_000 }
            }
        });
        expect(seek).toEqual(expect.objectContaining({
            status: 'completed',
            resultingState: expect.objectContaining({ positionMs: 20_000 })
        }));
        expect(mocks.audio.seekWithResult).toHaveBeenLastCalledWith(20);

        const next = await queueStore.executePlaybackCommand({
            ...baseDispatch,
            expectedQueueRevision: 2,
            command: { type: 'next' },
            desiredResult: {
                state: 'playing',
                currentMusicId: '2',
                currentIndex: 1,
                position: { mode: 'absolute', positionMs: 0 }
            }
        });
        expect(next).toEqual({
            status: 'completed',
            resultingState: {
                state: 'playing',
                currentMusicId: '2',
                currentIndex: 1,
                positionMs: 0
            }
        });
        expect(mocks.audio.load).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
        expect(mocks.audio.playWithResult).toHaveBeenCalledTimes(2);

        const previous = await queueStore.executePlaybackCommand({
            ...baseDispatch,
            command: { type: 'previous' },
            expectedSource: {
                ...baseDispatch.expectedSource,
                state: 'playing',
                currentMusicId: '2',
                currentIndex: 1,
                positionMs: 1_000
            },
            desiredResult: {
                state: 'playing',
                currentMusicId: '1',
                currentIndex: 0,
                position: { mode: 'absolute', positionMs: 0 }
            }
        });
        expect(previous).toEqual({
            status: 'completed',
            resultingState: {
                state: 'playing',
                currentMusicId: '1',
                currentIndex: 0,
                positionMs: 0
            }
        });
        expect(mocks.audio.load).toHaveBeenLastCalledWith(expect.objectContaining({ id: '1' }));
        expect(mocks.audio.playWithResult).toHaveBeenCalledTimes(3);
    });

    it('recovers only from successful snapshots at the acknowledged revisions', async () => {
        await expect(queueStore.recoverPlaybackCommand({
            sessionRevision: 3,
            queueRevision: 2
        }, () => true)).resolves.toBeUndefined();

        expect(mocks.sessionRefresh).toHaveBeenCalledWith(5_000);
        expect(mocks.queueRefresh).toHaveBeenCalledWith(5_000);

        mocks.sessionRefresh.mockResolvedValueOnce({
            type: 'success',
            snapshot: { ...mocks.sessionState.snapshot, revision: 3 }
        });
        await expect(queueStore.recoverPlaybackCommand({
            sessionRevision: 4,
            queueRevision: 2
        }, () => true)).rejects.toThrow('stale session snapshot');

        mocks.sessionRefresh.mockResolvedValueOnce({ type: 'error' });
        await expect(queueStore.recoverPlaybackCommand({
            sessionRevision: null,
            queueRevision: null
        }, () => true)).rejects.toThrow('could not refresh both snapshots');

        mocks.endpointId = null;
        const beginReconciliation = vi.fn(() => true);
        await expect(queueStore.recoverPlaybackCommand({
            sessionRevision: null,
            queueRevision: null
        }, beginReconciliation)).rejects.toThrow('active endpoint registration');
        expect(beginReconciliation).not.toHaveBeenCalled();
    });

    it('waits for prior persistence before reading recovery snapshots', async () => {
        mocks.sessionQuiesce.mockReturnValueOnce(false);

        await expect(queueStore.recoverPlaybackCommand({
            sessionRevision: null,
            queueRevision: null
        }, () => true)).rejects.toThrow('waiting for prior snapshot writes');

        expect(mocks.sessionQuiesce).toHaveBeenCalledOnce();
        expect(mocks.queueQuiesce).toHaveBeenCalledOnce();
        expect(mocks.sessionRefresh).not.toHaveBeenCalled();
        expect(mocks.queueRefresh).not.toHaveBeenCalled();
    });

    it('defers automatic queue restoration until reconciliation begins', async () => {
        let resolveSession!: (value: {
            type: 'success';
            snapshot: typeof mocks.sessionState.snapshot;
        }) => void;
        mocks.sessionRefresh.mockReturnValueOnce(new Promise((resolve) => {
            resolveSession = resolve;
        }));
        const recoveredQueue = {
            ...mocks.queueState.snapshot,
            musicIds: ['2', '1'],
            currentIndex: 0,
            revision: 3
        };
        mocks.queueRefresh.mockImplementationOnce(async () => {
            const previousState = { ...mocks.queueState };
            mocks.queueState.snapshot = recoveredQueue;
            mocks.queueState.restoreVersion += 1;
            mocks.queueSubscriber?.(mocks.queueState, previousState);
            return { type: 'success', snapshot: recoveredQueue };
        });
        const beginReconciliation = vi.fn(() => true);

        const recovery = queueStore.recoverPlaybackCommand({
            sessionRevision: 3,
            queueRevision: 3
        }, beginReconciliation);
        await vi.waitFor(() => expect(mocks.queueRefresh).toHaveBeenCalledOnce());

        expect(beginReconciliation).not.toHaveBeenCalled();
        expect(queueStore.state.items).toEqual(['1', '2']);
        expect(mocks.audio.load).not.toHaveBeenCalled();

        resolveSession({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });
        await expect(recovery).resolves.toBeUndefined();

        expect(beginReconciliation).toHaveBeenCalledOnce();
        expect(queueStore.state.items).toEqual(['2', '1']);
        expect(mocks.audio.load).toHaveBeenCalledWith(
            expect.objectContaining({ id: '2' })
        );
    });

    it('rejects asynchronous reconciliation superseded by a newer snapshot', async () => {
        let resolvePlay!: () => void;
        mocks.audio.playWithResult.mockReturnValue(new Promise<void>((resolve) => {
            resolvePlay = resolve;
        }));
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'playing',
            revision: 4
        };
        mocks.sessionRefresh.mockResolvedValueOnce({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });

        const recovery = queueStore.recoverPlaybackCommand({
            sessionRevision: 4,
            queueRevision: 2
        }, () => true);
        await vi.waitFor(() => {
            expect(mocks.audio.playWithResult).toHaveBeenCalledTimes(1);
        });

        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            revision: 5
        };
        resolvePlay();

        await expect(recovery).rejects.toThrow('superseded by newer state');
        expect(mocks.audio.pause).toHaveBeenCalled();
        expect(queueStore.state.isPlaying).toBe(false);
    });

    it('bounds media recovery and falls back to a paused local state', async () => {
        vi.useFakeTimers();
        try {
            mocks.audio.playWithResult.mockReturnValue(new Promise<void>(() => undefined));
            mocks.sessionState.snapshot = {
                ...mocks.sessionState.snapshot,
                state: 'playing',
                revision: 4
            };
            mocks.sessionRefresh.mockResolvedValueOnce({
                type: 'success',
                snapshot: mocks.sessionState.snapshot
            });

            const recovery = queueStore.recoverPlaybackCommand({
                sessionRevision: 4,
                queueRevision: 2
            }, () => true);
            await vi.waitFor(() => {
                expect(mocks.audio.playWithResult).toHaveBeenCalledTimes(1);
            });

            await vi.advanceTimersByTimeAsync(2_000);

            await expect(recovery).resolves.toBeUndefined();
            expect(mocks.audio.pause).toHaveBeenCalled();
            expect(queueStore.state.isPlaying).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('maps browser autoplay rejection to the stable target error', async () => {
        mocks.audio.playWithResult.mockRejectedValue(
            new DOMException('blocked', 'NotAllowedError')
        );

        await expect(queueStore.executePlaybackCommand(baseDispatch)).resolves.toEqual({
            status: 'rejected',
            error: {
                code: 'AUTOPLAY_BLOCKED',
                retryable: false,
                message: 'Browser autoplay policy blocked the remote playback command.'
            }
        });
    });
});
