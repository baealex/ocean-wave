import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

type SocketHandler = (
    value?: unknown,
    acknowledge?: (acknowledgement: unknown) => void
) => void;

const mocks = vi.hoisted(() => ({
    beginBarrier: vi.fn().mockReturnValue(true),
    endBarrier: vi.fn(),
    endpointSequence: 4,
    registration: {
        endpointId: 'source-tab',
        registrationGeneration: 2,
        commandEpoch: 'epoch-1',
        registrationProof: 'proof-1'
    } as import('./playback-endpoint').PlaybackEndpointRegistrationState | null,
    registrationSubscriber: null as null | ((
        registration: import('./playback-endpoint')
            .PlaybackEndpointRegistrationState | null
    ) => void),
    socketHandlers: new Map<string, SocketHandler>()
}));

vi.mock('~/modules/playback-command-barrier', () => ({
    beginPlaybackCommandBarrier: mocks.beginBarrier,
    endPlaybackCommandBarrier: mocks.endBarrier
}));

vi.mock('~/modules/playback-device', () => ({
    getPlaybackEndpointSequence: () => mocks.endpointSequence
}));

vi.mock('./playback-endpoint', () => ({
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

vi.mock('./socket', () => ({
    socket: {
        on: vi.fn((event: string, handler: SocketHandler) => {
            mocks.socketHandlers.set(event, handler);
        }),
        off: vi.fn((event: string) => {
            mocks.socketHandlers.delete(event);
        })
    }
}));

import {
    HANDOFF_ACTIVATION_TIMEOUT_MS,
    HANDOFF_RELEASE_TIMEOUT_MS,
    HANDOFF_SOURCE_SETTLE_TIMEOUT_MS,
    PLAYBACK_HANDOFF_ACTIVATE,
    PLAYBACK_HANDOFF_RELEASE,
    PLAYBACK_HANDOFF_SETTLE_SOURCE,
    type PlaybackHandoffActivationDispatch,
    type PlaybackHandoffReleaseDispatch,
    type PlaybackHandoffSourceSettleDispatch
} from './playback-handoff-contract';
import {
    PlaybackHandoffController,
    PlaybackHandoffSourceTarget,
    type PlaybackHandoffControllerAdapter,
    type PlaybackHandoffSourceAdapter
} from './playback-handoff';

const SOURCE_RECOVERY_TIMEOUT_MS = HANDOFF_RELEASE_TIMEOUT_MS
    + HANDOFF_ACTIVATION_TIMEOUT_MS
    + HANDOFF_SOURCE_SETTLE_TIMEOUT_MS
    + 2_000;

const snapshot = {
    sessionRevision: 3,
    queueRevision: 2,
    state: 'playing' as const,
    currentMusicId: '1',
    currentIndex: 0,
    positionMs: 12_000,
    queue: {
        id: '1',
        musicIds: ['1', '2'],
        sourceMusicIds: [],
        currentIndex: 0,
        contextType: 'queue' as const,
        contextId: null,
        contextTitle: null,
        shuffle: false,
        repeatMode: 'none' as const,
        revision: 2,
        updatedAt: '2026-07-20T00:00:00.000Z'
    }
};

const releaseDispatch: PlaybackHandoffReleaseDispatch = {
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
    snapshot
};

const restoreDispatch: PlaybackHandoffSourceSettleDispatch = {
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
        ...snapshot,
        sessionRevision: 5,
        positionMs: 12_500
    },
    reason: null
};

const playbackHistory = {
    clientSessionId: 'shared-playback-1',
    branchId: 'target-branch-1',
    parentBranchId: 'shared-playback-1',
    branchBasePlayedMs: 12_000,
    trackId: '1',
    startedAt: '2026-07-19T23:59:50.000Z',
    accumulatedPlayedMs: 22_000,
    hadSeek: true,
    updatedAt: '2026-07-20T00:00:12.000Z'
};

const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

describe('PlaybackHandoffSourceTarget', () => {
    let sourceTarget: PlaybackHandoffSourceTarget;
    let adapter: PlaybackHandoffSourceAdapter;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.socketHandlers.clear();
        mocks.registration = {
            endpointId: 'source-tab',
            registrationGeneration: 2,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-1'
        };
        mocks.registrationSubscriber = null;
        adapter = {
            prepareRelease: vi.fn().mockReturnValue(null),
            release: vi.fn().mockResolvedValue({
                status: 'released',
                endpointSequence: 5,
                positionMs: 12_000,
                playbackHistory
            }),
            settle: vi.fn().mockResolvedValue({
                status: 'settled',
                endpointSequence: 6,
                positionMs: 12_500
            }),
            recover: vi.fn().mockResolvedValue(undefined),
            abandon: vi.fn(),
            flushBufferedReport: vi.fn()
        };
        sourceTarget = new PlaybackHandoffSourceTarget();
        sourceTarget.connect(adapter);
    });

    afterEach(() => {
        sourceTarget.disconnect();
        vi.useRealTimers();
    });

    const releaseSource = async () => {
        const acknowledge = vi.fn();
        mocks.socketHandlers.get(PLAYBACK_HANDOFF_RELEASE)?.(
            releaseDispatch,
            acknowledge
        );
        await flushPromises();
        expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({
            status: 'released',
            positionMs: 12_000,
            playbackHistory
        }));
    };

    const loseRegistration = () => {
        mocks.registration = null;
        mocks.registrationSubscriber?.(null);
    };

    it('keeps a released source paused while its endpoint lease is unavailable', async () => {
        await releaseSource();

        loseRegistration();
        await vi.advanceTimersByTimeAsync(SOURCE_RECOVERY_TIMEOUT_MS);

        expect(adapter.recover).not.toHaveBeenCalled();
        expect(adapter.abandon).not.toHaveBeenCalled();

        const renewed = {
            endpointId: 'source-tab',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-2'
        };
        mocks.registration = renewed;
        mocks.registrationSubscriber?.(renewed);
        await flushPromises();

        expect(adapter.recover).toHaveBeenCalledOnce();
        expect(adapter.flushBufferedReport).toHaveBeenCalledOnce();
    });

    it('waits for a valid source registration before applying rollback', async () => {
        await releaseSource();
        loseRegistration();
        const acknowledge = vi.fn();

        mocks.socketHandlers.get(PLAYBACK_HANDOFF_SETTLE_SOURCE)?.(
            restoreDispatch,
            acknowledge
        );
        await flushPromises();
        expect(adapter.settle).not.toHaveBeenCalled();
        expect(acknowledge).not.toHaveBeenCalled();

        const renewed = {
            endpointId: 'source-tab',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-2'
        };
        mocks.registration = renewed;
        mocks.registrationSubscriber?.(renewed);
        await flushPromises();

        expect(adapter.settle).toHaveBeenCalledWith(restoreDispatch);
        expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({
            status: 'settled'
        }));
        expect(adapter.recover).not.toHaveBeenCalled();
    });

    it('reconciles immediately after the server command epoch changes', async () => {
        await releaseSource();
        loseRegistration();

        const restarted = {
            endpointId: 'source-tab',
            registrationGeneration: 3,
            commandEpoch: 'epoch-2',
            registrationProof: 'proof-2'
        };
        mocks.registration = restarted;
        mocks.registrationSubscriber?.(restarted);
        await flushPromises();

        expect(adapter.recover).toHaveBeenCalledOnce();
        expect(adapter.abandon).not.toHaveBeenCalled();
    });

    it('abandons a released source without resuming after endpoint rotation', async () => {
        await releaseSource();
        loseRegistration();

        const rotated = {
            endpointId: 'rotated-source-tab',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-2'
        };
        mocks.registration = rotated;
        mocks.registrationSubscriber?.(rotated);

        expect(adapter.abandon).toHaveBeenCalledOnce();
        expect(adapter.recover).not.toHaveBeenCalled();
        expect(adapter.flushBufferedReport).toHaveBeenCalledOnce();
    });
});

describe('PlaybackHandoffController activation', () => {
    let controller: PlaybackHandoffController;
    let adapter: PlaybackHandoffControllerAdapter;

    const activation: PlaybackHandoffActivationDispatch = {
        protocolVersion: 1,
        commandEpoch: 'epoch-1',
        handoffId: 'handoff-target-1',
        handoffSequence: 2,
        sourceEndpointId: 'source-tab',
        targetEndpointId: 'target-tab',
        targetRegistrationGeneration: 3,
        claimSessionRevision: 4,
        activateBy: '2026-07-20T00:00:10.000Z',
        snapshot: {
            ...snapshot,
            sessionRevision: 4
        },
        playbackHistory
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.socketHandlers.clear();
        mocks.registration = {
            endpointId: 'target-tab',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-target'
        };
        mocks.registrationSubscriber = null;
        adapter = {
            activate: vi.fn().mockResolvedValue({
                status: 'completed',
                endpointSequence: 5,
                positionMs: 12_000
            }),
            abort: vi.fn()
        };
        controller = new PlaybackHandoffController();
        controller.connect(adapter);
    });

    afterEach(() => {
        controller.disconnect();
    });

    it('forwards a validated cumulative history transfer to the target adapter', async () => {
        const acknowledge = vi.fn();

        mocks.socketHandlers.get(PLAYBACK_HANDOFF_ACTIVATE)?.(
            activation,
            acknowledge
        );
        await flushPromises();

        expect(adapter.activate).toHaveBeenCalledWith(activation);
        expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
            endpointSequence: 5
        }));
    });

    it('rejects a history transfer with a noncanonical parent', async () => {
        const acknowledge = vi.fn();

        mocks.socketHandlers.get(PLAYBACK_HANDOFF_ACTIVATE)?.({
            ...activation,
            playbackHistory: {
                ...playbackHistory,
                parentBranchId: 'missing-parent'
            }
        }, acknowledge);
        await flushPromises();

        expect(adapter.activate).not.toHaveBeenCalled();
        expect(acknowledge).not.toHaveBeenCalled();
    });

    it('accepts an older activation without a history transfer', async () => {
        const acknowledge = vi.fn();
        const legacyActivation = { ...activation } as Partial<
            PlaybackHandoffActivationDispatch
        >;
        delete legacyActivation.playbackHistory;

        mocks.socketHandlers.get(PLAYBACK_HANDOFF_ACTIVATE)?.(
            legacyActivation,
            acknowledge
        );
        await flushPromises();

        expect(adapter.activate).toHaveBeenCalledWith(legacyActivation);
        expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed'
        }));
    });
});
