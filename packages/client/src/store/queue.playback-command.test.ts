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
    audioEventHandler: null as null | import('~/modules/audio-channel').AudioChannelEventHandler,
    audio: {
        load: vi.fn(),
        play: vi.fn(),
        playWithResult: vi.fn().mockResolvedValue(undefined),
        beginMutedPlayback: vi.fn().mockResolvedValue(undefined),
        commitMutedPlayback: vi.fn().mockResolvedValue(undefined),
        cancelMutedPlayback: vi.fn(),
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
    sessionReport: vi.fn(),
    sessionBufferDisconnectPause: vi.fn(),
    queueRefresh: vi.fn(),
    musicSubscriber: null as null | ((state: { loaded: boolean }) => Promise<void>),
    queueSubscriber: null as null | ((
        state: unknown,
        previousState: unknown
    ) => void)
}));

vi.mock('~/modules/audio-channel', () => ({
    WebAudioChannel: class {
        constructor(handler: import('~/modules/audio-channel').AudioChannelEventHandler) {
            mocks.audioEventHandler = handler;
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
        report: mocks.sessionReport,
        bufferSocketDisconnectPause: mocks.sessionBufferDisconnectPause,
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

import {
    beginPlaybackCommandBarrier,
    beginPlaybackControllerCommandBarrier,
    endPlaybackCommandBarrier,
    endPlaybackControllerCommandBarrier
} from '~/modules/playback-command-barrier';
import type { PlaybackCommandDispatch } from '~/socket/playback-command-contract';
import type {
    PlaybackHandoffActivationDispatch,
    PlaybackHandoffReleaseDispatch,
    PlaybackHandoffSnapshot,
    PlaybackHandoffSourceSettleDispatch
} from '~/socket/playback-handoff-contract';

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

const handoffSnapshot: PlaybackHandoffSnapshot = {
    sessionRevision: 3,
    queueRevision: 2,
    state: 'playing',
    currentMusicId: '1',
    currentIndex: 0,
    positionMs: 12_000,
    queue: {
        id: '1',
        musicIds: ['1', '2'],
        sourceMusicIds: [],
        currentIndex: 0,
        shuffle: false,
        repeatMode: 'none',
        revision: 2,
        updatedAt: '2026-07-20T00:00:00.000Z'
    }
};

const handoffRelease: PlaybackHandoffReleaseDispatch = {
    protocolVersion: 1,
    commandEpoch: 'epoch-1',
    handoffId: 'handoff-1',
    handoffSequence: 1,
    sourceEndpointId: 'source-tab',
    sourceRegistrationGeneration: 2,
    targetEndpointId: 'target-tab',
    targetRegistrationGeneration: 3,
    issuedAt: '2026-07-20T00:00:00.000Z',
    releaseBy: '2026-07-20T00:00:05.000Z',
    snapshot: handoffSnapshot
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
        mocks.audio.beginMutedPlayback.mockResolvedValue(undefined);
        mocks.audio.commitMutedPlayback.mockResolvedValue(undefined);
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
            playMode: 'later',
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

    it('blocks controller-side queue and audio mutations for the full pending lifecycle', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        const controllerBarrier = Symbol('controller-pending-test');
        beginPlaybackControllerCommandBarrier(controllerBarrier);

        try {
            const stateBeforeActions = { ...queueStore.state };

            queueStore.select(1);
            queueStore.play();
            queueStore.seek(20);
            queueStore.next();
            await queueStore.add('2');
            await queueStore.removeItems(['1']);
            queueStore.reorderToIndex('2', 0);
            queueStore.toggleShuffle();

            expect(queueStore.state).toEqual(stateBeforeActions);
            expect(mocks.audio.load).not.toHaveBeenCalled();
            expect(mocks.audio.play).not.toHaveBeenCalled();
            expect(mocks.audio.seek).not.toHaveBeenCalled();
        } finally {
            endPlaybackControllerCommandBarrier(controllerBarrier);
        }

        queueStore.select(1);
        expect(queueStore.state.currentTrackId).toBe('2');
        expect(mocks.audio.load).toHaveBeenCalledWith(
            expect.objectContaining({ id: '2' })
        );
    });

    it('blocks delayed audio events from claiming or mixing during a controller command', () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        const controllerBarrier = Symbol('controller-audio-event-test');
        const mix = vi.fn();
        beginPlaybackControllerCommandBarrier(controllerBarrier);

        try {
            mocks.audioEventHandler?.onPlay?.();
            mocks.audioEventHandler?.onPause?.();
            mocks.audioEventHandler?.onStop?.();
            mocks.audioEventHandler?.onEnded();
            mocks.audioEventHandler?.onTimeUpdate(20, mix);

            expect(mocks.audio.pause).toHaveBeenCalledOnce();
            expect(mocks.audio.load).not.toHaveBeenCalled();
            expect(mocks.audio.play).not.toHaveBeenCalled();
            expect(queueStore.state.isPlaying).toBe(false);
            expect(mocks.sessionReport).not.toHaveBeenCalled();
            expect(mix).not.toHaveBeenCalled();
        } finally {
            endPlaybackControllerCommandBarrier(controllerBarrier);
        }

        mocks.audioEventHandler?.onPlay?.();
        expect(queueStore.state.isPlaying).toBe(true);
        expect(mocks.sessionReport).toHaveBeenCalledWith(
            expect.objectContaining({ state: 'playing' }),
            expect.objectContaining({ claimActive: true })
        );
    });

    it('silences local audio and buffers a passive pause when the socket disconnects', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        await queueStore.set({ isPlaying: true, currentTime: 12 });
        mocks.audio.getCurrentTime.mockReturnValueOnce(12.25);

        queueStore.silencePlaybackForSocketDisconnect();

        expect(mocks.audio.pause).toHaveBeenCalledOnce();
        expect(queueStore.state.isPlaying).toBe(false);
        expect(mocks.sessionBufferDisconnectPause).toHaveBeenCalledWith({
            currentMusicId: '1',
            positionMs: 12_250
        }, null);
    });

    it('reports a delayed paused time update without restarting shared playback', () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        const mix = vi.fn();

        mocks.audioEventHandler?.onTimeUpdate(20, mix);

        expect(mocks.sessionReport).toHaveBeenCalledWith({
            state: 'paused',
            currentMusicId: '1',
            positionMs: 20_000
        }, {
            claimActive: false,
            checkpoint: true
        });
        expect(queueStore.state.isPlaying).toBe(false);
    });

    it('rejects an incoming target command while this tab controls another player', () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        const controllerBarrier = Symbol('controller-target-overlap-test');
        expect(beginPlaybackControllerCommandBarrier(controllerBarrier)).toBe(true);

        try {
            expect(beginPlaybackCommandBarrier('overlapping-target-command')).toBe(false);
            expect(queueStore.preparePlaybackCommand(baseDispatch)).toEqual({
                code: 'TARGET_STATE_MISMATCH',
                message: 'This player is already controlling another playback command.',
                retryable: true
            });
        } finally {
            endPlaybackControllerCommandBarrier(controllerBarrier);
            endPlaybackCommandBarrier('overlapping-target-command');
        }
    });

    it('prevents remote ownership from becoming an implicit local playback claim', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        mocks.endpointId = 'local-tab';
        mocks.musicMap.set('3', {
            id: '3',
            name: 'Third',
            duration: 120,
            artist: { name: 'Artist' }
        });
        await queueStore.set({ playMode: 'immediately' });

        const selectedBeforeActions = queueStore.state.selected;
        queueStore.select(1);
        queueStore.play();
        queueStore.next();
        queueStore.prev();
        await queueStore.reset(['2']);
        await queueStore.add('3');

        expect(queueStore.state).toMatchObject({
            selected: selectedBeforeActions,
            currentTrackId: '1',
            isPlaying: false,
            items: ['1', '2', '3']
        });
        expect(mocks.audio.load).not.toHaveBeenCalled();
        expect(mocks.audio.play).not.toHaveBeenCalled();
        expect(mocks.sessionReport).not.toHaveBeenCalled();

        mocks.audioEventHandler?.onPlay?.();
        expect(mocks.audio.pause).toHaveBeenCalledOnce();
        expect(queueStore.state.isPlaying).toBe(false);
        expect(mocks.sessionReport).not.toHaveBeenCalled();
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

    it('warms muted target audio from the Play Here gesture and unmutes only after claim', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        const controllerBarrier = Symbol('handoff-target-test');
        beginPlaybackControllerCommandBarrier(controllerBarrier);
        mocks.endpointId = 'target-tab';
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'playing',
            activeDeviceId: 'source-tab',
            currentMusicId: '1',
            revision: 3
        };

        try {
            const preparation = queueStore.primePlaybackHandoff(handoffSnapshot);
            expect(mocks.audio.beginMutedPlayback).toHaveBeenCalledOnce();
            await expect(preparation).resolves.toEqual({ status: 'ready' });
            expect(mocks.audio.load).toHaveBeenCalledWith(
                expect.objectContaining({ id: '1' })
            );

            const activation: PlaybackHandoffActivationDispatch = {
                protocolVersion: 1,
                commandEpoch: 'epoch-1',
                handoffId: 'handoff-1',
                handoffSequence: 1,
                sourceEndpointId: 'source-tab',
                targetEndpointId: 'target-tab',
                targetRegistrationGeneration: 3,
                claimSessionRevision: 4,
                activateBy: '2026-07-20T00:00:10.000Z',
                snapshot: {
                    ...handoffSnapshot,
                    sessionRevision: 4,
                    positionMs: 12_500
                }
            };
            await expect(queueStore.activatePlaybackHandoff(activation)).resolves.toEqual(
                expect.objectContaining({
                    status: 'completed',
                    positionMs: 12_500
                })
            );
            expect(mocks.audio.commitMutedPlayback).toHaveBeenCalledOnce();
            expect(queueStore.state.isPlaying).toBe(true);

            queueStore.finishPlaybackHandoffTarget(true);
            expect(mocks.audio.commitMutedPlayback).toHaveBeenCalledOnce();
        } finally {
            queueStore.finishPlaybackHandoffTarget(false);
            endPlaybackControllerCommandBarrier(controllerBarrier);
        }
    });

    it('rejects activation when an ended muted warm-up cannot restart', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        const controllerBarrier = Symbol('handoff-ended-warmup-test');
        beginPlaybackControllerCommandBarrier(controllerBarrier);
        mocks.endpointId = 'target-tab';
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'playing',
            activeDeviceId: 'source-tab',
            currentMusicId: '1',
            revision: 3
        };

        try {
            await expect(queueStore.primePlaybackHandoff(handoffSnapshot)).resolves.toEqual({
                status: 'ready'
            });
            mocks.audio.commitMutedPlayback.mockRejectedValueOnce(
                new DOMException('The ended warm-up could not restart.', 'NotAllowedError')
            );

            await expect(queueStore.activatePlaybackHandoff({
                protocolVersion: 1,
                commandEpoch: 'epoch-1',
                handoffId: 'handoff-1',
                handoffSequence: 1,
                sourceEndpointId: 'source-tab',
                targetEndpointId: 'target-tab',
                targetRegistrationGeneration: 3,
                claimSessionRevision: 4,
                activateBy: '2026-07-20T00:00:10.000Z',
                snapshot: {
                    ...handoffSnapshot,
                    sessionRevision: 4
                }
            })).resolves.toEqual({
                status: 'rejected',
                error: {
                    code: 'AUTOPLAY_BLOCKED',
                    message: 'Browser autoplay policy blocked Play Here. Try again from this button.',
                    retryable: false,
                    forceAllowed: false
                }
            });
            expect(mocks.audio.cancelMutedPlayback).toHaveBeenCalledOnce();
            expect(queueStore.state.isPlaying).toBe(false);
        } finally {
            queueStore.finishPlaybackHandoffTarget(false);
            endPlaybackControllerCommandBarrier(controllerBarrier);
        }
    });

    it('cancels target warm-up and rejects later activation after a socket disconnect', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        const controllerBarrier = Symbol('handoff-target-disconnect-test');
        beginPlaybackControllerCommandBarrier(controllerBarrier);
        mocks.endpointId = 'target-tab';
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'playing',
            activeDeviceId: 'source-tab',
            currentMusicId: '1',
            revision: 3
        };

        try {
            await expect(queueStore.primePlaybackHandoff(handoffSnapshot)).resolves.toEqual({
                status: 'ready'
            });

            queueStore.silencePlaybackForSocketDisconnect('target-tab');

            expect(mocks.audio.cancelMutedPlayback).toHaveBeenCalledOnce();
            expect(queueStore.state.isPlaying).toBe(false);
            expect(mocks.sessionBufferDisconnectPause).toHaveBeenCalledWith({
                currentMusicId: '1',
                positionMs: 12_000
            }, 'target-tab');

            await expect(queueStore.activatePlaybackHandoff({
                protocolVersion: 1,
                commandEpoch: 'epoch-1',
                handoffId: 'handoff-1',
                handoffSequence: 1,
                sourceEndpointId: 'source-tab',
                targetEndpointId: 'target-tab',
                targetRegistrationGeneration: 3,
                claimSessionRevision: 4,
                activateBy: '2026-07-20T00:00:10.000Z',
                snapshot: {
                    ...handoffSnapshot,
                    sessionRevision: 4
                }
            })).resolves.toEqual(expect.objectContaining({
                status: 'rejected',
                error: expect.objectContaining({ code: 'TARGET_STATE_MISMATCH' })
            }));
            expect(mocks.audio.commitMutedPlayback).not.toHaveBeenCalled();
        } finally {
            queueStore.finishPlaybackHandoffTarget(false);
            endPlaybackControllerCommandBarrier(controllerBarrier);
        }
    });

    it('prepares a stopped offline snapshot as paused without starting audio', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        const controllerBarrier = Symbol('handoff-stopped-target-test');
        beginPlaybackControllerCommandBarrier(controllerBarrier);
        mocks.endpointId = 'target-tab';
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'stopped',
            activeDeviceId: 'source-tab',
            currentMusicId: '1',
            revision: 3
        };

        try {
            await expect(queueStore.primePlaybackHandoff({
                ...handoffSnapshot,
                state: 'paused'
            })).resolves.toEqual({ status: 'ready' });
            expect(mocks.audio.beginMutedPlayback).not.toHaveBeenCalled();
            expect(mocks.audio.load).toHaveBeenCalledWith(
                expect.objectContaining({ id: '1' })
            );
        } finally {
            queueStore.finishPlaybackHandoffTarget(false);
            endPlaybackControllerCommandBarrier(controllerBarrier);
        }
    });

    it('fails closed when target registration changes during gesture resume', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        let resolvePlayback!: (value: void | PromiseLike<void>) => void;
        mocks.audio.playWithResult.mockReturnValueOnce(new Promise<void>((resolve) => {
            resolvePlayback = resolve;
        }));

        const resume = queueStore.resumePlaybackHandoffHere();
        await vi.waitFor(() => {
            expect(mocks.audio.playWithResult).toHaveBeenCalledOnce();
        });

        mocks.endpointId = null;
        resolvePlayback(undefined);

        await expect(resume).resolves.toBe(false);
        expect(mocks.audio.pause).toHaveBeenCalledOnce();
        expect(queueStore.state.isPlaying).toBe(false);
    });

    it('fails closed when a playback barrier starts during gesture resume', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        let resolvePlayback!: (value: void | PromiseLike<void>) => void;
        mocks.audio.playWithResult.mockReturnValueOnce(new Promise<void>((resolve) => {
            resolvePlayback = resolve;
        }));

        const resume = queueStore.resumePlaybackHandoffHere();
        await vi.waitFor(() => {
            expect(mocks.audio.playWithResult).toHaveBeenCalledOnce();
        });

        const controllerBarrier = Symbol('handoff-resume-race-test');
        expect(beginPlaybackControllerCommandBarrier(controllerBarrier)).toBe(true);
        resolvePlayback(undefined);

        try {
            await expect(resume).resolves.toBe(false);
            expect(mocks.audio.pause).toHaveBeenCalledOnce();
            expect(queueStore.state.isPlaying).toBe(false);
        } finally {
            endPlaybackControllerCommandBarrier(controllerBarrier);
        }
    });

    it('does not resume while the browser is a released handoff source', async () => {
        await expect(queueStore.releasePlaybackHandoff({
            ...handoffRelease,
            sourceEndpointId: 'target-tab'
        })).resolves.toEqual(expect.objectContaining({ status: 'released' }));
        mocks.audio.playWithResult.mockClear();

        await expect(queueStore.resumePlaybackHandoffHere()).resolves.toBe(false);
        expect(mocks.audio.playWithResult).not.toHaveBeenCalled();

        queueStore.abandonPlaybackHandoffSource();
        expect(queueStore.state.isPlaying).toBe(false);
    });

    it('rejects resume after a source handoff starts and settles in flight', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        let resolvePlayback!: (value: void | PromiseLike<void>) => void;
        mocks.audio.playWithResult.mockReturnValueOnce(new Promise<void>((resolve) => {
            resolvePlayback = resolve;
        }));

        const resume = queueStore.resumePlaybackHandoffHere();
        await vi.waitFor(() => {
            expect(mocks.audio.playWithResult).toHaveBeenCalledOnce();
        });

        await queueStore.releasePlaybackHandoff({
            ...handoffRelease,
            sourceEndpointId: 'target-tab'
        });
        await queueStore.settlePlaybackHandoffSource({
            protocolVersion: 1,
            commandEpoch: 'epoch-1',
            handoffId: 'handoff-2',
            handoffSequence: 2,
            sourceEndpointId: 'target-tab',
            sourceRegistrationGeneration: 3,
            action: 'complete',
            sessionRevision: 4,
            queueRevision: 2,
            snapshot: {
                ...handoffSnapshot,
                sessionRevision: 4
            },
            reason: null
        });
        resolvePlayback(undefined);

        await expect(resume).resolves.toBe(false);
        expect(mocks.audio.pause).toHaveBeenCalledTimes(2);
        expect(queueStore.state.isPlaying).toBe(false);
    });

    it('keeps a released source paused until rollback explicitly restores it', async () => {
        mocks.endpointId = 'source-tab';
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'playing',
            activeDeviceId: 'source-tab',
            currentMusicId: '1',
            revision: 3
        };
        await queueStore.set({ isPlaying: true, currentTime: 12 });

        expect(queueStore.preparePlaybackHandoffRelease(handoffRelease)).toBeNull();
        await expect(queueStore.releasePlaybackHandoff(handoffRelease)).resolves.toEqual(
            expect.objectContaining({
                status: 'released',
                positionMs: 12_000
            })
        );
        expect(mocks.audio.pause).toHaveBeenCalledOnce();
        expect(queueStore.state.isPlaying).toBe(false);

        queueStore.silencePlaybackForSocketDisconnect();
        expect(mocks.audio.pause).toHaveBeenCalledTimes(2);
        expect(mocks.sessionBufferDisconnectPause).toHaveBeenCalledWith({
            currentMusicId: '1',
            positionMs: 12_000
        }, null);

        const restore: PlaybackHandoffSourceSettleDispatch = {
            protocolVersion: 1,
            commandEpoch: 'epoch-1',
            handoffId: 'handoff-1',
            handoffSequence: 1,
            sourceEndpointId: 'source-tab',
            sourceRegistrationGeneration: 2,
            action: 'restore',
            sessionRevision: 5,
            queueRevision: 2,
            snapshot: {
                ...handoffSnapshot,
                sessionRevision: 5,
                positionMs: 12_500
            },
            reason: null
        };
        await expect(queueStore.settlePlaybackHandoffSource(restore)).resolves.toEqual(
            expect.objectContaining({ status: 'settled' })
        );
        expect(mocks.audio.seek).toHaveBeenLastCalledWith(12.5);
        expect(mocks.audio.playWithResult).toHaveBeenCalledOnce();
        expect(queueStore.state.isPlaying).toBe(true);
    });

    it('refuses to recover a released source without its endpoint registration', async () => {
        mocks.endpointId = 'source-tab';
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'playing',
            activeDeviceId: 'source-tab',
            currentMusicId: '1',
            revision: 3
        };
        await queueStore.set({ isPlaying: true, currentTime: 12 });

        expect(queueStore.preparePlaybackHandoffRelease(handoffRelease)).toBeNull();
        await expect(queueStore.releasePlaybackHandoff(handoffRelease)).resolves.toEqual(
            expect.objectContaining({ status: 'released' })
        );
        mocks.endpointId = null;

        await expect(
            queueStore.recoverPlaybackHandoffSource(handoffRelease)
        ).rejects.toThrow('requires the source registration');
        expect(mocks.sessionQuiesce).not.toHaveBeenCalled();
        expect(mocks.audio.playWithResult).not.toHaveBeenCalled();
        expect(queueStore.state.isPlaying).toBe(false);

        queueStore.abandonPlaybackHandoffSource();
        expect(mocks.audio.pause).toHaveBeenCalledTimes(2);
    });

    it('keeps a released source paused when registration is lost during recovery', async () => {
        mocks.endpointId = 'source-tab';
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'playing',
            activeDeviceId: 'source-tab',
            currentMusicId: '1',
            revision: 3
        };
        await queueStore.set({ isPlaying: true, currentTime: 12 });
        expect(queueStore.preparePlaybackHandoffRelease(handoffRelease)).toBeNull();
        await queueStore.releasePlaybackHandoff(handoffRelease);

        let resolveSessionRefresh!: (
            result: { type: 'success'; snapshot: typeof mocks.sessionState.snapshot }
        ) => void;
        mocks.sessionRefresh.mockReturnValueOnce(new Promise((resolve) => {
            resolveSessionRefresh = resolve;
        }));
        const recovery = queueStore.recoverPlaybackHandoffSource(handoffRelease);
        await vi.waitFor(() => expect(mocks.sessionRefresh).toHaveBeenCalledOnce());

        mocks.endpointId = null;
        resolveSessionRefresh({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });

        await expect(recovery).rejects.toThrow(
            'registration changed during handoff recovery'
        );
        expect(mocks.audio.playWithResult).not.toHaveBeenCalled();
        expect(queueStore.state.isPlaying).toBe(false);

        mocks.endpointId = 'source-tab';
        queueStore.abandonPlaybackHandoffSource();
    });

    it('rejects Play Here before release when the gesture warm-up is blocked', async () => {
        endPlaybackCommandBarrier('queue-adapter-test');
        const controllerBarrier = Symbol('handoff-autoplay-test');
        beginPlaybackControllerCommandBarrier(controllerBarrier);
        mocks.endpointId = 'target-tab';
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'playing',
            activeDeviceId: 'source-tab',
            currentMusicId: '1',
            revision: 3
        };
        mocks.audio.beginMutedPlayback.mockRejectedValueOnce(
            new DOMException('blocked', 'NotAllowedError')
        );

        try {
            await expect(queueStore.primePlaybackHandoff(handoffSnapshot)).resolves.toEqual({
                status: 'rejected',
                error: {
                    code: 'AUTOPLAY_BLOCKED',
                    message: 'Browser autoplay policy blocked Play Here. Try again from this button.',
                    retryable: false,
                    forceAllowed: false
                }
            });
            expect(mocks.audio.cancelMutedPlayback).toHaveBeenCalledOnce();
        } finally {
            queueStore.finishPlaybackHandoffTarget(false);
            endPlaybackControllerCommandBarrier(controllerBarrier);
        }
    });
});
