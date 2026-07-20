import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchPlaybackSession: vi.fn(),
    reportPlaybackState: vi.fn(),
    listenerConnect: vi.fn(),
    listenerDisconnect: vi.fn(),
    socketOn: vi.fn(),
    socketOff: vi.fn(),
    registrationCurrent: null as null | {
        endpointId: string;
        registrationGeneration: number;
        registrationProof: string;
        commandEpoch: string;
    },
    registrationSubscriber: null as null | ((registration: unknown) => void),
    registrationUnsubscribe: vi.fn(),
    ensureSequence: vi.fn(),
    sequence: 0
}));

vi.mock('~/api/playback-session', () => ({
    fetchPlaybackSession: mocks.fetchPlaybackSession,
    reportPlaybackState: mocks.reportPlaybackState
}));

vi.mock('~/modules/playback-device', () => ({
    ensurePlaybackEndpointSequenceAtLeast: mocks.ensureSequence,
    nextPlaybackEndpointSequence: () => {
        mocks.sequence += 1;
        return mocks.sequence;
    }
}));

vi.mock('~/socket', () => ({
    PlaybackListener: class {
        connect = mocks.listenerConnect;
        disconnect = mocks.listenerDisconnect;
    }
}));

vi.mock('~/socket/playback-endpoint', () => ({
    playbackEndpointRegistration: {
        get current() {
            return mocks.registrationCurrent;
        },
        subscribe: (subscriber: (registration: unknown) => void) => {
            mocks.registrationSubscriber = subscriber;
            return mocks.registrationUnsubscribe;
        }
    }
}));

vi.mock('~/socket/socket', () => ({
    socket: {
        on: mocks.socketOn,
        off: mocks.socketOff
    }
}));

import type { PlaybackSessionSnapshot } from '~/api/playback-session';
import {
    beginPlaybackCommandBarrier,
    endPlaybackCommandBarrier
} from '~/modules/playback-command-barrier';
import { PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS } from '~/modules/playback-controller';
import { PlaybackSessionStore } from './playback-session';

const createRegistration = (endpointId = 'web-tab-local', generation = 1) => ({
    endpointId,
    registrationGeneration: generation,
    registrationProof: `proof-${endpointId}-${generation}`,
    commandEpoch: 'epoch-1'
});

const createSnapshot = (
    overrides: Partial<PlaybackSessionSnapshot> = {}
): PlaybackSessionSnapshot => ({
    id: '1',
    state: 'playing',
    activeDeviceId: 'web-tab-remote',
    activeDeviceSequence: 3,
    currentMusicId: '42',
    positionMs: 1_000,
    positionUpdatedAt: '2026-07-14T00:00:00.000Z',
    startedAt: '2026-07-14T00:00:00.000Z',
    revision: 1,
    serverTime: '2026-07-14T00:00:00.000Z',
    ...overrides
});

describe('PlaybackSessionStore', () => {
    beforeEach(() => {
        mocks.fetchPlaybackSession.mockReset();
        mocks.reportPlaybackState.mockReset();
        mocks.listenerConnect.mockReset();
        mocks.listenerDisconnect.mockReset();
        mocks.socketOn.mockReset();
        mocks.socketOff.mockReset();
        mocks.registrationUnsubscribe.mockReset();
        mocks.ensureSequence.mockReset();
        mocks.registrationCurrent = createRegistration();
        mocks.registrationSubscriber = null;
        mocks.sequence = 0;
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: null
        });
    });

    it('loads the snapshot and ignores an older realtime notification', async () => {
        const initial = createSnapshot({ revision: 2 });
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: initial
        });
        const store = new PlaybackSessionStore();

        store.connect();
        await vi.waitFor(() => expect(store.state.loading).toBe(false));
        expect(mocks.fetchPlaybackSession).toHaveBeenCalledWith(
            PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
        );

        const handler = mocks.listenerConnect.mock.calls[0]?.[0] as {
            onStateUpdated: (snapshot: PlaybackSessionSnapshot) => void;
        };
        handler.onStateUpdated(createSnapshot({ revision: 1 }));
        expect(store.state.snapshot?.revision).toBe(2);

        handler.onStateUpdated(createSnapshot({ revision: 3 }));
        expect(store.state.snapshot?.revision).toBe(3);

        store.disconnect();
        expect(mocks.listenerDisconnect).toHaveBeenCalledOnce();
        expect(mocks.registrationUnsubscribe).toHaveBeenCalledOnce();
        expect(mocks.socketOff).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('does not let a delayed null refresh clear a newer realtime snapshot', async () => {
        const initial = createSnapshot({ revision: 2 });
        const realtime = createSnapshot({
            activeDeviceId: 'web-tab-local',
            activeDeviceSequence: 7,
            revision: 3
        });
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: initial
        });
        const store = new PlaybackSessionStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(initial));

        let resolveRefresh: ((value: unknown) => void) | undefined;
        mocks.fetchPlaybackSession.mockReturnValueOnce(new Promise((resolve) => {
            resolveRefresh = resolve;
        }));
        const refresh = store.refresh();
        const handler = mocks.listenerConnect.mock.calls[0]?.[0] as {
            onStateUpdated: (snapshot: PlaybackSessionSnapshot) => void;
        };
        handler.onStateUpdated(realtime);
        resolveRefresh?.({
            type: 'success',
            playbackSession: null
        });

        await expect(refresh).resolves.toEqual({
            type: 'success',
            snapshot: realtime
        });
        expect(store.state.snapshot).toEqual(realtime);
        expect(mocks.ensureSequence).toHaveBeenCalledWith(7);
        store.disconnect();
    });

    it('reports a bounded recovery read failure without reusing it as success', async () => {
        const snapshot = createSnapshot({ revision: 3 });
        mocks.fetchPlaybackSession.mockResolvedValueOnce({
            type: 'success',
            playbackSession: snapshot
        });
        const store = new PlaybackSessionStore();
        await expect(store.refresh()).resolves.toEqual({
            type: 'success',
            snapshot
        });
        mocks.fetchPlaybackSession.mockResolvedValueOnce({
            type: 'error',
            category: 'network',
            errors: [{ code: 'ECONNABORTED', message: 'timed out' }]
        });

        await expect(store.refresh(5_000)).resolves.toEqual({ type: 'error' });
        expect(mocks.fetchPlaybackSession).toHaveBeenLastCalledWith(5_000);
        expect(store.state.snapshot).toEqual(snapshot);
    });

    it('reports a user claim only with acknowledged registration authority', async () => {
        const accepted = createSnapshot({
            activeDeviceId: 'web-tab-local',
            revision: 1
        });
        mocks.reportPlaybackState.mockResolvedValue({
            type: 'success',
            reportPlaybackState: {
                type: 'accepted',
                session: accepted,
                conflict: null
            }
        });
        const store = new PlaybackSessionStore();
        store.connect();

        store.report({
            state: 'playing',
            currentMusicId: '42',
            positionMs: 1_500
        }, { claimActive: true });

        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());
        expect(mocks.reportPlaybackState).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'web-tab-local',
            registrationGeneration: 1,
            registrationProof: 'proof-web-tab-local-1',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing',
            currentMusicId: '42',
            positionMs: 1_500
        }));
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(accepted));

        store.report({
            state: 'playing',
            currentMusicId: '42',
            positionMs: 1_600
        }, { checkpoint: true });
        expect(mocks.reportPlaybackState).toHaveBeenCalledOnce();
        store.disconnect();
    });

    it('suppresses ordinary reports while a remote command barrier is active', () => {
        const store = new PlaybackSessionStore();
        store.connect();
        beginPlaybackCommandBarrier('command-test');

        try {
            store.report({
                state: 'playing',
                currentMusicId: '42',
                positionMs: 1_500
            }, { claimActive: true });
            expect(mocks.reportPlaybackState).not.toHaveBeenCalled();
            expect(mocks.sequence).toBe(0);
        } finally {
            endPlaybackCommandBarrier('command-test');
            store.disconnect();
        }
    });

    it('quiesces buffered reports and does not retry them through the command barrier', async () => {
        let resolveReport: ((value: unknown) => void) | undefined;
        mocks.reportPlaybackState.mockReturnValue(new Promise((resolve) => {
            resolveReport = resolve;
        }));
        const store = new PlaybackSessionStore();
        store.connect();
        store.report({
            state: 'playing',
            currentMusicId: '42',
            positionMs: 1_500
        }, { claimActive: true });
        store.report({
            state: 'paused',
            currentMusicId: '42',
            positionMs: 1_800
        });
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());

        beginPlaybackCommandBarrier('session-recovery-test');
        try {
            expect(store.quiesceForPlaybackCommandRecovery()).toBe(false);
            resolveReport?.({
                type: 'error',
                category: 'network',
                errors: [{ code: 'NETWORK_ERROR', message: 'Offline' }]
            });
            await vi.waitFor(() => expect(store.state.error).toBe('Offline'));

            expect(mocks.reportPlaybackState).toHaveBeenCalledOnce();
            expect(store.hasPendingReport).toBe(true);
            expect(store.quiesceForPlaybackCommandRecovery()).toBe(true);
            expect(store.hasPendingReport).toBe(false);
        } finally {
            endPlaybackCommandBarrier('session-recovery-test');
            store.disconnect();
        }
    });

    it('keeps a buffered challenger claim sticky across a newer checkpoint', async () => {
        mocks.registrationCurrent = null;
        const accepted = createSnapshot({
            activeDeviceId: 'web-tab-rotated',
            revision: 2
        });
        mocks.reportPlaybackState.mockResolvedValue({
            type: 'success',
            reportPlaybackState: {
                type: 'accepted',
                session: accepted,
                conflict: null
            }
        });
        const store = new PlaybackSessionStore();
        store.connect();

        store.report({
            state: 'playing',
            currentMusicId: '42',
            positionMs: 2_000
        }, { claimActive: true });
        store.report({
            state: 'paused',
            currentMusicId: '42',
            positionMs: 2_300
        });
        expect(mocks.reportPlaybackState).not.toHaveBeenCalled();

        mocks.registrationSubscriber?.(createRegistration('web-tab-rotated', 1));
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());
        expect(mocks.reportPlaybackState).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'web-tab-rotated',
            registrationProof: 'proof-web-tab-rotated-1',
            claimActive: true,
            state: 'paused',
            positionMs: 2_300
        }));
        expect(mocks.reportPlaybackState).not.toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'web-tab-local'
        }));
        store.disconnect();
    });

    it('buffers a former active endpoint pause through a registration gap', async () => {
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: createSnapshot({
                activeDeviceId: 'web-tab-local',
                revision: 1
            })
        });
        const paused = createSnapshot({
            state: 'paused',
            activeDeviceId: 'web-tab-local',
            positionMs: 2_500,
            revision: 2
        });
        mocks.reportPlaybackState.mockResolvedValue({
            type: 'success',
            reportPlaybackState: {
                type: 'accepted',
                session: paused,
                conflict: null
            }
        });
        const store = new PlaybackSessionStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.snapshot?.revision).toBe(1));

        mocks.registrationSubscriber?.(null);
        store.report({
            state: 'paused',
            currentMusicId: '42',
            positionMs: 2_500
        });
        expect(mocks.reportPlaybackState).not.toHaveBeenCalled();

        mocks.registrationSubscriber?.(createRegistration('web-tab-local', 2));
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());
        expect(mocks.reportPlaybackState).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'web-tab-local',
            registrationGeneration: 2,
            claimActive: false,
            state: 'paused',
            positionMs: 2_500
        }));
        store.disconnect();
    });

    it('buffers a barrier-safe pause for a possibly claimed disconnected target', async () => {
        const paused = createSnapshot({
            state: 'paused',
            activeDeviceId: 'web-tab-local',
            positionMs: 2_750,
            revision: 2
        });
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: createSnapshot({ revision: 1 })
        });
        mocks.reportPlaybackState.mockResolvedValue({
            type: 'success',
            reportPlaybackState: {
                type: 'accepted',
                session: paused,
                conflict: null
            }
        });
        const store = new PlaybackSessionStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.snapshot?.revision).toBe(1));

        mocks.registrationSubscriber?.(null);
        beginPlaybackCommandBarrier('disconnect-pause-test');
        try {
            expect(store.bufferSocketDisconnectPause({
                currentMusicId: '42',
                positionMs: 2_750
            }, 'web-tab-local')).toBe(true);
            mocks.registrationSubscriber?.(createRegistration('web-tab-local', 2));
            expect(mocks.reportPlaybackState).not.toHaveBeenCalled();
        } finally {
            endPlaybackCommandBarrier('disconnect-pause-test');
        }

        await expect(store.flushBufferedReport()).resolves.toBe(true);
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());
        expect(mocks.reportPlaybackState).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'web-tab-local',
            registrationGeneration: 2,
            claimActive: false,
            state: 'paused',
            currentMusicId: '42',
            positionMs: 2_750
        }));
        store.disconnect();
    });

    it('buffers an exact passive pause when the active source disconnects before Force', async () => {
        const paused = createSnapshot({
            state: 'paused',
            activeDeviceId: 'web-tab-local',
            positionMs: 3_125,
            revision: 2
        });
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: createSnapshot({
                state: 'playing',
                activeDeviceId: 'web-tab-local',
                positionMs: 3_000,
                revision: 1
            })
        });
        mocks.reportPlaybackState.mockResolvedValue({
            type: 'success',
            reportPlaybackState: {
                type: 'accepted',
                session: paused,
                conflict: null
            }
        });
        const store = new PlaybackSessionStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.snapshot?.revision).toBe(1));

        mocks.registrationSubscriber?.(null);
        expect(store.bufferSocketDisconnectPause({
            currentMusicId: '42',
            positionMs: 3_125
        })).toBe(true);
        expect(mocks.reportPlaybackState).not.toHaveBeenCalled();

        mocks.registrationSubscriber?.(createRegistration('web-tab-local', 2));
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());
        expect(mocks.reportPlaybackState).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'web-tab-local',
            registrationGeneration: 2,
            claimActive: false,
            state: 'paused',
            currentMusicId: '42',
            positionMs: 3_125
        }));
        store.disconnect();
    });

    it('does not buffer a disconnect pause from an inactive endpoint', async () => {
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: createSnapshot({
                activeDeviceId: 'another-tab',
                revision: 1
            })
        });
        const store = new PlaybackSessionStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.snapshot?.revision).toBe(1));

        mocks.registrationSubscriber?.(null);
        expect(store.bufferSocketDisconnectPause({
            currentMusicId: '42',
            positionMs: 3_125
        })).toBe(false);
        mocks.registrationSubscriber?.(createRegistration('web-tab-local', 2));

        await Promise.resolve();
        expect(mocks.reportPlaybackState).not.toHaveBeenCalled();
        store.disconnect();
    });

    it('does not promote a passive report after endpoint rotation', async () => {
        const incumbent = createSnapshot({
            activeDeviceId: 'web-tab-local',
            revision: 2
        });
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: createSnapshot({
                activeDeviceId: 'web-tab-local',
                revision: 1
            })
        });
        mocks.reportPlaybackState.mockResolvedValue({
            type: 'success',
            reportPlaybackState: {
                type: 'conflict',
                session: incumbent,
                conflict: {
                    reason: 'active-device',
                    session: incumbent
                }
            }
        });
        const store = new PlaybackSessionStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.snapshot?.revision).toBe(1));

        mocks.registrationSubscriber?.(null);
        store.report({
            state: 'paused',
            currentMusicId: '42',
            positionMs: 2_500
        });
        mocks.registrationSubscriber?.(createRegistration('web-tab-rotated', 2));

        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());
        expect(mocks.reportPlaybackState).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'web-tab-rotated',
            registrationGeneration: 2,
            registrationProof: 'proof-web-tab-rotated-2',
            claimActive: false,
            state: 'paused',
            positionMs: 2_500
        }));
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(incumbent));
        store.disconnect();
    });

    it('fences an old in-flight report and replays only the latest intent', async () => {
        let resolveOld: ((value: unknown) => void) | undefined;
        const oldRequest = new Promise((resolve) => {
            resolveOld = resolve;
        });
        const rotatedSnapshot = createSnapshot({
            state: 'paused',
            activeDeviceId: 'web-tab-rotated',
            positionMs: 2_600,
            revision: 2
        });
        mocks.reportPlaybackState
            .mockReturnValueOnce(oldRequest)
            .mockResolvedValueOnce({
                type: 'success',
                reportPlaybackState: {
                    type: 'accepted',
                    session: rotatedSnapshot,
                    conflict: null
                }
            });
        const store = new PlaybackSessionStore();
        store.connect();
        store.report({
            state: 'playing',
            currentMusicId: '42',
            positionMs: 2_000
        }, { claimActive: true });
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());
        store.report({
            state: 'paused',
            currentMusicId: '42',
            positionMs: 2_600
        });

        mocks.registrationSubscriber?.(null);
        mocks.registrationSubscriber?.(createRegistration('web-tab-rotated', 2));
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledTimes(2));
        expect(mocks.reportPlaybackState.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            deviceId: 'web-tab-rotated',
            registrationGeneration: 2,
            registrationProof: 'proof-web-tab-rotated-2',
            sequence: 2,
            claimActive: true,
            state: 'paused',
            positionMs: 2_600
        }));
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(rotatedSnapshot));
        expect(store.hasPendingReport).toBe(true);

        resolveOld?.({
            type: 'success',
            reportPlaybackState: {
                type: 'accepted',
                session: createSnapshot({
                    activeDeviceId: 'web-tab-local',
                    revision: 1
                }),
                conflict: null
            }
        });
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(rotatedSnapshot));
        await vi.waitFor(() => expect(store.hasPendingReport).toBe(false));
        store.disconnect();
    });

    it('retains an unresolved claim after a network failure and reconnect', async () => {
        mocks.reportPlaybackState
            .mockResolvedValueOnce({
                type: 'error',
                category: 'network',
                errors: [{ code: 'NETWORK_ERROR', message: 'Offline' }]
            })
            .mockResolvedValueOnce({
                type: 'success',
                reportPlaybackState: {
                    type: 'accepted',
                    session: createSnapshot({
                        activeDeviceId: 'web-tab-local',
                        revision: 2
                    }),
                    conflict: null
                }
            });
        const store = new PlaybackSessionStore();
        store.connect();
        store.report({
            state: 'playing',
            currentMusicId: '42',
            positionMs: 3_000
        }, { claimActive: true });
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());

        mocks.registrationSubscriber?.(null);
        mocks.registrationSubscriber?.(createRegistration('web-tab-local', 2));
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledTimes(2));
        expect(mocks.reportPlaybackState.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            registrationGeneration: 2,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing',
            positionMs: 3_000
        }));
        store.disconnect();
    });

    it('cannot silently reclaim after reconnecting to a newer server revision', async () => {
        const authoritative = createSnapshot({
            activeDeviceId: 'other-tab',
            activeDeviceSequence: 9,
            positionMs: 9_000,
            revision: 4
        });
        mocks.reportPlaybackState
            .mockResolvedValueOnce({
                type: 'error',
                category: 'network',
                errors: [{ code: 'NETWORK_ERROR', message: 'Offline' }]
            })
            .mockResolvedValueOnce({
                type: 'success',
                reportPlaybackState: {
                    type: 'conflict',
                    session: authoritative,
                    conflict: {
                        reason: 'stale-revision',
                        session: authoritative
                    }
                }
            });
        const store = new PlaybackSessionStore();
        store.connect();
        store.report({
            state: 'playing',
            currentMusicId: '42',
            positionMs: 3_000
        }, { claimActive: true });
        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());

        mocks.registrationSubscriber?.(null);
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: authoritative
        });
        mocks.registrationSubscriber?.(createRegistration('web-tab-local', 2));

        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledTimes(2));
        expect(mocks.reportPlaybackState.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            deviceId: 'web-tab-local',
            registrationGeneration: 2,
            expectedRevision: 0,
            claimActive: true,
            positionMs: 3_000
        }));
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(authoritative));
        expect(store.state.error).toContain('changed while this browser was reconnecting');
        expect(store.hasPendingReport).toBe(false);
        store.disconnect();
    });
});
