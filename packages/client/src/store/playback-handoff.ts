import {
    normalizePlaybackHandoffState,
    type PlaybackHandoffError,
    type PlaybackHandoffRequest,
    type PlaybackHandoffSnapshot,
    type PlaybackHandoffStatus
} from '~/socket/playback-handoff-contract';
import {
    beginPlaybackControllerCommandBarrier,
    endPlaybackControllerCommandBarrier
} from '~/modules/playback-command-barrier';
import {
    PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
} from '~/modules/playback-controller';
import { nextPlaybackEndpointSequence } from '~/modules/playback-device';
import {
    type PlaybackEndpointRegistrationState,
    playbackEndpointRegistration
} from '~/socket/playback-endpoint';
import {
    playbackHandoffController,
    playbackHandoffSourceTarget
} from '~/socket/playback-handoff';
import { socket } from '~/socket/socket';

import { BaseStore } from './base-store';
import { musicStore } from './music';
import { playbackDevicesStore, resolveActivePlaybackTarget } from './playback-devices';
import { playbackQueueStore } from './playback-queue';
import { playbackSessionStore } from './playback-session';
import { queueStore } from './queue';

const HANDOFF_STATUS_RECOVERY_DELAY_MS = 1_000;
const HANDOFF_NONTERMINAL_RECOVERY_DELAY_MS = 20_000;
const HANDOFF_STATUS_RECOVERY_WINDOW_MS = 60_000;

export type PlaybackHandoffUiPhase =
    | 'idle'
    | 'preparing'
    | 'releasing'
    | 'claiming'
    | 'activating'
    | 'recovering'
    | 'reconciling'
    | 'completed'
    | 'rolled_back'
    | 'rejected'
    | 'timed_out'
    | 'recovery_required';

interface PlaybackHandoffStoreState {
    handoffId: string | null;
    sourceEndpointId: string | null;
    sourceDeviceName: string | null;
    targetEndpointId: string | null;
    targetDeviceName: string | null;
    phase: PlaybackHandoffUiPhase;
    message: string | null;
    error: PlaybackHandoffError | null;
    forceAvailable: boolean;
    retryAvailable: boolean;
    resumeAvailable: boolean;
}

type PreparedPlaybackHandoffRequest = Omit<
    PlaybackHandoffRequest,
    'targetClaimSequence'
> & {
    targetClaimSequence: number | null;
};

interface PendingPlaybackHandoff {
    request: PreparedPlaybackHandoffRequest;
    sourceDeviceName: string;
    targetDeviceName: string;
    requestedState: PlaybackHandoffSnapshot['state'];
    controlLossObserved: boolean;
    startedAtMs: number;
    requestStarted: boolean;
}

type PlaybackHandoffContext =
    | {
        type: 'ready';
        registration: PlaybackEndpointRegistrationState;
        request: PreparedPlaybackHandoffRequest;
        snapshot: PlaybackHandoffSnapshot;
        sourceDeviceName: string;
        targetDeviceName: string;
      }
    | {
        type: 'error';
        sourceEndpointId: string | null;
        sourceDeviceName: string | null;
        targetEndpointId: string | null;
        targetDeviceName: string | null;
        error: PlaybackHandoffError;
      };

const initialState = (): PlaybackHandoffStoreState => ({
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

const handoffError = (
    code: PlaybackHandoffError['code'],
    message: string,
    retryable = false,
    forceAllowed = false
): PlaybackHandoffError => ({ code, message, retryable, forceAllowed });

export const isPlaybackHandoffPending = (phase: PlaybackHandoffUiPhase) => [
    'preparing',
    'releasing',
    'claiming',
    'activating',
    'recovering',
    'reconciling'
].includes(phase);

export class PlaybackHandoffStore extends BaseStore<PlaybackHandoffStoreState> {
    private connected = false;
    private pending: PendingPlaybackHandoff | null = null;
    private registration: PlaybackEndpointRegistrationState | null = null;
    private unsubscribeRegistration: (() => void) | null = null;
    private unsubscribeStatus: (() => void) | null = null;
    private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    private controlLossSilenced = false;
    private terminalStatusAwaitingIdentity: PlaybackHandoffStatus | null = null;
    private failClosedAwaitingIdentity = false;
    private resumeAttempt: symbol | null = null;
    private readonly mutationBarrier = Symbol('playback-handoff-controller');

    constructor() {
        super();
        this.state = initialState();
    }

    connect() {
        if (this.connected) {
            return;
        }

        this.connected = true;
        this.unsubscribeStatus = playbackHandoffController.subscribe(
            this.handleStatus
        );
        playbackHandoffController.connect({
            activate: dispatch => queueStore.activatePlaybackHandoff(dispatch),
            abort: () => queueStore.abortPlaybackHandoffTarget(true)
        });
        playbackHandoffSourceTarget.connect({
            prepareRelease: dispatch => (
                queueStore.preparePlaybackHandoffRelease(dispatch)
            ),
            release: dispatch => queueStore.releasePlaybackHandoff(dispatch),
            settle: dispatch => queueStore.settlePlaybackHandoffSource(dispatch),
            recover: dispatch => queueStore.recoverPlaybackHandoffSource(dispatch),
            abandon: () => queueStore.abandonPlaybackHandoffSource(),
            flushBufferedReport: () => {
                void playbackSessionStore.flushBufferedReport();
            }
        });
        this.registration = playbackEndpointRegistration.current;
        this.unsubscribeRegistration = playbackEndpointRegistration.subscribe(
            this.handleRegistrationChanged
        );
        socket.on('connect', this.handleSocketConnect);
        socket.on('disconnect', this.handleSocketDisconnect);
    }

    disconnect() {
        if (!this.connected) {
            return;
        }

        this.connected = false;
        this.unsubscribeRegistration?.();
        this.unsubscribeRegistration = null;
        this.unsubscribeStatus?.();
        this.unsubscribeStatus = null;
        playbackHandoffSourceTarget.disconnect();
        playbackHandoffController.disconnect();
        socket.off('connect', this.handleSocketConnect);
        socket.off('disconnect', this.handleSocketDisconnect);
        this.clearRecoveryTimer();
        queueStore.finishPlaybackHandoffTarget(false);
        this.releaseMutationBarrier();
        this.pending = null;
        this.registration = null;
        this.controlLossSilenced = false;
        this.terminalStatusAwaitingIdentity = null;
        this.failClosedAwaitingIdentity = false;
        this.resumeAttempt = null;
        this.state = initialState();
    }

    async playHere(force = false) {
        if (this.pending) {
            if (this.failClosedAwaitingIdentity) {
                return this.retryFailClosedRecovery(this.pending);
            }
            return false;
        }
        if (isPlaybackHandoffPending(this.state.phase)) {
            return false;
        }

        this.clearRecoveryTimer();
        this.terminalStatusAwaitingIdentity = null;
        this.failClosedAwaitingIdentity = false;
        const context = this.resolveContext(force);
        if (context.type === 'error') {
            this.pending = null;
            this.set({
                handoffId: null,
                sourceEndpointId: context.sourceEndpointId,
                sourceDeviceName: context.sourceDeviceName,
                targetEndpointId: context.targetEndpointId,
                targetDeviceName: context.targetDeviceName,
                phase: 'rejected',
                message: context.error.message,
                error: context.error,
                forceAvailable: context.error.forceAllowed,
                retryAvailable: context.error.retryable,
                resumeAvailable: false
            });
            return false;
        }

        if (!beginPlaybackControllerCommandBarrier(this.mutationBarrier)) {
            const error = handoffError(
                'HANDOFF_IN_PROGRESS',
                'Another playback transition is already in progress.',
                true
            );
            this.set({
                phase: 'rejected',
                message: error.message,
                error,
                forceAvailable: false,
                retryAvailable: true,
                resumeAvailable: false
            });
            return false;
        }

        const pending: PendingPlaybackHandoff = {
            request: context.request,
            sourceDeviceName: context.sourceDeviceName,
            targetDeviceName: context.targetDeviceName,
            requestedState: context.snapshot.state,
            controlLossObserved: false,
            startedAtMs: Date.now(),
            requestStarted: false
        };
        this.pending = pending;
        this.set({
            handoffId: context.request.handoffId,
            sourceEndpointId: context.request.sourceEndpointId,
            sourceDeviceName: context.sourceDeviceName,
            targetEndpointId: context.request.targetEndpointId,
            targetDeviceName: context.targetDeviceName,
            phase: 'preparing',
            message: `Preparing ${context.targetDeviceName} without interrupting ${context.sourceDeviceName}…`,
            error: null,
            forceAvailable: false,
            retryAvailable: false,
            resumeAvailable: false
        });

        // primePlaybackHandoff invokes media playback before its first await so
        // this Play Here click remains the browser autoplay gesture.
        const prepared = await queueStore.primePlaybackHandoff(context.snapshot);
        if (this.pending !== pending) {
            return false;
        }
        if (prepared.status === 'rejected') {
            this.finishLocally('rejected', prepared.error);
            return false;
        }

        return this.request(pending);
    }

    retry() {
        if (!this.state.retryAvailable || isPlaybackHandoffPending(this.state.phase)) {
            return Promise.resolve(false);
        }

        if (this.pending && this.failClosedAwaitingIdentity) {
            return this.retryFailClosedRecovery(this.pending);
        }

        return this.playHere(false);
    }

    forcePlayHere() {
        if (!this.state.forceAvailable || isPlaybackHandoffPending(this.state.phase)) {
            return Promise.resolve(false);
        }

        return this.playHere(true);
    }

    async resumeHere() {
        if (
            !this.state.resumeAvailable
            || isPlaybackHandoffPending(this.state.phase)
            || this.resumeAttempt
        ) {
            return false;
        }

        const attempt = Symbol('playback-handoff-resume');
        this.resumeAttempt = attempt;
        try {
            const targetEndpointId = this.state.targetEndpointId;
            const registration = this.registration;
            if (
                !targetEndpointId
                || registration?.endpointId !== targetEndpointId
                || playbackSessionStore.endpointId !== targetEndpointId
            ) {
                this.failResumeForControlChange();
                return false;
            }

            const resumed = await queueStore.resumePlaybackHandoffHere();
            const attemptIsCurrent = this.resumeAttempt === attempt
                && this.state.phase === 'recovery_required'
                && this.state.resumeAvailable
                && this.state.targetEndpointId === targetEndpointId
                && this.registrationMatches(this.registration, registration)
                && playbackSessionStore.endpointId === targetEndpointId;
            if (!attemptIsCurrent) {
                queueStore.silencePlaybackForSocketDisconnect(targetEndpointId);
                if (
                    this.state.phase === 'recovery_required'
                    && this.state.resumeAvailable
                    && this.state.targetEndpointId === targetEndpointId
                ) {
                    this.failResumeForControlChange();
                }
                return false;
            }

            if (!resumed) {
                const error = handoffError(
                    'AUTOPLAY_BLOCKED',
                    'Playback could not resume here. Use Resume here to try the gesture again.',
                    true
                );
                this.set({
                    message: error.message,
                    error,
                    retryAvailable: false,
                    resumeAvailable: true
                });
                return false;
            }

            this.set({
                phase: 'completed',
                message: 'Playback resumed on this browser.',
                error: null,
                forceAvailable: false,
                retryAvailable: false,
                resumeAvailable: false
            });
            return true;
        } finally {
            if (this.resumeAttempt === attempt) {
                this.resumeAttempt = null;
            }
        }
    }

    dismiss() {
        if (isPlaybackHandoffPending(this.state.phase)) {
            return;
        }

        this.state = initialState();
    }

    private async request(pending: PendingPlaybackHandoff): Promise<boolean> {
        if (!this.hasCurrentTargetRegistration(pending)) {
            this.handleControlLoss(
                'Playback endpoint registration is unavailable. Waiting to recover the exact handoff outcome…',
                true
            );
            return this.pending === pending;
        }

        if (pending.request.targetClaimSequence === null) {
            pending.request.targetClaimSequence = nextPlaybackEndpointSequence();
        }
        pending.requestStarted = true;
        const request: PlaybackHandoffRequest = {
            ...pending.request,
            targetClaimSequence: pending.request.targetClaimSequence
        };
        const result = await playbackHandoffController.request(request);
        if (this.pending !== pending) {
            return false;
        }
        if (this.state.phase === 'reconciling') {
            return true;
        }

        if (result.type === 'transport-error') {
            if (
                Date.now() - pending.startedAtMs
                >= HANDOFF_STATUS_RECOVERY_WINDOW_MS
            ) {
                const registration = this.registration;
                if (registration) {
                    this.beginControlIdentityReconciliation(pending, registration);
                } else {
                    this.enterFailClosedIdentityTimeout(pending, result.error);
                }
                return true;
            }

            this.set({
                phase: 'recovering',
                message: 'The handoff acknowledgement is delayed. Recovering the exact server outcome…',
                error: null
            });
            this.recoveryTimer = setTimeout(() => {
                this.recoveryTimer = null;
                if (this.pending === pending) {
                    void this.request(pending);
                }
            }, HANDOFF_STATUS_RECOVERY_DELAY_MS);
            return true;
        }

        const acknowledgement = result.acknowledgement;
        if (!this.statusMatchesPending(acknowledgement, pending)) {
            this.finishLocally('rejected', handoffError(
                'INVALID_HANDOFF',
                'The handoff acknowledgement did not match this request.'
            ));
            return false;
        }

        this.applyStatus(acknowledgement);
        return !['rejected', 'timed_out', 'rolled_back'].includes(
            acknowledgement.phase
        );
    }

    private handleStatus = (status: PlaybackHandoffStatus) => {
        const pending = this.pending;
        if (!pending || !this.statusMatchesPending(status, pending)) {
            return;
        }

        this.applyStatus(status);
    };

    private handleRegistrationChanged = (
        registration: PlaybackEndpointRegistrationState | null
    ) => {
        const previous = this.registration;
        const registrationChanged = previous !== null && (
            !registration
            || previous.endpointId !== registration.endpointId
            || previous.registrationGeneration
                !== registration.registrationGeneration
            || previous.commandEpoch !== registration.commandEpoch
            || previous.registrationProof !== registration.registrationProof
        );
        this.registration = registration;

        if (registrationChanged) {
            this.handleControlLoss(
                'Playback endpoint registration was lost. Waiting to recover the exact handoff outcome…',
                true
            );
            if (!this.pending && this.state.resumeAvailable) {
                this.failResumeForControlChange();
            }
        }

        if (!registration) {
            return;
        }

        const shouldRecoverPending = this.controlLossSilenced;
        this.controlLossSilenced = false;
        const pending = this.pending;
        if (
            shouldRecoverPending
            && pending?.requestStarted
            && (
                isPlaybackHandoffPending(this.state.phase)
                || this.failClosedAwaitingIdentity
            )
        ) {
            this.restorePendingUiIdentity(pending);
            this.failClosedAwaitingIdentity = false;
            if (this.hasCurrentTargetRegistration(pending)) {
                this.clearRecoveryTimer();
                const terminalStatus = this.terminalStatusAwaitingIdentity;
                if (
                    terminalStatus
                    && this.statusMatchesPending(terminalStatus, pending)
                ) {
                    this.beginTerminalReconciliation(pending, terminalStatus);
                } else {
                    void this.request(pending);
                }
            } else {
                this.beginControlIdentityReconciliation(pending, registration);
            }
        }
    };

    private handleSocketDisconnect = () => {
        this.handleControlLoss(
            'Playback control disconnected. Waiting to recover the exact handoff outcome…'
        );
    };

    private handleControlLoss(message: string, scheduleRecovery = false) {
        this.silenceForControlLoss();
        const pending = this.pending;
        if (!pending || !isPlaybackHandoffPending(this.state.phase)) {
            return;
        }

        if (!pending.requestStarted) {
            this.finishLocally('rejected', handoffError(
                'CLAIM_FAILED',
                'Playback control was lost before the handoff request was sent.',
                true
            ));
            return;
        }

        // A target that has started but not yet committed must stop immediately;
        // the server will either roll ownership back or retain a paused target.
        this.clearRecoveryTimer();
        this.set({
            phase: 'recovering',
            message,
            error: null
        });
        if (scheduleRecovery) {
            this.scheduleStatusRecovery(pending);
        }
    }

    private silenceForControlLoss() {
        if (this.pending?.requestStarted) {
            this.pending.controlLossObserved = true;
        }
        if (this.controlLossSilenced) {
            return;
        }

        this.controlLossSilenced = true;
        const pending = this.pending;
        const pendingTargetMayOwnPlayback = pending && [
            'claiming',
            'activating',
            'recovering',
            'reconciling'
        ].includes(this.state.phase);
        const completedTargetMayOwnPlayback = !pending && [
            'completed',
            'recovery_required'
        ].includes(this.state.phase);
        const targetMayOwnPlayback = pendingTargetMayOwnPlayback
            ? pending.request.targetEndpointId
            : completedTargetMayOwnPlayback
                ? this.state.targetEndpointId
                : null;
        queueStore.silencePlaybackForSocketDisconnect(targetMayOwnPlayback);
    }

    private handleSocketConnect = () => {
        const pending = this.pending;
        if (
            !pending
            || !pending.requestStarted
            || (
                !isPlaybackHandoffPending(this.state.phase)
                && !this.failClosedAwaitingIdentity
            )
            || !this.hasCurrentTargetRegistration(pending)
        ) {
            return;
        }

        this.failClosedAwaitingIdentity = false;
        this.clearRecoveryTimer();
        this.restorePendingUiIdentity(pending);
        const terminalStatus = this.terminalStatusAwaitingIdentity;
        if (terminalStatus && this.statusMatchesPending(terminalStatus, pending)) {
            this.beginTerminalReconciliation(pending, terminalStatus);
        } else {
            this.set({
                phase: 'recovering',
                message: 'Checking the exact handoff outcome with the server…',
                error: null,
                retryAvailable: false
            });
            void this.request(pending);
        }
    };

    private beginControlIdentityReconciliation(
        pending: PendingPlaybackHandoff,
        registration: PlaybackEndpointRegistrationState
    ) {
        this.clearRecoveryTimer();
        this.failClosedAwaitingIdentity = false;
        this.terminalStatusAwaitingIdentity = null;
        queueStore.finishPlaybackHandoffTarget(false);
        this.set({
            ...this.pendingUiIdentity(pending),
            phase: 'reconciling',
            message: 'Playback control changed. Confirming the authoritative safe state…',
            error: null
        });
        void this.reconcileControlIdentityChange(pending, registration);
    }

    private async reconcileControlIdentityChange(
        pending: PendingPlaybackHandoff,
        registration: PlaybackEndpointRegistrationState
    ) {
        await playbackSessionStore.flushBufferedReport(
            PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
        );
        const [sessionResult] = await Promise.allSettled([
            playbackSessionStore.refresh(PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS),
            playbackQueueStore.refresh(PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS),
            playbackDevicesStore.refresh(PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS)
        ]);
        if (
            this.pending !== pending
            || this.state.phase !== 'reconciling'
            || !this.registrationMatches(this.registration, registration)
        ) {
            return;
        }

        if (
            sessionResult.status !== 'fulfilled'
            || sessionResult.value.type !== 'success'
        ) {
            this.enterFailClosedIdentityTimeout(pending, handoffError(
                'ACTIVATION_TIMEOUT',
                'The authoritative playback state is unavailable. Local playback remains paused.',
                true
            ));
            return;
        }

        this.releaseMutationBarrier();
        this.pending = null;
        this.failClosedAwaitingIdentity = false;
        this.terminalStatusAwaitingIdentity = null;
        const session = sessionResult.value.snapshot;
        if (
            session?.activeDeviceId === registration.endpointId
            && session.state === 'paused'
            && playbackSessionStore.endpointId === registration.endpointId
        ) {
            const error = handoffError(
                'RECOVERY_REQUIRED',
                'Playback control changed during handoff. Playback is safely paused here.',
                true
            );
            this.set({
                phase: 'recovery_required',
                message: error.message,
                error,
                forceAvailable: false,
                retryAvailable: false,
                resumeAvailable: true
            });
            return;
        }

        if (session?.activeDeviceId === pending.request.sourceEndpointId) {
            this.set({
                phase: 'rolled_back',
                message: `Playback control changed during handoff. Playback remains safely on ${pending.sourceDeviceName}.`,
                error: null,
                forceAvailable: false,
                retryAvailable: true,
                resumeAvailable: false
            });
            return;
        }

        const error = handoffError(
            'ACTIVATION_TIMEOUT',
            'Playback control changed before the handoff outcome could be recovered. Local playback remains paused.',
            true
        );
        this.set({
            phase: 'timed_out',
            message: error.message,
            error,
            forceAvailable: false,
            retryAvailable: true,
            resumeAvailable: false
        });
    }

    private applyStatus(status: PlaybackHandoffStatus) {
        const pending = this.pending;
        if (!pending) {
            return;
        }

        const source = pending.sourceDeviceName;
        const target = pending.targetDeviceName;
        const phase = status.phase;
        if (this.state.phase === 'reconciling') {
            return;
        }
        if (phase === 'accepted' || phase === 'releasing') {
            if (!this.hasCurrentTargetRegistration(pending)) {
                return;
            }
            if (['claiming', 'activating'].includes(this.state.phase)) {
                return;
            }
            this.set({
                phase: 'releasing',
                message: `Waiting for ${source} to stop and release playback…`,
                error: null
            });
            this.scheduleStatusRecovery(pending);
            return;
        }
        if (phase === 'claiming') {
            if (!this.hasCurrentTargetRegistration(pending)) {
                return;
            }
            if (this.state.phase === 'activating') {
                return;
            }
            this.set({
                phase: 'claiming',
                message: `Claiming the released playback revision for ${target}…`,
                error: null
            });
            this.scheduleStatusRecovery(pending);
            return;
        }
        if (phase === 'activating') {
            if (!this.hasCurrentTargetRegistration(pending)) {
                return;
            }
            this.set({
                phase: 'activating',
                message: `Continuing playback on ${target}…`,
                error: null
            });
            this.scheduleStatusRecovery(pending);
            return;
        }

        this.beginTerminalReconciliation(pending, status);
    }

    private beginTerminalReconciliation(
        pending: PendingPlaybackHandoff,
        status: PlaybackHandoffStatus
    ) {
        this.terminalStatusAwaitingIdentity = status;
        this.failClosedAwaitingIdentity = false;
        this.clearRecoveryTimer();
        queueStore.finishPlaybackHandoffTarget(status.phase === 'completed');
        this.set({
            ...this.pendingUiIdentity(pending),
            phase: 'reconciling',
            message: status.phase === 'completed'
                ? 'Playback moved here. Confirming the authoritative state…'
                : 'Confirming the safe playback state after handoff…',
            error: status.error
        });

        if (!this.hasCurrentTargetRegistration(pending)) {
            this.scheduleTerminalIdentityTimeout(pending);
            return;
        }

        void this.reconcileTerminal(status);
    }

    private async reconcileTerminal(status: PlaybackHandoffStatus) {
        const pending = this.pending;
        if (!pending) {
            return;
        }

        await playbackSessionStore.flushBufferedReport(
            PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
        );
        const [sessionResult] = await Promise.allSettled([
            playbackSessionStore.refresh(PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS),
            playbackQueueStore.refresh(PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS),
            playbackDevicesStore.refresh(PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS)
        ]);
        if (
            this.pending !== pending
            || this.state.phase !== 'reconciling'
            || this.terminalStatusAwaitingIdentity !== status
            || !this.hasCurrentTargetRegistration(pending)
        ) {
            return;
        }

        if (
            sessionResult.status !== 'fulfilled'
            || sessionResult.value.type !== 'success'
        ) {
            this.enterFailClosedIdentityTimeout(pending, handoffError(
                'ACTIVATION_TIMEOUT',
                'The authoritative playback state is unavailable. Local playback remains paused.',
                true
            ));
            return;
        }

        this.releaseMutationBarrier();
        this.pending = null;
        this.failClosedAwaitingIdentity = false;
        this.terminalStatusAwaitingIdentity = null;
        const error = status.error;
        if (status.phase === 'completed') {
            if (
                pending.requestedState === 'playing'
                && pending.controlLossObserved
            ) {
                if (this.canResumePendingTarget(pending)) {
                    const recoveryError = handoffError(
                        'RECOVERY_REQUIRED',
                        'Playback moved here but control was interrupted. Playback is safely paused.',
                        true
                    );
                    this.set({
                        phase: 'recovery_required',
                        message: recoveryError.message,
                        error: recoveryError,
                        forceAvailable: false,
                        retryAvailable: false,
                        resumeAvailable: true
                    });
                } else {
                    const recoveryError = handoffError(
                        'ACTIVATION_TIMEOUT',
                        'Playback moved here while control was interrupted. Local playback remains paused.',
                        true
                    );
                    this.set({
                        phase: 'timed_out',
                        message: recoveryError.message,
                        error: recoveryError,
                        forceAvailable: false,
                        retryAvailable: true,
                        resumeAvailable: false
                    });
                }
                return;
            }

            this.set({
                phase: 'completed',
                message: `Playback moved from ${pending.sourceDeviceName} to ${pending.targetDeviceName}.`,
                error: null,
                forceAvailable: false,
                retryAvailable: false,
                resumeAvailable: false
            });
            return;
        }

        if (status.phase === 'rolled_back') {
            this.set({
                phase: 'rolled_back',
                message: `${error?.message ?? 'Playback could not start here.'} Playback returned safely to ${pending.sourceDeviceName}.`,
                error,
                forceAvailable: false,
                retryAvailable: error?.retryable ?? true,
                resumeAvailable: false
            });
            return;
        }

        if (status.phase === 'recovery_required') {
            const ownsPausedPlayback = this.canResumePendingTarget(pending);
            this.set({
                phase: 'recovery_required',
                message: error?.message
                    ?? 'Playback is safely paused here and requires an explicit resume.',
                error,
                forceAvailable: false,
                retryAvailable: false,
                resumeAvailable: ownsPausedPlayback
            });
            return;
        }

        const ownsPausedPlayback = this.canResumePendingTarget(pending);
        if (ownsPausedPlayback) {
            this.set({
                phase: 'recovery_required',
                message: `${error?.message ?? 'The handoff outcome was interrupted.'} Playback is safely paused on this browser.`,
                error: error ?? handoffError(
                    'RECOVERY_REQUIRED',
                    'Playback is safely paused on this browser.',
                    true
                ),
                forceAvailable: false,
                retryAvailable: false,
                resumeAvailable: true
            });
            return;
        }

        this.set({
            phase: status.phase as Extract<PlaybackHandoffUiPhase,
                'rejected' | 'timed_out'>,
            message: error?.message ?? 'Playback handoff did not complete.',
            error,
            forceAvailable: error?.forceAllowed ?? false,
            retryAvailable: error?.retryable ?? false,
            resumeAvailable: false
        });
    }

    private finishLocally(
        phase: 'rejected' | 'timed_out',
        error: PlaybackHandoffError
    ) {
        this.clearRecoveryTimer();
        if (this.pending?.requestStarted) {
            queueStore.silencePlaybackForSocketDisconnect(
                this.pending.request.targetEndpointId
            );
        } else {
            queueStore.finishPlaybackHandoffTarget(false);
        }
        this.releaseMutationBarrier();
        this.pending = null;
        this.failClosedAwaitingIdentity = false;
        this.terminalStatusAwaitingIdentity = null;
        this.set({
            phase,
            message: error.message,
            error,
            forceAvailable: error.forceAllowed,
            retryAvailable: error.retryable,
            resumeAvailable: false
        });
    }

    private resolveContext(force: boolean): PlaybackHandoffContext {
        const registration = playbackEndpointRegistration.current;
        const session = playbackSessionStore.state.snapshot;
        const queue = playbackQueueStore.state.snapshot;
        const registry = playbackDevicesStore.state.registry;
        const source = resolveActivePlaybackTarget(registry);
        const target = registry?.devices.flatMap(device => (
            device.endpoints.map(endpoint => ({ device, endpoint }))
        )).find(candidate => candidate.endpoint.id === registration?.endpointId) ?? null;
        const sourceEndpointId = source?.endpoint.id ?? session?.activeDeviceId ?? null;
        const sourceDeviceName = source?.device.name ?? 'the active player';
        const targetEndpointId = registration?.endpointId ?? null;
        const targetDeviceName = target?.device.name ?? 'this browser';
        const localFailure = (
            error: PlaybackHandoffError
        ): PlaybackHandoffContext => ({
            type: 'error',
            sourceEndpointId,
            sourceDeviceName,
            targetEndpointId,
            targetDeviceName,
            error
        });

        if (
            !registration
            || !registry
            || registry.commandEpoch !== registration.commandEpoch
            || !target
            || playbackSessionStore.endpointId !== registration.endpointId
        ) {
            return localFailure(handoffError(
                'UNAUTHORIZED_HANDOFF',
                'This browser is reconnecting to playback control.',
                true
            ));
        }

        if (!session || !source || session.activeDeviceId !== source.endpoint.id) {
            return localFailure(handoffError(
                'SOURCE_NOT_ACTIVE',
                'The active playback device changed. Refresh the device list and try again.',
                true
            ));
        }

        if (source.endpoint.id === registration.endpointId) {
            return localFailure(handoffError(
                'TARGET_ALREADY_ACTIVE',
                'Playback is already active in this browser.'
            ));
        }

        if (
            !source.endpoint.capabilities.includes('handoff')
            || !target.endpoint.capabilities.includes('handoff')
        ) {
            return localFailure(handoffError(
                'UNSUPPORTED_HANDOFF',
                'Both browsers must reconnect before Play Here is available.',
                true
            ));
        }

        const handoffState = normalizePlaybackHandoffState(session.state);
        if (
            !handoffState
            || !session.currentMusicId
        ) {
            return localFailure(handoffError(
                'MEDIA_UNAVAILABLE',
                'Play Here requires a current playback item.'
            ));
        }

        if (
            !queue
            || queue.currentIndex === null
            || queue.musicIds[queue.currentIndex] !== session.currentMusicId
        ) {
            return localFailure(handoffError(
                'QUEUE_UNAVAILABLE',
                'The authoritative playback queue is not ready for transfer.',
                true
            ));
        }

        if (force && source.endpoint.online) {
            return localFailure(handoffError(
                'SOURCE_STILL_ONLINE',
                'The source is online again. Retry the normal Play Here flow.',
                true
            ));
        }

        const music = musicStore.state.musicMap.get(session.currentMusicId);
        const elapsedMs = session.state === 'playing'
            ? Math.max(Date.now() - playbackSessionStore.state.receivedAtMs, 0)
            : 0;
        const durationMs = music
            ? Math.max(Math.round(music.duration * 1_000), 0)
            : Number.MAX_SAFE_INTEGER;
        const positionMs = Math.min(
            Math.max(Math.round(session.positionMs + elapsedMs), 0),
            durationMs
        );
        const handoffId = createUuid();
        const snapshot: PlaybackHandoffSnapshot = {
            sessionRevision: session.revision,
            queueRevision: queue.revision,
            state: handoffState,
            currentMusicId: session.currentMusicId,
            currentIndex: queue.currentIndex,
            positionMs,
            queue: {
                ...queue,
                currentIndex: queue.currentIndex
            }
        };

        return {
            type: 'ready',
            registration,
            sourceDeviceName,
            targetDeviceName,
            snapshot,
            request: {
                protocolVersion: 1,
                commandEpoch: registration.commandEpoch,
                handoffId,
                sourceEndpointId: source.endpoint.id,
                targetEndpointId: registration.endpointId,
                expectedSessionRevision: session.revision,
                expectedQueueRevision: queue.revision,
                targetClaimSequence: null,
                force
            }
        };
    }

    private statusMatchesPending(
        status: PlaybackHandoffStatus,
        pending: PendingPlaybackHandoff
    ) {
        return status.commandEpoch === pending.request.commandEpoch
            && status.handoffId === pending.request.handoffId
            && status.sourceEndpointId === pending.request.sourceEndpointId
            && status.targetEndpointId === pending.request.targetEndpointId;
    }

    private hasCurrentTargetRegistration(pending: PendingPlaybackHandoff) {
        return this.registration?.endpointId === pending.request.targetEndpointId
            && this.registration.commandEpoch === pending.request.commandEpoch;
    }

    private canResumePendingTarget(pending: PendingPlaybackHandoff) {
        return this.hasCurrentTargetRegistration(pending)
            && playbackSessionStore.endpointId === pending.request.targetEndpointId
            && playbackSessionStore.state.snapshot?.activeDeviceId
                === pending.request.targetEndpointId
            && playbackSessionStore.state.snapshot.state === 'paused';
    }

    private failResumeForControlChange() {
        const error = handoffError(
            'RECOVERY_REQUIRED',
            'Playback control changed before resume. Refresh the target and try Play Here again.',
            true
        );
        this.set({
            phase: 'timed_out',
            message: error.message,
            error,
            forceAvailable: false,
            retryAvailable: true,
            resumeAvailable: false
        });
    }

    private pendingUiIdentity(pending: PendingPlaybackHandoff) {
        return {
            handoffId: pending.request.handoffId,
            sourceEndpointId: pending.request.sourceEndpointId,
            sourceDeviceName: pending.sourceDeviceName,
            targetEndpointId: pending.request.targetEndpointId,
            targetDeviceName: pending.targetDeviceName
        };
    }

    private restorePendingUiIdentity(pending: PendingPlaybackHandoff) {
        this.set(this.pendingUiIdentity(pending));
    }

    private retryFailClosedRecovery(
        pending: PendingPlaybackHandoff
    ): Promise<boolean> {
        if (this.pending !== pending || !this.failClosedAwaitingIdentity) {
            return Promise.resolve(false);
        }

        this.restorePendingUiIdentity(pending);
        const registration = this.registration;
        if (!registration) {
            this.enterFailClosedIdentityTimeout(pending, handoffError(
                'ACTIVATION_TIMEOUT',
                'Playback control is still unavailable. Local playback remains paused.',
                true
            ));
            return Promise.resolve(false);
        }

        this.failClosedAwaitingIdentity = false;
        this.clearRecoveryTimer();
        if (!this.hasCurrentTargetRegistration(pending)) {
            this.beginControlIdentityReconciliation(pending, registration);
            return Promise.resolve(true);
        }

        const terminalStatus = this.terminalStatusAwaitingIdentity;
        if (terminalStatus && this.statusMatchesPending(terminalStatus, pending)) {
            this.beginTerminalReconciliation(pending, terminalStatus);
            return Promise.resolve(true);
        }

        this.set({
            phase: 'recovering',
            message: 'Checking the exact handoff outcome with the server…',
            error: null,
            forceAvailable: false,
            retryAvailable: false,
            resumeAvailable: false
        });
        return this.request(pending);
    }

    private scheduleTerminalIdentityTimeout(pending: PendingPlaybackHandoff) {
        this.clearRecoveryTimer();
        const remainingMs = Math.max(
            HANDOFF_STATUS_RECOVERY_WINDOW_MS
                - (Date.now() - pending.startedAtMs),
            0
        );
        if (remainingMs === 0) {
            this.enterFailClosedIdentityTimeout(pending, handoffError(
                'ACTIVATION_TIMEOUT',
                'Playback control did not reconnect in time. Local playback remains paused.',
                true
            ));
            return;
        }

        this.recoveryTimer = setTimeout(() => {
            this.recoveryTimer = null;
            if (this.pending !== pending) {
                return;
            }

            const registration = this.registration;
            if (!registration) {
                this.enterFailClosedIdentityTimeout(pending, handoffError(
                    'ACTIVATION_TIMEOUT',
                    'Playback control did not reconnect in time. Local playback remains paused.',
                    true
                ));
                return;
            }

            if (this.hasCurrentTargetRegistration(pending)) {
                const terminalStatus = this.terminalStatusAwaitingIdentity;
                if (terminalStatus) {
                    this.beginTerminalReconciliation(pending, terminalStatus);
                } else {
                    this.beginControlIdentityReconciliation(pending, registration);
                }
            } else {
                this.beginControlIdentityReconciliation(pending, registration);
            }
        }, remainingMs);
    }

    private enterFailClosedIdentityTimeout(
        pending: PendingPlaybackHandoff,
        error: PlaybackHandoffError
    ) {
        if (this.pending !== pending) {
            return;
        }

        this.clearRecoveryTimer();
        this.failClosedAwaitingIdentity = true;
        pending.controlLossObserved = true;
        queueStore.silencePlaybackForSocketDisconnect(
            pending.request.targetEndpointId
        );
        this.set({
            ...this.pendingUiIdentity(pending),
            phase: 'timed_out',
            message: error.message,
            error,
            forceAvailable: false,
            retryAvailable: true,
            resumeAvailable: false
        });
    }

    private registrationMatches(
        current: PlaybackEndpointRegistrationState | null,
        expected: PlaybackEndpointRegistrationState
    ) {
        return current?.endpointId === expected.endpointId
            && current.registrationGeneration === expected.registrationGeneration
            && current.commandEpoch === expected.commandEpoch
            && current.registrationProof === expected.registrationProof;
    }

    private releaseMutationBarrier() {
        endPlaybackControllerCommandBarrier(this.mutationBarrier);
        void playbackSessionStore.flushBufferedReport();
    }

    private scheduleStatusRecovery(pending: PendingPlaybackHandoff) {
        this.clearRecoveryTimer();
        const elapsedMs = Date.now() - pending.startedAtMs;
        if (elapsedMs >= HANDOFF_STATUS_RECOVERY_WINDOW_MS) {
            const registration = this.registration;
            if (registration) {
                this.beginControlIdentityReconciliation(pending, registration);
            } else {
                this.enterFailClosedIdentityTimeout(pending, handoffError(
                    'ACTIVATION_TIMEOUT',
                    'The exact handoff outcome could not be confirmed in time. Local playback remains paused.',
                    true
                ));
            }
            return;
        }

        this.recoveryTimer = setTimeout(() => {
            this.recoveryTimer = null;
            if (this.pending === pending) {
                this.set({
                    phase: 'recovering',
                    message: 'Checking the exact handoff outcome with the server…',
                    error: null
                });
                void this.request(pending);
            }
        }, Math.min(
            HANDOFF_NONTERMINAL_RECOVERY_DELAY_MS,
            HANDOFF_STATUS_RECOVERY_WINDOW_MS - elapsedMs
        ));
    }

    private clearRecoveryTimer() {
        if (!this.recoveryTimer) {
            return;
        }
        clearTimeout(this.recoveryTimer);
        this.recoveryTimer = null;
    }
}

export const playbackHandoffStore = new PlaybackHandoffStore();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        playbackHandoffStore.disconnect();
    });
}
