import type { PlaybackDeviceRegistrySnapshot } from '~/api/playback-devices';
import type { PlaybackQueueSnapshot } from '~/api/playback-queue';
import type { PlaybackSessionSnapshot } from '~/api/playback-session';
import {
    beginPlaybackControllerCommandBarrier,
    endPlaybackControllerCommandBarrier,
    isPlaybackCommandBarrierActive
} from '~/modules/playback-command-barrier';
import {
    PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS,
    playbackControllerRegistrationKey
} from '~/modules/playback-controller';
import {
    COMMAND_COMPLETION_TIMEOUT_MS,
    CONTROLLER_RECOVERY_WINDOW_MS,
    type PlaybackCommand,
    type PlaybackCommandError,
    type PlaybackCommandRequestAck,
    type PlaybackCommandStatus,
    playbackCommandController,
    START_REQUEST_TIMEOUT_MS,
    TARGET_READY_TIMEOUT_MS
} from '~/socket/playback-command';
import {
    type PlaybackEndpointRegistrationState,
    playbackEndpointRegistration
} from '~/socket/playback-endpoint';

import { BaseStore } from './base-store';
import { playbackDevicesStore, resolveActivePlaybackTarget } from './playback-devices';
import { playbackQueueStore } from './playback-queue';
import { playbackSessionStore } from './playback-session';

export const REMOTE_PLAYBACK_STATUS_RECOVERY_MS = TARGET_READY_TIMEOUT_MS
    + START_REQUEST_TIMEOUT_MS
    + COMMAND_COMPLETION_TIMEOUT_MS
    + 2_000;
export const REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS = PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS;

export type RemotePlaybackControlPhase =
    | 'idle'
    | 'sending'
    | 'accepted'
    | 'recovering'
    | 'reconciling'
    | 'refresh_error'
    | 'completed'
    | 'rejected'
    | 'timed_out';

export interface RemotePlaybackControlError {
    code: PlaybackCommandError['code'];
    message: string;
    retryable: boolean;
}

export interface RemotePlaybackControlState {
    commandId: string | null;
    command: PlaybackCommand | null;
    targetEndpointId: string | null;
    targetDeviceName: string | null;
    phase: RemotePlaybackControlPhase;
    message: string | null;
    error: RemotePlaybackControlError | null;
    controllerReady: boolean;
    controllerRefreshing: boolean;
    controllerMessage: string | null;
    controllerError: RemotePlaybackControlError | null;
}

interface PendingControllerRequest {
    commandId: string;
    commandEpoch: string;
    requesterEndpointId: string;
    requesterRegistrationGeneration: number;
    targetEndpointId: string;
    expectedSessionRevision: number;
    expectedQueueRevision: number | null;
    command: PlaybackCommand;
    startedAtMonotonicMs: number;
}

interface AuthoritativePlaybackState {
    session: PlaybackSessionSnapshot | null;
    queue: PlaybackQueueSnapshot | null;
    registry: PlaybackDeviceRegistrySnapshot;
}

interface TerminalCommandOutcome {
    phase: 'completed' | 'rejected' | 'timed_out';
    message: string;
    error: RemotePlaybackControlError | null;
    targetEndpointId: string | null;
    sessionRevision: number | null;
    queueRevision: number | null;
}

type RemotePlaybackRequestContext = {
    type: 'ready';
    targetEndpointId: string;
    targetDeviceName: string;
    commandEpoch: string;
    requesterEndpointId: string;
    requesterRegistrationGeneration: number;
    expectedSessionRevision: number;
    expectedQueueRevision: number | null;
} | {
    type: 'error';
    targetEndpointId: string | null;
    targetDeviceName: string;
    error: RemotePlaybackControlError;
};

const initialState = (): RemotePlaybackControlState => ({
    commandId: null,
    command: null,
    targetEndpointId: null,
    targetDeviceName: null,
    phase: 'idle',
    message: null,
    error: null,
    controllerReady: false,
    controllerRefreshing: false,
    controllerMessage: null,
    controllerError: null
});

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

const registryHasRegistration = (
    registry: PlaybackDeviceRegistrySnapshot,
    registration: PlaybackEndpointRegistrationState
) => registry.devices.some(device => device.endpoints.some(endpoint => (
    endpoint.id === registration.endpointId
    && endpoint.registrationGeneration === registration.registrationGeneration
)));

const playbackSnapshotsMatchRegistration = (
    registration: PlaybackEndpointRegistrationState | null
) => {
    const sessionState = playbackSessionStore.state;
    const queueState = playbackQueueStore.state;
    const devicesState = playbackDevicesStore.state;
    const registry = devicesState.registry;

    return Boolean(
        registration
        && registry
        && sessionState.endpointId === registration.endpointId
        && (sessionState.snapshot?.activeDeviceId ?? null) === registry.activeEndpointId
        && (!registry.activeEndpointId || resolveActivePlaybackTarget(registry))
        && registry.commandEpoch === registration.commandEpoch
        && registryHasRegistration(registry, registration)
        && !sessionState.loading
        && !sessionState.error
        && !queueState.loading
        && !queueState.error
        && queueState.initialized
        && !devicesState.loading
        && !devicesState.error
    );
};

export const isRemotePlaybackControlPending = (
    phase: RemotePlaybackControlPhase
) => [
    'sending',
    'accepted',
    'recovering',
    'reconciling',
    'refresh_error'
].includes(phase);

const commandLabel = (command: PlaybackCommand) => {
    switch (command.type) {
        case 'play': return 'Play';
        case 'pause': return 'Pause';
        case 'seek': return 'Seek';
        case 'next': return 'Next';
        case 'previous': return 'Previous';
    }
};

const localError = (
    code: PlaybackCommandError['code'],
    message: string,
    retryable = true
): RemotePlaybackControlError => ({ code, message, retryable });

export class RemotePlaybackControlStore extends BaseStore<RemotePlaybackControlState> {
    private connected = false;
    private unsubscribeStatus: (() => void) | null = null;
    private unsubscribeRegistration: (() => void) | null = null;
    private unsubscribeSession: (() => void) | null = null;
    private unsubscribeQueue: (() => void) | null = null;
    private unsubscribeDevices: (() => void) | null = null;
    private pendingRequest: PendingControllerRequest | null = null;
    private terminalOutcome: TerminalCommandOutcome | null = null;
    private retryPreflightToken: symbol | null = null;
    private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    private readinessSequence = 0;
    private synchronizedRegistrationKey: string | null = null;
    private readonly localMutationBarrier = Symbol('remote-playback-controller-command');

    constructor() {
        super();
        this.state = initialState();
    }

    get controllerReady() {
        return this.state.controllerReady
            && playbackSnapshotsMatchRegistration(playbackEndpointRegistration.current);
    }

    afterStateChange(state: RemotePlaybackControlState) {
        if (isRemotePlaybackControlPending(state.phase)) {
            beginPlaybackControllerCommandBarrier(this.localMutationBarrier);
            return;
        }

        endPlaybackControllerCommandBarrier(this.localMutationBarrier);
    }

    connect() {
        if (this.connected) {
            return;
        }

        this.connected = true;
        this.unsubscribeStatus = playbackCommandController.subscribe(
            this.handleStatus
        );
        this.unsubscribeRegistration = playbackEndpointRegistration.subscribe(
            this.handleRegistrationChanged
        );
        this.unsubscribeSession = playbackSessionStore.subscribe(
            this.handlePlaybackSnapshotsChanged
        );
        this.unsubscribeQueue = playbackQueueStore.subscribe(
            this.handlePlaybackSnapshotsChanged
        );
        this.unsubscribeDevices = playbackDevicesStore.subscribe(
            this.handlePlaybackSnapshotsChanged
        );
        this.handleRegistrationChanged(playbackEndpointRegistration.current);
    }

    disconnect() {
        if (this.connected) {
            this.connected = false;
            this.unsubscribeStatus?.();
            this.unsubscribeStatus = null;
            this.unsubscribeRegistration?.();
            this.unsubscribeRegistration = null;
            this.unsubscribeSession?.();
            this.unsubscribeSession = null;
            this.unsubscribeQueue?.();
            this.unsubscribeQueue = null;
            this.unsubscribeDevices?.();
            this.unsubscribeDevices = null;
        }

        this.clearTimers();
        this.readinessSequence += 1;
        this.synchronizedRegistrationKey = null;
        this.pendingRequest = null;
        this.terminalOutcome = null;
        this.retryPreflightToken = null;
        this.state = initialState();
    }

    async send(command: PlaybackCommand) {
        if (isRemotePlaybackControlPending(this.state.phase)) {
            return false;
        }

        this.clearTimers();
        this.terminalOutcome = null;
        this.retryPreflightToken = null;
        const context = this.resolveRequestContext(command);
        if (context.type === 'error') {
            this.pendingRequest = null;
            this.set({
                commandId: null,
                command,
                targetEndpointId: context.targetEndpointId,
                targetDeviceName: context.targetDeviceName,
                phase: 'rejected',
                message: context.error.message,
                error: context.error
            });
            void this.refreshAuthoritativeState();
            return false;
        }

        const commandId = createUuid();
        const request: PendingControllerRequest = {
            commandId,
            commandEpoch: context.commandEpoch,
            requesterEndpointId: context.requesterEndpointId,
            requesterRegistrationGeneration: context.requesterRegistrationGeneration,
            targetEndpointId: context.targetEndpointId,
            expectedSessionRevision: context.expectedSessionRevision,
            expectedQueueRevision: context.expectedQueueRevision,
            command,
            startedAtMonotonicMs: monotonicNow()
        };
        this.pendingRequest = request;
        this.set({
            commandId,
            command,
            targetEndpointId: context.targetEndpointId,
            targetDeviceName: context.targetDeviceName,
            phase: 'sending',
            message: `Sending ${commandLabel(command)} to ${context.targetDeviceName}…`,
            error: null
        });

        const result = await playbackCommandController.request(request);
        const stateAfterRequest = this.api.getState();
        if (
            stateAfterRequest.commandId !== commandId
            || stateAfterRequest.phase !== 'sending'
        ) {
            return this.wasAcceptedOrCompleted();
        }

        if (result.type === 'transport-error') {
            this.continueOutcomeRecovery();
            return true;
        }

        if (!this.acknowledgementMatchesRequest(result.acknowledgement, request)) {
            if (result.acknowledgement.commandEpoch !== request.commandEpoch) {
                this.failRecoveryFence(
                    'The playback coordinator changed before the command outcome was confirmed.'
                );
                return false;
            }

            const acknowledgementError = result.acknowledgement.status === 'rejected'
                ? result.acknowledgement.error
                : null;
            this.applyFailure('rejected', acknowledgementError ?? localError(
                'INVALID_COMMAND',
                'The playback command acknowledgement did not match this request.',
                false
            ));
            return false;
        }

        this.applyAcknowledgement(result.acknowledgement);
        return result.acknowledgement.status === 'accepted'
            || result.acknowledgement.status === 'completed';
    }

    async retry() {
        if (this.state.phase === 'refresh_error' && this.terminalOutcome) {
            return this.reconcileTerminalOutcome(this.terminalOutcome);
        }

        const command = this.state.command;
        const commandId = this.state.commandId;
        const phase = this.state.phase;
        if (
            !command
            || !this.state.error?.retryable
            || isRemotePlaybackControlPending(this.state.phase)
            || isPlaybackCommandBarrierActive()
            || (phase !== 'rejected' && phase !== 'timed_out')
        ) {
            return false;
        }
        const retryOutcome: TerminalCommandOutcome = {
            phase,
            message: this.state.message ?? 'The playback command did not complete.',
            error: this.state.error,
            targetEndpointId: this.state.targetEndpointId,
            sessionRevision: null,
            queueRevision: null
        };

        const retryPreflightToken = Symbol('remote-playback-retry-preflight');
        this.retryPreflightToken = retryPreflightToken;
        this.set({
            phase: 'reconciling',
            message: 'Refreshing playback state before retrying the command…',
            error: null
        });

        const refreshed = await this.refreshAuthoritativeState();
        if (
            this.retryPreflightToken !== retryPreflightToken
            || this.state.command !== command
            || this.state.commandId !== commandId
            || this.state.phase !== 'reconciling'
        ) {
            return false;
        }
        this.retryPreflightToken = null;

        if (!refreshed) {
            const error = localError(
                'STATE_COMMIT_FAILED',
                'The latest playback state could not be refreshed, so the command was not retried.'
            );
            this.terminalOutcome = retryOutcome;
            this.set({
                phase: 'refresh_error',
                message: error.message,
                error
            });
            return false;
        }

        this.set({
            phase: retryOutcome.phase,
            message: retryOutcome.message,
            error: retryOutcome.error
        });
        return this.send(command);
    }

    async retryControllerReadiness() {
        if (
            this.state.controllerRefreshing
            || isRemotePlaybackControlPending(this.state.phase)
        ) {
            return false;
        }

        const registration = playbackEndpointRegistration.current;
        if (!registration) {
            const error = localError(
                'TARGET_OFFLINE',
                playbackEndpointRegistration.error
                    ?? 'This browser is not connected to playback control.',
                false
            );
            this.set({
                controllerReady: false,
                controllerRefreshing: false,
                controllerMessage: error.message,
                controllerError: error
            });
            return false;
        }

        return this.synchronizeControllerRegistration(registration);
    }

    dismiss() {
        if (isRemotePlaybackControlPending(this.state.phase)) {
            return;
        }

        this.clearTimers();
        this.pendingRequest = null;
        this.terminalOutcome = null;
        this.retryPreflightToken = null;
        this.state = {
            ...initialState(),
            controllerReady: this.state.controllerReady,
            controllerRefreshing: this.state.controllerRefreshing,
            controllerMessage: this.state.controllerMessage,
            controllerError: this.state.controllerError
        };
    }

    private requestContextControllerReady() {
        return playbackSnapshotsMatchRegistration(playbackEndpointRegistration.current)
            && (!this.connected || this.state.controllerReady);
    }

    private resolveRequestContext(command: PlaybackCommand): RemotePlaybackRequestContext {
        const session = playbackSessionStore.state.snapshot;
        const registry = playbackDevicesStore.state.registry;
        const registration = playbackEndpointRegistration.current;
        const target = resolveActivePlaybackTarget(registry);
        const targetEndpointId = target?.endpoint.id ?? registry?.activeEndpointId ?? null;
        const targetDeviceName = target?.device.name ?? 'the active player';

        if (isPlaybackCommandBarrierActive()) {
            return {
                type: 'error',
                error: localError(
                    'TARGET_STATE_MISMATCH',
                    'This browser is executing another playback command. Try again when it finishes.'
                ),
                targetEndpointId,
                targetDeviceName
            };
        }

        if (!session) {
            return {
                type: 'error',
                error: localError(
                    'SESSION_NOT_FOUND',
                    'The shared playback session is not available yet.'
                ),
                targetEndpointId,
                targetDeviceName
            };
        }

        if (
            !registration
            || playbackSessionStore.endpointId !== registration.endpointId
        ) {
            return {
                type: 'error',
                error: localError(
                    'TARGET_OFFLINE',
                    'This browser is reconnecting to playback control.'
                ),
                targetEndpointId,
                targetDeviceName
            };
        }

        if (!registry || !target || session.activeDeviceId !== target.endpoint.id) {
            return {
                type: 'error',
                error: localError(
                    'TARGET_NOT_ACTIVE',
                    'The active playback device changed. Refreshing its state now.'
                ),
                targetEndpointId,
                targetDeviceName
            };
        }
        if (
            registry.commandEpoch !== registration.commandEpoch
            || !registryHasRegistration(registry, registration)
            || !this.requestContextControllerReady()
        ) {
            return {
                type: 'error',
                error: localError(
                    'TARGET_NOT_ACTIVE',
                    'Playback control is still refreshing after this browser reconnected.'
                ),
                targetEndpointId,
                targetDeviceName
            };
        }

        if (!target.endpoint.online) {
            return {
                type: 'error',
                error: localError(
                    'TARGET_OFFLINE',
                    `${target.device.name} is offline.`
                ),
                targetEndpointId,
                targetDeviceName
            };
        }

        if (!target.endpoint.capabilities.includes(command.type)) {
            return {
                type: 'error',
                error: localError(
                    'UNSUPPORTED_COMMAND',
                    `${target.device.name} does not support ${commandLabel(command)}.`,
                    false
                ),
                targetEndpointId,
                targetDeviceName
            };
        }

        if (target.endpoint.id === playbackSessionStore.endpointId) {
            return {
                type: 'error',
                error: localError(
                    'INVALID_COMMAND',
                    'Use this browser’s local playback controls for the active player.',
                    false
                ),
                targetEndpointId,
                targetDeviceName
            };
        }

        if (
            session.state === 'stopped'
            && (command.type === 'pause' || command.type === 'seek')
        ) {
            return {
                type: 'error',
                error: localError(
                    'INVALID_COMMAND',
                    `${commandLabel(command)} requires an active playback item.`,
                    false
                ),
                targetEndpointId,
                targetDeviceName
            };
        }

        const needsQueueRevision = command.type === 'next'
            || command.type === 'previous'
            || (command.type === 'play' && session.state === 'stopped');
        const queueRevision = playbackQueueStore.state.snapshot?.revision ?? null;

        if (needsQueueRevision && queueRevision === null) {
            return {
                type: 'error',
                error: localError(
                    'STALE_QUEUE_REVISION',
                    'The shared playback queue is not available yet.'
                ),
                targetEndpointId,
                targetDeviceName
            };
        }

        return {
            type: 'ready',
            targetEndpointId: target.endpoint.id,
            targetDeviceName,
            commandEpoch: registry.commandEpoch,
            requesterEndpointId: registration.endpointId,
            requesterRegistrationGeneration: registration.registrationGeneration,
            expectedSessionRevision: session.revision,
            expectedQueueRevision: needsQueueRevision ? queueRevision : null
        };
    }

    private applyAcknowledgement(acknowledgement: PlaybackCommandRequestAck) {
        if (acknowledgement.status === 'accepted') {
            const command = this.state.command;
            const targetDeviceName = this.state.targetDeviceName ?? 'the active player';
            if (!command) {
                return;
            }

            this.set({
                phase: 'accepted',
                message: `${targetDeviceName} accepted ${commandLabel(command)}. Waiting for completion…`,
                error: null
            });
            this.scheduleStatusRecovery();
            return;
        }

        if (acknowledgement.status === 'completed') {
            this.complete(acknowledgement);
            return;
        }

        this.applyFailure(
            acknowledgement.status,
            acknowledgement.error ?? localError(
                acknowledgement.status === 'timed_out'
                    ? 'COMMAND_COMPLETION_TIMEOUT'
                    : 'STATE_COMMIT_FAILED',
                acknowledgement.status === 'timed_out'
                    ? 'The active player did not confirm the command in time.'
                    : 'The active player rejected the command.'
            ),
            acknowledgement
        );
    }

    private handleStatus = (status: PlaybackCommandStatus) => {
        const request = this.pendingRequest;
        if (
            !request
            || status.commandId !== this.state.commandId
            || status.targetEndpointId !== this.state.targetEndpointId
            || status.commandEpoch !== request.commandEpoch
            || this.isTerminal()
        ) {
            return;
        }

        this.applyAcknowledgement(status);
    };

    private complete(acknowledgement: PlaybackCommandStatus) {
        const command = this.state.command;
        const targetDeviceName = this.state.targetDeviceName ?? 'The active player';
        if (!command) {
            return;
        }

        this.beginTerminalReconciliation({
            phase: 'completed',
            message: `${targetDeviceName} completed ${commandLabel(command)}.`,
            error: null,
            targetEndpointId: acknowledgement.targetEndpointId,
            sessionRevision: acknowledgement.sessionRevision,
            queueRevision: acknowledgement.queueRevision
        });
    }

    private applyFailure(
        phase: 'rejected' | 'timed_out',
        error: RemotePlaybackControlError,
        acknowledgement?: PlaybackCommandRequestAck
    ) {
        this.beginTerminalReconciliation({
            phase,
            message: error.message,
            error,
            targetEndpointId: acknowledgement?.targetEndpointId ?? null,
            sessionRevision: acknowledgement && 'sessionRevision' in acknowledgement
                ? acknowledgement.sessionRevision
                : null,
            queueRevision: acknowledgement && 'queueRevision' in acknowledgement
                ? acknowledgement.queueRevision
                : null
        });
    }

    private beginTerminalReconciliation(outcome: TerminalCommandOutcome) {
        this.clearRecoveryTimer();
        this.pendingRequest = null;
        this.terminalOutcome = outcome;
        this.set({
            phase: 'reconciling',
            message: outcome.phase === 'completed'
                ? `${outcome.message} Refreshing playback state…`
                : `${outcome.message} Refreshing playback state before controls resume…`,
            error: outcome.error
        });
        void this.reconcileTerminalOutcome(outcome);
    }

    private async reconcileTerminalOutcome(outcome: TerminalCommandOutcome) {
        if (this.state.phase === 'refresh_error') {
            this.set({
                phase: 'reconciling',
                message: 'Refreshing the latest playback state…',
                error: null
            });
        }

        const refreshed = await this.refreshAuthoritativeState();
        if (
            this.terminalOutcome !== outcome
            || !['reconciling', 'refresh_error'].includes(this.state.phase)
        ) {
            return false;
        }

        if (!refreshed || !this.authoritativeStateMeets(outcome, refreshed)) {
            const error = localError(
                'STATE_COMMIT_FAILED',
                `${outcome.message} The latest playback state could not be confirmed.`
            );
            this.set({
                phase: 'refresh_error',
                message: error.message,
                error
            });
            return false;
        }

        this.terminalOutcome = null;
        this.set({
            phase: outcome.phase,
            message: outcome.message,
            error: outcome.error
        });
        return outcome.phase === 'completed';
    }

    private continueOutcomeRecovery() {
        const command = this.state.command;
        const targetDeviceName = this.state.targetDeviceName ?? 'the active player';
        if (!command || !this.pendingRequest) {
            return;
        }

        this.set({
            phase: 'recovering',
            message: `The acknowledgement for ${commandLabel(command)} on ${targetDeviceName} is delayed. Checking the outcome…`,
            error: null
        });
        void this.refreshAuthoritativeState();
        this.scheduleStatusRecovery();
    }

    private scheduleStatusRecovery() {
        this.clearRecoveryTimer();
        const request = this.pendingRequest;
        const remainingRecoveryMs = request
            ? Math.max(
                CONTROLLER_RECOVERY_WINDOW_MS
                    - (monotonicNow() - request.startedAtMonotonicMs),
                0
            )
            : REMOTE_PLAYBACK_STATUS_RECOVERY_MS;
        this.recoveryTimer = setTimeout(() => {
            void this.recoverStatus();
        }, Math.min(REMOTE_PLAYBACK_STATUS_RECOVERY_MS, remainingRecoveryMs));
    }

    private async recoverStatus(
        synchronizedState?: AuthoritativePlaybackState
    ) {
        const request = this.pendingRequest;
        if (
            !request
            || !['accepted', 'recovering'].includes(this.state.phase)
        ) {
            return;
        }

        if (!this.isWithinRecoveryWindow(request)) {
            this.failRecoveryFence(
                'The command outcome could not be confirmed within the recovery window.'
            );
            return;
        }

        const registrationBeforeRefresh = playbackEndpointRegistration.current;
        if (!registrationBeforeRefresh) {
            this.deferOutcomeRecovery(
                'Playback control is disconnected. Waiting to recover the existing command outcome…'
            );
            return;
        }
        if (!this.requesterIdentityMatches(request, registrationBeforeRefresh)) {
            this.failRecoveryFence(
                registrationBeforeRefresh.commandEpoch !== request.commandEpoch
                    ? 'The playback coordinator changed before the command outcome was confirmed.'
                    : 'This browser changed playback endpoint before the command outcome was confirmed.'
            );
            return;
        }
        if (
            playbackDevicesStore.state.registry
            && playbackDevicesStore.state.registry.commandEpoch !== request.commandEpoch
        ) {
            this.failRecoveryFence(
                'The playback coordinator changed before the command outcome was confirmed.'
            );
            return;
        }
        if (this.connected && this.state.controllerRefreshing) {
            this.deferOutcomeRecovery(
                'Playback control is refreshing before the existing command outcome is checked…'
            );
            return;
        }

        const refreshed = synchronizedState ?? await this.refreshAuthoritativeState();
        if (
            this.pendingRequest !== request
            || !['accepted', 'recovering'].includes(this.state.phase)
        ) {
            return;
        }

        const registration = playbackEndpointRegistration.current;
        if (!registration) {
            this.deferOutcomeRecovery(
                'Playback control disconnected while the command outcome was being checked. Waiting to recover…'
            );
            return;
        }
        if (!this.requesterIdentityMatches(request, registration)) {
            this.failRecoveryFence(
                registration.commandEpoch !== request.commandEpoch
                    ? 'The playback coordinator changed before the command outcome was confirmed.'
                    : 'This browser changed playback endpoint before the command outcome was confirmed.'
            );
            return;
        }

        if (!this.isWithinRecoveryWindow(request)) {
            this.failRecoveryFence(
                'The command outcome could not be confirmed within the recovery window.'
            );
            return;
        }

        if (!refreshed) {
            this.deferOutcomeRecovery(
                'The command outcome is still unknown because playback state could not be refreshed. Checking again…'
            );
            return;
        }

        if (refreshed.registry.commandEpoch !== request.commandEpoch) {
            this.failRecoveryFence(
                'The playback coordinator changed before the command outcome was confirmed.'
            );
            return;
        }

        if (
            !registryHasRegistration(refreshed.registry, registration)
        ) {
            this.deferOutcomeRecovery(
                'This browser registration is still refreshing. Waiting to recover the command outcome…'
            );
            return;
        }

        const result = await playbackCommandController.request(request);
        if (
            this.pendingRequest !== request
            || !['accepted', 'recovering'].includes(this.state.phase)
        ) {
            return;
        }

        if (result.type === 'transport-error') {
            if (this.isWithinRecoveryWindow(request)) {
                this.continueOutcomeRecovery();
            } else {
                this.failRecoveryFence(
                    'The command outcome could not be confirmed within the recovery window.'
                );
            }
            return;
        }

        if (!this.acknowledgementMatchesRequest(result.acknowledgement, request)) {
            if (result.acknowledgement.commandEpoch !== request.commandEpoch) {
                this.failRecoveryFence(
                    'The playback coordinator changed before the command outcome was confirmed.'
                );
                return;
            }

            this.applyFailure('rejected', localError(
                'INVALID_COMMAND',
                'The playback command acknowledgement did not match this request.',
                false
            ));
            return;
        }

        if (result.acknowledgement.status !== 'accepted') {
            this.applyAcknowledgement(result.acknowledgement);
            return;
        }

        this.applyAcknowledgement(result.acknowledgement);
    }

    private acknowledgementMatchesRequest(
        acknowledgement: PlaybackCommandRequestAck,
        request: PendingControllerRequest
    ) {
        return acknowledgement.commandId === request.commandId
            && acknowledgement.commandEpoch === request.commandEpoch
            && acknowledgement.targetEndpointId === request.targetEndpointId;
    }

    private isWithinRecoveryWindow(request: PendingControllerRequest) {
        return monotonicNow() - request.startedAtMonotonicMs
            < CONTROLLER_RECOVERY_WINDOW_MS;
    }

    private failRecoveryFence(message: string) {
        this.applyFailure('timed_out', localError(
            'COMMAND_COMPLETION_TIMEOUT',
            message
        ));
    }

    private deferOutcomeRecovery(message: string) {
        if (!this.pendingRequest) {
            return;
        }

        this.set({
            phase: 'recovering',
            message,
            error: null
        });
        this.scheduleStatusRecovery();
    }

    private async synchronizeControllerRegistration(
        registration: PlaybackEndpointRegistrationState
    ) {
        const readinessSequence = ++this.readinessSequence;
        const registrationKey = playbackControllerRegistrationKey(registration);
        this.synchronizedRegistrationKey = null;
        this.set({
            controllerReady: false,
            controllerRefreshing: true,
            controllerMessage: 'Refreshing playback control after registration…',
            controllerError: null
        });

        const refreshed = await this.refreshAuthoritativeState();
        const currentRegistration = playbackEndpointRegistration.current;
        if (
            readinessSequence !== this.readinessSequence
            || !currentRegistration
            || playbackControllerRegistrationKey(currentRegistration) !== registrationKey
        ) {
            return false;
        }

        const concurrentlyRefreshed = (
            this.synchronizedRegistrationKey === registrationKey
            && playbackSnapshotsMatchRegistration(currentRegistration)
            && playbackDevicesStore.state.registry
        ) ? {
                session: playbackSessionStore.state.snapshot,
                queue: playbackQueueStore.state.snapshot,
                registry: playbackDevicesStore.state.registry
            }
            : null;
        const synchronizedState = refreshed ?? concurrentlyRefreshed;
        if (!synchronizedState) {
            const error = localError(
                'STATE_COMMIT_FAILED',
                'Playback control state could not be refreshed. Retry before sending commands.'
            );
            this.set({
                controllerReady: false,
                controllerRefreshing: false,
                controllerMessage: error.message,
                controllerError: error
            });
            return false;
        }

        this.set({
            controllerReady: true,
            controllerRefreshing: false,
            controllerMessage: null,
            controllerError: null
        });

        const request = this.pendingRequest;
        if (
            request
            && this.requesterIdentityMatches(request, currentRegistration)
            && ['accepted', 'recovering'].includes(this.state.phase)
        ) {
            void this.recoverStatus(synchronizedState);
        } else if (
            this.terminalOutcome
            && ['reconciling', 'refresh_error'].includes(this.state.phase)
        ) {
            void this.reconcileTerminalOutcome(this.terminalOutcome);
        }

        return true;
    }

    private async refreshAuthoritativeState(): Promise<AuthoritativePlaybackState | null> {
        const registration = playbackEndpointRegistration.current;
        if (!registration) {
            return null;
        }
        const registrationKey = playbackControllerRegistrationKey(registration);
        const [sessionResult, queueResult, devicesResult] = await Promise.allSettled([
            playbackSessionStore.refresh(REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS),
            playbackQueueStore.refresh(REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS),
            playbackDevicesStore.refresh(REMOTE_PLAYBACK_REFRESH_TIMEOUT_MS)
        ]);

        if (
            sessionResult.status !== 'fulfilled'
            || sessionResult.value.type !== 'success'
            || queueResult.status !== 'fulfilled'
            || queueResult.value.type !== 'success'
            || devicesResult.status !== 'fulfilled'
            || devicesResult.value.type !== 'success'
        ) {
            return null;
        }

        const refreshed = {
            session: sessionResult.value.snapshot,
            queue: queueResult.value.snapshot,
            registry: devicesResult.value.registry
        };
        const currentRegistration = playbackEndpointRegistration.current;
        if (
            !currentRegistration
            || playbackControllerRegistrationKey(currentRegistration) !== registrationKey
            || refreshed.registry.commandEpoch !== registration.commandEpoch
            || !registryHasRegistration(refreshed.registry, registration)
            || playbackSessionStore.endpointId !== registration.endpointId
            || playbackSessionStore.state.loading
            || playbackQueueStore.state.loading
            || playbackDevicesStore.state.loading
            || !playbackSnapshotsMatchRegistration(currentRegistration)
            || playbackSessionStore.state.snapshot !== refreshed.session
            || playbackQueueStore.state.snapshot !== refreshed.queue
            || playbackDevicesStore.state.registry !== refreshed.registry
            || (refreshed.session?.activeDeviceId ?? null)
                !== refreshed.registry.activeEndpointId
            || (
                refreshed.registry.activeEndpointId
                && !resolveActivePlaybackTarget(refreshed.registry)
            )
        ) {
            return null;
        }

        this.synchronizedRegistrationKey = registrationKey;
        if (this.connected) {
            this.set({
                controllerReady: true,
                controllerRefreshing: false,
                controllerMessage: null,
                controllerError: null
            });
        }
        return refreshed;
    }

    private authoritativeStateMeets(
        outcome: TerminalCommandOutcome,
        refreshed: AuthoritativePlaybackState
    ) {
        const { session, queue, registry } = refreshed;
        if (
            (session?.activeDeviceId ?? null) !== registry.activeEndpointId
            || (registry.activeEndpointId && !resolveActivePlaybackTarget(registry))
        ) {
            return false;
        }

        if (
            outcome.sessionRevision !== null
            && (!session || session.revision < outcome.sessionRevision)
        ) {
            return false;
        }

        if (
            outcome.phase === 'completed'
            && (!session || outcome.sessionRevision === null)
        ) {
            return false;
        }

        if (
            outcome.phase === 'completed'
            && outcome.sessionRevision !== null
            && session
            && session.revision === outcome.sessionRevision
            && outcome.targetEndpointId
            && session.activeDeviceId !== outcome.targetEndpointId
        ) {
            return false;
        }

        if (
            outcome.queueRevision !== null
            && (!queue || queue.revision < outcome.queueRevision)
        ) {
            return false;
        }

        return true;
    }

    private isTerminal() {
        return [
            'completed',
            'rejected',
            'timed_out'
        ].includes(this.state.phase);
    }

    private wasAcceptedOrCompleted() {
        const phase: RemotePlaybackControlPhase = this.api.getState().phase;
        if (phase === 'reconciling' || phase === 'refresh_error') {
            return this.terminalOutcome?.phase === 'completed';
        }

        return phase === 'accepted'
            || phase === 'recovering'
            || phase === 'completed';
    }

    private clearRecoveryTimer() {
        if (this.recoveryTimer) {
            clearTimeout(this.recoveryTimer);
            this.recoveryTimer = null;
        }
    }

    private clearTimers() {
        this.clearRecoveryTimer();
    }

    private requesterIdentityMatches(
        request: PendingControllerRequest,
        registration = playbackEndpointRegistration.current
    ) {
        return Boolean(
            registration
            && registration.endpointId === request.requesterEndpointId
            && registration.commandEpoch === request.commandEpoch
        );
    }

    private handlePlaybackSnapshotsChanged = () => {
        if (!this.connected) {
            return;
        }

        const registration = playbackEndpointRegistration.current;
        if (!registration) {
            return;
        }

        const sessionState = playbackSessionStore.state;
        const queueState = playbackQueueStore.state;
        const devicesState = playbackDevicesStore.state;
        if (sessionState.loading || queueState.loading || devicesState.loading) {
            this.set({
                controllerReady: false,
                controllerRefreshing: true,
                controllerMessage: 'Refreshing playback control state…',
                controllerError: null
            });
            return;
        }

        if (
            this.state.controllerRefreshing
            && this.synchronizedRegistrationKey === null
        ) {
            return;
        }

        const registrationKey = playbackControllerRegistrationKey(registration);
        if (
            this.synchronizedRegistrationKey === registrationKey
            && playbackSnapshotsMatchRegistration(registration)
        ) {
            this.set({
                controllerReady: true,
                controllerRefreshing: false,
                controllerMessage: null,
                controllerError: null
            });
            return;
        }

        const sourceError = sessionState.error
            ?? queueState.error
            ?? devicesState.error;
        const error = localError(
            'STATE_COMMIT_FAILED',
            sourceError
                ? `Playback control needs a refresh. ${sourceError}`
                : 'Playback control snapshots no longer match. Refresh before sending commands.'
        );
        this.set({
            controllerReady: false,
            controllerRefreshing: false,
            controllerMessage: error.message,
            controllerError: error
        });
    };

    private handleRegistrationChanged = (
        registration: PlaybackEndpointRegistrationState | null
    ) => {
        const request = this.pendingRequest;
        if (request && !registration) {
            this.deferOutcomeRecovery(
                'Playback control disconnected before the command outcome was confirmed. Waiting to reconnect…'
            );
        } else if (request && !this.requesterIdentityMatches(request, registration)) {
            this.failRecoveryFence(
                registration?.commandEpoch !== request.commandEpoch
                    ? 'The playback coordinator changed before the command outcome was confirmed.'
                    : 'This browser changed playback endpoint before the command outcome was confirmed.'
            );
        } else if (request) {
            this.deferOutcomeRecovery(
                'This browser reconnected. Refreshing state before checking the existing command outcome…'
            );
        }

        if (registration) {
            void this.synchronizeControllerRegistration(registration);
            return;
        }

        this.readinessSequence += 1;
        this.synchronizedRegistrationKey = null;
        const registrationError = playbackEndpointRegistration.error;
        const error = registrationError
            ? localError('TARGET_OFFLINE', registrationError, false)
            : null;
        this.set({
            controllerReady: false,
            controllerRefreshing: !error,
            controllerMessage: error?.message ?? 'Connecting this browser to playback control…',
            controllerError: error
        });
    };
}

export const remotePlaybackControlStore = new RemotePlaybackControlStore();

export const isRemotePlaybackControllerReady = () => (
    remotePlaybackControlStore.controllerReady
);

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        remotePlaybackControlStore.disconnect();
    });
}
