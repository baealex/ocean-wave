import {
    getPlaybackEndpointSequence,
    nextPlaybackEndpointSequence
} from '~/modules/playback-device';
import {
    beginPlaybackCommandBarrier,
    beginPlaybackCommandRecovery,
    endPlaybackCommandBarrier
} from '~/modules/playback-command-barrier';

import {
    COMMAND_RESULT_RETENTION_MS,
    CONTROLLER_REQUEST_ACK_TIMEOUT_MS,
    PLAYBACK_COMMAND_EXECUTE,
    PLAYBACK_COMMAND_REQUEST,
    PLAYBACK_COMMAND_RESULT,
    PLAYBACK_COMMAND_START,
    PLAYBACK_COMMAND_STATUS,
    START_REQUEST_TIMEOUT_MS,
    type PlaybackCommand,
    type PlaybackCommandDispatch,
    type PlaybackCommandError,
    type PlaybackCommandExecuteAck,
    type PlaybackCommandExecutionResult,
    type PlaybackCommandRequest,
    type PlaybackCommandRequestAck,
    type PlaybackCommandResultAck,
    type PlaybackCommandStartAck,
    type PlaybackCommandState,
    type PlaybackCommandStatus
} from './playback-command-contract';
import {
    playbackEndpointRegistration,
    type PlaybackEndpointRegistrationState
} from './playback-endpoint';
import { socket } from './socket';

const RESULT_RETRY_DELAY_MS = 250;
const RECOVERY_RETRY_DELAY_MS = 1_000;
const RECENT_TARGET_COMMAND_LIMIT = 512;

export interface PlaybackCommandControllerInput {
    commandId?: string;
    targetEndpointId: string;
    expectedSessionRevision: number;
    expectedQueueRevision: number | null;
    command: PlaybackCommand;
}

export type PlaybackCommandControllerResult =
    | { type: 'acknowledged'; acknowledgement: PlaybackCommandRequestAck }
    | {
        type: 'transport-error';
        commandId: string;
        targetEndpointId: string;
        retryable: true;
        message: string;
      };

type PlaybackCommandStatusSubscriber = (status: PlaybackCommandStatus) => void;

export interface PlaybackCommandRecoveryFence {
    sessionRevision: number | null;
    queueRevision: number | null;
}

export interface PlaybackCommandTargetAdapter {
    prepare: (dispatch: PlaybackCommandDispatch) => PlaybackCommandError | null;
    execute: (dispatch: PlaybackCommandDispatch) => Promise<
        | {
            status: 'completed';
            resultingState: PlaybackCommandState;
          }
        | { status: 'rejected'; error: PlaybackCommandError }
    >;
    recover: (
        fence: PlaybackCommandRecoveryFence,
        beginReconciliation: () => boolean
    ) => Promise<void>;
}

interface ActiveTargetCommand {
    commandKey: string;
    dispatch: PlaybackCommandDispatch;
    startRequestId: string;
    cancelled: boolean;
    executionTimer: ReturnType<typeof setTimeout> | null;
}

interface RecentTargetCommand {
    commandKey: string;
    startRequestId: string;
    result: PlaybackCommandExecutionResult;
    resultRetryByMs: number;
    serverSettleByMs: number;
    expiresAtMs: number;
    reconciled: boolean;
}

interface PlaybackCommandRecovery {
    commandKey: string;
    fence: PlaybackCommandRecoveryFence;
    fenceVersion: number;
    running: boolean;
    retryTimer: ReturnType<typeof setTimeout> | null;
    recent: RecentTargetCommand | null;
}

const createUuid = () => {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
        const random = Math.floor(Math.random() * 16);
        const value = token === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
};

const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();

const isNullableRevision = (value: unknown): value is number | null => (
    value === null || (Number.isSafeInteger(value) && Number(value) >= 0)
);

const commandKey = (dispatch: PlaybackCommandDispatch) => [
    dispatch.commandId,
    dispatch.targetEndpointId,
    dispatch.targetRegistrationGeneration,
    dispatch.commandSequence
].join('\u0000');

const commandError = (
    code: PlaybackCommandError['code'],
    message: string,
    retryable = false
): PlaybackCommandError => ({ code, message, retryable });

const emptyRecoveryFence = (): PlaybackCommandRecoveryFence => ({
    sessionRevision: null,
    queueRevision: null
});

const isCommandStatus = (value: unknown): value is PlaybackCommandStatus => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackCommandStatus>;
    return candidate.protocolVersion === 1
        && typeof candidate.commandEpoch === 'string'
        && typeof candidate.commandId === 'string'
        && ['accepted', 'completed', 'rejected', 'timed_out'].includes(
            String(candidate.status)
        )
        && typeof candidate.targetEndpointId === 'string';
};

const isDispatch = (value: unknown): value is PlaybackCommandDispatch => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackCommandDispatch>;
    return candidate.protocolVersion === 1
        && typeof candidate.commandId === 'string'
        && typeof candidate.targetEndpointId === 'string'
        && typeof candidate.requesterEndpointId === 'string'
        && Number.isSafeInteger(candidate.targetRegistrationGeneration)
        && Number(candidate.targetRegistrationGeneration) > 0
        && Number.isSafeInteger(candidate.commandSequence)
        && Number(candidate.commandSequence) > 0
        && Boolean(candidate.expectedSource)
        && Boolean(candidate.desiredResult)
        && Boolean(candidate.command);
};

const isStartAck = (
    value: unknown,
    commandId: string
): value is PlaybackCommandStartAck => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackCommandStartAck>;
    return candidate.protocolVersion === 1
        && candidate.commandId === commandId
        && (
            (
                candidate.status === 'granted'
                && typeof candidate.executionToken === 'string'
                && Number.isFinite(candidate.startWithinMs)
                && Number(candidate.startWithinMs) > 0
                && Number.isFinite(candidate.completeWithinMs)
                && Number(candidate.completeWithinMs) > 0
            )
            || (candidate.status === 'rejected' && Boolean(candidate.error))
        );
};

const isResultAck = (
    value: unknown,
    result: PlaybackCommandExecutionResult
): value is PlaybackCommandResultAck => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackCommandResultAck>;
    return candidate.protocolVersion === 1
        && candidate.commandId === result.commandId
        && candidate.targetEndpointId === result.targetEndpointId
        && candidate.targetRegistrationGeneration === result.targetRegistrationGeneration
        && candidate.commandSequence === result.commandSequence
        && ['committed', 'duplicate', 'rejected', 'expired'].includes(
            String(candidate.disposition)
        )
        && ['completed', 'rejected', 'timed_out'].includes(
            String(candidate.commandStatus)
        )
        && isNullableRevision(candidate.sessionRevision)
        && isNullableRevision(candidate.queueRevision);
};

export class PlaybackCommandController {
    private connected = false;
    private readonly subscribers = new Set<PlaybackCommandStatusSubscriber>();

    connect() {
        if (this.connected) {
            return;
        }

        this.connected = true;
        socket.on(PLAYBACK_COMMAND_STATUS, this.handleStatus);
    }

    disconnect() {
        if (!this.connected) {
            return;
        }

        this.connected = false;
        socket.off(PLAYBACK_COMMAND_STATUS, this.handleStatus);
    }

    subscribe(subscriber: PlaybackCommandStatusSubscriber) {
        this.subscribers.add(subscriber);
        return () => {
            this.subscribers.delete(subscriber);
        };
    }

    request(input: PlaybackCommandControllerInput): Promise<PlaybackCommandControllerResult> {
        const commandId = input.commandId ?? createUuid();
        const request: PlaybackCommandRequest = {
            protocolVersion: 1,
            commandId,
            targetEndpointId: input.targetEndpointId,
            expectedSessionRevision: input.expectedSessionRevision,
            expectedQueueRevision: input.expectedQueueRevision,
            command: input.command
        };

        return new Promise((resolve) => {
            socket.timeout(CONTROLLER_REQUEST_ACK_TIMEOUT_MS).emit(
                PLAYBACK_COMMAND_REQUEST,
                request,
                (error: Error | null, acknowledgement?: PlaybackCommandRequestAck) => {
                    if (error || !acknowledgement) {
                        resolve({
                            type: 'transport-error',
                            commandId,
                            targetEndpointId: input.targetEndpointId,
                            retryable: true,
                            message: 'The playback command acknowledgement timed out.'
                        });
                        return;
                    }

                    resolve({ type: 'acknowledged', acknowledgement });
                }
            );
        });
    }

    private handleStatus = (status: unknown) => {
        if (!isCommandStatus(status)) {
            return;
        }

        for (const subscriber of this.subscribers) {
            subscriber(status);
        }
    };
}

export class PlaybackCommandTarget {
    private adapter: PlaybackCommandTargetAdapter | null = null;
    private registration: PlaybackEndpointRegistrationState | null = null;
    private unsubscribeRegistration: (() => void) | null = null;
    private active: ActiveTargetCommand | null = null;
    private recovery: PlaybackCommandRecovery | null = null;
    private lastGrantedCommandSequence = 0;
    private readonly recent = new Map<string, RecentTargetCommand>();

    connect(adapter: PlaybackCommandTargetAdapter) {
        if (this.adapter) {
            this.disconnect();
        }

        this.adapter = adapter;
        this.registration = playbackEndpointRegistration.current;
        this.unsubscribeRegistration = playbackEndpointRegistration.subscribe(
            this.handleRegistrationChanged
        );
        socket.on(PLAYBACK_COMMAND_EXECUTE, this.handleExecute);
    }

    disconnect() {
        socket.off(PLAYBACK_COMMAND_EXECUTE, this.handleExecute);
        this.unsubscribeRegistration?.();
        this.unsubscribeRegistration = null;
        const active = this.active;
        const recovery = this.recovery;
        if (active?.executionTimer) {
            clearTimeout(active.executionTimer);
        }
        if (recovery?.retryTimer) {
            clearTimeout(recovery.retryTimer);
        }
        if (active) {
            active.cancelled = true;
        }
        this.active = null;
        this.recovery = null;
        this.registration = null;
        this.lastGrantedCommandSequence = 0;
        this.recent.clear();
        this.adapter = null;

        if (active) {
            endPlaybackCommandBarrier(active.commandKey);
        }
        if (recovery) {
            endPlaybackCommandBarrier(recovery.commandKey);
        }
    }

    private handleExecute = (
        value: unknown,
        acknowledge?: (acknowledgement: PlaybackCommandExecuteAck) => void
    ) => {
        if (typeof acknowledge !== 'function' || !isDispatch(value)) {
            return;
        }

        const dispatch = value;
        const registration = this.registration;
        const key = commandKey(dispatch);
        this.pruneRecent();

        if (
            !registration
            || registration.endpointId !== dispatch.targetEndpointId
            || registration.registrationGeneration
                !== dispatch.targetRegistrationGeneration
        ) {
            acknowledge(this.executeRejectedAck(
                dispatch,
                commandError(
                    'UNAUTHORIZED_COMMAND',
                    'The command targets a different endpoint registration.'
                )
            ));
            return;
        }

        const recent = this.recent.get(dispatch.commandId);
        if (recent?.commandKey === key) {
            acknowledge(this.executeReadyAck(dispatch));
            this.requestStart(dispatch, recent.startRequestId, recent);
            return;
        }

        if (this.active?.commandKey === key) {
            acknowledge(this.executeReadyAck(dispatch));
            return;
        }

        if (
            this.active
            || dispatch.commandSequence <= this.lastGrantedCommandSequence
        ) {
            acknowledge(this.executeRejectedAck(
                dispatch,
                commandError(
                    'TARGET_STATE_MISMATCH',
                    'The target already has a current or newer playback command.',
                    true
                )
            ));
            return;
        }

        if (!beginPlaybackCommandBarrier(key)) {
            acknowledge(this.executeRejectedAck(
                dispatch,
                commandError(
                    'TARGET_STATE_MISMATCH',
                    'The target playback persistence barrier is busy.',
                    true
                )
            ));
            return;
        }

        const adapterError = this.adapter
            ? this.adapter.prepare(dispatch)
            : commandError(
                'MEDIA_NOT_READY',
                'The target playback adapter is unavailable.',
                true
            );

        if (adapterError) {
            acknowledge(this.executeRejectedAck(dispatch, adapterError));
            this.startRecovery(key, emptyRecoveryFence());
            return;
        }

        const active: ActiveTargetCommand = {
            commandKey: key,
            dispatch,
            startRequestId: createUuid(),
            cancelled: false,
            executionTimer: null
        };
        this.active = active;
        acknowledge(this.executeReadyAck(dispatch));
        this.requestStart(dispatch, active.startRequestId);
    };

    private requestStart(
        dispatch: PlaybackCommandDispatch,
        startRequestId: string,
        cached?: RecentTargetCommand
    ) {
        const sentAt = monotonicNow();
        socket.timeout(START_REQUEST_TIMEOUT_MS).emit(
            PLAYBACK_COMMAND_START,
            {
                protocolVersion: 1,
                commandId: dispatch.commandId,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                commandSequence: dispatch.commandSequence,
                startRequestId
            },
            (error: Error | null, acknowledgement?: PlaybackCommandStartAck) => {
                const elapsedMs = monotonicNow() - sentAt;

                if (
                    error
                    || !isStartAck(acknowledgement, dispatch.commandId)
                    || acknowledgement.status !== 'granted'
                    || elapsedMs > acknowledgement.startWithinMs
                ) {
                    if (!cached) {
                        this.recoverActive(dispatch);
                    }
                    return;
                }

                if (cached) {
                    if (cached.result.executionToken === acknowledgement.executionToken) {
                        this.sendResult(
                            cached.result,
                            cached
                        );
                    }
                    return;
                }

                const grantReceivedAt = monotonicNow();

                const active = this.active;
                if (
                    !active
                    || active.cancelled
                    || active.commandKey !== commandKey(dispatch)
                    || monotonicNow() - sentAt > acknowledgement.startWithinMs
                ) {
                    this.recoverActive(dispatch);
                    return;
                }

                this.lastGrantedCommandSequence = dispatch.commandSequence;
                let execution: ReturnType<PlaybackCommandTargetAdapter['execute']> | undefined;
                try {
                    execution = this.adapter?.execute(dispatch);
                } catch {
                    void this.finishExecution(dispatch, acknowledgement, {
                        status: 'rejected',
                        error: commandError(
                            'MEDIA_NOT_READY',
                            'The target could not execute the playback command.',
                            true
                        )
                    }, grantReceivedAt);
                    return;
                }
                if (!execution) {
                    void this.finishExecution(dispatch, acknowledgement, {
                        status: 'rejected',
                        error: commandError(
                            'MEDIA_NOT_READY',
                            'The target playback adapter is unavailable.',
                            true
                        )
                    }, grantReceivedAt);
                    return;
                }

                const remainingMs = acknowledgement.completeWithinMs
                    - (monotonicNow() - grantReceivedAt);
                if (remainingMs <= 0) {
                    this.recoverActive(dispatch);
                    return;
                }
                active.executionTimer = setTimeout(() => {
                    this.recoverActive(dispatch);
                }, remainingMs);

                void execution.then((result) => {
                    void this.finishExecution(
                        dispatch,
                        acknowledgement,
                        result,
                        grantReceivedAt
                    );
                }, () => {
                    void this.finishExecution(dispatch, acknowledgement, {
                        status: 'rejected',
                        error: commandError(
                            'MEDIA_NOT_READY',
                            'The target could not execute the playback command.',
                            true
                        )
                    }, grantReceivedAt);
                });
            }
        );
    }

    private finishExecution(
        dispatch: PlaybackCommandDispatch,
        grant: Extract<PlaybackCommandStartAck, { status: 'granted' }>,
        execution: Awaited<ReturnType<PlaybackCommandTargetAdapter['execute']>>,
        grantReceivedAt: number
    ) {
        const active = this.active;
        if (
            !active
            || active.cancelled
            || active.commandKey !== commandKey(dispatch)
        ) {
            return;
        }
        if (active.executionTimer) {
            clearTimeout(active.executionTimer);
            active.executionTimer = null;
        }

        const common = {
            protocolVersion: 1 as const,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            executionToken: grant.executionToken,
            observedAt: new Date().toISOString()
        };
        const result: PlaybackCommandExecutionResult = execution.status === 'completed'
            ? {
                ...common,
                status: 'completed',
                endpointSequence: nextPlaybackEndpointSequence(),
                resultingState: execution.resultingState
            }
            : {
                ...common,
                status: 'rejected',
                lastEndpointSequence: getPlaybackEndpointSequence(),
                error: execution.error
            };
        const recent: RecentTargetCommand = {
            commandKey: commandKey(dispatch),
            startRequestId: active.startRequestId,
            result,
            resultRetryByMs: grantReceivedAt + grant.completeWithinMs,
            serverSettleByMs: grantReceivedAt
                + grant.completeWithinMs
                + grant.startWithinMs,
            expiresAtMs: Date.now() + COMMAND_RESULT_RETENTION_MS,
            reconciled: false
        };
        this.remember(dispatch.commandId, recent);
        this.sendResult(result, recent);
    }

    private sendResult(
        result: PlaybackCommandExecutionResult,
        recent: RecentTargetCommand
    ) {
        if (this.recent.get(result.commandId) !== recent) {
            return;
        }

        const remainingMs = recent.resultRetryByMs - monotonicNow();

        if (remainingMs <= 0 || !socket.connected) {
            this.recoverActiveResult(
                result,
                recent,
                emptyRecoveryFence(),
                Math.max(recent.serverSettleByMs - monotonicNow(), 0)
            );
            return;
        }

        socket.timeout(Math.max(Math.min(remainingMs, START_REQUEST_TIMEOUT_MS), 1)).emit(
            PLAYBACK_COMMAND_RESULT,
            result,
            (error: Error | null, acknowledgement?: PlaybackCommandResultAck) => {
                if (!error && isResultAck(acknowledgement, result)) {
                    this.recoverActiveResult(result, recent, {
                        sessionRevision: acknowledgement.sessionRevision,
                        queueRevision: acknowledgement.queueRevision
                    });
                    return;
                }

                const retryDelayMs = Math.min(RESULT_RETRY_DELAY_MS, Math.max(
                    recent.resultRetryByMs - monotonicNow(),
                    0
                ));
                setTimeout(() => {
                    this.sendResult(result, recent);
                }, retryDelayMs);
            }
        );
    }

    private recoverActive(dispatch: PlaybackCommandDispatch) {
        const active = this.active;
        if (!active || active.commandKey !== commandKey(dispatch)) {
            return;
        }

        this.startRecovery(active.commandKey, emptyRecoveryFence());
    }

    private recoverActiveResult(
        result: PlaybackCommandExecutionResult,
        recent: RecentTargetCommand,
        fence: PlaybackCommandRecoveryFence,
        delayMs = 0
    ) {
        recent.result = result;
        recent.expiresAtMs = Date.now() + COMMAND_RESULT_RETENTION_MS;
        if (recent.reconciled) {
            return;
        }

        this.startRecovery(recent.commandKey, fence, recent, delayMs);
    }

    private startRecovery(
        key: string,
        fence: PlaybackCommandRecoveryFence,
        recent: RecentTargetCommand | null = null,
        delayMs = 0
    ) {
        const active = this.active;
        if (active?.commandKey === key) {
            active.cancelled = true;
            if (active.executionTimer) {
                clearTimeout(active.executionTimer);
                active.executionTimer = null;
            }
        }

        const existing = this.recovery;
        if (existing) {
            if (existing.commandKey !== key) {
                return;
            }

            const sessionRevision = this.mergeRevision(
                existing.fence.sessionRevision,
                fence.sessionRevision
            );
            const queueRevision = this.mergeRevision(
                existing.fence.queueRevision,
                fence.queueRevision
            );
            if (
                sessionRevision !== existing.fence.sessionRevision
                || queueRevision !== existing.fence.queueRevision
            ) {
                existing.fence = { sessionRevision, queueRevision };
                existing.fenceVersion += 1;
            }
            existing.recent ??= recent;
            if (delayMs === 0 && existing.retryTimer) {
                clearTimeout(existing.retryTimer);
                existing.retryTimer = null;
            }
            if (!existing.running && !existing.retryTimer) {
                void this.attemptRecovery(existing);
            }
            return;
        }

        if (!beginPlaybackCommandRecovery(key)) {
            return;
        }

        const recovery: PlaybackCommandRecovery = {
            commandKey: key,
            fence: { ...fence },
            fenceVersion: 0,
            running: false,
            retryTimer: null,
            recent
        };
        this.recovery = recovery;
        if (delayMs > 0) {
            recovery.retryTimer = setTimeout(() => {
                recovery.retryTimer = null;
                void this.attemptRecovery(recovery);
            }, delayMs);
        } else {
            void this.attemptRecovery(recovery);
        }
    }

    private async attemptRecovery(recovery: PlaybackCommandRecovery) {
        if (
            this.recovery !== recovery
            || recovery.running
            || !this.adapter
        ) {
            return;
        }

        if (!beginPlaybackCommandRecovery(recovery.commandKey)) {
            return;
        }

        recovery.running = true;
        const fenceVersion = recovery.fenceVersion;
        const fence = { ...recovery.fence };
        let reconciliationStarted = false;

        try {
            await this.adapter.recover(fence, () => {
                if (
                    this.recovery !== recovery
                    || recovery.fenceVersion !== fenceVersion
                    || !beginPlaybackCommandBarrier(recovery.commandKey)
                ) {
                    return false;
                }

                reconciliationStarted = true;
                return true;
            });
            if (!reconciliationStarted) {
                throw new Error('Playback command recovery skipped reconciliation.');
            }
        } catch {
            if (this.recovery !== recovery) {
                return;
            }

            recovery.running = false;
            beginPlaybackCommandRecovery(recovery.commandKey);
            recovery.retryTimer = setTimeout(() => {
                recovery.retryTimer = null;
                void this.attemptRecovery(recovery);
            }, RECOVERY_RETRY_DELAY_MS);
            return;
        }

        if (this.recovery !== recovery) {
            return;
        }

        recovery.running = false;
        if (fenceVersion !== recovery.fenceVersion) {
            void this.attemptRecovery(recovery);
            return;
        }

        if (recovery.recent) {
            recovery.recent.reconciled = true;
            recovery.recent.expiresAtMs = Date.now() + COMMAND_RESULT_RETENTION_MS;
        }
        if (this.active?.commandKey === recovery.commandKey) {
            this.active = null;
        }
        this.recovery = null;
        endPlaybackCommandBarrier(recovery.commandKey);
    }

    private mergeRevision(current: number | null, incoming: number | null) {
        if (current === null) return incoming;
        if (incoming === null) return current;
        return Math.max(current, incoming);
    }

    private handleRegistrationChanged = (
        registration: PlaybackEndpointRegistrationState | null
    ) => {
        const previous = this.registration;
        this.registration = registration;

        if (
            previous?.endpointId === registration?.endpointId
            && previous?.registrationGeneration === registration?.registrationGeneration
        ) {
            return;
        }

        this.lastGrantedCommandSequence = 0;
        if (this.recovery) {
            this.recovery.fenceVersion += 1;
        }
        const active = this.active;
        if (!active) {
            return;
        }

        const recent = this.recent.get(active.dispatch.commandId);
        if (recent?.commandKey === active.commandKey && !recent.reconciled) {
            this.recoverActiveResult(
                recent.result,
                recent,
                emptyRecoveryFence(),
                Math.max(recent.serverSettleByMs - monotonicNow(), 0)
            );
        } else {
            this.recoverActive(active.dispatch);
        }
    };

    private executeReadyAck(
        dispatch: PlaybackCommandDispatch
    ): PlaybackCommandExecuteAck {
        return {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            status: 'ready',
            lastEndpointSequence: getPlaybackEndpointSequence()
        };
    }

    private executeRejectedAck(
        dispatch: PlaybackCommandDispatch,
        error: PlaybackCommandError
    ): PlaybackCommandExecuteAck {
        return {
            protocolVersion: 1,
            commandId: dispatch.commandId,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            commandSequence: dispatch.commandSequence,
            status: 'rejected',
            lastEndpointSequence: getPlaybackEndpointSequence(),
            error
        };
    }

    private remember(commandId: string, recent: RecentTargetCommand) {
        this.pruneRecent();
        if (this.recent.size >= RECENT_TARGET_COMMAND_LIMIT) {
            const oldest = this.recent.keys().next().value;
            if (oldest) {
                this.recent.delete(oldest);
            }
        }
        this.recent.set(commandId, recent);
    }

    private pruneRecent() {
        const now = Date.now();
        for (const [commandId, recent] of this.recent) {
            if (recent.expiresAtMs <= now) {
                this.recent.delete(commandId);
            }
        }
    }
}

export const playbackCommandController = new PlaybackCommandController();
export const playbackCommandTarget = new PlaybackCommandTarget();

export * from './playback-command-contract';
