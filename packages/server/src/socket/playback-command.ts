import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';

import {
    commitPlaybackCommandResult,
    isPlaybackCommandServiceError,
    resolvePlaybackCommand,
    type PlaybackCommandCommitResult,
    type ResolvedPlaybackCommand
} from '~/features/playback/services/playback-command';
import { getPlaybackSessionSnapshot } from '~/features/playback/services/playback-session';

import { connectors } from './connectors';
import {
    playbackEndpointRegistry,
    type PlaybackEndpointRoute
} from './playback-endpoints';
import { PLAYBACK_STATE_UPDATED } from './playback';
import {
    COMMAND_COMPLETION_TIMEOUT_MS,
    COMMAND_RESULT_RETENTION_MS,
    CONTROLLER_RECOVERY_WINDOW_MS,
    EXECUTION_GRANT_TTL_MS,
    PLAYBACK_COMMAND_ERROR_CODES,
    PLAYBACK_COMMAND_EXECUTE,
    PLAYBACK_COMMAND_REQUEST,
    PLAYBACK_COMMAND_RESULT,
    PLAYBACK_COMMAND_START,
    PLAYBACK_COMMAND_STATUS,
    PLAYBACK_COMMAND_TYPES,
    START_REQUEST_TIMEOUT_MS,
    TARGET_READY_TIMEOUT_MS,
    type PlaybackCommand,
    type PlaybackCommandError,
    type PlaybackCommandErrorCode,
    type PlaybackCommandExecuteAck,
    type PlaybackCommandExecutionResult,
    type PlaybackCommandParseFailure,
    type PlaybackCommandRequest,
    type PlaybackCommandRequestAck,
    type PlaybackCommandResultAck,
    type PlaybackCommandStartAck,
    type PlaybackCommandStartRequest,
    type PlaybackCommandStatus
} from './playback-command-contract';

const PLAYBACK_COMMAND_MAX_RETAINED_RESERVATIONS = 512;
const PLAYBACK_COMMAND_MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
export const PLAYBACK_COMMAND_REQUEST_RATE_WINDOW_MS = 60_000;
export const PLAYBACK_COMMAND_REQUEST_RATE_LIMIT = 120;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_ERROR_CODES: readonly PlaybackCommandErrorCode[] = [
    'UNSUPPORTED_COMMAND',
    'TARGET_STATE_MISMATCH',
    'AUTOPLAY_BLOCKED',
    'MEDIA_NOT_READY',
    'MEDIA_UNAVAILABLE'
];

type PlaybackCommandReservationState =
    | 'validating'
    | 'dispatched'
    | 'ready'
    | 'accepted'
    | 'committing'
    | 'terminal';

interface PlaybackCommandRouteSnapshot {
    socket: Socket;
    socketId: string;
    endpointId: string;
    registrationGeneration: number;
}

interface PlaybackCommandReservation {
    request: PlaybackCommandRequest;
    fingerprint: string;
    requesterEndpointId: string;
    controllerSockets: Set<Socket>;
    state: PlaybackCommandReservationState;
    initialStatus: Promise<PlaybackCommandStatus>;
    resolveInitialStatus: (status: PlaybackCommandStatus) => void;
    initialStatusSettled: boolean;
    latestStatus: PlaybackCommandStatus | null;
    resolved: ResolvedPlaybackCommand | null;
    target: PlaybackCommandRouteSnapshot | null;
    commandSequence: number | null;
    readyEndpointSequence: number | null;
    readyByMs: number | null;
    startRequestByMs: number | null;
    completionDeadlineMs: number | null;
    timer: ReturnType<typeof setTimeout> | null;
    startRequestId: string | null;
    startAck: Extract<PlaybackCommandStartAck, { status: 'granted' }> | null;
    resultFingerprint: string | null;
    resultAck: PlaybackCommandResultAck | null;
    commitPromise: Promise<PlaybackCommandResultAck> | null;
    expiresAtMs: number | null;
}

interface PlaybackCommandCoordinatorDependencies {
    now?: () => number;
    commandEpoch?: string;
    getRoute?: (endpointId: string) => PlaybackEndpointRoute | null;
    getSession?: typeof getPlaybackSessionSnapshot;
    resolveCommand?: typeof resolvePlaybackCommand;
    commitResult?: typeof commitPlaybackCommandResult;
    onCommitted?: (result: PlaybackCommandCommitResult) => Promise<void> | void;
}

const normalizeOpaqueId = (value: unknown) => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= 128
        ? normalized
        : null;
};

const normalizeUuid = (value: unknown) => {
    const normalized = normalizeOpaqueId(value);
    return normalized && UUID_PATTERN.test(normalized) ? normalized : null;
};

const normalizeRevision = (value: unknown) => Number.isSafeInteger(value)
    && Number(value) >= 0
    ? Number(value)
    : null;

const normalizeCommand = (value: unknown): PlaybackCommand | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Partial<PlaybackCommand>;

    if (!PLAYBACK_COMMAND_TYPES.includes(candidate.type as PlaybackCommand['type'])) {
        return null;
    }

    if (candidate.type === 'seek') {
        if (
            Object.keys(candidate).some(key => key !== 'type' && key !== 'positionMs')
            || Object.keys(candidate).length !== 2
            || !Number.isFinite(candidate.positionMs)
            || Number(candidate.positionMs) < 0
        ) {
            return null;
        }

        return {
            type: 'seek',
            positionMs: Math.round(Number(candidate.positionMs))
        };
    }

    if (Object.keys(candidate).length !== 1) {
        return null;
    }

    return { type: candidate.type } as PlaybackCommand;
};

const normalizeRequest = (input: unknown): PlaybackCommandRequest | null => {
    if (!input || typeof input !== 'object') {
        return null;
    }

    const candidate = input as Partial<PlaybackCommandRequest>;
    const commandId = normalizeUuid(candidate.commandId);
    const targetEndpointId = normalizeOpaqueId(candidate.targetEndpointId);
    const expectedSessionRevision = normalizeRevision(candidate.expectedSessionRevision);
    const expectedQueueRevision = candidate.expectedQueueRevision === null
        ? null
        : normalizeRevision(candidate.expectedQueueRevision);
    const command = normalizeCommand(candidate.command);

    if (
        candidate.protocolVersion !== 1
        || !commandId
        || !targetEndpointId
        || expectedSessionRevision === null
        || (candidate.expectedQueueRevision !== null && expectedQueueRevision === null)
        || !command
        || Object.keys(candidate).some(key => ![
            'protocolVersion',
            'commandId',
            'targetEndpointId',
            'expectedSessionRevision',
            'expectedQueueRevision',
            'command'
        ].includes(key))
    ) {
        return null;
    }

    return {
        protocolVersion: 1,
        commandId,
        targetEndpointId,
        expectedSessionRevision,
        expectedQueueRevision,
        command
    };
};

const normalizeError = (value: unknown): PlaybackCommandError | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Partial<PlaybackCommandError>;
    return PLAYBACK_COMMAND_ERROR_CODES.includes(
        candidate.code as PlaybackCommandErrorCode
    )
        && typeof candidate.retryable === 'boolean'
        && typeof candidate.message === 'string'
        && candidate.message.length > 0
        && candidate.message.length <= 500
        ? {
            code: candidate.code as PlaybackCommandErrorCode,
            retryable: candidate.retryable,
            message: candidate.message
        }
        : null;
};

const normalizeTargetError = (value: unknown) => {
    const error = normalizeError(value);
    return error && TARGET_ERROR_CODES.includes(error.code) ? error : null;
};

const requestFingerprint = (request: PlaybackCommandRequest) => JSON.stringify(request);

const executionResultFingerprint = (result: PlaybackCommandExecutionResult) => (
    JSON.stringify(result)
);

const protocolError = (
    code: PlaybackCommandErrorCode,
    message: string,
    retryable = false
): PlaybackCommandError => ({ code, retryable, message });

const isTerminalStatus = (status: PlaybackCommandStatus) => (
    status.status === 'completed'
    || status.status === 'rejected'
    || status.status === 'timed_out'
);

const isExecuteAck = (
    value: unknown,
    reservation: PlaybackCommandReservation
): value is PlaybackCommandExecuteAck => {
    if (!value || typeof value !== 'object' || !reservation.target) {
        return false;
    }

    const candidate = value as Partial<PlaybackCommandExecuteAck>;
    const common = candidate.protocolVersion === 1
        && candidate.commandId === reservation.request.commandId
        && candidate.targetEndpointId === reservation.target.endpointId
        && candidate.targetRegistrationGeneration
            === reservation.target.registrationGeneration
        && candidate.commandSequence === reservation.commandSequence
        && Number.isSafeInteger(candidate.lastEndpointSequence)
        && Number(candidate.lastEndpointSequence) >= 0;

    if (!common) {
        return false;
    }

    return candidate.status === 'ready'
        || (candidate.status === 'rejected' && Boolean(normalizeTargetError(candidate.error)));
};

const normalizeStartRequest = (input: unknown): PlaybackCommandStartRequest | null => {
    if (!input || typeof input !== 'object') {
        return null;
    }

    const candidate = input as Partial<PlaybackCommandStartRequest>;
    const commandId = normalizeUuid(candidate.commandId);
    const targetEndpointId = normalizeOpaqueId(candidate.targetEndpointId);
    const startRequestId = normalizeUuid(candidate.startRequestId);

    if (
        candidate.protocolVersion !== 1
        || !commandId
        || !targetEndpointId
        || !Number.isSafeInteger(candidate.targetRegistrationGeneration)
        || Number(candidate.targetRegistrationGeneration) < 1
        || !Number.isSafeInteger(candidate.commandSequence)
        || Number(candidate.commandSequence) < 1
        || !startRequestId
    ) {
        return null;
    }

    return {
        protocolVersion: 1,
        commandId,
        targetEndpointId,
        targetRegistrationGeneration: Number(candidate.targetRegistrationGeneration),
        commandSequence: Number(candidate.commandSequence),
        startRequestId
    };
};

const normalizeExecutionState = (value: unknown) => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as {
        state?: unknown;
        currentMusicId?: unknown;
        currentIndex?: unknown;
        positionMs?: unknown;
    };
    const state = candidate.state;
    const currentMusicId = candidate.currentMusicId === null
        ? null
        : normalizeOpaqueId(candidate.currentMusicId);
    const currentIndex = candidate.currentIndex === null
        ? null
        : normalizeRevision(candidate.currentIndex);

    if (
        !['playing', 'paused', 'stopped'].includes(String(state))
        || (candidate.currentMusicId !== null && !currentMusicId)
        || (candidate.currentIndex !== null && currentIndex === null)
        || !Number.isFinite(candidate.positionMs)
        || Number(candidate.positionMs) < 0
    ) {
        return null;
    }

    return {
        state: state as 'playing' | 'paused' | 'stopped',
        currentMusicId,
        currentIndex,
        positionMs: Math.round(Number(candidate.positionMs))
    };
};

const normalizeExecutionResult = (input: unknown): PlaybackCommandExecutionResult | null => {
    if (!input || typeof input !== 'object') {
        return null;
    }

    const candidate = input as Partial<PlaybackCommandExecutionResult>;
    const commandId = normalizeUuid(candidate.commandId);
    const targetEndpointId = normalizeOpaqueId(candidate.targetEndpointId);
    const executionToken = normalizeUuid(candidate.executionToken);
    const observedAt = typeof candidate.observedAt === 'string'
        && !Number.isNaN(new Date(candidate.observedAt).getTime())
        ? candidate.observedAt
        : null;
    const common = candidate.protocolVersion === 1
        && commandId
        && targetEndpointId
        && Number.isSafeInteger(candidate.targetRegistrationGeneration)
        && Number(candidate.targetRegistrationGeneration) >= 1
        && Number.isSafeInteger(candidate.commandSequence)
        && Number(candidate.commandSequence) >= 1
        && executionToken
        && observedAt;

    if (!common) {
        return null;
    }

    if (candidate.status === 'completed') {
        const resultingState = normalizeExecutionState(candidate.resultingState);

        if (
            !Number.isSafeInteger(candidate.endpointSequence)
            || Number(candidate.endpointSequence) < 1
            || !resultingState
        ) {
            return null;
        }

        return {
            protocolVersion: 1,
            commandId,
            targetEndpointId,
            targetRegistrationGeneration: Number(candidate.targetRegistrationGeneration),
            commandSequence: Number(candidate.commandSequence),
            executionToken,
            status: 'completed',
            endpointSequence: Number(candidate.endpointSequence),
            observedAt,
            resultingState
        };
    }

    if (candidate.status === 'rejected') {
        const error = normalizeTargetError(candidate.error);

        if (
            !Number.isSafeInteger(candidate.lastEndpointSequence)
            || Number(candidate.lastEndpointSequence) < 0
            || !error
        ) {
            return null;
        }

        return {
            protocolVersion: 1,
            commandId,
            targetEndpointId,
            targetRegistrationGeneration: Number(candidate.targetRegistrationGeneration),
            commandSequence: Number(candidate.commandSequence),
            executionToken,
            status: 'rejected',
            lastEndpointSequence: Number(candidate.lastEndpointSequence),
            observedAt,
            error
        };
    }

    return null;
};

export class PlaybackCommandCoordinator {
    readonly commandEpoch: string;

    private readonly now: () => number;
    private readonly getRoute: (endpointId: string) => PlaybackEndpointRoute | null;
    private readonly getSession: typeof getPlaybackSessionSnapshot;
    private readonly resolveCommand: typeof resolvePlaybackCommand;
    private readonly commitResult: typeof commitPlaybackCommandResult;
    private readonly onCommitted: (result: PlaybackCommandCommitResult) => Promise<void> | void;
    private readonly reservations = new Map<string, PlaybackCommandReservation>();
    private requestRateBySocket = new WeakMap<Socket, {
        startedAtMs: number;
        attempts: number;
    }>();
    private guardCommandId: string | null = null;
    private lastCommandSequence = 0;
    private pruneTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(dependencies: PlaybackCommandCoordinatorDependencies = {}) {
        this.now = dependencies.now ?? Date.now;
        this.commandEpoch = dependencies.commandEpoch
            ?? playbackEndpointRegistry.commandEpoch;
        this.getRoute = dependencies.getRoute
            ?? (endpointId => playbackEndpointRegistry.getRoute(endpointId));
        this.getSession = dependencies.getSession ?? getPlaybackSessionSnapshot;
        this.resolveCommand = dependencies.resolveCommand ?? resolvePlaybackCommand;
        this.commitResult = dependencies.commitResult ?? commitPlaybackCommandResult;
        this.onCommitted = dependencies.onCommitted ?? (async () => {
            const snapshot = await getPlaybackSessionSnapshot();
            if (snapshot) {
                connectors.notify(PLAYBACK_STATE_UPDATED, snapshot);
            }
        });
    }

    async request(socket: Socket, input: unknown): Promise<PlaybackCommandRequestAck> {
        this.pruneExpired();
        const request = normalizeRequest(input);

        if (!this.acceptRequestAttempt(socket)) {
            return request
                ? this.detachedStatus(
                    request,
                    protocolError(
                        'COMMAND_IN_PROGRESS',
                        'The playback command request rate limit was reached.',
                        true
                    )
                )
                : this.parseFailure(input);
        }

        if (!request) {
            return this.parseFailure(input);
        }

        const route = this.getRequesterRoute(socket);

        if (!route) {
            return this.detachedStatus(
                request,
                protocolError(
                    'UNAUTHORIZED_COMMAND',
                    'A current playback endpoint registration is required.',
                    false
                )
            );
        }

        const fingerprint = requestFingerprint(request);
        const existing = this.reservations.get(request.commandId);

        if (existing) {
            if (
                existing.requesterEndpointId !== route.endpointId
                || existing.fingerprint !== fingerprint
            ) {
                return this.detachedStatus(
                    request,
                    protocolError(
                        'INVALID_COMMAND',
                        'The command id is already reserved for a different request.',
                        false
                    )
                );
            }

            this.addControllerSocket(existing, socket);
            if (existing.latestStatus) {
                return { ...existing.latestStatus, deduplicated: true };
            }

            const status = await existing.initialStatus;
            return { ...status, deduplicated: true };
        }

        if (this.reservations.size >= PLAYBACK_COMMAND_MAX_RETAINED_RESERVATIONS) {
            return this.detachedStatus(
                request,
                protocolError(
                    'COMMAND_IN_PROGRESS',
                    'The playback command coordinator is temporarily at capacity.',
                    true
                )
            );
        }

        const reservation = this.createReservation(request, fingerprint, route, socket);
        this.reservations.set(request.commandId, reservation);
        this.setTimer(reservation, CONTROLLER_RECOVERY_WINDOW_MS, () => {
            if (reservation.state === 'validating') {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(
                        'COMMAND_EXPIRED',
                        'The command validation window expired.',
                        true
                    )
                );
            }
        });
        void this.validateAndDispatch(reservation);
        return reservation.initialStatus;
    }

    start(socket: Socket, input: unknown): PlaybackCommandStartAck {
        const request = normalizeStartRequest(input);

        if (!request) {
            return this.rejectedStartAck(
                normalizeOpaqueId((input as { commandId?: unknown } | null)?.commandId) ?? '',
                protocolError('INVALID_COMMAND', 'The execution start request is invalid.')
            );
        }

        const reservation = this.reservations.get(request.commandId);

        if (!reservation || !this.isCurrentTarget(socket, reservation, request)) {
            return this.rejectedStartAck(
                request.commandId,
                protocolError(
                    'UNAUTHORIZED_COMMAND',
                    'The command is not bound to this playback endpoint.'
                )
            );
        }

        const now = this.now();

        if (
            reservation.startRequestId === request.startRequestId
            && reservation.startAck
        ) {
            if (
                (reservation.state === 'accepted' || reservation.state === 'committing')
                && this.guardCommandId === reservation.request.commandId
                && reservation.completionDeadlineMs !== null
                && now <= reservation.completionDeadlineMs
            ) {
                return reservation.startAck;
            }

            return this.rejectedStartAck(
                request.commandId,
                protocolError(
                    'COMMAND_EXPIRED',
                    'The execution grant is no longer current.',
                    true
                )
            );
        }

        if (reservation.startRequestId !== null) {
            return this.rejectedStartAck(
                request.commandId,
                protocolError(
                    'INVALID_COMMAND',
                    'A different execution start request already owns this command.'
                )
            );
        }

        if (
            reservation.state !== 'ready'
            || reservation.startRequestByMs === null
            || now > reservation.startRequestByMs
        ) {
            if (reservation.state === 'ready') {
                this.terminalize(
                    reservation,
                    'timed_out',
                    protocolError(
                        'START_REQUEST_TIMEOUT',
                        'The target did not request execution in time.',
                        true
                    )
                );
            }

            return this.rejectedStartAck(
                request.commandId,
                protocolError(
                    'COMMAND_EXPIRED',
                    'The execution start window has expired.',
                    true
                )
            );
        }

        reservation.startRequestId = request.startRequestId;
        reservation.state = 'accepted';
        reservation.completionDeadlineMs = now
            + EXECUTION_GRANT_TTL_MS
            + COMMAND_COMPLETION_TIMEOUT_MS;
        reservation.startAck = {
            protocolVersion: 1,
            commandId: request.commandId,
            status: 'granted',
            executionToken: randomUUID(),
            startWithinMs: EXECUTION_GRANT_TTL_MS,
            completeWithinMs: COMMAND_COMPLETION_TIMEOUT_MS
        };
        this.setTimer(reservation, (
            EXECUTION_GRANT_TTL_MS + COMMAND_COMPLETION_TIMEOUT_MS
        ), () => {
            if (reservation.state !== 'accepted') {
                return;
            }
            this.terminalize(
                reservation,
                'timed_out',
                protocolError(
                    'COMMAND_COMPLETION_TIMEOUT',
                    'The target did not complete the command in time.',
                    true
                )
            );
        });
        this.publishStatus(reservation, 'accepted', null);
        return reservation.startAck;
    }

    async result(socket: Socket, input: unknown): Promise<PlaybackCommandResultAck> {
        const result = normalizeExecutionResult(input);

        if (!result) {
            return this.invalidResultAck(input);
        }

        const reservation = this.reservations.get(result.commandId);

        if (!reservation || !this.isCurrentTarget(socket, reservation, result)) {
            return this.resultAckFrom(
                result,
                'rejected',
                'rejected',
                null,
                null,
                protocolError(
                    'UNAUTHORIZED_COMMAND',
                    'The command result is not bound to this playback endpoint.'
                )
            );
        }

        const fingerprint = executionResultFingerprint(result);

        if (reservation.state === 'terminal') {
            if (
                reservation.resultFingerprint === fingerprint
                && reservation.resultAck
            ) {
                return { ...reservation.resultAck, disposition: 'duplicate' };
            }
            if (
                reservation.resultFingerprint === fingerprint
                && reservation.commitPromise
            ) {
                const acknowledgement = await reservation.commitPromise;
                return { ...acknowledgement, disposition: 'duplicate' };
            }

            const terminal = reservation.latestStatus;
            return this.resultAckFrom(
                result,
                terminal?.status === 'timed_out' ? 'expired' : 'rejected',
                terminal?.status === 'completed' ? 'completed'
                    : terminal?.status === 'timed_out' ? 'timed_out' : 'rejected',
                terminal?.sessionRevision ?? null,
                terminal?.queueRevision ?? null,
                terminal?.error ?? protocolError(
                    'COMMAND_EXPIRED',
                    'The command no longer accepts execution results.',
                    true
                )
            );
        }

        if (reservation.state === 'committing' && reservation.commitPromise) {
            if (reservation.resultFingerprint !== fingerprint) {
                return this.resultAckFrom(
                    result,
                    'rejected',
                    'rejected',
                    null,
                    null,
                    protocolError(
                        'INVALID_COMMAND',
                        'A different command result is already being committed.'
                    )
                );
            }

            const acknowledgement = await reservation.commitPromise;
            return { ...acknowledgement, disposition: 'duplicate' };
        }

        if (
            reservation.state !== 'accepted'
            || !reservation.startAck
            || result.executionToken !== reservation.startAck.executionToken
        ) {
            return this.resultAckFrom(
                result,
                'rejected',
                'rejected',
                null,
                null,
                protocolError(
                    'COMMAND_EXPIRED',
                    'The command does not have a current execution grant.',
                    true
                )
            );
        }

        if (
            reservation.completionDeadlineMs === null
            || this.now() > reservation.completionDeadlineMs
        ) {
            const status = this.terminalize(
                reservation,
                'timed_out',
                protocolError(
                    'COMMAND_COMPLETION_TIMEOUT',
                    'The command completion window expired.',
                    true
                )
            );
            return this.resultAckFrom(
                result,
                'expired',
                'timed_out',
                status.sessionRevision,
                status.queueRevision,
                status.error
            );
        }

        if (
            reservation.readyEndpointSequence === null
            || (
                result.status === 'completed'
                && result.endpointSequence !== reservation.readyEndpointSequence + 1
            )
            || (
                result.status === 'rejected'
                && result.lastEndpointSequence !== reservation.readyEndpointSequence
            )
        ) {
            const status = this.terminalize(
                reservation,
                'rejected',
                protocolError(
                    'TARGET_STATE_MISMATCH',
                    'The target result sequence does not follow its readiness sequence.',
                    true
                )
            );
            return this.resultAckFrom(
                result,
                'rejected',
                'rejected',
                status.sessionRevision,
                status.queueRevision,
                status.error
            );
        }

        reservation.resultFingerprint = fingerprint;

        if (result.status === 'rejected') {
            const status = this.terminalize(reservation, 'rejected', result.error);
            const acknowledgement = this.resultAckFrom(
                result,
                'committed',
                'rejected',
                status.sessionRevision,
                status.queueRevision,
                status.error
            );
            reservation.resultAck = acknowledgement;
            return acknowledgement;
        }

        this.clearTimer(reservation);
        reservation.state = 'committing';
        reservation.commitPromise = this.commitCompletedResult(reservation, result);
        const acknowledgement = await reservation.commitPromise;
        reservation.resultAck = acknowledgement;
        return acknowledgement;
    }

    handleSocketDisconnected(socketId: string) {
        for (const reservation of this.reservations.values()) {
            if (
                reservation.state === 'terminal'
                || reservation.target?.socketId !== socketId
            ) {
                continue;
            }

            if (reservation.state === 'committing') {
                continue;
            }

            if (reservation.state === 'accepted') {
                this.terminalize(
                    reservation,
                    'timed_out',
                    protocolError(
                        'COMMAND_COMPLETION_TIMEOUT',
                        'The target disconnected before completion was confirmed.',
                        true
                    )
                );
            } else {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(
                        'TARGET_OFFLINE',
                        'The target disconnected before execution was granted.',
                        true
                    )
                );
            }
        }
    }

    clear() {
        for (const reservation of this.reservations.values()) {
            this.clearTimer(reservation);
        }
        if (this.pruneTimer) {
            clearTimeout(this.pruneTimer);
            this.pruneTimer = null;
        }
        this.reservations.clear();
        this.requestRateBySocket = new WeakMap();
        this.guardCommandId = null;
        this.lastCommandSequence = 0;
    }

    private createReservation(
        request: PlaybackCommandRequest,
        fingerprint: string,
        route: PlaybackEndpointRoute,
        socket: Socket
    ): PlaybackCommandReservation {
        let resolveInitialStatus!: (status: PlaybackCommandStatus) => void;
        const initialStatus = new Promise<PlaybackCommandStatus>((resolve) => {
            resolveInitialStatus = resolve;
        });

        return {
            request,
            fingerprint,
            requesterEndpointId: route.endpointId,
            controllerSockets: new Set([socket]),
            state: 'validating',
            initialStatus,
            resolveInitialStatus,
            initialStatusSettled: false,
            latestStatus: null,
            resolved: null,
            target: null,
            commandSequence: null,
            readyEndpointSequence: null,
            readyByMs: null,
            startRequestByMs: null,
            completionDeadlineMs: null,
            timer: null,
            startRequestId: null,
            startAck: null,
            resultFingerprint: null,
            resultAck: null,
            commitPromise: null,
            expiresAtMs: null
        };
    }

    private acceptRequestAttempt(socket: Socket) {
        const now = this.now();
        const current = this.requestRateBySocket.get(socket);

        if (
            !current
            || now - current.startedAtMs >= PLAYBACK_COMMAND_REQUEST_RATE_WINDOW_MS
        ) {
            this.requestRateBySocket.set(socket, {
                startedAtMs: now,
                attempts: 1
            });
            return true;
        }

        if (current.attempts >= PLAYBACK_COMMAND_REQUEST_RATE_LIMIT) {
            return false;
        }

        current.attempts += 1;
        return true;
    }

    private addControllerSocket(
        reservation: PlaybackCommandReservation,
        socket: Socket
    ) {
        for (const controller of reservation.controllerSockets) {
            if (!controller.connected) {
                reservation.controllerSockets.delete(controller);
            }
        }

        if (
            !reservation.controllerSockets.has(socket)
            && reservation.controllerSockets.size >= 4
        ) {
            const oldest = reservation.controllerSockets.values().next().value;
            if (oldest) {
                reservation.controllerSockets.delete(oldest);
            }
        }
        reservation.controllerSockets.add(socket);
    }

    private async validateAndDispatch(reservation: PlaybackCommandReservation) {
        const { request } = reservation;

        try {
            const session = await this.getSession(new Date(this.now()));

            if (reservation.state !== 'validating') {
                return;
            }

            if (!session) {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(
                        'SESSION_NOT_FOUND',
                        'No authoritative playback session exists.',
                        true
                    )
                );
                return;
            }

            if (session.activeDeviceId !== request.targetEndpointId) {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(
                        'TARGET_NOT_ACTIVE',
                        'The requested endpoint is not the active playback endpoint.',
                        true
                    ),
                    session.revision,
                    null
                );
                return;
            }

            const route = this.getRoute(request.targetEndpointId);

            if (!route) {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(
                        'TARGET_OFFLINE',
                        'The active playback endpoint is offline.',
                        true
                    ),
                    session.revision,
                    null
                );
                return;
            }

            if (!route.capabilities.includes(request.command.type)) {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(
                        'UNSUPPORTED_COMMAND',
                        'The active playback endpoint does not support this command.'
                    ),
                    session.revision,
                    null
                );
                return;
            }

            const resolved = await this.resolveCommand(request, new Date(this.now()));

            if (reservation.state !== 'validating') {
                return;
            }
            const currentRoute = this.getRoute(request.targetEndpointId);

            if (!currentRoute || !this.sameRoute(route, currentRoute)) {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(
                        'TARGET_OFFLINE',
                        'The active playback endpoint registration changed.',
                        true
                    ),
                    resolved.dispatchSource.sessionRevision,
                    resolved.dispatchSource.queueRevision
                );
                return;
            }

            if (this.guardCommandId !== null) {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(
                        'COMMAND_IN_PROGRESS',
                        'Another playback command is in progress.',
                        true
                    ),
                    resolved.dispatchSource.sessionRevision,
                    resolved.dispatchSource.queueRevision
                );
                return;
            }

            this.guardCommandId = request.commandId;
            reservation.resolved = resolved;
            reservation.target = {
                socket: currentRoute.socket,
                socketId: currentRoute.socketId,
                endpointId: currentRoute.endpointId,
                registrationGeneration: currentRoute.registrationGeneration
            };
            reservation.commandSequence = this.allocateCommandSequence();
            reservation.state = 'dispatched';
            const issuedAtMs = this.now();
            reservation.readyByMs = issuedAtMs + TARGET_READY_TIMEOUT_MS;
            const dispatch = {
                ...request,
                requesterEndpointId: reservation.requesterEndpointId,
                targetRegistrationGeneration: currentRoute.registrationGeneration,
                commandSequence: reservation.commandSequence,
                issuedAt: new Date(issuedAtMs).toISOString(),
                readyBy: new Date(reservation.readyByMs).toISOString(),
                expectedSource: resolved.dispatchSource,
                desiredResult: resolved.desiredResult
            };

            this.setTimer(reservation, TARGET_READY_TIMEOUT_MS, () => {
                this.terminalize(
                    reservation,
                    'timed_out',
                    protocolError(
                        'TARGET_READY_TIMEOUT',
                        'The target did not acknowledge command readiness in time.',
                        true
                    )
                );
            });

            try {
                currentRoute.socket.emit(
                    PLAYBACK_COMMAND_EXECUTE,
                    dispatch,
                    (acknowledgement: unknown) => {
                        this.handleExecuteAck(reservation, acknowledgement);
                    }
                );
            } catch {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(
                        'TARGET_OFFLINE',
                        'The command could not be delivered to the target endpoint.',
                        true
                    )
                );
            }
        } catch (error) {
            if (isPlaybackCommandServiceError(error)) {
                this.terminalize(
                    reservation,
                    'rejected',
                    protocolError(error.code, error.message, error.retryable),
                    error.sessionRevision,
                    error.queueRevision
                );
                return;
            }

            console.error(error);
            this.terminalize(
                reservation,
                'rejected',
                protocolError(
                    'STATE_COMMIT_FAILED',
                    'The playback command could not be validated.',
                    true
                )
            );
        }
    }

    private handleExecuteAck(
        reservation: PlaybackCommandReservation,
        acknowledgement: unknown
    ) {
        if (reservation.state !== 'dispatched') {
            return;
        }

        if (!isExecuteAck(acknowledgement, reservation)) {
            this.terminalize(
                reservation,
                'rejected',
                protocolError(
                    'TARGET_STATE_MISMATCH',
                    'The target returned an invalid readiness acknowledgement.',
                    true
                )
            );
            return;
        }

        if (
            reservation.readyByMs === null
            || this.now() > reservation.readyByMs
        ) {
            this.terminalize(
                reservation,
                'timed_out',
                protocolError(
                    'TARGET_READY_TIMEOUT',
                    'The target readiness acknowledgement arrived too late.',
                    true
                )
            );
            return;
        }

        if (!this.hasCurrentTargetRoute(reservation)) {
            this.terminalize(
                reservation,
                'rejected',
                protocolError(
                    'TARGET_OFFLINE',
                    'The target endpoint registration changed before readiness.',
                    true
                )
            );
            return;
        }

        if (acknowledgement.status === 'rejected') {
            this.terminalize(
                reservation,
                'rejected',
                normalizeTargetError(acknowledgement.error) ?? protocolError(
                    'TARGET_STATE_MISMATCH',
                    'The target rejected the playback command.',
                    true
                )
            );
            return;
        }

        if (
            !reservation.resolved
            || acknowledgement.lastEndpointSequence
                < reservation.resolved.activeEndpointSequence
        ) {
            this.terminalize(
                reservation,
                'rejected',
                protocolError(
                    'TARGET_STATE_MISMATCH',
                    'The target endpoint sequence does not match the server session.',
                    true
                )
            );
            return;
        }

        reservation.readyEndpointSequence = acknowledgement.lastEndpointSequence;

        this.clearTimer(reservation);
        reservation.state = 'ready';
        reservation.startRequestByMs = this.now() + START_REQUEST_TIMEOUT_MS;
        this.setTimer(reservation, START_REQUEST_TIMEOUT_MS, () => {
            this.terminalize(
                reservation,
                'timed_out',
                protocolError(
                    'START_REQUEST_TIMEOUT',
                    'The target did not request an execution grant in time.',
                    true
                )
            );
        });
    }

    private async commitCompletedResult(
        reservation: PlaybackCommandReservation,
        result: Extract<PlaybackCommandExecutionResult, { status: 'completed' }>
    ): Promise<PlaybackCommandResultAck> {
        if (!reservation.resolved) {
            const status = this.terminalize(
                reservation,
                'rejected',
                protocolError(
                    'STATE_COMMIT_FAILED',
                    'The resolved command state is unavailable.',
                    true
                )
            );
            return this.resultAckFrom(
                result,
                'rejected',
                'rejected',
                status.sessionRevision,
                status.queueRevision,
                status.error
            );
        }

        try {
            const committed = await this.commitResult(
                reservation.request.targetEndpointId,
                reservation.resolved,
                result,
                new Date(this.now()),
                Math.max(
                    (reservation.completionDeadlineMs ?? this.now()) - this.now(),
                    1
                )
            );
            const status = this.terminalize(
                reservation,
                'completed',
                null,
                committed.sessionRevision,
                committed.queueRevision
            );
            const completedInTime = status.status === 'completed';
            const acknowledgement = this.resultAckFrom(
                result,
                completedInTime ? 'committed' : 'expired',
                completedInTime ? 'completed' : 'timed_out',
                status.sessionRevision,
                status.queueRevision,
                completedInTime ? null : status.error
            );
            reservation.resultAck = acknowledgement;
            try {
                await this.onCommitted(committed);
            } catch (error) {
                console.error(error);
            }
            return acknowledgement;
        } catch (error) {
            const commandError = isPlaybackCommandServiceError(error)
                ? protocolError(error.code, error.message, error.retryable)
                : protocolError(
                    'STATE_COMMIT_FAILED',
                    'The authoritative playback state could not be committed.',
                    true
                );
            if (!isPlaybackCommandServiceError(error)) {
                console.error(error);
            }
            const status = this.terminalize(
                reservation,
                'rejected',
                commandError,
                isPlaybackCommandServiceError(error)
                    ? error.sessionRevision
                    : reservation.resolved.dispatchSource.sessionRevision,
                isPlaybackCommandServiceError(error)
                    ? error.queueRevision
                    : reservation.resolved.dispatchSource.queueRevision
            );
            const timedOut = status.status === 'timed_out';
            const acknowledgement = this.resultAckFrom(
                result,
                timedOut ? 'expired' : 'rejected',
                timedOut ? 'timed_out' : 'rejected',
                status.sessionRevision,
                status.queueRevision,
                status.error
            );
            reservation.resultAck = acknowledgement;
            return acknowledgement;
        }
    }

    private getRequesterRoute(socket: Socket) {
        const endpointId = normalizeOpaqueId(socket.data.playbackEndpointId);
        const generation = socket.data.playbackRegistrationGeneration;

        if (!endpointId || !Number.isSafeInteger(generation)) {
            return null;
        }

        const route = this.getRoute(endpointId);
        return route
            && route.socketId === socket.id
            && route.registrationGeneration === generation
            ? route
            : null;
    }

    private isCurrentTarget(
        socket: Socket,
        reservation: PlaybackCommandReservation,
        input: {
            targetEndpointId: string;
            targetRegistrationGeneration: number;
            commandSequence: number;
        }
    ) {
        return Boolean(
            reservation.target
            && reservation.commandSequence === input.commandSequence
            && reservation.target.socketId === socket.id
            && reservation.target.endpointId === input.targetEndpointId
            && reservation.target.registrationGeneration
                === input.targetRegistrationGeneration
            && this.hasCurrentTargetRoute(reservation)
        );
    }

    private hasCurrentTargetRoute(reservation: PlaybackCommandReservation) {
        if (!reservation.target) {
            return false;
        }

        const route = this.getRoute(reservation.target.endpointId);
        return Boolean(route && this.sameRoute(route, reservation.target));
    }

    private sameRoute(
        left: Pick<PlaybackEndpointRoute, 'socketId' | 'endpointId' | 'registrationGeneration'>,
        right: Pick<PlaybackEndpointRoute, 'socketId' | 'endpointId' | 'registrationGeneration'>
    ) {
        return left.socketId === right.socketId
            && left.endpointId === right.endpointId
            && left.registrationGeneration === right.registrationGeneration;
    }

    private publishStatus(
        reservation: PlaybackCommandReservation,
        status: PlaybackCommandStatus['status'],
        error: PlaybackCommandError | null,
        sessionRevision = reservation.resolved?.dispatchSource.sessionRevision ?? null,
        queueRevision = reservation.resolved?.dispatchSource.queueRevision ?? null
    ) {
        const envelope: PlaybackCommandStatus = {
            protocolVersion: 1,
            commandEpoch: this.commandEpoch,
            commandId: reservation.request.commandId,
            status,
            deduplicated: false,
            targetEndpointId: reservation.request.targetEndpointId,
            commandSequence: reservation.commandSequence,
            sessionRevision,
            queueRevision,
            occurredAt: new Date(this.now()).toISOString(),
            error
        };
        reservation.latestStatus = envelope;

        if (!reservation.initialStatusSettled) {
            reservation.initialStatusSettled = true;
            reservation.resolveInitialStatus(envelope);
        }

        for (const controller of reservation.controllerSockets) {
            try {
                if (controller.connected) {
                    controller.emit(PLAYBACK_COMMAND_STATUS, envelope);
                } else {
                    reservation.controllerSockets.delete(controller);
                }
            } catch (emitError) {
                console.error(emitError);
            }
        }

        return envelope;
    }

    private terminalize(
        reservation: PlaybackCommandReservation,
        status: 'completed' | 'rejected' | 'timed_out',
        error: PlaybackCommandError | null,
        sessionRevision = reservation.resolved?.dispatchSource.sessionRevision ?? null,
        queueRevision = reservation.resolved?.dispatchSource.queueRevision ?? null
    ) {
        if (reservation.state === 'terminal' && reservation.latestStatus) {
            return reservation.latestStatus;
        }

        this.clearTimer(reservation);
        reservation.state = 'terminal';
        reservation.expiresAtMs = this.now() + COMMAND_RESULT_RETENTION_MS;
        if (this.guardCommandId === reservation.request.commandId) {
            this.guardCommandId = null;
        }
        const envelope = this.publishStatus(
            reservation,
            status,
            error,
            sessionRevision,
            queueRevision
        );
        this.schedulePrune();
        return envelope;
    }

    private detachedStatus(
        request: PlaybackCommandRequest,
        error: PlaybackCommandError
    ): PlaybackCommandStatus {
        return {
            protocolVersion: 1,
            commandEpoch: this.commandEpoch,
            commandId: request.commandId,
            status: 'rejected',
            deduplicated: false,
            targetEndpointId: request.targetEndpointId,
            commandSequence: null,
            sessionRevision: null,
            queueRevision: null,
            occurredAt: new Date(this.now()).toISOString(),
            error
        };
    }

    private parseFailure(input: unknown): PlaybackCommandParseFailure {
        const candidate = input && typeof input === 'object'
            ? input as { commandId?: unknown; targetEndpointId?: unknown }
            : null;
        return {
            protocolVersion: 1,
            commandEpoch: this.commandEpoch,
            commandId: normalizeUuid(candidate?.commandId),
            targetEndpointId: normalizeOpaqueId(candidate?.targetEndpointId),
            status: 'rejected',
            occurredAt: new Date(this.now()).toISOString(),
            error: protocolError(
                'INVALID_COMMAND',
                'The playback command request is invalid.'
            ) as PlaybackCommandParseFailure['error']
        };
    }

    private rejectedStartAck(
        commandId: string,
        error: PlaybackCommandError
    ): PlaybackCommandStartAck {
        return {
            protocolVersion: 1,
            commandId,
            status: 'rejected',
            error
        };
    }

    private resultAckFrom(
        result: Pick<PlaybackCommandExecutionResult,
            | 'commandId'
            | 'targetEndpointId'
            | 'targetRegistrationGeneration'
            | 'commandSequence'>,
        disposition: PlaybackCommandResultAck['disposition'],
        commandStatus: PlaybackCommandResultAck['commandStatus'],
        sessionRevision: number | null,
        queueRevision: number | null,
        error: PlaybackCommandError | null
    ): PlaybackCommandResultAck {
        return {
            protocolVersion: 1,
            commandId: result.commandId,
            targetEndpointId: result.targetEndpointId,
            targetRegistrationGeneration: result.targetRegistrationGeneration,
            commandSequence: result.commandSequence,
            disposition,
            commandStatus,
            sessionRevision,
            queueRevision,
            occurredAt: new Date(this.now()).toISOString(),
            error
        };
    }

    private invalidResultAck(input: unknown): PlaybackCommandResultAck {
        const candidate = input && typeof input === 'object'
            ? input as Record<string, unknown>
            : {};
        return {
            protocolVersion: 1,
            commandId: normalizeOpaqueId(candidate.commandId) ?? '',
            targetEndpointId: normalizeOpaqueId(candidate.targetEndpointId) ?? '',
            targetRegistrationGeneration: Number.isSafeInteger(
                candidate.targetRegistrationGeneration
            ) ? Number(candidate.targetRegistrationGeneration) : 0,
            commandSequence: Number.isSafeInteger(candidate.commandSequence)
                ? Number(candidate.commandSequence)
                : 0,
            disposition: 'rejected',
            commandStatus: 'rejected',
            sessionRevision: null,
            queueRevision: null,
            occurredAt: new Date(this.now()).toISOString(),
            error: protocolError(
                'INVALID_COMMAND',
                'The playback command result is invalid.'
            )
        };
    }

    private allocateCommandSequence() {
        this.lastCommandSequence = this.lastCommandSequence >= PLAYBACK_COMMAND_MAX_SEQUENCE
            ? 1
            : this.lastCommandSequence + 1;
        return this.lastCommandSequence;
    }

    private setTimer(
        reservation: PlaybackCommandReservation,
        delayMs: number,
        callback: () => void
    ) {
        this.clearTimer(reservation);
        reservation.timer = setTimeout(callback, delayMs);
        reservation.timer.unref?.();
    }

    private clearTimer(reservation: PlaybackCommandReservation) {
        if (reservation.timer) {
            clearTimeout(reservation.timer);
            reservation.timer = null;
        }
    }

    private pruneExpired() {
        const now = this.now();
        for (const [commandId, reservation] of this.reservations) {
            if (
                reservation.state === 'terminal'
                && reservation.expiresAtMs !== null
                && reservation.expiresAtMs <= now
            ) {
                this.reservations.delete(commandId);
            }
        }
    }

    private schedulePrune() {
        if (this.pruneTimer) {
            return;
        }

        const expirations = [...this.reservations.values()]
            .map(reservation => reservation.expiresAtMs)
            .filter((value): value is number => value !== null);

        if (expirations.length === 0) {
            return;
        }

        const delayMs = Math.max(Math.min(...expirations) - this.now(), 0);
        this.pruneTimer = setTimeout(() => {
            this.pruneTimer = null;
            this.pruneExpired();
            if ([...this.reservations.values()].some(reservation => (
                reservation.expiresAtMs !== null
            ))) {
                this.schedulePrune();
            }
        }, delayMs);
        this.pruneTimer.unref?.();
    }
}

export const playbackCommandCoordinator = new PlaybackCommandCoordinator();

export const playbackCommandListener = (
    socket: Socket,
    coordinator = playbackCommandCoordinator
) => {
    socket.on(PLAYBACK_COMMAND_REQUEST, (input, acknowledge) => {
        void coordinator.request(socket, input).then((result) => {
            if (typeof acknowledge === 'function') {
                acknowledge(result);
            }
        });
    });

    socket.on(PLAYBACK_COMMAND_START, (input, acknowledge) => {
        const result = coordinator.start(socket, input);
        if (typeof acknowledge === 'function') {
            acknowledge(result);
        }
    });

    socket.on(PLAYBACK_COMMAND_RESULT, (input, acknowledge) => {
        void coordinator.result(socket, input).then((result) => {
            if (typeof acknowledge === 'function') {
                acknowledge(result);
            }
        });
    });
};

export const isPlaybackCommandTerminalStatus = isTerminalStatus;
