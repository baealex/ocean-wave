import {
    getPlaybackEndpointSequence
} from '~/modules/playback-device';
import {
    beginPlaybackCommandBarrier,
    endPlaybackCommandBarrier
} from '~/modules/playback-command-barrier';

import {
    HANDOFF_ACTIVATION_TIMEOUT_MS,
    HANDOFF_RELEASE_TIMEOUT_MS,
    HANDOFF_REQUEST_ACK_TIMEOUT_MS,
    HANDOFF_SOURCE_SETTLE_TIMEOUT_MS,
    PLAYBACK_HANDOFF_ABORT_TARGET,
    PLAYBACK_HANDOFF_ACTIVATE,
    PLAYBACK_HANDOFF_RELEASE,
    PLAYBACK_HANDOFF_REQUEST,
    PLAYBACK_HANDOFF_SETTLE_SOURCE,
    PLAYBACK_HANDOFF_STATUS,
    type PlaybackHandoffActivationAck,
    type PlaybackHandoffActivationDispatch,
    type PlaybackHandoffError,
    type PlaybackHandoffHistoryTransfer,
    type PlaybackHandoffErrorCode,
    type PlaybackHandoffReleaseAck,
    type PlaybackHandoffReleaseDispatch,
    type PlaybackHandoffRequest,
    type PlaybackHandoffRequestAck,
    type PlaybackHandoffSourceSettleAck,
    type PlaybackHandoffSourceSettleDispatch,
    type PlaybackHandoffStatus,
    type PlaybackHandoffTargetAbortAck,
    type PlaybackHandoffTargetAbortDispatch
} from './playback-handoff-contract';
import {
    playbackEndpointRegistration,
    type PlaybackEndpointRegistrationState
} from './playback-endpoint';
import { socket } from './socket';

const SOURCE_RECOVERY_TIMEOUT_MS = HANDOFF_RELEASE_TIMEOUT_MS
    + HANDOFF_ACTIVATION_TIMEOUT_MS
    + HANDOFF_SOURCE_SETTLE_TIMEOUT_MS
    + 2_000;

type PlaybackHandoffStatusSubscriber = (status: PlaybackHandoffStatus) => void;

export interface PlaybackHandoffControllerAdapter {
    activate: (dispatch: PlaybackHandoffActivationDispatch) => Promise<
        | { status: 'completed'; endpointSequence: number; positionMs: number }
        | { status: 'rejected'; error: PlaybackHandoffError }
    >;
    abort: (dispatch: PlaybackHandoffTargetAbortDispatch) => void;
}

export interface PlaybackHandoffSourceAdapter {
    prepareRelease: (
        dispatch: PlaybackHandoffReleaseDispatch
    ) => PlaybackHandoffError | null;
    release: (dispatch: PlaybackHandoffReleaseDispatch) => Promise<
        | {
            status: 'released';
            endpointSequence: number;
            positionMs: number;
            playbackHistory: PlaybackHandoffHistoryTransfer | null;
        }
        | { status: 'rejected'; error: PlaybackHandoffError }
    >;
    settle: (dispatch: PlaybackHandoffSourceSettleDispatch) => Promise<
        | { status: 'settled'; endpointSequence: number; positionMs: number }
        | { status: 'rejected'; error: PlaybackHandoffError }
    >;
    recover: (dispatch: PlaybackHandoffReleaseDispatch) => Promise<void>;
    abandon: () => void;
    flushBufferedReport: () => void;
}

interface ActiveSourceHandoff {
    key: string;
    dispatch: PlaybackHandoffReleaseDispatch;
    releaseAck: PlaybackHandoffReleaseAck | null;
    pendingSettle: {
        dispatch: PlaybackHandoffSourceSettleDispatch;
        acknowledge?: (acknowledgement: PlaybackHandoffSourceSettleAck) => void;
    } | null;
    recovering: boolean;
    recoveryDue: boolean;
    timer: ReturnType<typeof setTimeout> | null;
}

const handoffKey = (input: {
    commandEpoch: string;
    handoffId: string;
    handoffSequence: number;
    sourceEndpointId: string;
    sourceRegistrationGeneration: number;
}) => [
    input.commandEpoch,
    input.handoffId,
    input.handoffSequence,
    input.sourceEndpointId,
    input.sourceRegistrationGeneration
].join('\u0000');

const handoffError = (
    code: PlaybackHandoffErrorCode,
    message: string,
    retryable = false,
    forceAllowed = false
): PlaybackHandoffError => ({ code, message, retryable, forceAllowed });

const isStatus = (value: unknown): value is PlaybackHandoffStatus => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffStatus>;
    return candidate.protocolVersion === 1
        && typeof candidate.commandEpoch === 'string'
        && typeof candidate.handoffId === 'string'
        && typeof candidate.sourceEndpointId === 'string'
        && typeof candidate.targetEndpointId === 'string'
        && [
            'accepted',
            'releasing',
            'claiming',
            'activating',
            'completed',
            'rolled_back',
            'rejected',
            'timed_out',
            'recovery_required'
        ].includes(String(candidate.phase));
};

const isReleaseDispatch = (
    value: unknown
): value is PlaybackHandoffReleaseDispatch => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffReleaseDispatch>;
    return candidate.protocolVersion === 1
        && typeof candidate.commandEpoch === 'string'
        && typeof candidate.handoffId === 'string'
        && Number.isSafeInteger(candidate.handoffSequence)
        && Number(candidate.handoffSequence) > 0
        && typeof candidate.sourceEndpointId === 'string'
        && Number.isSafeInteger(candidate.sourceRegistrationGeneration)
        && Number(candidate.sourceRegistrationGeneration) > 0
        && typeof candidate.targetEndpointId === 'string'
        && Number.isSafeInteger(candidate.targetRegistrationGeneration)
        && Number(candidate.targetRegistrationGeneration) > 0
        && Boolean(candidate.snapshot);
};

const isPlaybackHistoryTransfer = (
    value: unknown,
    expectedTrackId: string
) => {
    if (value === null || value === undefined) {
        return true;
    }
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffHistoryTransfer>;
    const startedAt = typeof candidate.startedAt === 'string'
        ? new Date(candidate.startedAt)
        : null;
    const updatedAt = typeof candidate.updatedAt === 'string'
        ? new Date(candidate.updatedAt)
        : null;
    return typeof candidate.clientSessionId === 'string'
        && candidate.clientSessionId.length > 0
        && candidate.clientSessionId.length <= 128
        && typeof candidate.branchId === 'string'
        && candidate.branchId.length > 0
        && candidate.branchId.length <= 128
        && (
            candidate.parentBranchId === null
            || (
                typeof candidate.parentBranchId === 'string'
                && candidate.parentBranchId.length > 0
                && candidate.parentBranchId.length <= 128
                && candidate.parentBranchId !== candidate.branchId
                && candidate.parentBranchId === candidate.clientSessionId
            )
        )
        && Number.isSafeInteger(candidate.branchBasePlayedMs)
        && Number(candidate.branchBasePlayedMs) >= 0
        && (
            candidate.parentBranchId !== null
            || Number(candidate.branchBasePlayedMs) === 0
        )
        && (
            candidate.parentBranchId !== null
            || candidate.branchId === candidate.clientSessionId
        )
        && candidate.trackId === expectedTrackId
        && Boolean(startedAt && !Number.isNaN(startedAt.getTime()))
        && Boolean(updatedAt && !Number.isNaN(updatedAt.getTime()))
        && Boolean(startedAt && updatedAt && startedAt <= updatedAt)
        && Number.isSafeInteger(candidate.accumulatedPlayedMs)
        && Number(candidate.accumulatedPlayedMs) >= 0
        && Number(candidate.accumulatedPlayedMs)
            >= Number(candidate.branchBasePlayedMs)
        && typeof candidate.hadSeek === 'boolean';
};

const isActivationDispatch = (
    value: unknown
): value is PlaybackHandoffActivationDispatch => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffActivationDispatch>;
    return candidate.protocolVersion === 1
        && typeof candidate.commandEpoch === 'string'
        && typeof candidate.handoffId === 'string'
        && Number.isSafeInteger(candidate.handoffSequence)
        && Number(candidate.handoffSequence) > 0
        && typeof candidate.sourceEndpointId === 'string'
        && typeof candidate.targetEndpointId === 'string'
        && Number.isSafeInteger(candidate.targetRegistrationGeneration)
        && Number(candidate.targetRegistrationGeneration) > 0
        && Number.isSafeInteger(candidate.claimSessionRevision)
        && Number(candidate.claimSessionRevision) >= 0
        && Boolean(candidate.snapshot)
        && isPlaybackHistoryTransfer(
            candidate.playbackHistory,
            candidate.snapshot?.currentMusicId ?? ''
        );
};

const isTargetAbortDispatch = (
    value: unknown
): value is PlaybackHandoffTargetAbortDispatch => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffTargetAbortDispatch>;
    return candidate.protocolVersion === 1
        && typeof candidate.commandEpoch === 'string'
        && typeof candidate.handoffId === 'string'
        && Number.isSafeInteger(candidate.handoffSequence)
        && Number(candidate.handoffSequence) > 0
        && typeof candidate.targetEndpointId === 'string'
        && Number.isSafeInteger(candidate.targetRegistrationGeneration)
        && Number(candidate.targetRegistrationGeneration) > 0
        && Boolean(candidate.reason);
};

const isSettleDispatch = (
    value: unknown
): value is PlaybackHandoffSourceSettleDispatch => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffSourceSettleDispatch>;
    return candidate.protocolVersion === 1
        && typeof candidate.commandEpoch === 'string'
        && typeof candidate.handoffId === 'string'
        && Number.isSafeInteger(candidate.handoffSequence)
        && Number(candidate.handoffSequence) > 0
        && typeof candidate.sourceEndpointId === 'string'
        && Number.isSafeInteger(candidate.sourceRegistrationGeneration)
        && Number(candidate.sourceRegistrationGeneration) > 0
        && ['complete', 'cancel', 'restore'].includes(String(candidate.action))
        && Boolean(candidate.snapshot);
};

export class PlaybackHandoffController {
    private adapter: PlaybackHandoffControllerAdapter | null = null;
    private registration: PlaybackEndpointRegistrationState | null = null;
    private unsubscribeRegistration: (() => void) | null = null;
    private readonly subscribers = new Set<PlaybackHandoffStatusSubscriber>();

    connect(adapter: PlaybackHandoffControllerAdapter) {
        if (this.adapter) {
            this.disconnect();
        }

        this.adapter = adapter;
        this.registration = playbackEndpointRegistration.current;
        this.unsubscribeRegistration = playbackEndpointRegistration.subscribe(
            this.handleRegistrationChanged
        );
        socket.on(PLAYBACK_HANDOFF_STATUS, this.handleStatus);
        socket.on(PLAYBACK_HANDOFF_ACTIVATE, this.handleActivate);
        socket.on(PLAYBACK_HANDOFF_ABORT_TARGET, this.handleAbortTarget);
    }

    disconnect() {
        socket.off(PLAYBACK_HANDOFF_STATUS, this.handleStatus);
        socket.off(PLAYBACK_HANDOFF_ACTIVATE, this.handleActivate);
        socket.off(PLAYBACK_HANDOFF_ABORT_TARGET, this.handleAbortTarget);
        this.unsubscribeRegistration?.();
        this.unsubscribeRegistration = null;
        this.registration = null;
        this.adapter = null;
    }

    subscribe(subscriber: PlaybackHandoffStatusSubscriber) {
        this.subscribers.add(subscriber);
        return () => {
            this.subscribers.delete(subscriber);
        };
    }

    request(request: PlaybackHandoffRequest): Promise<
        | { type: 'acknowledged'; acknowledgement: PlaybackHandoffRequestAck }
        | { type: 'transport-error'; error: PlaybackHandoffError }
    > {
        return new Promise((resolve) => {
            socket.timeout(HANDOFF_REQUEST_ACK_TIMEOUT_MS).emit(
                PLAYBACK_HANDOFF_REQUEST,
                request,
                (error: Error | null, acknowledgement?: PlaybackHandoffRequestAck) => {
                    if (error || !acknowledgement || !isStatus(acknowledgement)) {
                        resolve({
                            type: 'transport-error',
                            error: handoffError(
                                'CLAIM_FAILED',
                                'The playback handoff acknowledgement timed out.',
                                true
                            )
                        });
                        return;
                    }

                    resolve({ type: 'acknowledged', acknowledgement });
                }
            );
        });
    }

    private handleRegistrationChanged = (
        registration: PlaybackEndpointRegistrationState | null
    ) => {
        this.registration = registration;
    };

    private handleStatus = (value: unknown) => {
        if (!isStatus(value)) {
            return;
        }

        for (const subscriber of this.subscribers) {
            subscriber(value);
        }
    };

    private handleActivate = async (
        value: unknown,
        acknowledge?: (acknowledgement: PlaybackHandoffActivationAck) => void
    ) => {
        if (typeof acknowledge !== 'function' || !isActivationDispatch(value)) {
            return;
        }

        const dispatch = value;
        const registration = this.registration;
        if (
            !registration
            || registration.commandEpoch !== dispatch.commandEpoch
            || registration.endpointId !== dispatch.targetEndpointId
            || registration.registrationGeneration
                !== dispatch.targetRegistrationGeneration
        ) {
            acknowledge(this.activationRejectedAck(dispatch, handoffError(
                'UNAUTHORIZED_HANDOFF',
                'The activation targets a different endpoint registration.'
            )));
            return;
        }

        if (!this.adapter) {
            acknowledge(this.activationRejectedAck(dispatch, handoffError(
                'MEDIA_NOT_READY',
                'The local playback handoff adapter is unavailable.',
                true
            )));
            return;
        }

        try {
            const result = await this.adapter.activate(dispatch);
            if (result.status === 'rejected') {
                this.adapter.abort({
                    protocolVersion: 1,
                    commandEpoch: dispatch.commandEpoch,
                    handoffId: dispatch.handoffId,
                    handoffSequence: dispatch.handoffSequence,
                    targetEndpointId: dispatch.targetEndpointId,
                    targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                    reason: result.error
                });
                acknowledge(this.activationRejectedAck(dispatch, result.error));
                return;
            }

            acknowledge({
                protocolVersion: 1,
                handoffId: dispatch.handoffId,
                handoffSequence: dispatch.handoffSequence,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                status: 'completed',
                endpointSequence: result.endpointSequence,
                positionMs: result.positionMs
            });
        } catch {
            const error = handoffError(
                'MEDIA_NOT_READY',
                'This browser could not activate the transferred playback item.',
                true
            );
            this.adapter.abort({
                protocolVersion: 1,
                commandEpoch: dispatch.commandEpoch,
                handoffId: dispatch.handoffId,
                handoffSequence: dispatch.handoffSequence,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                reason: error
            });
            acknowledge(this.activationRejectedAck(dispatch, error));
        }
    };

    private handleAbortTarget = (
        value: unknown,
        acknowledge?: (acknowledgement: PlaybackHandoffTargetAbortAck) => void
    ) => {
        if (typeof acknowledge !== 'function' || !isTargetAbortDispatch(value)) {
            return;
        }

        const dispatch = value;
        const registration = this.registration;
        if (
            !registration
            || registration.commandEpoch !== dispatch.commandEpoch
            || registration.endpointId !== dispatch.targetEndpointId
            || registration.registrationGeneration
                !== dispatch.targetRegistrationGeneration
            || !this.adapter
        ) {
            return;
        }

        this.adapter.abort(dispatch);
        acknowledge({
            protocolVersion: 1,
            handoffId: dispatch.handoffId,
            handoffSequence: dispatch.handoffSequence,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            status: 'paused'
        });
    };

    private activationRejectedAck(
        dispatch: PlaybackHandoffActivationDispatch,
        error: PlaybackHandoffError
    ): PlaybackHandoffActivationAck {
        return {
            protocolVersion: 1,
            handoffId: dispatch.handoffId,
            handoffSequence: dispatch.handoffSequence,
            targetEndpointId: dispatch.targetEndpointId,
            targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
            status: 'rejected',
            lastEndpointSequence: getPlaybackEndpointSequence(),
            error
        };
    }
}

export class PlaybackHandoffSourceTarget {
    private adapter: PlaybackHandoffSourceAdapter | null = null;
    private registration: PlaybackEndpointRegistrationState | null = null;
    private unsubscribeRegistration: (() => void) | null = null;
    private active: ActiveSourceHandoff | null = null;

    connect(adapter: PlaybackHandoffSourceAdapter) {
        if (this.adapter) {
            this.disconnect();
        }

        this.adapter = adapter;
        this.registration = playbackEndpointRegistration.current;
        this.unsubscribeRegistration = playbackEndpointRegistration.subscribe(
            this.handleRegistrationChanged
        );
        socket.on(PLAYBACK_HANDOFF_RELEASE, this.handleRelease);
        socket.on(PLAYBACK_HANDOFF_SETTLE_SOURCE, this.handleSettle);
    }

    disconnect() {
        socket.off(PLAYBACK_HANDOFF_RELEASE, this.handleRelease);
        socket.off(PLAYBACK_HANDOFF_SETTLE_SOURCE, this.handleSettle);
        this.unsubscribeRegistration?.();
        this.unsubscribeRegistration = null;
        if (this.active) {
            this.abandonActive(this.active);
        }
        this.registration = null;
        this.adapter = null;
    }

    private handleRegistrationChanged = (
        registration: PlaybackEndpointRegistrationState | null
    ) => {
        this.registration = registration;
        const active = this.active;

        if (!active || !registration) {
            return;
        }

        if (registration.endpointId !== active.dispatch.sourceEndpointId) {
            this.abandonActive(active);
            return;
        }

        if (registration.commandEpoch !== active.dispatch.commandEpoch) {
            if (active.pendingSettle) {
                active.pendingSettle.acknowledge?.(this.settleRejectedAck(
                    active.pendingSettle.dispatch,
                    handoffError(
                        'UNAUTHORIZED_HANDOFF',
                        'Playback control restarted before the source could settle.',
                        true
                    )
                ));
                active.pendingSettle = null;
            }
            this.markRecoveryDue(active);
            return;
        }

        if (active.pendingSettle && active.releaseAck) {
            const pending = active.pendingSettle;
            active.pendingSettle = null;
            this.applyOrHoldSettle(active, pending.dispatch, pending.acknowledge);
            return;
        }

        if (active.recoveryDue) {
            void this.recoverActive(active);
        }
    };

    private handleRelease = (
        value: unknown,
        acknowledge?: (acknowledgement: PlaybackHandoffReleaseAck) => void
    ) => {
        if (typeof acknowledge !== 'function' || !isReleaseDispatch(value)) {
            return;
        }

        const dispatch = value;
        const registration = this.registration;
        if (
            !registration
            || registration.commandEpoch !== dispatch.commandEpoch
            || registration.endpointId !== dispatch.sourceEndpointId
            || registration.registrationGeneration
                !== dispatch.sourceRegistrationGeneration
        ) {
            acknowledge(this.releaseRejectedAck(dispatch, handoffError(
                'UNAUTHORIZED_HANDOFF',
                'The release request targets a different endpoint registration.'
            )));
            return;
        }

        const key = handoffKey(dispatch);
        if (this.active?.key === key) {
            if (this.active.releaseAck) {
                acknowledge(this.active.releaseAck);
            }
            return;
        }

        if (this.active || !beginPlaybackCommandBarrier(key)) {
            acknowledge(this.releaseRejectedAck(dispatch, handoffError(
                'SOURCE_STATE_MISMATCH',
                'The source playback barrier is already busy.',
                true
            )));
            return;
        }

        const adapterError = this.adapter
            ? this.adapter.prepareRelease(dispatch)
            : handoffError(
                'MEDIA_NOT_READY',
                'The source playback handoff adapter is unavailable.',
                true
            );
        if (adapterError) {
            endPlaybackCommandBarrier(key);
            acknowledge(this.releaseRejectedAck(dispatch, adapterError));
            return;
        }

        const active: ActiveSourceHandoff = {
            key,
            dispatch,
            releaseAck: null,
            pendingSettle: null,
            recovering: false,
            recoveryDue: false,
            timer: null
        };
        this.active = active;
        this.scheduleRecovery(SOURCE_RECOVERY_TIMEOUT_MS);
        void this.adapter!.release(dispatch).then((result) => {
            if (this.active !== active) {
                return;
            }

            const releaseAck: PlaybackHandoffReleaseAck = result.status === 'released'
                ? {
                    protocolVersion: 1,
                    handoffId: dispatch.handoffId,
                    handoffSequence: dispatch.handoffSequence,
                    sourceEndpointId: dispatch.sourceEndpointId,
                    sourceRegistrationGeneration: dispatch.sourceRegistrationGeneration,
                    status: 'released',
                    endpointSequence: result.endpointSequence,
                    positionMs: result.positionMs,
                    playbackHistory: result.playbackHistory
                }
                : this.releaseRejectedAck(dispatch, result.error);
            active.releaseAck = releaseAck;
            acknowledge(releaseAck);

            if (releaseAck.status === 'rejected') {
                this.clearActive();
                return;
            }

            if (active.pendingSettle) {
                const pending = active.pendingSettle;
                active.pendingSettle = null;
                this.applyOrHoldSettle(
                    active,
                    pending.dispatch,
                    pending.acknowledge
                );
            }
        }, () => {
            if (this.active !== active) {
                return;
            }
            const releaseAck = this.releaseRejectedAck(dispatch, handoffError(
                'SOURCE_STATE_MISMATCH',
                'The source endpoint could not release playback.',
                true
            ));
            active.releaseAck = releaseAck;
            acknowledge(releaseAck);
            this.clearActive();
        });
    };

    private handleSettle = (
        value: unknown,
        acknowledge?: (acknowledgement: PlaybackHandoffSourceSettleAck) => void
    ) => {
        if (!isSettleDispatch(value)) {
            return;
        }

        const active = this.active;
        if (!active || active.key !== handoffKey(value)) {
            if (typeof acknowledge === 'function') {
                acknowledge(this.settleRejectedAck(value, handoffError(
                    'SOURCE_STATE_MISMATCH',
                    'The source no longer has this handoff release context.',
                    true
                )));
            }
            return;
        }

        if (!active.releaseAck) {
            active.pendingSettle = { dispatch: value, acknowledge };
            return;
        }

        this.applyOrHoldSettle(active, value, acknowledge);
    };

    private applyOrHoldSettle(
        active: ActiveSourceHandoff,
        dispatch: PlaybackHandoffSourceSettleDispatch,
        acknowledge?: (acknowledgement: PlaybackHandoffSourceSettleAck) => void
    ) {
        if (
            dispatch.action !== 'complete'
            && !this.hasCurrentSourceRegistration(active)
        ) {
            active.pendingSettle = { dispatch, acknowledge };
            return;
        }

        void this.applySettle(active, dispatch, acknowledge);
    }

    private async applySettle(
        active: ActiveSourceHandoff,
        dispatch: PlaybackHandoffSourceSettleDispatch,
        acknowledge?: (acknowledgement: PlaybackHandoffSourceSettleAck) => void
    ) {
        if (this.active !== active || !this.adapter) {
            return;
        }

        try {
            const result = await this.adapter.settle(dispatch);
            if (this.active !== active) {
                return;
            }

            const settleAck: PlaybackHandoffSourceSettleAck = result.status === 'settled'
                ? {
                    protocolVersion: 1,
                    handoffId: dispatch.handoffId,
                    handoffSequence: dispatch.handoffSequence,
                    sourceEndpointId: dispatch.sourceEndpointId,
                    sourceRegistrationGeneration: dispatch.sourceRegistrationGeneration,
                    status: 'settled',
                    endpointSequence: result.endpointSequence,
                    positionMs: result.positionMs
                }
                : this.settleRejectedAck(dispatch, result.error);
            acknowledge?.(settleAck);
            this.clearActive();
        } catch {
            acknowledge?.(this.settleRejectedAck(dispatch, handoffError(
                'ROLLBACK_FAILED',
                'The source endpoint could not restore its released playback.',
                true
            )));
            this.scheduleRecovery(SOURCE_RECOVERY_TIMEOUT_MS);
        }
    }

    private scheduleRecovery(delayMs: number) {
        const active = this.active;
        if (!active || active.recovering) {
            return;
        }

        if (active.timer) {
            clearTimeout(active.timer);
        }
        active.recoveryDue = false;
        active.timer = setTimeout(() => {
            active.timer = null;
            active.recoveryDue = true;
            void this.recoverActive(active);
        }, delayMs);
    }

    private markRecoveryDue(active: ActiveSourceHandoff) {
        if (active.timer) {
            clearTimeout(active.timer);
            active.timer = null;
        }
        active.recoveryDue = true;
        void this.recoverActive(active);
    }

    private async recoverActive(active: ActiveSourceHandoff) {
        if (this.active !== active || active.recovering || !this.adapter) {
            return;
        }

        const registration = this.registration;
        if (!registration) {
            return;
        }
        if (registration.endpointId !== active.dispatch.sourceEndpointId) {
            this.abandonActive(active);
            return;
        }
        if (
            !active.recoveryDue
            && registration.commandEpoch === active.dispatch.commandEpoch
        ) {
            return;
        }

        active.recovering = true;
        try {
            await this.adapter.recover(active.dispatch);
            if (this.active === active) {
                this.clearActive();
            }
        } catch {
            if (this.active === active) {
                active.recovering = false;
                this.scheduleRecovery(SOURCE_RECOVERY_TIMEOUT_MS);
            }
        }
    }

    private abandonActive(active: ActiveSourceHandoff) {
        if (this.active !== active || !this.adapter) {
            return;
        }

        if (active.pendingSettle) {
            active.pendingSettle.acknowledge?.(this.settleRejectedAck(
                active.pendingSettle.dispatch,
                handoffError(
                    'UNAUTHORIZED_HANDOFF',
                    'The source endpoint identity changed before settlement.',
                    true
                )
            ));
            active.pendingSettle = null;
        }
        this.adapter.abandon();
        this.clearActive();
    }

    private hasCurrentSourceRegistration(active: ActiveSourceHandoff) {
        return this.registration?.endpointId === active.dispatch.sourceEndpointId
            && this.registration.commandEpoch === active.dispatch.commandEpoch;
    }

    private clearActive() {
        const active = this.active;
        if (!active) {
            return;
        }

        if (active.timer) {
            clearTimeout(active.timer);
        }
        this.active = null;
        endPlaybackCommandBarrier(active.key);
        this.adapter?.flushBufferedReport();
    }

    private releaseRejectedAck(
        dispatch: PlaybackHandoffReleaseDispatch,
        error: PlaybackHandoffError
    ): PlaybackHandoffReleaseAck {
        return {
            protocolVersion: 1,
            handoffId: dispatch.handoffId,
            handoffSequence: dispatch.handoffSequence,
            sourceEndpointId: dispatch.sourceEndpointId,
            sourceRegistrationGeneration: dispatch.sourceRegistrationGeneration,
            status: 'rejected',
            lastEndpointSequence: getPlaybackEndpointSequence(),
            error
        };
    }

    private settleRejectedAck(
        dispatch: PlaybackHandoffSourceSettleDispatch,
        error: PlaybackHandoffError
    ): PlaybackHandoffSourceSettleAck {
        return {
            protocolVersion: 1,
            handoffId: dispatch.handoffId,
            handoffSequence: dispatch.handoffSequence,
            sourceEndpointId: dispatch.sourceEndpointId,
            sourceRegistrationGeneration: dispatch.sourceRegistrationGeneration,
            status: 'rejected',
            lastEndpointSequence: getPlaybackEndpointSequence(),
            error
        };
    }
}

export const playbackHandoffController = new PlaybackHandoffController();
export const playbackHandoffSourceTarget = new PlaybackHandoffSourceTarget();
