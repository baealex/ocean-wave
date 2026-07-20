import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    beginBarrier: vi.fn().mockReturnValue(true),
    endBarrier: vi.fn(),
    endpointSequence: { value: 3 },
    getEndpointSequence: vi.fn(),
    nextEndpointSequence: vi.fn(),
    request: vi.fn(),
    controllerConnect: vi.fn(),
    controllerDisconnect: vi.fn(),
    sourceConnect: vi.fn(),
    sourceDisconnect: vi.fn(),
    statusSubscriber: null as null | ((
        status: import('~/socket/playback-handoff-contract').PlaybackHandoffStatus
    ) => void),
    registrationSubscriber: null as null | ((
        registration: import('~/socket/playback-endpoint')
            .PlaybackEndpointRegistrationState | null
    ) => void),
    prime: vi.fn().mockResolvedValue({ status: 'ready' }),
    finishTarget: vi.fn(),
    silenceForDisconnect: vi.fn(),
    resumeHere: vi.fn().mockResolvedValue(true),
    flushBufferedReport: vi.fn(),
    sessionRefresh: vi.fn(),
    queueRefresh: vi.fn(),
    devicesRefresh: vi.fn(),
    socketHandlers: new Map<string, () => void>(),
    registration: {
        endpointId: 'target-tab',
        registrationGeneration: 3,
        commandEpoch: 'epoch-1',
        registrationProof: 'proof-1'
    },
    sessionState: {
        snapshot: {
            id: '1',
            state: 'playing',
            activeDeviceId: 'source-tab',
            currentMusicId: '1',
            positionMs: 12_000,
            positionUpdatedAt: '2026-07-20T00:00:00.000Z',
            startedAt: '2026-07-20T00:00:00.000Z',
            revision: 3,
            serverTime: '2026-07-20T00:00:00.000Z'
        },
        receivedAtMs: Date.now(),
        endpointId: 'target-tab',
        loading: false,
        error: null
    },
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
    registryState: {
        registry: null as null | Record<string, unknown>,
        loading: false,
        error: null
    }
}));

vi.mock('~/modules/playback-command-barrier', () => ({
    beginPlaybackControllerCommandBarrier: mocks.beginBarrier,
    endPlaybackControllerCommandBarrier: mocks.endBarrier
}));

vi.mock('~/modules/playback-device', () => ({
    getPlaybackEndpointSequence: mocks.getEndpointSequence,
    nextPlaybackEndpointSequence: mocks.nextEndpointSequence
}));

vi.mock('~/socket/playback-endpoint', () => ({
    playbackEndpointRegistration: {
        get current() {
            return mocks.registration;
        },
        subscribe: (subscriber: typeof mocks.registrationSubscriber) => {
            mocks.registrationSubscriber = subscriber;
            return vi.fn();
        }
    }
}));

vi.mock('~/socket/playback-handoff', () => ({
    playbackHandoffController: {
        connect: mocks.controllerConnect,
        disconnect: mocks.controllerDisconnect,
        subscribe: (subscriber: typeof mocks.statusSubscriber) => {
            mocks.statusSubscriber = subscriber;
            return vi.fn();
        },
        request: mocks.request
    },
    playbackHandoffSourceTarget: {
        connect: mocks.sourceConnect,
        disconnect: mocks.sourceDisconnect
    }
}));

vi.mock('~/socket/socket', () => ({
    socket: {
        on: vi.fn((event: string, handler: () => void) => {
            mocks.socketHandlers.set(event, handler);
        }),
        off: vi.fn((event: string) => {
            mocks.socketHandlers.delete(event);
        })
    }
}));

vi.mock('./music', () => ({
    musicStore: {
        state: {
            musicMap: new Map([
                ['1', { id: '1', duration: 60 }],
                ['2', { id: '2', duration: 90 }]
            ])
        }
    }
}));

vi.mock('./playback-session', () => ({
    playbackSessionStore: {
        get state() {
            return mocks.sessionState;
        },
        get endpointId() {
            return mocks.sessionState.endpointId;
        },
        refresh: mocks.sessionRefresh,
        flushBufferedReport: mocks.flushBufferedReport
    }
}));

vi.mock('./playback-queue', () => ({
    playbackQueueStore: {
        get state() {
            return mocks.queueState;
        },
        refresh: mocks.queueRefresh
    }
}));

vi.mock('./playback-devices', () => ({
    playbackDevicesStore: {
        get state() {
            return mocks.registryState;
        },
        refresh: mocks.devicesRefresh
    },
    resolveActivePlaybackTarget: (registry: {
        activeEndpointId?: string | null;
        devices?: Array<{ endpoints: Array<{ id: string }> }>;
    } | null) => {
        if (!registry?.activeEndpointId) {
            return null;
        }
        for (const device of registry.devices ?? []) {
            const endpoint = device.endpoints.find(
                candidate => candidate.id === registry.activeEndpointId
            );
            if (endpoint) {
                return { device, endpoint };
            }
        }
        return null;
    }
}));

vi.mock('./queue', () => ({
    queueStore: {
        primePlaybackHandoff: mocks.prime,
        activatePlaybackHandoff: vi.fn(),
        preparePlaybackHandoffRelease: vi.fn(),
        releasePlaybackHandoff: vi.fn(),
        settlePlaybackHandoffSource: vi.fn(),
        recoverPlaybackHandoffSource: vi.fn(),
        finishPlaybackHandoffTarget: mocks.finishTarget,
        silencePlaybackForSocketDisconnect: mocks.silenceForDisconnect,
        resumePlaybackHandoffHere: mocks.resumeHere
    }
}));

import type { PlaybackHandoffRequest } from '~/socket/playback-handoff-contract';
import { playbackHandoffStore } from './playback-handoff';

const sourceEndpoint = {
    id: 'source-tab',
    capabilities: ['play', 'pause', 'seek', 'next', 'previous', 'handoff'],
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    online: true,
    active: true,
    registrationGeneration: 2
};

const targetEndpoint = {
    ...sourceEndpoint,
    id: 'target-tab',
    active: false,
    registrationGeneration: 3
};

const registry = () => ({
    commandEpoch: 'epoch-1',
    activeEndpointId: 'source-tab',
    serverTime: '2026-07-20T00:00:00.000Z',
    devices: [
        {
            id: 'source-device',
            name: 'Living Room Browser',
            type: 'desktop-web',
            lastSeenAt: '2026-07-20T00:00:00.000Z',
            online: true,
            active: true,
            endpoints: [sourceEndpoint]
        },
        {
            id: 'target-device',
            name: 'This Browser',
            type: 'desktop-web',
            lastSeenAt: '2026-07-20T00:00:00.000Z',
            online: true,
            active: false,
            endpoints: [targetEndpoint]
        }
    ]
});

const status = (
    request: PlaybackHandoffRequest,
    phase: import('~/socket/playback-handoff-contract').PlaybackHandoffPhase,
    error: import('~/socket/playback-handoff-contract').PlaybackHandoffError | null = null
) => ({
    protocolVersion: 1 as const,
    commandEpoch: request.commandEpoch,
    handoffId: request.handoffId,
    sourceEndpointId: request.sourceEndpointId,
    targetEndpointId: request.targetEndpointId,
    handoffSequence: 1,
    phase,
    deduplicated: false,
    sessionRevision: phase === 'completed' ? 5 : 3,
    queueRevision: 2,
    occurredAt: '2026-07-20T00:00:01.000Z',
    error
});

describe('PlaybackHandoffStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.statusSubscriber = null;
        mocks.registrationSubscriber = null;
        mocks.socketHandlers.clear();
        mocks.endpointSequence.value = 3;
        mocks.getEndpointSequence.mockImplementation(
            () => mocks.endpointSequence.value
        );
        mocks.nextEndpointSequence.mockImplementation(
            () => ++mocks.endpointSequence.value
        );
        mocks.registryState.registry = registry();
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'playing',
            activeDeviceId: 'source-tab',
            revision: 3
        };
        mocks.sessionState.endpointId = 'target-tab';
        mocks.queueState.snapshot = {
            ...mocks.queueState.snapshot,
            currentIndex: 0,
            revision: 2
        };
        mocks.prime.mockResolvedValue({ status: 'ready' });
        mocks.resumeHere.mockResolvedValue(true);
        mocks.flushBufferedReport.mockResolvedValue(true);
        mocks.sessionRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });
        mocks.queueRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.queueState.snapshot
        });
        mocks.devicesRefresh.mockResolvedValue({
            type: 'success',
            registry: mocks.registryState.registry
        });
        playbackHandoffStore.disconnect();
        playbackHandoffStore.state = {
            handoffId: null,
            sourceEndpointId: null,
            sourceDeviceName: null,
            targetEndpointId: null,
            targetDeviceName: null,
            phase: 'idle',
            message: null,
            error: null,
            forceAvailable: false,
            retryAvailable: false,
            resumeAvailable: false
        };
        playbackHandoffStore.connect();
    });

    afterEach(() => {
        playbackHandoffStore.disconnect();
    });

    it('warms the target before sending and reconciles a completed handoff', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'releasing')
        }));

        await expect(playbackHandoffStore.playHere()).resolves.toBe(true);
        expect(mocks.prime).toHaveBeenCalledOnce();
        expect(mocks.request).toHaveBeenCalledOnce();
        expect(playbackHandoffStore.state.phase).toBe('releasing');

        const request = mocks.request.mock.calls[0]![0] as PlaybackHandoffRequest;
        mocks.statusSubscriber?.(status(request, 'completed'));
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state.phase).toBe('completed');
        });
        expect(mocks.finishTarget).toHaveBeenCalledWith(true);
        expect(mocks.sessionRefresh).toHaveBeenCalledOnce();
        expect(mocks.endBarrier).toHaveBeenCalled();

        mocks.silenceForDisconnect.mockClear();
        mocks.socketHandlers.get('disconnect')?.();
        expect(mocks.silenceForDisconnect).toHaveBeenCalledWith('target-tab');
    });

    it('keeps a normal paused handoff completed without offering resume', async () => {
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'source-tab'
        };
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => {
            mocks.sessionState.snapshot = {
                ...mocks.sessionState.snapshot,
                state: 'paused',
                activeDeviceId: 'target-tab',
                revision: 4
            };
            mocks.sessionRefresh.mockResolvedValue({
                type: 'success',
                snapshot: mocks.sessionState.snapshot
            });
            return {
                type: 'acknowledged',
                acknowledgement: status(request, 'completed')
            };
        });

        await playbackHandoffStore.playHere();
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'completed',
                retryAvailable: false,
                resumeAvailable: false
            }));
        });
    });

    it('does not publish the claim sequence to heartbeats while warm-up is pending', async () => {
        let resolvePrime!: (result: { status: 'ready' }) => void;
        mocks.prime.mockReturnValueOnce(new Promise((resolve) => {
            resolvePrime = resolve;
        }));
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'releasing')
        }));

        const playHere = playbackHandoffStore.playHere();
        await vi.waitFor(() => expect(mocks.prime).toHaveBeenCalledOnce());

        // Heartbeats read the same persisted counter. It must still expose only
        // committed endpoint traffic until the muted media warm-up succeeds.
        expect(mocks.getEndpointSequence()).toBe(3);
        expect(mocks.nextEndpointSequence).not.toHaveBeenCalled();
        expect(mocks.request).not.toHaveBeenCalled();

        resolvePrime({ status: 'ready' });
        await expect(playHere).resolves.toBe(true);

        expect(mocks.nextEndpointSequence).toHaveBeenCalledOnce();
        expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
            targetClaimSequence: 4
        }));
    });

    it('cancels before sending when the socket disconnects during warm-up', async () => {
        let resolvePrime!: (result: { status: 'ready' }) => void;
        mocks.prime.mockReturnValueOnce(new Promise((resolve) => {
            resolvePrime = resolve;
        }));

        const playHere = playbackHandoffStore.playHere();
        await vi.waitFor(() => expect(mocks.prime).toHaveBeenCalledOnce());

        mocks.socketHandlers.get('disconnect')?.();
        expect(mocks.silenceForDisconnect).toHaveBeenCalledWith(null);
        expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
            phase: 'rejected',
            retryAvailable: true
        }));

        resolvePrime({ status: 'ready' });
        await expect(playHere).resolves.toBe(false);
        expect(mocks.nextEndpointSequence).not.toHaveBeenCalled();
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('cancels before sending when its endpoint lease expires during warm-up', async () => {
        let resolvePrime!: (result: { status: 'ready' }) => void;
        mocks.prime.mockReturnValueOnce(new Promise((resolve) => {
            resolvePrime = resolve;
        }));

        const playHere = playbackHandoffStore.playHere();
        await vi.waitFor(() => expect(mocks.prime).toHaveBeenCalledOnce());

        mocks.registrationSubscriber?.(null);
        expect(mocks.silenceForDisconnect).toHaveBeenCalledWith(null);
        expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
            phase: 'rejected',
            retryAvailable: true
        }));

        resolvePrime({ status: 'ready' });
        await expect(playHere).resolves.toBe(false);
        expect(mocks.nextEndpointSequence).not.toHaveBeenCalled();
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('requires a second explicit click before forcing an offline source handoff', async () => {
        (mocks.registryState.registry as ReturnType<typeof registry>)
            .devices[0]!.endpoints[0]!.online = false;
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'stopped'
        };
        mocks.request.mockImplementationOnce(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'rejected', {
                code: 'SOURCE_OFFLINE',
                message: 'The source endpoint is offline.',
                retryable: true,
                forceAllowed: true
            })
        })).mockImplementationOnce(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'completed')
        }));

        await expect(playbackHandoffStore.playHere()).resolves.toBe(false);
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state.forceAvailable).toBe(true);
        });
        expect((mocks.request.mock.calls[0]![0] as PlaybackHandoffRequest).force).toBe(false);

        await expect(playbackHandoffStore.forcePlayHere()).resolves.toBe(true);
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state.phase).toBe('completed');
        });
        expect((mocks.request.mock.calls[1]![0] as PlaybackHandoffRequest).force).toBe(true);
        expect(mocks.prime).toHaveBeenCalledTimes(2);
        expect(mocks.prime).toHaveBeenNthCalledWith(1, expect.objectContaining({
            state: 'paused',
            positionMs: 12_000
        }));
    });

    it('offers gesture-backed resume when the server leaves the target safely paused', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => {
            mocks.sessionState.snapshot = {
                ...mocks.sessionState.snapshot,
                state: 'paused',
                activeDeviceId: 'target-tab',
                revision: 4
            };
            return {
                type: 'acknowledged',
                acknowledgement: status(request, 'recovery_required', {
                code: 'RECOVERY_REQUIRED',
                message: 'Playback is safely paused here.',
                retryable: true,
                forceAllowed: false
                })
            };
        });

        await playbackHandoffStore.playHere();
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state.resumeAvailable).toBe(true);
        });
        await expect(playbackHandoffStore.resumeHere()).resolves.toBe(true);
        expect(mocks.resumeHere).toHaveBeenCalledOnce();
        expect(playbackHandoffStore.state.phase).toBe('completed');
    });

    it('does not complete an in-flight resume after target registration loss', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => {
            mocks.sessionState.snapshot = {
                ...mocks.sessionState.snapshot,
                state: 'paused',
                activeDeviceId: 'target-tab',
                revision: 4
            };
            return {
                type: 'acknowledged',
                acknowledgement: status(request, 'recovery_required', {
                    code: 'RECOVERY_REQUIRED',
                    message: 'Playback is safely paused here.',
                    retryable: true,
                    forceAllowed: false
                })
            };
        });

        await playbackHandoffStore.playHere();
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state.resumeAvailable).toBe(true);
        });

        let resolveResume!: (resumed: boolean) => void;
        mocks.resumeHere.mockReturnValueOnce(new Promise((resolve) => {
            resolveResume = resolve;
        }));
        const resume = playbackHandoffStore.resumeHere();
        await vi.waitFor(() => expect(mocks.resumeHere).toHaveBeenCalledOnce());

        mocks.registrationSubscriber?.(null);
        resolveResume(true);

        await expect(resume).resolves.toBe(false);
        expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
            phase: 'timed_out',
            retryAvailable: true,
            resumeAvailable: false
        }));
        expect(mocks.silenceForDisconnect).toHaveBeenLastCalledWith('target-tab');
    });

    it('serializes overlapping gesture resume attempts', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => {
            mocks.sessionState.snapshot = {
                ...mocks.sessionState.snapshot,
                state: 'paused',
                activeDeviceId: 'target-tab',
                revision: 4
            };
            return {
                type: 'acknowledged',
                acknowledgement: status(request, 'recovery_required', {
                    code: 'RECOVERY_REQUIRED',
                    message: 'Playback is safely paused here.',
                    retryable: true,
                    forceAllowed: false
                })
            };
        });

        await playbackHandoffStore.playHere();
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state.resumeAvailable).toBe(true);
        });

        let resolveResume!: (resumed: boolean) => void;
        mocks.resumeHere.mockReturnValueOnce(new Promise((resolve) => {
            resolveResume = resolve;
        }));
        const firstResume = playbackHandoffStore.resumeHere();
        await vi.waitFor(() => expect(mocks.resumeHere).toHaveBeenCalledOnce());

        await expect(playbackHandoffStore.resumeHere()).resolves.toBe(false);
        expect(mocks.resumeHere).toHaveBeenCalledOnce();

        resolveResume(true);
        await expect(firstResume).resolves.toBe(true);
        expect(playbackHandoffStore.state.phase).toBe('completed');
        expect(mocks.silenceForDisconnect).not.toHaveBeenCalled();
    });

    it('silences a pending target immediately when its control socket disconnects', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'activating')
        }));

        await playbackHandoffStore.playHere();
        expect(playbackHandoffStore.state.phase).toBe('activating');

        mocks.socketHandlers.get('disconnect')?.();
        expect(mocks.silenceForDisconnect).toHaveBeenCalledWith('target-tab');
        expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
            phase: 'recovering',
            message: expect.stringContaining('disconnected')
        }));
    });

    it('silences and recovers a pending target when its endpoint lease expires', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'activating')
        }));

        await playbackHandoffStore.playHere();
        expect(playbackHandoffStore.state.phase).toBe('activating');

        mocks.registrationSubscriber?.(null);
        expect(mocks.silenceForDisconnect).toHaveBeenCalledTimes(1);
        expect(mocks.silenceForDisconnect).toHaveBeenLastCalledWith('target-tab');
        expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
            phase: 'recovering',
            message: expect.stringContaining('registration was lost')
        }));

        mocks.socketHandlers.get('disconnect')?.();
        expect(mocks.silenceForDisconnect).toHaveBeenCalledTimes(1);

        mocks.registrationSubscriber?.({
            ...mocks.registration,
            registrationGeneration: 4,
            registrationProof: 'proof-2'
        });
        await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    });

    it('reconciles and releases a pending target after a command epoch restart', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'activating')
        }));

        await playbackHandoffStore.playHere();
        mocks.registrationSubscriber?.(null);
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'target-tab',
            revision: 4
        };
        mocks.sessionRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });
        mocks.registrationSubscriber?.({
            ...mocks.registration,
            registrationGeneration: 4,
            commandEpoch: 'epoch-2',
            registrationProof: 'proof-2'
        });

        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'recovery_required',
                resumeAvailable: true
            }));
        });
        expect(mocks.request).toHaveBeenCalledOnce();
        expect(mocks.finishTarget).toHaveBeenLastCalledWith(false);
        expect(mocks.endBarrier).toHaveBeenCalled();
    });

    it('offers resume after a playing completion was silenced by registration loss', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'activating')
        }));

        await playbackHandoffStore.playHere();
        const request = mocks.request.mock.calls[0]![0] as PlaybackHandoffRequest;
        mocks.registrationSubscriber?.(null);
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'target-tab',
            revision: 4
        };
        mocks.sessionRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });

        mocks.statusSubscriber?.(status(request, 'completed'));
        expect(playbackHandoffStore.state.phase).toBe('reconciling');
        expect(mocks.endBarrier).not.toHaveBeenCalled();

        mocks.registrationSubscriber?.({
            ...mocks.registration,
            registrationGeneration: 4,
            registrationProof: 'proof-2'
        });

        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'recovery_required',
                retryAvailable: false,
                resumeAvailable: true
            }));
        });
        expect(mocks.endBarrier).toHaveBeenCalled();
    });

    it('releases a pending target safely after endpoint rotation', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'activating')
        }));

        await playbackHandoffStore.playHere();
        mocks.registrationSubscriber?.(null);
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'source-tab',
            revision: 4
        };
        mocks.sessionRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });
        mocks.registrationSubscriber?.({
            endpointId: 'rotated-target-tab',
            registrationGeneration: 4,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-2'
        });

        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'rolled_back',
                retryAvailable: true
            }));
        });
        expect(mocks.request).toHaveBeenCalledOnce();
        expect(mocks.endBarrier).toHaveBeenCalled();
    });

    it('keeps the audio gate when authoritative identity refresh fails', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'activating')
        }));

        await playbackHandoffStore.playHere();
        mocks.registrationSubscriber?.(null);
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'source-tab',
            revision: 4
        };
        mocks.sessionRefresh.mockResolvedValue({ type: 'error' });
        mocks.registrationSubscriber?.({
            endpointId: 'rotated-target-tab',
            registrationGeneration: 4,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-2'
        });

        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'timed_out',
                retryAvailable: true,
                resumeAvailable: false
            }));
        });
        expect(mocks.endBarrier).not.toHaveBeenCalled();

        playbackHandoffStore.dismiss();
        expect(playbackHandoffStore.state.phase).toBe('idle');
        mocks.sessionRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });

        await expect(playbackHandoffStore.playHere()).resolves.toBe(true);
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state.phase).toBe('rolled_back');
        });
        expect(mocks.endBarrier).toHaveBeenCalled();
    });

    it('keeps the audio gate when terminal reconciliation refresh fails', async () => {
        mocks.sessionRefresh.mockResolvedValue({ type: 'superseded' });
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'rolled_back', {
                code: 'ACTIVATION_TIMEOUT',
                message: 'Playback returned to the source.',
                retryable: true,
                forceAllowed: false
            })
        }));

        await playbackHandoffStore.playHere();
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'timed_out',
                retryAvailable: true,
                resumeAvailable: false
            }));
        });
        expect(mocks.endBarrier).not.toHaveBeenCalled();

        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'source-tab',
            revision: 4
        };
        mocks.sessionRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });

        await expect(playbackHandoffStore.retry()).resolves.toBe(true);
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state.phase).toBe('rolled_back');
        });
        expect(mocks.endBarrier).toHaveBeenCalled();
    });

    it('offers resume after completed playing audio is silenced by refresh failure', async () => {
        mocks.sessionRefresh.mockResolvedValue({ type: 'error' });
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'completed')
        }));

        await playbackHandoffStore.playHere();
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'timed_out',
                retryAvailable: true,
                resumeAvailable: false
            }));
        });
        expect(mocks.endBarrier).not.toHaveBeenCalled();
        expect(mocks.silenceForDisconnect).toHaveBeenCalledWith('target-tab');

        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'target-tab',
            revision: 4
        };
        mocks.sessionRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });

        await expect(playbackHandoffStore.retry()).resolves.toBe(true);
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'recovery_required',
                retryAvailable: false,
                resumeAvailable: true
            }));
        });
        expect(mocks.endBarrier).toHaveBeenCalled();
    });

    it('defers a terminal outcome until a rotated target identity is reconciled', async () => {
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'activating')
        }));

        await playbackHandoffStore.playHere();
        const request = mocks.request.mock.calls[0]![0] as PlaybackHandoffRequest;
        mocks.registrationSubscriber?.(null);
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'target-tab',
            revision: 4
        };
        mocks.sessionRefresh.mockResolvedValue({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });

        mocks.statusSubscriber?.(status(request, 'recovery_required', {
            code: 'RECOVERY_REQUIRED',
            message: 'Playback is safely paused on the retired target.',
            retryable: true,
            forceAllowed: false
        }));
        expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
            phase: 'reconciling',
            resumeAvailable: false
        }));
        expect(mocks.sessionRefresh).not.toHaveBeenCalled();
        expect(mocks.endBarrier).not.toHaveBeenCalled();

        mocks.registrationSubscriber?.({
            endpointId: 'rotated-target-tab',
            registrationGeneration: 4,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-2'
        });

        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'timed_out',
                retryAvailable: true,
                resumeAvailable: false
            }));
        });
        expect(mocks.endBarrier).toHaveBeenCalled();
        await expect(playbackHandoffStore.resumeHere()).resolves.toBe(false);
        expect(mocks.resumeHere).not.toHaveBeenCalled();
    });

    it('times out terminal identity recovery without releasing the audio gate', async () => {
        vi.useFakeTimers();
        try {
            mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
                type: 'acknowledged',
                acknowledgement: status(request, 'activating')
            }));

            await playbackHandoffStore.playHere();
            const request = mocks.request.mock.calls[0]![0] as PlaybackHandoffRequest;
            mocks.registrationSubscriber?.(null);
            mocks.sessionState.snapshot = {
                ...mocks.sessionState.snapshot,
                state: 'paused',
                activeDeviceId: 'source-tab',
                revision: 4
            };
            mocks.sessionRefresh.mockResolvedValue({
                type: 'success',
                snapshot: mocks.sessionState.snapshot
            });
            mocks.statusSubscriber?.(status(request, 'recovery_required', {
                code: 'RECOVERY_REQUIRED',
                message: 'Playback is safely paused.',
                retryable: true,
                forceAllowed: false
            }));

            await vi.advanceTimersByTimeAsync(60_000);
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'timed_out',
                retryAvailable: true,
                resumeAvailable: false
            }));
            expect(mocks.endBarrier).not.toHaveBeenCalled();
            await expect(playbackHandoffStore.retry()).resolves.toBe(false);

            playbackHandoffStore.dismiss();
            expect(playbackHandoffStore.state.phase).toBe('idle');
            expect(mocks.endBarrier).not.toHaveBeenCalled();

            vi.useRealTimers();
            mocks.registrationSubscriber?.({
                endpointId: 'rotated-target-tab',
                registrationGeneration: 4,
                commandEpoch: 'epoch-1',
                registrationProof: 'proof-2'
            });
            await vi.waitFor(() => {
                expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                    phase: 'rolled_back',
                    retryAvailable: true
                }));
            });
            expect(mocks.endBarrier).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the audio gate after a nonterminal recovery timeout', async () => {
        vi.useFakeTimers();
        try {
            mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
                type: 'acknowledged',
                acknowledgement: status(request, 'activating')
            }));

            await playbackHandoffStore.playHere();
            mocks.registrationSubscriber?.(null);
            mocks.sessionState.snapshot = {
                ...mocks.sessionState.snapshot,
                state: 'paused',
                activeDeviceId: 'source-tab',
                revision: 4
            };
            mocks.sessionRefresh.mockResolvedValue({
                type: 'success',
                snapshot: mocks.sessionState.snapshot
            });

            await vi.advanceTimersByTimeAsync(60_000);
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'timed_out',
                retryAvailable: true,
                resumeAvailable: false
            }));
            expect(mocks.endBarrier).not.toHaveBeenCalled();

            vi.useRealTimers();
            mocks.registrationSubscriber?.({
                endpointId: 'rotated-target-tab',
                registrationGeneration: 4,
                commandEpoch: 'epoch-1',
                registrationProof: 'proof-2'
            });
            await vi.waitFor(() => {
                expect(playbackHandoffStore.state.phase).toBe('rolled_back');
            });
            expect(mocks.endBarrier).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('ignores obsolete nonterminal statuses across target identity reconciliation', async () => {
        let resolveSessionRefresh!: (result: {
            type: 'success';
            snapshot: typeof mocks.sessionState.snapshot;
        }) => void;
        mocks.request.mockImplementation(async (request: PlaybackHandoffRequest) => ({
            type: 'acknowledged',
            acknowledgement: status(request, 'activating')
        }));

        await playbackHandoffStore.playHere();
        const request = mocks.request.mock.calls[0]![0] as PlaybackHandoffRequest;
        mocks.registrationSubscriber?.(null);
        mocks.statusSubscriber?.(status(request, 'claiming'));
        expect(playbackHandoffStore.state.phase).toBe('recovering');

        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            state: 'paused',
            activeDeviceId: 'source-tab',
            revision: 4
        };
        mocks.sessionRefresh.mockReturnValueOnce(new Promise((resolve) => {
            resolveSessionRefresh = resolve;
        }));
        mocks.registrationSubscriber?.({
            endpointId: 'rotated-target-tab',
            registrationGeneration: 4,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-2'
        });

        await vi.waitFor(() => {
            expect(playbackHandoffStore.state.phase).toBe('reconciling');
            expect(mocks.sessionRefresh).toHaveBeenCalledOnce();
        });
        mocks.statusSubscriber?.(status(request, 'claiming'));
        mocks.statusSubscriber?.(status(request, 'activating'));
        expect(playbackHandoffStore.state.phase).toBe('reconciling');

        resolveSessionRefresh({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        });
        await vi.waitFor(() => {
            expect(playbackHandoffStore.state).toEqual(expect.objectContaining({
                phase: 'rolled_back',
                retryAvailable: true,
                resumeAvailable: false
            }));
        });
    });

    it('silences an active source before another browser can Force Play Here', () => {
        mocks.socketHandlers.get('disconnect')?.();

        expect(mocks.silenceForDisconnect).toHaveBeenCalledWith(null);
        expect(playbackHandoffStore.state.phase).toBe('idle');
    });

    it('silences an active source when its endpoint lease expires', () => {
        mocks.sessionState.snapshot = {
            ...mocks.sessionState.snapshot,
            activeDeviceId: 'target-tab'
        };

        mocks.registrationSubscriber?.(null);

        expect(mocks.silenceForDisconnect).toHaveBeenCalledWith(null);
        expect(playbackHandoffStore.state.phase).toBe('idle');
    });
});
