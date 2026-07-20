import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    sequence: 4,
    now: 100,
    connected: true,
    registration: {
        endpointId: 'target-tab',
        registrationGeneration: 3,
        commandEpoch: 'epoch-1',
        registrationProof: 'proof-3'
    } as import('./playback-endpoint').PlaybackEndpointRegistrationState | null,
    registrationSubscriber: null as ((
        value: import('./playback-endpoint').PlaybackEndpointRegistrationState | null
    ) => void) | null,
    socketOn: vi.fn(),
    socketOff: vi.fn(),
    timeout: vi.fn(),
    timeoutEmit: vi.fn()
}));

vi.mock('~/modules/playback-device', () => ({
    getPlaybackEndpointSequence: () => mocks.sequence,
    nextPlaybackEndpointSequence: () => {
        mocks.sequence += 1;
        return mocks.sequence;
    }
}));

vi.mock('./playback-endpoint', () => ({
    playbackEndpointRegistration: {
        get current() {
            return mocks.registration;
        },
        subscribe: (subscriber: typeof mocks.registrationSubscriber) => {
            mocks.registrationSubscriber = subscriber;
            return () => {
                mocks.registrationSubscriber = null;
            };
        }
    }
}));

vi.mock('./socket', () => ({
    socket: {
        get connected() {
            return mocks.connected;
        },
        on: mocks.socketOn,
        off: mocks.socketOff,
        timeout: mocks.timeout
    }
}));

import {
    isPlaybackCommandBarrierActive,
    isPlaybackCommandExecutionBarrierActive
} from '~/modules/playback-command-barrier';

import {
    PlaybackCommandController,
    PlaybackCommandTarget,
    type PlaybackCommandTargetAdapter
} from './playback-command';
import {
    CONTROLLER_REQUEST_ACK_TIMEOUT_MS,
    PLAYBACK_COMMAND_EXECUTE,
    PLAYBACK_COMMAND_REQUEST,
    PLAYBACK_COMMAND_RESULT,
    PLAYBACK_COMMAND_START,
    PLAYBACK_COMMAND_STATUS,
    type PlaybackCommandDispatch,
    type PlaybackCommandExecuteAck,
    type PlaybackCommandRequestAck,
    type PlaybackCommandResultAck,
    type PlaybackCommandStartAck
} from './playback-command-contract';

const dispatch: PlaybackCommandDispatch = {
    protocolVersion: 1,
    commandId: '10000000-0000-4000-8000-000000000001',
    targetEndpointId: 'target-tab',
    expectedSessionRevision: 3,
    expectedQueueRevision: null,
    command: { type: 'play' },
    requesterEndpointId: 'controller-tab',
    targetRegistrationGeneration: 3,
    commandSequence: 8,
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

const recoverSuccessfully = () => vi.fn<PlaybackCommandTargetAdapter['recover']>()
    .mockImplementation(async (_fence, beginReconciliation) => {
        if (!beginReconciliation()) {
            throw new Error('Recovery is no longer current.');
        }
    });

const getSocketHandler = (event: string) => {
    const call = mocks.socketOn.mock.calls.find(([registered]) => registered === event);
    return call?.[1] as ((...args: never[]) => void) | undefined;
};

const getEmit = (event: string, index = 0) => {
    const calls = mocks.timeoutEmit.mock.calls.filter(([emitted]) => emitted === event);
    return calls[index] as [string, Record<string, unknown>, (...args: never[]) => void] | undefined;
};

describe('playback command client transport', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.sequence = 4;
        mocks.now = 100;
        mocks.connected = true;
        mocks.registration = {
            endpointId: 'target-tab',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-3'
        };
        mocks.registrationSubscriber = null;
        mocks.socketOn.mockReset();
        mocks.socketOff.mockReset();
        mocks.timeout.mockReset();
        mocks.timeoutEmit.mockReset();
        mocks.timeout.mockReturnValue({ emit: mocks.timeoutEmit });
        vi.stubGlobal('performance', { now: () => mocks.now });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('executes a granted command once, reports completion, and reconciles before release', async () => {
        const adapter: PlaybackCommandTargetAdapter = {
            prepare: vi.fn().mockReturnValue(null),
            execute: vi.fn().mockResolvedValue({
                status: 'completed',
                resultingState: {
                    state: 'playing',
                    currentMusicId: '1',
                    currentIndex: 0,
                    positionMs: 1_000
                }
            }),
            recover: recoverSuccessfully()
        };
        const target = new PlaybackCommandTarget();
        const executeAck = vi.fn<(ack: PlaybackCommandExecuteAck) => void>();
        target.connect(adapter);

        getSocketHandler(PLAYBACK_COMMAND_EXECUTE)?.(
            dispatch as never,
            executeAck as never
        );

        expect(executeAck).toHaveBeenCalledWith(expect.objectContaining({
            status: 'ready',
            lastEndpointSequence: 4
        }));
        expect(isPlaybackCommandBarrierActive()).toBe(true);
        const start = getEmit(PLAYBACK_COMMAND_START);
        expect(start?.[1]).toEqual(expect.objectContaining({
            commandId: dispatch.commandId,
            commandSequence: dispatch.commandSequence
        }));

        const startAck: PlaybackCommandStartAck = {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            status: 'granted',
            executionToken: 'execution-token',
            startWithinMs: 2_000,
            completeWithinMs: 10_000
        };
        start?.[2](null as never, startAck as never);

        await vi.waitFor(() => {
            expect(adapter.execute).toHaveBeenCalledTimes(1);
            expect(getEmit(PLAYBACK_COMMAND_RESULT)).toBeDefined();
        });
        const result = getEmit(PLAYBACK_COMMAND_RESULT);
        expect(result?.[1]).toEqual(expect.objectContaining({
            status: 'completed',
            endpointSequence: 5,
            executionToken: 'execution-token'
        }));
        const resultAck: PlaybackCommandResultAck = {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            disposition: 'committed',
            commandStatus: 'completed',
            sessionRevision: 4,
            queueRevision: 2,
            occurredAt: '2026-07-20T00:00:01.000Z',
            error: null
        };
        result?.[2](null as never, resultAck as never);
        await vi.waitFor(() => {
            expect(adapter.recover).toHaveBeenCalledWith({
                sessionRevision: 4,
                queueRevision: 2
            }, expect.any(Function));
            expect(isPlaybackCommandBarrierActive()).toBe(false);
        });

        getSocketHandler(PLAYBACK_COMMAND_EXECUTE)?.(
            dispatch as never,
            executeAck as never
        );
        const duplicateStart = getEmit(PLAYBACK_COMMAND_START, 1);
        duplicateStart?.[2](null as never, startAck as never);
        await vi.waitFor(() => {
            expect(getEmit(PLAYBACK_COMMAND_RESULT, 1)).toBeDefined();
        });
        expect(adapter.execute).toHaveBeenCalledTimes(1);
        expect(mocks.sequence).toBe(5);

        target.disconnect();
    });

    it('rejects a mismatched target and reconciles before releasing its barrier', async () => {
        const adapter: PlaybackCommandTargetAdapter = {
            prepare: vi.fn().mockReturnValue({
                code: 'TARGET_STATE_MISMATCH',
                retryable: true,
                message: 'Snapshots differ.'
            }),
            execute: vi.fn(),
            recover: recoverSuccessfully()
        };
        const target = new PlaybackCommandTarget();
        const executeAck = vi.fn<(ack: PlaybackCommandExecuteAck) => void>();
        target.connect(adapter);

        getSocketHandler(PLAYBACK_COMMAND_EXECUTE)?.(
            dispatch as never,
            executeAck as never
        );

        expect(executeAck).toHaveBeenCalledWith(expect.objectContaining({
            status: 'rejected',
            error: expect.objectContaining({ code: 'TARGET_STATE_MISMATCH' })
        }));
        expect(getEmit(PLAYBACK_COMMAND_START)).toBeUndefined();
        expect(adapter.execute).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(adapter.recover).toHaveBeenCalledTimes(1);
            expect(isPlaybackCommandBarrierActive()).toBe(false);
        });

        target.disconnect();
    });

    it('does not execute a missing or late start grant and recovers snapshots', async () => {
        const adapter: PlaybackCommandTargetAdapter = {
            prepare: vi.fn().mockReturnValue(null),
            execute: vi.fn(),
            recover: recoverSuccessfully()
        };
        const target = new PlaybackCommandTarget();
        target.connect(adapter);

        getSocketHandler(PLAYBACK_COMMAND_EXECUTE)?.(
            dispatch as never,
            vi.fn() as never
        );
        const start = getEmit(PLAYBACK_COMMAND_START);
        mocks.now += 2_001;
        start?.[2](null as never, {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            status: 'granted',
            executionToken: 'late-token',
            startWithinMs: 2_000,
            completeWithinMs: 10_000
        } as never);

        await vi.waitFor(() => {
            expect(adapter.recover).toHaveBeenCalledTimes(1);
        });
        expect(adapter.execute).not.toHaveBeenCalled();
        expect(isPlaybackCommandBarrierActive()).toBe(false);

        target.disconnect();
    });

    it('bounds a stalled media execution and fences its late settlement', async () => {
        let resolveExecution!: (value: Awaited<
            ReturnType<PlaybackCommandTargetAdapter['execute']>
        >) => void;
        const execution = new Promise<Awaited<
            ReturnType<PlaybackCommandTargetAdapter['execute']>
        >>((resolve) => {
            resolveExecution = resolve;
        });
        const adapter: PlaybackCommandTargetAdapter = {
            prepare: vi.fn().mockReturnValue(null),
            execute: vi.fn().mockReturnValue(execution),
            recover: recoverSuccessfully()
        };
        const target = new PlaybackCommandTarget();
        target.connect(adapter);
        getSocketHandler(PLAYBACK_COMMAND_EXECUTE)?.(
            dispatch as never,
            vi.fn() as never
        );
        const start = getEmit(PLAYBACK_COMMAND_START);
        start?.[2](null as never, {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            status: 'granted',
            executionToken: 'stalled-token',
            startWithinMs: 2_000,
            completeWithinMs: 1_000
        } as never);

        expect(isPlaybackCommandExecutionBarrierActive()).toBe(true);
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.waitFor(() => {
            expect(adapter.recover).toHaveBeenCalledWith({
                sessionRevision: null,
                queueRevision: null
            }, expect.any(Function));
            expect(isPlaybackCommandBarrierActive()).toBe(false);
        });

        resolveExecution({
            status: 'completed',
            resultingState: {
                state: 'playing',
                currentMusicId: '1',
                currentIndex: 0,
                positionMs: 1_000
            }
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(getEmit(PLAYBACK_COMMAND_RESULT)).toBeUndefined();
        expect(mocks.sequence).toBe(4);

        target.disconnect();
    });

    it('waits for the server window and registration before ambiguous recovery', async () => {
        const recover = vi.fn<PlaybackCommandTargetAdapter['recover']>()
            .mockImplementation(async (_fence, beginReconciliation) => {
                if (!mocks.registration) {
                    throw new Error('Endpoint registration is unavailable.');
                }
                if (!beginReconciliation()) {
                    throw new Error('Recovery is no longer current.');
                }
            });
        const adapter: PlaybackCommandTargetAdapter = {
            prepare: vi.fn().mockReturnValue(null),
            execute: vi.fn().mockResolvedValue({
                status: 'completed',
                resultingState: {
                    state: 'playing',
                    currentMusicId: '1',
                    currentIndex: 0,
                    positionMs: 1_000
                }
            }),
            recover
        };
        const target = new PlaybackCommandTarget();
        target.connect(adapter);
        getSocketHandler(PLAYBACK_COMMAND_EXECUTE)?.(
            dispatch as never,
            vi.fn() as never
        );
        const start = getEmit(PLAYBACK_COMMAND_START);
        start?.[2](null as never, {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            status: 'granted',
            executionToken: 'disconnected-token',
            startWithinMs: 200,
            completeWithinMs: 1_000
        } as never);

        await Promise.resolve();
        await Promise.resolve();
        expect(getEmit(PLAYBACK_COMMAND_RESULT)).toBeDefined();
        mocks.connected = false;
        mocks.registration = null;
        mocks.registrationSubscriber?.(null);
        expect(adapter.recover).not.toHaveBeenCalled();
        expect(isPlaybackCommandBarrierActive()).toBe(true);
        expect(isPlaybackCommandExecutionBarrierActive()).toBe(false);
        await vi.advanceTimersByTimeAsync(1_199);
        expect(adapter.recover).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => {
            expect(adapter.recover).toHaveBeenCalledTimes(1);
        });
        expect(isPlaybackCommandBarrierActive()).toBe(true);
        expect(isPlaybackCommandExecutionBarrierActive()).toBe(false);

        mocks.now += 1_200;
        mocks.connected = true;
        mocks.registration = {
            endpointId: 'target-tab',
            registrationGeneration: 4,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-4'
        };
        mocks.registrationSubscriber?.(mocks.registration);
        await vi.waitFor(() => {
            expect(adapter.recover).toHaveBeenCalledTimes(2);
            expect(isPlaybackCommandBarrierActive()).toBe(false);
        });

        target.disconnect();
    });

    it('retains the persistence barrier and retries failed snapshot recovery', async () => {
        const recover = recoverSuccessfully();
        recover.mockRejectedValueOnce(new Error('Network unavailable.'));
        const adapter: PlaybackCommandTargetAdapter = {
            prepare: vi.fn().mockReturnValue({
                code: 'TARGET_STATE_MISMATCH',
                retryable: true,
                message: 'Snapshots differ.'
            }),
            execute: vi.fn(),
            recover
        };
        const target = new PlaybackCommandTarget();
        target.connect(adapter);
        getSocketHandler(PLAYBACK_COMMAND_EXECUTE)?.(
            dispatch as never,
            vi.fn() as never
        );

        await Promise.resolve();
        await Promise.resolve();
        expect(adapter.recover).toHaveBeenCalledTimes(1);
        expect(isPlaybackCommandBarrierActive()).toBe(true);
        expect(isPlaybackCommandExecutionBarrierActive()).toBe(false);
        await vi.advanceTimersByTimeAsync(999);
        expect(adapter.recover).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => {
            expect(adapter.recover).toHaveBeenCalledTimes(2);
            expect(isPlaybackCommandBarrierActive()).toBe(false);
        });

        target.disconnect();
    });

    it('keeps local controls available while recovery waits on network reads', async () => {
        let beginReconciliation!: () => boolean;
        let resolveRecovery!: () => void;
        const recover = vi.fn<PlaybackCommandTargetAdapter['recover']>()
            .mockImplementation((_fence, begin) => {
                beginReconciliation = begin;
                return new Promise<void>((resolve) => {
                    resolveRecovery = resolve;
                });
            });
        const adapter: PlaybackCommandTargetAdapter = {
            prepare: vi.fn().mockReturnValue({
                code: 'TARGET_STATE_MISMATCH',
                retryable: true,
                message: 'Snapshots differ.'
            }),
            execute: vi.fn(),
            recover
        };
        const target = new PlaybackCommandTarget();
        target.connect(adapter);
        getSocketHandler(PLAYBACK_COMMAND_EXECUTE)?.(
            dispatch as never,
            vi.fn() as never
        );

        expect(recover).toHaveBeenCalledTimes(1);
        expect(isPlaybackCommandBarrierActive()).toBe(true);
        expect(isPlaybackCommandExecutionBarrierActive()).toBe(false);

        expect(beginReconciliation()).toBe(true);
        expect(isPlaybackCommandExecutionBarrierActive()).toBe(true);
        resolveRecovery();
        await vi.waitFor(() => {
            expect(isPlaybackCommandBarrierActive()).toBe(false);
        });

        target.disconnect();
    });

    it('cancels an active command when registration generation changes', async () => {
        const adapter: PlaybackCommandTargetAdapter = {
            prepare: vi.fn().mockReturnValue(null),
            execute: vi.fn(),
            recover: recoverSuccessfully()
        };
        const target = new PlaybackCommandTarget();
        target.connect(adapter);
        getSocketHandler(PLAYBACK_COMMAND_EXECUTE)?.(
            dispatch as never,
            vi.fn() as never
        );

        mocks.registration = {
            ...mocks.registration!,
            registrationGeneration: 4
        };
        mocks.registrationSubscriber?.(mocks.registration);

        await vi.waitFor(() => {
            expect(adapter.recover).toHaveBeenCalledTimes(1);
        });
        expect(adapter.execute).not.toHaveBeenCalled();
        expect(isPlaybackCommandBarrierActive()).toBe(false);

        target.disconnect();
    });

    it('returns a bounded transport error and forwards later command status events', async () => {
        const controller = new PlaybackCommandController();
        const subscriber = vi.fn();
        controller.subscribe(subscriber);
        controller.connect();
        const pending = controller.request({
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            expectedSessionRevision: 3,
            expectedQueueRevision: null,
            command: { type: 'pause' }
        });

        expect(mocks.timeout).toHaveBeenCalledWith(CONTROLLER_REQUEST_ACK_TIMEOUT_MS);
        const request = getEmit(PLAYBACK_COMMAND_REQUEST);
        request?.[2](new Error('timeout') as never);
        await expect(pending).resolves.toEqual({
            type: 'transport-error',
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            retryable: true,
            message: 'The playback command acknowledgement timed out.'
        });

        const statusHandler = getSocketHandler(PLAYBACK_COMMAND_STATUS);
        const status: PlaybackCommandRequestAck = {
            protocolVersion: 1,
            commandEpoch: 'epoch-1',
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            commandSequence: 8,
            status: 'completed',
            deduplicated: false,
            sessionRevision: 4,
            queueRevision: 2,
            occurredAt: '2026-07-20T00:00:01.000Z',
            error: null
        };
        statusHandler?.(status as never);
        expect(subscriber).toHaveBeenCalledWith(status);

        controller.disconnect();
    });
});
