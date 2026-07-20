import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    controllerRequest: vi.fn(),
    controllerSubscriber: null as null | ((
        status: import('~/socket/playback-command').PlaybackCommandStatus
    ) => void),
    devicesSubscriber: null as null | (() => void),
    devicesRefresh: vi.fn(),
    devicesState: {
        error: null as string | null,
        loading: false,
        registry: null as Record<string, unknown> | null
    },
    queueRefresh: vi.fn(),
    queueSubscriber: null as null | (() => void),
    queueState: {
        error: null as string | null,
        initialized: true,
        loading: false,
        snapshot: null as Record<string, unknown> | null
    },
    registrationState: {
        endpointId: 'local-tab',
        registrationGeneration: 3,
        commandEpoch: 'epoch-1',
        registrationProof: 'proof-1'
    } as null | {
        endpointId: string;
        registrationGeneration: number;
        commandEpoch: string;
        registrationProof: string;
    },
    registrationError: null as string | null,
    registrationSubscriber: null as null | ((registration: null | {
        endpointId: string;
        registrationGeneration: number;
        commandEpoch: string;
        registrationProof: string;
    }) => void),
    sessionRefresh: vi.fn(),
    sessionSubscriber: null as null | (() => void),
    sessionState: {
        endpointId: 'local-tab',
        error: null as string | null,
        loading: false,
        snapshot: null as Record<string, unknown> | null
    }
}));

vi.mock('~/socket/playback-command', () => ({
    COMMAND_COMPLETION_TIMEOUT_MS: 300,
    CONTROLLER_RECOVERY_WINDOW_MS: 10_000,
    START_REQUEST_TIMEOUT_MS: 200,
    TARGET_READY_TIMEOUT_MS: 100,
    playbackCommandController: {
        request: mocks.controllerRequest,
        subscribe: (subscriber: (
            status: import('~/socket/playback-command').PlaybackCommandStatus
        ) => void) => {
            mocks.controllerSubscriber = subscriber;
            return () => {
                mocks.controllerSubscriber = null;
            };
        }
    }
}));

vi.mock('./playback-devices', () => ({
    playbackDevicesStore: {
        get state() {
            return mocks.devicesState;
        },
        refresh: mocks.devicesRefresh,
        subscribe: (subscriber: () => void) => {
            mocks.devicesSubscriber = subscriber;
            return () => {
                mocks.devicesSubscriber = null;
            };
        }
    },
    resolveActivePlaybackTarget: (registry: {
        activeEndpointId?: string | null;
        devices?: Array<{
            endpoints: Array<{ id: string }>;
        }>;
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

vi.mock('./playback-queue', () => ({
    playbackQueueStore: {
        get state() {
            return mocks.queueState;
        },
        refresh: mocks.queueRefresh,
        subscribe: (subscriber: () => void) => {
            mocks.queueSubscriber = subscriber;
            return () => {
                mocks.queueSubscriber = null;
            };
        }
    }
}));

vi.mock('./playback-session', () => ({
    playbackSessionStore: {
        get endpointId() {
            return mocks.sessionState.endpointId;
        },
        get state() {
            return mocks.sessionState;
        },
        refresh: mocks.sessionRefresh,
        subscribe: (subscriber: () => void) => {
            mocks.sessionSubscriber = subscriber;
            return () => {
                mocks.sessionSubscriber = null;
            };
        }
    }
}));

vi.mock('~/socket/playback-endpoint', () => ({
    playbackEndpointRegistration: {
        get current() {
            return mocks.registrationState;
        },
        get error() {
            return mocks.registrationError;
        },
        subscribe: (subscriber: NonNullable<typeof mocks.registrationSubscriber>) => {
            mocks.registrationSubscriber = subscriber;
            return () => {
                mocks.registrationSubscriber = null;
            };
        }
    }
}));

import {
    beginPlaybackCommandBarrier,
    endPlaybackCommandBarrier,
    isPlaybackControllerCommandBarrierActive
} from '~/modules/playback-command-barrier';
import type {
    PlaybackCommandControllerInput,
    PlaybackCommandRequestAck,
    PlaybackCommandStatus
} from '~/socket/playback-command';
import {
    isRemotePlaybackControlPending,
    REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS,
    REMOTE_PLAYBACK_STATUS_RECOVERY_MS,
    RemotePlaybackControlStore
} from './remote-playback-control';

const remoteEndpoint = {
    id: 'remote-tab',
    capabilities: ['play', 'pause', 'seek', 'next', 'previous'],
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    online: true,
    active: true,
    registrationGeneration: 2
};

const remoteDevice = {
    id: 'remote-browser',
    name: 'Living Room Browser',
    type: 'desktop-web',
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    online: true,
    active: true,
    endpoints: [remoteEndpoint]
};

const localEndpoint = {
    id: 'local-tab',
    capabilities: ['play', 'pause', 'seek', 'next', 'previous'],
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    online: true,
    active: false,
    registrationGeneration: 3
};

const localDevice = {
    id: 'local-browser',
    name: 'This Browser',
    type: 'desktop-web',
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    online: true,
    active: false,
    endpoints: [localEndpoint]
};

const createStatus = (
    input: PlaybackCommandControllerInput,
    status: PlaybackCommandStatus['status'],
    error: PlaybackCommandStatus['error'] = null,
    overrides: Partial<PlaybackCommandStatus> = {}
): PlaybackCommandStatus => ({
    protocolVersion: 1,
    commandEpoch: 'epoch-1',
    commandId: input.commandId ?? 'missing-command-id',
    status,
    deduplicated: false,
    targetEndpointId: input.targetEndpointId,
    commandSequence: 8,
    sessionRevision: 7,
    queueRevision: 4,
    occurredAt: '2026-07-20T00:00:01.000Z',
    error,
    ...overrides
});

const acknowledged = (acknowledgement: PlaybackCommandRequestAck) => ({
    type: 'acknowledged' as const,
    acknowledgement
});

const connectReadyStore = async (store: RemotePlaybackControlStore) => {
    store.connect();
    await vi.waitFor(() => expect(store.controllerReady).toBe(true));
    mocks.sessionRefresh.mockClear();
    mocks.queueRefresh.mockClear();
    mocks.devicesRefresh.mockClear();
};

describe('RemotePlaybackControlStore', () => {
    beforeEach(() => {
        mocks.controllerRequest.mockReset();
        mocks.controllerSubscriber = null;
        mocks.devicesSubscriber = null;
        mocks.devicesRefresh.mockReset();
        mocks.queueRefresh.mockReset();
        mocks.queueSubscriber = null;
        mocks.sessionRefresh.mockReset();
        mocks.sessionSubscriber = null;
        mocks.devicesState.error = null;
        mocks.devicesState.loading = false;
        mocks.queueState.error = null;
        mocks.queueState.initialized = true;
        mocks.queueState.loading = false;
        mocks.sessionState.error = null;
        mocks.sessionState.loading = false;
        remoteEndpoint.online = true;
        remoteEndpoint.capabilities = ['play', 'pause', 'seek', 'next', 'previous'];
        localEndpoint.id = 'local-tab';
        localEndpoint.registrationGeneration = 3;
        mocks.sessionState.endpointId = 'local-tab';
        mocks.registrationState = {
            endpointId: 'local-tab',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-1'
        };
        mocks.registrationError = null;
        mocks.registrationSubscriber = null;
        mocks.sessionState.snapshot = {
            id: 'session-1',
            state: 'playing',
            activeDeviceId: 'remote-tab',
            currentMusicId: '42',
            positionMs: 1_000,
            positionUpdatedAt: '2026-07-20T00:00:00.000Z',
            startedAt: '2026-07-20T00:00:00.000Z',
            revision: 7,
            serverTime: '2026-07-20T00:00:00.000Z'
        };
        mocks.queueState.snapshot = {
            revision: 4
        };
        mocks.devicesState.registry = {
            commandEpoch: 'epoch-1',
            activeEndpointId: 'remote-tab',
            serverTime: '2026-07-20T00:00:00.000Z',
            devices: [remoteDevice, localDevice]
        };
        mocks.devicesRefresh.mockImplementation(async () => ({
            type: 'success',
            registry: mocks.devicesState.registry
        }));
        mocks.queueRefresh.mockImplementation(async () => ({
            type: 'success',
            snapshot: mocks.queueState.snapshot
        }));
        mocks.sessionRefresh.mockImplementation(async () => ({
            type: 'success',
            snapshot: mocks.sessionState.snapshot
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('shows accepted work until the target completes and then refreshes authoritative state', async () => {
        mocks.controllerRequest.mockImplementation(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'accepted')));
        const store = new RemotePlaybackControlStore();
        await connectReadyStore(store);

        await expect(store.send({ type: 'pause' })).resolves.toBe(true);

        expect(mocks.controllerRequest).toHaveBeenCalledWith(expect.objectContaining({
            targetEndpointId: 'remote-tab',
            expectedSessionRevision: 7,
            expectedQueueRevision: null,
            command: { type: 'pause' }
        }));
        expect(store.state).toMatchObject({
            phase: 'accepted',
            targetDeviceName: 'Living Room Browser',
            error: null
        });

        const request = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;
        mocks.controllerSubscriber?.(createStatus(request, 'completed'));

        await vi.waitFor(() => {
            expect(store.state).toMatchObject({
                phase: 'completed',
                message: 'Living Room Browser completed Pause.'
            });
            expect(mocks.sessionRefresh).toHaveBeenCalledOnce();
            expect(mocks.queueRefresh).toHaveBeenCalledOnce();
            expect(mocks.devicesRefresh).toHaveBeenCalledOnce();
        });
        store.disconnect();
    });

    it('keeps controls blocked until terminal revision fences are refreshed', async () => {
        let resolveSessionRefresh!: (value: {
            type: 'success';
            snapshot: Record<string, unknown>;
        }) => void;
        mocks.sessionRefresh.mockImplementationOnce(() => new Promise((resolve) => {
            resolveSessionRefresh = resolve;
        }));
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'completed', null, {
            sessionRevision: 8,
            queueRevision: 5
        })));
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'pause' })).resolves.toBe(true);
        expect(store.state.phase).toBe('reconciling');
        expect(isRemotePlaybackControlPending(store.state.phase)).toBe(true);
        expect(isPlaybackControllerCommandBarrierActive()).toBe(true);

        (mocks.sessionState.snapshot as { revision: number }).revision = 8;
        (mocks.queueState.snapshot as { revision: number }).revision = 5;
        resolveSessionRefresh({
            type: 'success',
            snapshot: mocks.sessionState.snapshot!
        });

        await vi.waitFor(() => expect(store.state.phase).toBe('completed'));
        expect(isRemotePlaybackControlPending(store.state.phase)).toBe(false);
        expect(isPlaybackControllerCommandBarrierActive()).toBe(false);
        store.disconnect();
    });

    it('retries only authoritative refresh after a terminal refresh failure', async () => {
        mocks.devicesRefresh.mockRejectedValueOnce(new Error('offline'));
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'completed')));
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'pause' })).resolves.toBe(true);
        await vi.waitFor(() => expect(store.state.phase).toBe('refresh_error'));
        expect(isRemotePlaybackControlPending(store.state.phase)).toBe(true);

        await expect(store.retry()).resolves.toBe(true);
        expect(store.state.phase).toBe('completed');
        expect(mocks.controllerRequest).toHaveBeenCalledOnce();
        expect(mocks.devicesRefresh).toHaveBeenCalledTimes(2);
        store.disconnect();
    });

    it('reconciles a target-changed rejection against the new authoritative target', async () => {
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => {
            (mocks.sessionState.snapshot as {
                activeDeviceId: string;
                revision: number;
            }).activeDeviceId = 'new-remote-tab';
            (mocks.sessionState.snapshot as { revision: number }).revision = 8;
            (mocks.devicesState.registry as {
                activeEndpointId: string;
                devices: Array<Record<string, unknown>>;
            }).activeEndpointId = 'new-remote-tab';
            (mocks.devicesState.registry as {
                devices: Array<Record<string, unknown>>;
            }).devices.push({
                id: 'new-remote-browser',
                name: 'Kitchen Browser',
                type: 'desktop-web',
                lastSeenAt: '2026-07-20T00:00:01.000Z',
                online: true,
                active: true,
                endpoints: [{
                    ...remoteEndpoint,
                    id: 'new-remote-tab',
                    active: true
                }]
            });
            return acknowledged(createStatus(input, 'rejected', {
                code: 'TARGET_NOT_ACTIVE',
                message: 'The requested endpoint is no longer active.',
                retryable: true
            }, {
                sessionRevision: 8,
                queueRevision: null
            }));
        });
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'pause' })).resolves.toBe(false);
        await vi.waitFor(() => expect(store.state).toMatchObject({
            phase: 'rejected',
            error: { code: 'TARGET_NOT_ACTIVE' }
        }));
        expect(store.state.phase).not.toBe('refresh_error');
        store.disconnect();
    });

    it('reconciles a session-not-found rejection to authoritative absence', async () => {
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => {
            mocks.sessionState.snapshot = null;
            (mocks.devicesState.registry as {
                activeEndpointId: string | null;
            }).activeEndpointId = null;
            return acknowledged(createStatus(input, 'rejected', {
                code: 'SESSION_NOT_FOUND',
                message: 'No authoritative playback session exists.',
                retryable: true
            }, {
                sessionRevision: null,
                queueRevision: null
            }));
        });
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'pause' })).resolves.toBe(false);
        await vi.waitFor(() => expect(store.state).toMatchObject({
            phase: 'rejected',
            error: { code: 'SESSION_NOT_FOUND' }
        }));
        expect(store.state.phase).not.toBe('refresh_error');
        store.disconnect();
    });

    it('does not resend a rejected command when retry preflight refresh fails', async () => {
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'rejected', {
            code: 'STALE_SESSION_REVISION',
            message: 'The shared playback session changed.',
            retryable: true
        })));
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'pause' })).resolves.toBe(false);
        await vi.waitFor(() => expect(store.state.phase).toBe('rejected'));
        mocks.sessionRefresh.mockResolvedValueOnce({ type: 'error' });

        await expect(store.retry()).resolves.toBe(false);
        expect(mocks.controllerRequest).toHaveBeenCalledOnce();
        expect(mocks.sessionRefresh).toHaveBeenLastCalledWith(
            REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS
        );
        expect(store.state).toMatchObject({
            phase: 'refresh_error',
            error: {
                code: 'STATE_COMMIT_FAILED',
                retryable: true
            }
        });

        await expect(store.retry()).resolves.toBe(false);
        expect(store.state).toMatchObject({
            phase: 'rejected',
            error: { code: 'STALE_SESSION_REVISION' }
        });
        expect(mocks.controllerRequest).toHaveBeenCalledOnce();
        store.disconnect();
    });

    it('blocks duplicate retry and concurrent commands during retry preflight', async () => {
        mocks.controllerRequest
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'rejected', {
                    code: 'STALE_SESSION_REVISION',
                    message: 'The shared playback session changed.',
                    retryable: true
                }))
            ))
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'accepted'))
            ));
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'next' })).resolves.toBe(false);
        await vi.waitFor(() => expect(store.state.phase).toBe('rejected'));
        const first = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;
        let resolveSessionRefresh!: (value: {
            type: 'success';
            snapshot: Record<string, unknown>;
        }) => void;
        mocks.sessionRefresh.mockImplementationOnce(() => new Promise((resolve) => {
            resolveSessionRefresh = resolve;
        }));

        const retry = store.retry();
        expect(store.state).toMatchObject({
            phase: 'reconciling',
            message: 'Refreshing playback state before retrying the command…',
            error: null
        });
        expect(isRemotePlaybackControlPending(store.state.phase)).toBe(true);
        await expect(store.retry()).resolves.toBe(false);
        await expect(store.send({ type: 'pause' })).resolves.toBe(false);
        expect(mocks.controllerRequest).toHaveBeenCalledOnce();

        (mocks.sessionState.snapshot as { revision: number }).revision = 9;
        resolveSessionRefresh({
            type: 'success',
            snapshot: mocks.sessionState.snapshot!
        });

        await expect(retry).resolves.toBe(true);
        const second = mocks.controllerRequest.mock.calls[1]![0] as PlaybackCommandControllerInput;
        expect(second.commandId).not.toBe(first.commandId);
        expect(second).toMatchObject({
            command: { type: 'next' },
            expectedSessionRevision: 9
        });
        expect(mocks.controllerRequest).toHaveBeenCalledTimes(2);
        store.disconnect();
    });

    it('bounds terminal snapshot recovery and exposes refresh retry after failure', async () => {
        mocks.sessionRefresh.mockImplementationOnce(async (timeoutMs: number) => {
            expect(timeoutMs).toBe(REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS);
            return { type: 'error' };
        });
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'completed')));
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'pause' })).resolves.toBe(true);
        await vi.waitFor(() => expect(store.state.phase).toBe('refresh_error'));
        expect(mocks.queueRefresh).toHaveBeenCalledWith(
            REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS
        );
        expect(mocks.devicesRefresh).toHaveBeenCalledWith(
            REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS
        );
        store.disconnect();
    });

    it('keeps a rejection visible and retries with a new id and current revisions', async () => {
        mocks.controllerRequest
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'rejected', {
                    code: 'STALE_SESSION_REVISION',
                    message: 'The shared playback session changed.',
                    retryable: true
                }))
            ))
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'accepted'))
            ));
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'next' })).resolves.toBe(false);
        await vi.waitFor(() => {
            expect(store.state).toMatchObject({
                phase: 'rejected',
                message: 'The shared playback session changed.',
                error: { code: 'STALE_SESSION_REVISION', retryable: true }
            });
        });

        await vi.waitFor(() => {
            expect(mocks.sessionRefresh).toHaveBeenCalledOnce();
            expect(mocks.queueRefresh).toHaveBeenCalledOnce();
        });
        mocks.sessionRefresh.mockImplementationOnce(async () => {
            (mocks.sessionState.snapshot as { revision: number }).revision = 9;
            return { type: 'success', snapshot: mocks.sessionState.snapshot };
        });
        mocks.queueRefresh.mockImplementationOnce(async () => {
            (mocks.queueState.snapshot as { revision: number }).revision = 6;
            return { type: 'success', snapshot: mocks.queueState.snapshot };
        });
        await expect(store.retry()).resolves.toBe(true);

        const first = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;
        const second = mocks.controllerRequest.mock.calls[1]![0] as PlaybackCommandControllerInput;
        expect(second.commandId).not.toBe(first.commandId);
        expect(second).toMatchObject({
            expectedSessionRevision: 9,
            expectedQueueRevision: 6,
            command: { type: 'next' }
        });
        expect(mocks.sessionRefresh).toHaveBeenCalledTimes(2);
        expect(mocks.queueRefresh).toHaveBeenCalledTimes(2);
        expect(store.state.phase).toBe('accepted');
        store.disconnect();
    });

    it('keeps an acknowledgement timeout pending and accepts a late terminal status', async () => {
        mocks.controllerRequest.mockImplementation(async (
            input: PlaybackCommandControllerInput
        ) => ({
            type: 'transport-error',
            commandId: input.commandId!,
            targetEndpointId: input.targetEndpointId,
            retryable: true,
            message: 'The playback command acknowledgement timed out.'
        }));
        const observedSnapshot = mocks.sessionState.snapshot;
        const store = new RemotePlaybackControlStore();
        await connectReadyStore(store);

        await expect(store.send({ type: 'next' })).resolves.toBe(true);

        expect(store.state).toMatchObject({
            phase: 'recovering',
            command: { type: 'next' },
            error: null
        });
        expect(mocks.sessionState.snapshot).toBe(observedSnapshot);
        const request = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;
        mocks.controllerSubscriber?.(createStatus(request, 'completed'));

        await vi.waitFor(() => expect(store.state.phase).toBe('completed'));
        expect(mocks.controllerRequest).toHaveBeenCalledOnce();
        store.disconnect();
    });

    it('recovers an acknowledgement timeout with the same command id', async () => {
        vi.useFakeTimers();
        mocks.controllerRequest
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => ({
                type: 'transport-error',
                commandId: input.commandId!,
                targetEndpointId: input.targetEndpointId,
                retryable: true,
                message: 'The playback command acknowledgement timed out.'
            }))
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'completed'))
            ));
        const store = new RemotePlaybackControlStore();

        await store.send({ type: 'previous' });
        expect(store.state.phase).toBe('recovering');
        await vi.advanceTimersByTimeAsync(REMOTE_PLAYBACK_STATUS_RECOVERY_MS);

        const first = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;
        const recovered = mocks.controllerRequest.mock.calls[1]![0] as PlaybackCommandControllerInput;
        expect(recovered.commandId).toBe(first.commandId);
        expect(store.state.phase).toBe('completed');
        store.disconnect();
    });

    it('does not replay while an exact device refresh is superseded', async () => {
        vi.useFakeTimers();
        mocks.controllerRequest
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => ({
                type: 'transport-error',
                commandId: input.commandId!,
                targetEndpointId: input.targetEndpointId,
                retryable: true,
                message: 'The playback command acknowledgement timed out.'
            }))
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'completed'))
            ));
        const store = new RemotePlaybackControlStore();

        await store.send({ type: 'next' });
        await vi.waitFor(() => expect(mocks.devicesRefresh).toHaveBeenCalledOnce());
        mocks.devicesRefresh.mockResolvedValueOnce({ type: 'superseded' });

        await vi.advanceTimersByTimeAsync(REMOTE_PLAYBACK_STATUS_RECOVERY_MS);
        expect(mocks.controllerRequest).toHaveBeenCalledOnce();
        expect(store.state.phase).toBe('recovering');
        expect(store.state.message).toContain('could not be refreshed');

        await vi.advanceTimersByTimeAsync(REMOTE_PLAYBACK_STATUS_RECOVERY_MS);
        const first = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;
        const recovered = mocks.controllerRequest.mock.calls[1]![0] as PlaybackCommandControllerInput;
        expect(recovered.commandId).toBe(first.commandId);
        expect(store.state.phase).toBe('completed');
        store.disconnect();
    });

    it('recovers a pending request with the same id after the same endpoint reconnects', async () => {
        mocks.controllerRequest
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'accepted'))
            ))
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'completed'))
            ));
        const store = new RemotePlaybackControlStore();
        await connectReadyStore(store);

        await store.send({ type: 'previous' });
        const first = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;
        mocks.registrationState = null;
        mocks.registrationSubscriber?.(null);

        expect(store.state.phase).toBe('recovering');
        expect(store.state.message).toContain('disconnected');
        expect(mocks.controllerRequest).toHaveBeenCalledOnce();

        localEndpoint.registrationGeneration = 4;
        mocks.registrationState = {
            endpointId: 'local-tab',
            registrationGeneration: 4,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-2'
        };
        mocks.registrationSubscriber?.(mocks.registrationState);

        await vi.waitFor(() => expect(store.state.phase).toBe('completed'));
        const recovered = mocks.controllerRequest.mock.calls[1]![0] as PlaybackCommandControllerInput;
        expect(recovered.commandId).toBe(first.commandId);
        store.disconnect();
    });

    it('does not replay a pending request under a rotated requester endpoint', async () => {
        vi.useFakeTimers();
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'accepted')));
        const store = new RemotePlaybackControlStore();
        await connectReadyStore(store);

        await store.send({ type: 'next' });
        localEndpoint.id = 'local-tab-rotated';
        localEndpoint.registrationGeneration = 1;
        mocks.sessionState.endpointId = 'local-tab-rotated';
        mocks.registrationState = {
            endpointId: 'local-tab-rotated',
            registrationGeneration: 1,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-rotated'
        };
        mocks.registrationSubscriber?.(mocks.registrationState);

        await vi.waitFor(() => expect(store.state.phase).toBe('timed_out'));
        await vi.advanceTimersByTimeAsync(REMOTE_PLAYBACK_STATUS_RECOVERY_MS * 2);
        expect(mocks.controllerRequest).toHaveBeenCalledOnce();
        store.disconnect();
    });

    it('does not recover or accept a command across coordinator epochs', async () => {
        vi.useFakeTimers();
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => ({
            type: 'transport-error',
            commandId: input.commandId!,
            targetEndpointId: input.targetEndpointId,
            retryable: true,
            message: 'The playback command acknowledgement timed out.'
        }));
        const store = new RemotePlaybackControlStore();
        await connectReadyStore(store);

        await store.send({ type: 'next' });
        const request = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;
        mocks.controllerSubscriber?.({
            ...createStatus(request, 'completed'),
            commandEpoch: 'epoch-2'
        });
        expect(store.state.phase).toBe('recovering');

        (mocks.devicesState.registry as { commandEpoch: string }).commandEpoch = 'epoch-2';
        mocks.registrationState = {
            endpointId: 'local-tab',
            registrationGeneration: 3,
            commandEpoch: 'epoch-2',
            registrationProof: 'proof-epoch-2'
        };
        mocks.registrationSubscriber?.(mocks.registrationState);

        expect(mocks.controllerRequest).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(store.state).toMatchObject({
            phase: 'timed_out',
            error: { code: 'COMMAND_COMPLETION_TIMEOUT', retryable: true }
        }));
        store.disconnect();
    });

    it('does not retransmit an accepted command after the recovery window', async () => {
        vi.useFakeTimers();
        let elapsedMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => elapsedMs);
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'accepted')));
        const store = new RemotePlaybackControlStore();

        await store.send({ type: 'previous' });
        vi.setSystemTime(Date.now() - 60_000);
        elapsedMs = 10_001;
        await vi.advanceTimersByTimeAsync(REMOTE_PLAYBACK_STATUS_RECOVERY_MS);

        expect(mocks.controllerRequest).toHaveBeenCalledOnce();
        expect(store.state.phase).toBe('timed_out');
        store.disconnect();
    });

    it('keeps a realtime acceptance when the request acknowledgement races and times out', async () => {
        let resolveRequest!: (result: {
            type: 'transport-error';
            commandId: string;
            targetEndpointId: string;
            retryable: true;
            message: string;
        }) => void;
        mocks.controllerRequest.mockImplementation((input: PlaybackCommandControllerInput) => (
            new Promise((resolve) => {
                resolveRequest = resolve;
                queueMicrotask(() => {
                    mocks.controllerSubscriber?.(createStatus(input, 'accepted'));
                });
            })
        ));
        const store = new RemotePlaybackControlStore();
        await connectReadyStore(store);
        const request = store.send({ type: 'pause' });
        await vi.waitFor(() => expect(store.state.phase).toBe('accepted'));
        const input = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;

        resolveRequest({
            type: 'transport-error',
            commandId: input.commandId!,
            targetEndpointId: input.targetEndpointId,
            retryable: true,
            message: 'The playback command acknowledgement timed out.'
        });

        await expect(request).resolves.toBe(true);
        expect(store.state.phase).toBe('accepted');
        store.disconnect();
    });

    it('recovers a missed terminal notification with the same command id', async () => {
        vi.useFakeTimers();
        mocks.controllerRequest
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'accepted'))
            ))
            .mockImplementationOnce(async (input: PlaybackCommandControllerInput) => (
                acknowledged(createStatus(input, 'completed'))
            ));
        const store = new RemotePlaybackControlStore();

        await store.send({ type: 'previous' });
        await vi.advanceTimersByTimeAsync(REMOTE_PLAYBACK_STATUS_RECOVERY_MS);

        const first = mocks.controllerRequest.mock.calls[0]![0] as PlaybackCommandControllerInput;
        const recovered = mocks.controllerRequest.mock.calls[1]![0] as PlaybackCommandControllerInput;
        expect(recovered.commandId).toBe(first.commandId);
        expect(store.state.phase).toBe('completed');
        store.disconnect();
    });

    it('keeps completed feedback until the user dismisses it', async () => {
        vi.useFakeTimers();
        mocks.controllerRequest.mockImplementationOnce(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'completed')));
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'pause' })).resolves.toBe(true);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(store.state.phase).toBe('completed');

        store.dismiss();
        expect(store.state.phase).toBe('idle');
        store.disconnect();
    });

    it('waits for a registry snapshot containing the current requester registration', async () => {
        localEndpoint.registrationGeneration = 2;
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'pause' })).resolves.toBe(false);
        expect(mocks.controllerRequest).not.toHaveBeenCalled();
        expect(store.state).toMatchObject({
            phase: 'rejected',
            error: { code: 'TARGET_NOT_ACTIVE', retryable: true }
        });
        store.disconnect();
    });

    it('waits for post-registration session, queue, and device reads before becoming ready', async () => {
        mocks.registrationState = null;
        let resolveSessionRefresh!: (value: {
            type: 'success';
            snapshot: Record<string, unknown>;
        }) => void;
        let resolveQueueRefresh!: (value: {
            type: 'success';
            snapshot: Record<string, unknown>;
        }) => void;
        let resolveDevicesRefresh!: (value: {
            type: 'success';
            registry: Record<string, unknown>;
        }) => void;
        mocks.sessionRefresh.mockImplementationOnce(() => new Promise((resolve) => {
            resolveSessionRefresh = resolve;
        }));
        mocks.queueRefresh.mockImplementationOnce(() => new Promise((resolve) => {
            resolveQueueRefresh = resolve;
        }));
        mocks.devicesRefresh.mockImplementationOnce(() => new Promise((resolve) => {
            resolveDevicesRefresh = resolve;
        }));
        const store = new RemotePlaybackControlStore();

        store.connect();
        expect(store.controllerReady).toBe(false);
        expect(mocks.sessionRefresh).not.toHaveBeenCalled();
        expect(mocks.queueRefresh).not.toHaveBeenCalled();
        expect(mocks.devicesRefresh).not.toHaveBeenCalled();

        mocks.registrationState = {
            endpointId: 'local-tab',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-1'
        };
        mocks.registrationSubscriber?.(mocks.registrationState);

        expect(store.state.controllerRefreshing).toBe(true);
        expect(mocks.sessionRefresh).toHaveBeenCalledWith(
            REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS
        );
        expect(mocks.queueRefresh).toHaveBeenCalledWith(
            REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS
        );
        expect(mocks.devicesRefresh).toHaveBeenCalledWith(
            REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS
        );

        resolveSessionRefresh({
            type: 'success',
            snapshot: mocks.sessionState.snapshot!
        });
        resolveQueueRefresh({
            type: 'success',
            snapshot: mocks.queueState.snapshot!
        });
        await Promise.resolve();
        expect(store.controllerReady).toBe(false);

        resolveDevicesRefresh({
            type: 'success',
            registry: mocks.devicesState.registry!
        });
        await vi.waitFor(() => expect(store.controllerReady).toBe(true));
        store.disconnect();
    });

    it('exposes a bounded retry when post-registration readiness refresh fails', async () => {
        mocks.sessionRefresh.mockResolvedValueOnce({ type: 'error' });
        const store = new RemotePlaybackControlStore();

        store.connect();
        await vi.waitFor(() => expect(store.state).toMatchObject({
            controllerReady: false,
            controllerRefreshing: false,
            controllerError: {
                code: 'STATE_COMMIT_FAILED',
                retryable: true
            }
        }));
        expect(mocks.sessionRefresh).toHaveBeenLastCalledWith(
            REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS
        );

        await expect(store.retryControllerReadiness()).resolves.toBe(true);
        expect(store.controllerReady).toBe(true);
        expect(store.state.controllerError).toBeNull();
        store.disconnect();
    });

    it('rejects exact readiness when a completed leg receives an error-only update', async () => {
        let resolveDevicesRefresh!: (value: {
            type: 'success';
            registry: Record<string, unknown>;
        }) => void;
        mocks.devicesRefresh.mockImplementationOnce(() => new Promise((resolve) => {
            resolveDevicesRefresh = resolve;
        }));
        const store = new RemotePlaybackControlStore();

        store.connect();
        await vi.waitFor(() => {
            expect(mocks.queueRefresh).toHaveBeenCalledOnce();
            expect(mocks.devicesRefresh).toHaveBeenCalledOnce();
        });

        mocks.queueState.error = 'The queue save failed after the exact read.';
        mocks.queueSubscriber?.();
        expect(store.state.controllerRefreshing).toBe(true);

        resolveDevicesRefresh({
            type: 'success',
            registry: mocks.devicesState.registry!
        });

        await vi.waitFor(() => expect(store.state).toMatchObject({
            controllerReady: false,
            controllerRefreshing: false,
            controllerError: {
                code: 'STATE_COMMIT_FAILED',
                retryable: true
            }
        }));
        expect(store.controllerReady).toBe(false);
        store.disconnect();
    });

    it('does not offer an ineffective refresh retry for terminal registration failure', async () => {
        mocks.registrationState = null;
        mocks.registrationError = 'Playback endpoint capacity is full. Close another playback tab and reload.';
        const store = new RemotePlaybackControlStore();

        store.connect();

        expect(store.state).toMatchObject({
            controllerReady: false,
            controllerRefreshing: false,
            controllerError: {
                code: 'TARGET_OFFLINE',
                retryable: false
            }
        });
        await expect(store.retryControllerReadiness()).resolves.toBe(false);
        expect(store.state.controllerError?.retryable).toBe(false);
        expect(mocks.sessionRefresh).not.toHaveBeenCalled();
        expect(mocks.queueRefresh).not.toHaveBeenCalled();
        expect(mocks.devicesRefresh).not.toHaveBeenCalled();
        store.disconnect();
    });

    it('surfaces later snapshot errors and restores controls through readiness retry', async () => {
        const store = new RemotePlaybackControlStore();
        await connectReadyStore(store);

        mocks.sessionState.error = 'Unable to read shared playback state.';
        mocks.sessionSubscriber?.();
        expect(store.controllerReady).toBe(false);
        expect(store.state).toMatchObject({
            controllerRefreshing: false,
            controllerError: {
                code: 'STATE_COMMIT_FAILED',
                retryable: true
            }
        });

        mocks.sessionState.error = null;
        await expect(store.retryControllerReadiness()).resolves.toBe(true);
        expect(store.controllerReady).toBe(true);
        store.disconnect();
    });

    it('does not send to an offline or unsupported active target', async () => {
        const store = new RemotePlaybackControlStore();
        remoteEndpoint.online = false;

        await expect(store.send({ type: 'pause' })).resolves.toBe(false);
        expect(store.state).toMatchObject({
            phase: 'rejected',
            error: { code: 'TARGET_OFFLINE', retryable: true }
        });
        expect(mocks.controllerRequest).not.toHaveBeenCalled();

        remoteEndpoint.online = true;
        remoteEndpoint.capabilities = ['play'];
        store.dismiss();
        await expect(store.send({ type: 'seek', positionMs: 4_000 })).resolves.toBe(false);
        expect(store.state).toMatchObject({
            phase: 'rejected',
            error: { code: 'UNSUPPORTED_COMMAND', retryable: false }
        });
        expect(mocks.controllerRequest).not.toHaveBeenCalled();

        remoteEndpoint.capabilities = ['play', 'pause', 'seek', 'next', 'previous'];
        store.disconnect();
    });

    it('does not start an outbound command while this tab executes a target command', async () => {
        const targetBarrier = 'incoming-target-command-test';
        expect(beginPlaybackCommandBarrier(targetBarrier)).toBe(true);
        const store = new RemotePlaybackControlStore();

        try {
            await expect(store.send({ type: 'pause' })).resolves.toBe(false);
            expect(store.state).toMatchObject({
                phase: 'rejected',
                error: {
                    code: 'TARGET_STATE_MISMATCH',
                    retryable: true
                }
            });
            expect(isPlaybackControllerCommandBarrierActive()).toBe(false);
            expect(mocks.controllerRequest).not.toHaveBeenCalled();
        } finally {
            store.disconnect();
            endPlaybackCommandBarrier(targetBarrier);
        }
    });

    it('waits for an authoritative queue revision only when the command needs one', async () => {
        mocks.queueState.snapshot = null;
        mocks.controllerRequest.mockImplementation(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'accepted')));
        const store = new RemotePlaybackControlStore();

        await expect(store.send({ type: 'previous' })).resolves.toBe(false);
        expect(store.state).toMatchObject({
            phase: 'rejected',
            error: { code: 'STALE_QUEUE_REVISION', retryable: true }
        });
        expect(mocks.controllerRequest).not.toHaveBeenCalled();

        store.dismiss();
        await expect(store.send({ type: 'seek', positionMs: 4_000 })).resolves.toBe(true);
        expect(mocks.controllerRequest).toHaveBeenCalledWith(expect.objectContaining({
            expectedQueueRevision: null
        }));
        store.disconnect();
    });

    it('includes the queue fence when play must select from a stopped session', async () => {
        mocks.controllerRequest.mockImplementation(async (
            input: PlaybackCommandControllerInput
        ) => acknowledged(createStatus(input, 'accepted')));
        const store = new RemotePlaybackControlStore();

        (mocks.sessionState.snapshot as { state: string }).state = 'paused';
        await store.send({ type: 'play' });
        expect(mocks.controllerRequest).toHaveBeenLastCalledWith(expect.objectContaining({
            expectedQueueRevision: null
        }));

        store.disconnect();
        (mocks.sessionState.snapshot as { state: string }).state = 'stopped';
        await store.send({ type: 'play' });
        expect(mocks.controllerRequest).toHaveBeenLastCalledWith(expect.objectContaining({
            expectedQueueRevision: 4
        }));

        store.disconnect();
        await expect(store.send({
            type: 'seek',
            positionMs: 4_000
        })).resolves.toBe(false);
        expect(store.state).toMatchObject({
            phase: 'rejected',
            error: { code: 'INVALID_COMMAND', retryable: false }
        });
        expect(mocks.controllerRequest).toHaveBeenCalledTimes(2);
        store.disconnect();
    });
});
