import type { Socket } from 'socket.io';

import {
    PlaybackCommandServiceError,
    type ResolvedPlaybackCommand
} from '~/features/playback/services/playback-command';
import type { PlaybackSessionSnapshot } from '~/features/playback/services/playback-session';

import type { PlaybackEndpointRoute } from './playback-endpoints';
import {
    PLAYBACK_COMMAND_REQUEST_RATE_LIMIT,
    PLAYBACK_COMMAND_REQUEST_RATE_WINDOW_MS,
    PlaybackCommandCoordinator
} from './playback-command';
import {
    COMMAND_COMPLETION_TIMEOUT_MS,
    COMMAND_RESULT_RETENTION_MS,
    CONTROLLER_RECOVERY_WINDOW_MS,
    CONTROLLER_REQUEST_ACK_TIMEOUT_MS,
    EXECUTION_GRANT_TTL_MS,
    PLAYBACK_COMMAND_EXECUTE,
    PLAYBACK_COMMAND_REQUEST,
    PLAYBACK_COMMAND_RESULT,
    PLAYBACK_COMMAND_START,
    PLAYBACK_COMMAND_STATUS,
    START_REQUEST_TIMEOUT_MS,
    TARGET_READY_TIMEOUT_MS,
    type PlaybackCommand,
    type PlaybackCommandDispatch,
    type PlaybackCommandExecutionResult,
    type PlaybackCommandRequest,
    type PlaybackCommandResultAck,
    type PlaybackCommandStatus
} from './playback-command-contract';

const COMMAND_ID = '10000000-0000-4000-8000-000000000001';
const START_REQUEST_ID = '20000000-0000-4000-8000-000000000001';

const createSocket = (id: string, endpointId: string, generation = 1) => ({
    id,
    connected: true,
    data: {
        playbackEndpointId: endpointId,
        playbackRegistrationGeneration: generation
    },
    emit: jest.fn(),
    on: jest.fn(),
    disconnect: jest.fn()
}) as unknown as Socket;

const createRoute = (
    socket: Socket,
    endpointId: string,
    generation = 1,
    capabilities: PlaybackEndpointRoute['capabilities'] = [
        'play',
        'pause',
        'seek',
        'next',
        'previous'
    ]
): PlaybackEndpointRoute => ({
    socket,
    socketId: socket.id,
    deviceId: `${endpointId}-device`,
    endpointId,
    registrationGeneration: generation,
    capabilities,
    lastEndpointSequence: 4
});

const createSession = (
    overrides: Partial<PlaybackSessionSnapshot> = {}
): PlaybackSessionSnapshot => ({
    id: '1',
    state: 'paused',
    activeDeviceId: 'target-tab',
    activeDeviceSequence: 4,
    currentMusicId: '1',
    positionMs: 1_000,
    positionUpdatedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    revision: 3,
    serverTime: '2026-07-20T00:00:00.000Z',
    ...overrides
});

const createResolved = (
    overrides: Partial<ResolvedPlaybackCommand> = {}
): ResolvedPlaybackCommand => ({
    dispatchSource: {
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
    },
    sessionId: 1,
    activeEndpointSequence: 4,
    sourceStartedAt: new Date('2026-07-20T00:00:00.000Z'),
    durationMs: 180_000,
    queue: {
        id: 1,
        revision: 2,
        currentIndex: 0,
        musicIds: ['1', '2']
    },
    ...overrides
});

const createRequest = (
    command: PlaybackCommand = { type: 'play' },
    overrides: Partial<PlaybackCommandRequest> = {}
): PlaybackCommandRequest => ({
    protocolVersion: 1,
    commandId: COMMAND_ID,
    targetEndpointId: 'target-tab',
    expectedSessionRevision: 3,
    expectedQueueRevision: command.type === 'next' || command.type === 'previous'
        ? 2
        : null,
    command,
    ...overrides
});

describe('playback command coordinator', () => {
    let controller: Socket;
    let target: Socket;
    let routes: Map<string, PlaybackEndpointRoute>;
    let getSession: jest.Mock;
    let resolveCommand: jest.Mock;
    let commitResult: jest.Mock;
    let onCommitted: jest.Mock;
    let coordinator: PlaybackCommandCoordinator;

    beforeEach(() => {
        jest.useFakeTimers({ now: Date.parse('2026-07-20T00:00:00.000Z') });
        controller = createSocket('controller-socket', 'controller-tab');
        target = createSocket('target-socket', 'target-tab');
        routes = new Map([
            ['controller-tab', createRoute(controller, 'controller-tab')],
            ['target-tab', createRoute(target, 'target-tab')]
        ]);
        getSession = jest.fn().mockResolvedValue(createSession());
        resolveCommand = jest.fn().mockResolvedValue(createResolved());
        commitResult = jest.fn().mockResolvedValue({
            sessionRevision: 4,
            queueRevision: 2
        });
        onCommitted = jest.fn().mockResolvedValue(undefined);
        coordinator = new PlaybackCommandCoordinator({
            now: Date.now,
            commandEpoch: 'epoch-1',
            getRoute: endpointId => routes.get(endpointId) ?? null,
            getSession,
            resolveCommand,
            commitResult,
            onCommitted
        });
    });

    afterEach(() => {
        coordinator.clear();
        jest.useRealTimers();
    });

    const emittedStatuses = () => (controller.emit as jest.Mock).mock.calls
        .filter(([event]) => event === PLAYBACK_COMMAND_STATUS)
        .map(([, status]) => status as PlaybackCommandStatus);

    it('keeps protocol event names and timing windows fixed', () => {
        expect({
            PLAYBACK_COMMAND_REQUEST,
            PLAYBACK_COMMAND_EXECUTE,
            PLAYBACK_COMMAND_START,
            PLAYBACK_COMMAND_RESULT,
            PLAYBACK_COMMAND_STATUS,
            CONTROLLER_REQUEST_ACK_TIMEOUT_MS,
            TARGET_READY_TIMEOUT_MS,
            START_REQUEST_TIMEOUT_MS,
            EXECUTION_GRANT_TTL_MS,
            COMMAND_COMPLETION_TIMEOUT_MS,
            CONTROLLER_RECOVERY_WINDOW_MS,
            COMMAND_RESULT_RETENTION_MS
        }).toEqual({
            PLAYBACK_COMMAND_REQUEST: 'playback:command-request',
            PLAYBACK_COMMAND_EXECUTE: 'playback:command-execute',
            PLAYBACK_COMMAND_START: 'playback:command-start',
            PLAYBACK_COMMAND_RESULT: 'playback:command-result',
            PLAYBACK_COMMAND_STATUS: 'playback:command-status',
            CONTROLLER_REQUEST_ACK_TIMEOUT_MS: 5_000,
            TARGET_READY_TIMEOUT_MS: 2_000,
            START_REQUEST_TIMEOUT_MS: 2_000,
            EXECUTION_GRANT_TTL_MS: 2_000,
            COMMAND_COMPLETION_TIMEOUT_MS: 10_000,
            CONTROLLER_RECOVERY_WINDOW_MS: 60_000,
            COMMAND_RESULT_RETENTION_MS: 120_000
        });
    });

    const installCompletingTarget = () => {
        let resultPromise: Promise<PlaybackCommandResultAck> | null = null;
        let submittedResult: PlaybackCommandExecutionResult | null = null;
        (target.emit as jest.Mock).mockImplementation((
            event: string,
            dispatch: PlaybackCommandDispatch,
            acknowledge: (value: unknown) => void
        ) => {
            if (event !== PLAYBACK_COMMAND_EXECUTE) {
                return true;
            }

            acknowledge({
                protocolVersion: 1,
                commandId: dispatch.commandId,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                commandSequence: dispatch.commandSequence,
                status: 'ready',
                lastEndpointSequence: 4
            });
            const grant = coordinator.start(target, {
                protocolVersion: 1,
                commandId: dispatch.commandId,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                commandSequence: dispatch.commandSequence,
                startRequestId: START_REQUEST_ID
            });

            if (grant.status !== 'granted') {
                throw new Error('Expected the execution grant to be issued.');
            }

            const result: PlaybackCommandExecutionResult = {
                protocolVersion: 1,
                commandId: dispatch.commandId,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                commandSequence: dispatch.commandSequence,
                executionToken: grant.executionToken,
                status: 'completed',
                endpointSequence: 5,
                observedAt: new Date().toISOString(),
                resultingState: {
                    state: dispatch.desiredResult.state,
                    currentMusicId: dispatch.desiredResult.currentMusicId,
                    currentIndex: dispatch.desiredResult.currentIndex,
                    positionMs: dispatch.desiredResult.position.mode === 'absolute'
                        ? dispatch.desiredResult.position.positionMs
                        : 1_000
                }
            };
            submittedResult = result;
            resultPromise = coordinator.result(target, result);
            return true;
        });

        return {
            wait: async () => {
                await Promise.resolve();
                if (!resultPromise) {
                    throw new Error('Expected the target to submit a result.');
                }
                return resultPromise;
            },
            getResult: () => {
                if (!submittedResult) {
                    throw new Error('Expected the target result to be available.');
                }
                return submittedResult;
            }
        };
    };

    it.each<PlaybackCommand>([
        { type: 'play' },
        { type: 'pause' },
        { type: 'seek', positionMs: 20_000 },
        { type: 'next' },
        { type: 'previous' }
    ])('uses the shared accepted and completed envelope for $type', async (command) => {
        const completion = installCompletingTarget();

        const acknowledgement = await coordinator.request(
            controller,
            createRequest(command)
        );
        const resultAck = await completion.wait();

        expect(acknowledgement).toEqual(expect.objectContaining({
            protocolVersion: 1,
            commandEpoch: 'epoch-1',
            commandId: COMMAND_ID,
            status: 'accepted',
            error: null
        }));
        expect(resultAck).toEqual(expect.objectContaining({
            disposition: 'committed',
            commandStatus: 'completed',
            sessionRevision: 4,
            queueRevision: 2
        }));
        expect(emittedStatuses().map(status => status.status)).toEqual([
            'accepted',
            'completed'
        ]);
        expect(commitResult).toHaveBeenCalledTimes(1);
        expect(onCommitted).toHaveBeenCalledWith({
            sessionRevision: 4,
            queueRevision: 2
        });
    });

    it('returns a target rejection without granting audio execution', async () => {
        (target.emit as jest.Mock).mockImplementation((
            _event: string,
            dispatch: PlaybackCommandDispatch,
            acknowledge: (value: unknown) => void
        ) => {
            acknowledge({
                protocolVersion: 1,
                commandId: dispatch.commandId,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                commandSequence: dispatch.commandSequence,
                status: 'rejected',
                lastEndpointSequence: 4,
                error: {
                    code: 'AUTOPLAY_BLOCKED',
                    retryable: false,
                    message: 'Autoplay is blocked.'
                }
            });
        });

        await expect(coordinator.request(controller, createRequest())).resolves.toEqual(
            expect.objectContaining({
                status: 'rejected',
                error: expect.objectContaining({ code: 'AUTOPLAY_BLOCKED' })
            })
        );
        expect(commitResult).not.toHaveBeenCalled();
    });

    it('reports accepted before a granted target execution is rejected', async () => {
        let resultPromise: Promise<PlaybackCommandResultAck> | null = null;
        (target.emit as jest.Mock).mockImplementation((
            _event: string,
            dispatch: PlaybackCommandDispatch,
            acknowledge: (value: unknown) => void
        ) => {
            acknowledge({
                protocolVersion: 1,
                commandId: dispatch.commandId,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                commandSequence: dispatch.commandSequence,
                status: 'ready',
                lastEndpointSequence: 4
            });
            const grant = coordinator.start(target, {
                protocolVersion: 1,
                commandId: dispatch.commandId,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                commandSequence: dispatch.commandSequence,
                startRequestId: START_REQUEST_ID
            });
            if (grant.status !== 'granted') {
                throw new Error('Expected an execution grant.');
            }
            resultPromise = coordinator.result(target, {
                protocolVersion: 1,
                commandId: dispatch.commandId,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                commandSequence: dispatch.commandSequence,
                executionToken: grant.executionToken,
                status: 'rejected',
                lastEndpointSequence: 4,
                observedAt: new Date().toISOString(),
                error: {
                    code: 'MEDIA_NOT_READY',
                    retryable: true,
                    message: 'The media element is not ready.'
                }
            });
        });

        await expect(coordinator.request(controller, createRequest())).resolves.toEqual(
            expect.objectContaining({ status: 'accepted', error: null })
        );
        expect(resultPromise).not.toBeNull();
        await expect(resultPromise!).resolves.toEqual(expect.objectContaining({
            disposition: 'committed',
            commandStatus: 'rejected',
            error: expect.objectContaining({ code: 'MEDIA_NOT_READY' })
        }));
        expect(emittedStatuses().map(status => status.status)).toEqual([
            'accepted',
            'rejected'
        ]);
        expect(commitResult).not.toHaveBeenCalled();
    });

    it('bounds readiness, start, and completion waits with distinct timeout errors', async () => {
        (target.emit as jest.Mock).mockReturnValue(true);
        const readiness = coordinator.request(controller, createRequest());
        await jest.advanceTimersByTimeAsync(TARGET_READY_TIMEOUT_MS);
        await expect(readiness).resolves.toEqual(expect.objectContaining({
            status: 'timed_out',
            error: expect.objectContaining({ code: 'TARGET_READY_TIMEOUT' })
        }));

        const secondRequest = createRequest({ type: 'pause' }, {
            commandId: '10000000-0000-4000-8000-000000000002'
        });
        (target.emit as jest.Mock).mockImplementation((
            _event: string,
            dispatch: PlaybackCommandDispatch,
            acknowledge: (value: unknown) => void
        ) => acknowledge({
            protocolVersion: 1,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            status: 'ready',
            lastEndpointSequence: 4
        }));
        const start = coordinator.request(controller, secondRequest);
        await jest.advanceTimersByTimeAsync(START_REQUEST_TIMEOUT_MS);
        await expect(start).resolves.toEqual(expect.objectContaining({
            status: 'timed_out',
            error: expect.objectContaining({ code: 'START_REQUEST_TIMEOUT' })
        }));

        let dispatch!: PlaybackCommandDispatch;
        (target.emit as jest.Mock).mockImplementation((
            _event: string,
            value: PlaybackCommandDispatch,
            acknowledge: (ack: unknown) => void
        ) => {
            dispatch = value;
            acknowledge({
                protocolVersion: 1,
                commandId: value.commandId,
                targetEndpointId: value.targetEndpointId,
                targetRegistrationGeneration: value.targetRegistrationGeneration,
                commandSequence: value.commandSequence,
                status: 'ready',
                lastEndpointSequence: 4
            });
        });
        const thirdRequest = createRequest({ type: 'seek', positionMs: 2_000 }, {
            commandId: '10000000-0000-4000-8000-000000000003'
        });
        const completion = coordinator.request(controller, thirdRequest);
        for (let attempt = 0; attempt < 10 && !dispatch; attempt += 1) {
            await Promise.resolve();
        }
        expect(dispatch).toBeDefined();
        const grant = coordinator.start(target, {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            startRequestId: '20000000-0000-4000-8000-000000000003'
        });
        expect(grant.status).toBe('granted');
        await expect(completion).resolves.toEqual(expect.objectContaining({
            status: 'accepted'
        }));
        await jest.advanceTimersByTimeAsync(
            EXECUTION_GRANT_TTL_MS + COMMAND_COMPLETION_TIMEOUT_MS
        );
        expect(emittedStatuses().at(-1)).toEqual(expect.objectContaining({
            status: 'timed_out',
            error: expect.objectContaining({ code: 'COMMAND_COMPLETION_TIMEOUT' })
        }));
    });

    it('reuses a current start grant but rejects it after terminal timeout', async () => {
        let dispatch!: PlaybackCommandDispatch;
        (target.emit as jest.Mock).mockImplementation((
            _event: string,
            value: PlaybackCommandDispatch,
            acknowledge: (ack: unknown) => void
        ) => {
            dispatch = value;
            acknowledge({
                protocolVersion: 1,
                commandId: value.commandId,
                targetEndpointId: value.targetEndpointId,
                targetRegistrationGeneration: value.targetRegistrationGeneration,
                commandSequence: value.commandSequence,
                status: 'ready',
                lastEndpointSequence: 4
            });
        });

        const pending = coordinator.request(controller, createRequest());
        for (let attempt = 0; attempt < 10 && !dispatch; attempt += 1) {
            await Promise.resolve();
        }
        const startRequest = {
            protocolVersion: 1 as const,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            startRequestId: START_REQUEST_ID
        };
        const grant = coordinator.start(target, startRequest);
        expect(grant.status).toBe('granted');
        expect(coordinator.start(target, startRequest)).toEqual(grant);
        await expect(pending).resolves.toEqual(expect.objectContaining({
            status: 'accepted'
        }));

        await jest.advanceTimersByTimeAsync(
            EXECUTION_GRANT_TTL_MS + COMMAND_COMPLETION_TIMEOUT_MS
        );

        expect(coordinator.start(target, startRequest)).toEqual(expect.objectContaining({
            status: 'rejected',
            error: expect.objectContaining({ code: 'COMMAND_EXPIRED' })
        }));
    });

    it('retains the session guard until an admitted result commit settles', async () => {
        let dispatch!: PlaybackCommandDispatch;
        let resolveCommit!: (value: {
            sessionRevision: number;
            queueRevision: number | null;
        }) => void;
        commitResult.mockImplementation(() => new Promise((resolve) => {
            resolveCommit = resolve;
        }));
        (target.emit as jest.Mock).mockImplementation((
            _event: string,
            value: PlaybackCommandDispatch,
            acknowledge: (ack: unknown) => void
        ) => {
            dispatch = value;
            acknowledge({
                protocolVersion: 1,
                commandId: value.commandId,
                targetEndpointId: value.targetEndpointId,
                targetRegistrationGeneration: value.targetRegistrationGeneration,
                commandSequence: value.commandSequence,
                status: 'ready',
                lastEndpointSequence: 4
            });
        });

        const pending = coordinator.request(controller, createRequest());
        for (let attempt = 0; attempt < 10 && !dispatch; attempt += 1) {
            await Promise.resolve();
        }
        const grant = coordinator.start(target, {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            startRequestId: START_REQUEST_ID
        });
        if (grant.status !== 'granted') {
            throw new Error('Expected an execution grant.');
        }
        await expect(pending).resolves.toEqual(expect.objectContaining({
            status: 'accepted'
        }));
        const committing = coordinator.result(target, {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            executionToken: grant.executionToken,
            status: 'completed',
            endpointSequence: 5,
            observedAt: new Date().toISOString(),
            resultingState: {
                state: 'playing',
                currentMusicId: '1',
                currentIndex: 0,
                positionMs: 1_000
            }
        });

        await jest.advanceTimersByTimeAsync(
            EXECUTION_GRANT_TTL_MS + COMMAND_COMPLETION_TIMEOUT_MS
        );
        expect(emittedStatuses().map(status => status.status)).toEqual(['accepted']);
        await expect(coordinator.request(controller, createRequest({ type: 'pause' }, {
            commandId: '10000000-0000-4000-8000-000000000004'
        }))).resolves.toEqual(expect.objectContaining({
            status: 'rejected',
            error: expect.objectContaining({ code: 'COMMAND_IN_PROGRESS' })
        }));

        resolveCommit({ sessionRevision: 4, queueRevision: 2 });
        await expect(committing).resolves.toEqual(expect.objectContaining({
            disposition: 'committed',
            commandStatus: 'completed'
        }));
        expect(emittedStatuses().map(status => status.status)).toEqual([
            'accepted',
            'rejected',
            'completed'
        ]);
        expect(onCommitted).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent and completed requests without a second dispatch or commit', async () => {
        const completion = installCompletingTarget();
        const request = createRequest();

        const [first, joined] = await Promise.all([
            coordinator.request(controller, request),
            coordinator.request(controller, request)
        ]);
        await completion.wait();
        const duplicate = await coordinator.request(controller, request);
        const duplicateResult = await coordinator.result(
            target,
            completion.getResult()
        );

        expect(first).toEqual(expect.objectContaining({ status: 'accepted' }));
        expect(joined).toEqual(expect.objectContaining({
            status: 'accepted',
            deduplicated: true
        }));
        expect(duplicate).toEqual(expect.objectContaining({
            status: 'completed',
            deduplicated: true
        }));
        expect(duplicateResult.disposition).toBe('duplicate');
        expect(target.emit).toHaveBeenCalledTimes(1);
        expect(commitResult).toHaveBeenCalledTimes(1);
    });

    it('keeps an accepted command terminal across target reconnect without replay', async () => {
        let dispatch!: PlaybackCommandDispatch;
        (target.emit as jest.Mock).mockImplementation((
            _event: string,
            value: PlaybackCommandDispatch,
            acknowledge: (ack: unknown) => void
        ) => {
            dispatch = value;
            acknowledge({
                protocolVersion: 1,
                commandId: value.commandId,
                targetEndpointId: value.targetEndpointId,
                targetRegistrationGeneration: value.targetRegistrationGeneration,
                commandSequence: value.commandSequence,
                status: 'ready',
                lastEndpointSequence: 4
            });
        });

        const pending = coordinator.request(controller, createRequest());
        for (let attempt = 0; attempt < 10 && !dispatch; attempt += 1) {
            await Promise.resolve();
        }
        expect(dispatch).toBeDefined();
        expect(coordinator.start(target, {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            startRequestId: START_REQUEST_ID
        }).status).toBe('granted');
        await expect(pending).resolves.toEqual(expect.objectContaining({
            status: 'accepted'
        }));

        const replacement = createSocket('replacement-socket', 'target-tab', 2);
        routes.set('target-tab', createRoute(replacement, 'target-tab', 2));
        coordinator.handleSocketDisconnected(target.id);

        expect(emittedStatuses().at(-1)).toEqual(expect.objectContaining({
            status: 'timed_out',
            error: expect.objectContaining({ code: 'COMMAND_COMPLETION_TIMEOUT' })
        }));
        await expect(coordinator.request(controller, createRequest())).resolves.toEqual(
            expect.objectContaining({
                status: 'timed_out',
                deduplicated: true
            })
        );
        expect(target.emit).toHaveBeenCalledTimes(1);
        expect(replacement.emit).not.toHaveBeenCalled();
    });

    it('standardizes unregistered, offline, unsupported, and stale request failures', async () => {
        const unregistered = createSocket('unknown', 'unknown');
        routes.delete('unknown');
        await expect(coordinator.request(unregistered, createRequest())).resolves.toEqual(
            expect.objectContaining({
                status: 'rejected',
                error: expect.objectContaining({ code: 'UNAUTHORIZED_COMMAND' })
            })
        );

        routes.delete('target-tab');
        await expect(coordinator.request(controller, createRequest({ type: 'pause' }, {
            commandId: '10000000-0000-4000-8000-000000000010'
        }))).resolves.toEqual(expect.objectContaining({
            error: expect.objectContaining({ code: 'TARGET_OFFLINE' })
        }));

        routes.set('target-tab', createRoute(target, 'target-tab', 1, ['play']));
        await expect(coordinator.request(controller, createRequest({ type: 'pause' }, {
            commandId: '10000000-0000-4000-8000-000000000011'
        }))).resolves.toEqual(expect.objectContaining({
            error: expect.objectContaining({ code: 'UNSUPPORTED_COMMAND' })
        }));

        routes.set('target-tab', createRoute(target, 'target-tab'));
        getSession.mockResolvedValue(createSession({ revision: 4 }));
        resolveCommand.mockRejectedValue(new PlaybackCommandServiceError(
            'The playback session revision is stale.',
            'STALE_SESSION_REVISION',
            {
                retryable: true,
                sessionRevision: 4,
                queueRevision: 2
            }
        ));
        await expect(coordinator.request(controller, createRequest({ type: 'pause' }, {
            commandId: '10000000-0000-4000-8000-000000000012'
        }))).resolves.toEqual(expect.objectContaining({
            sessionRevision: 4,
            queueRevision: 2,
            error: expect.objectContaining({ code: 'STALE_SESSION_REVISION' })
        }));
    });

    it('bounds command traffic per registered endpoint and resets the window', async () => {
        for (let attempt = 0; attempt < PLAYBACK_COMMAND_REQUEST_RATE_LIMIT; attempt += 1) {
            await expect(coordinator.request(controller, {})).resolves.toEqual(
                expect.objectContaining({
                    status: 'rejected',
                    error: expect.objectContaining({ code: 'INVALID_COMMAND' })
                })
            );
        }

        await expect(coordinator.request(controller, createRequest())).resolves.toEqual(
            expect.objectContaining({
                status: 'rejected',
                error: expect.objectContaining({
                    code: 'COMMAND_IN_PROGRESS',
                    retryable: true
                })
            })
        );
        expect(target.emit).not.toHaveBeenCalled();

        jest.advanceTimersByTime(PLAYBACK_COMMAND_REQUEST_RATE_WINDOW_MS);
        (target.emit as jest.Mock).mockImplementation((
            _event: string,
            dispatch: PlaybackCommandDispatch,
            acknowledge: (value: unknown) => void
        ) => acknowledge({
            protocolVersion: 1,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            status: 'rejected',
            lastEndpointSequence: 4,
            error: {
                code: 'MEDIA_NOT_READY',
                retryable: true,
                message: 'The target is not ready.'
            }
        }));
        await expect(coordinator.request(controller, createRequest())).resolves.toEqual(
            expect.objectContaining({
                error: expect.objectContaining({ code: 'MEDIA_NOT_READY' })
            })
        );
    });
});
