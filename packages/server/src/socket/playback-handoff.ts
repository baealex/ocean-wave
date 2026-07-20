import type { Socket } from 'socket.io';

import {
    claimPlaybackHandoff,
    completePlaybackHandoff,
    completePlaybackHandoffRollback,
    isPlaybackHandoffServiceError,
    rollbackPlaybackHandoff,
    resolvePlaybackHandoff,
    type ClaimedPlaybackHandoff,
    type ResolvedPlaybackHandoff
} from '~/features/playback/services/playback-handoff';
import { getPlaybackSessionSnapshot } from '~/features/playback/services/playback-session';

import { connectors } from './connectors';
import {
    HANDOFF_ACTIVATION_TIMEOUT_MS,
    HANDOFF_RELEASE_TIMEOUT_MS,
    HANDOFF_RESULT_RETENTION_MS,
    HANDOFF_SOURCE_SETTLE_TIMEOUT_MS,
    HANDOFF_TARGET_ABORT_TIMEOUT_MS,
    PLAYBACK_HANDOFF_ABORT_TARGET,
    PLAYBACK_HANDOFF_ACTIVATE,
    PLAYBACK_HANDOFF_ERROR_CODES,
    PLAYBACK_HANDOFF_RELEASE,
    PLAYBACK_HANDOFF_REQUEST,
    PLAYBACK_HANDOFF_SETTLE_SOURCE,
    PLAYBACK_HANDOFF_STATUS,
    type PlaybackHandoffActivationAck,
    type PlaybackHandoffActivationDispatch,
    type PlaybackHandoffError,
    type PlaybackHandoffErrorCode,
    type PlaybackHandoffPhase,
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
import { PLAYBACK_STATE_UPDATED } from './playback';
import {
    PLAYBACK_ENDPOINTS_INVALIDATED,
    playbackEndpointRegistry,
    type PlaybackEndpointRoute
} from './playback-endpoints';

const PLAYBACK_HANDOFF_MAX_RETAINED = 256;
const PLAYBACK_HANDOFF_REQUEST_RATE_WINDOW_MS = 60_000;
const PLAYBACK_HANDOFF_REQUEST_RATE_LIMIT = 30;
const PLAYBACK_HANDOFF_MAX_SEQUENCE = 2_147_483_647;

type ReservationState =
    | 'validating'
    | 'releasing'
    | 'claiming'
    | 'activating'
    | 'rolling_back'
    | 'terminal';

interface PlaybackHandoffReservation {
    request: PlaybackHandoffRequest;
    fingerprint: string;
    requesterEndpointId: string;
    controllerSockets: Set<Socket>;
    state: ReservationState;
    handoffSequence: number | null;
    sourceRoute: PlaybackEndpointRoute | null;
    targetRoute: PlaybackEndpointRoute;
    resolved: ResolvedPlaybackHandoff | null;
    claimed: ClaimedPlaybackHandoff | null;
    sourceReleaseSequence: number | null;
    latestStatus: PlaybackHandoffStatus | null;
    initialStatus: Promise<PlaybackHandoffStatus>;
    resolveInitialStatus: (status: PlaybackHandoffStatus) => void;
    initialStatusSettled: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    expiresAtMs: number | null;
}

interface PlaybackHandoffCoordinatorDependencies {
    now?: () => number;
    commandEpoch?: string;
    getRoute?: (endpointId: string) => PlaybackEndpointRoute | null;
    resolveHandoff?: typeof resolvePlaybackHandoff;
    claimHandoff?: typeof claimPlaybackHandoff;
    completeHandoff?: typeof completePlaybackHandoff;
    rollbackHandoff?: typeof rollbackPlaybackHandoff;
    completeRollback?: typeof completePlaybackHandoffRollback;
    onStateChanged?: () => Promise<void> | void;
}

const normalizeOpaqueId = (value: unknown) => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized && normalized.length <= 128 ? normalized : null;
};

const normalizeRevision = (value: unknown) => (
    Number.isSafeInteger(value) && Number(value) >= 0
        ? Number(value)
        : null
);

const normalizePositiveSequence = (value: unknown) => (
    Number.isSafeInteger(value) && Number(value) > 0
        ? Number(value)
        : null
);

const normalizeRequest = (input: unknown): PlaybackHandoffRequest | null => {
    if (!input || typeof input !== 'object') {
        return null;
    }

    const candidate = input as Partial<PlaybackHandoffRequest>;
    const commandEpoch = normalizeOpaqueId(candidate.commandEpoch);
    const handoffId = normalizeOpaqueId(candidate.handoffId);
    const sourceEndpointId = normalizeOpaqueId(candidate.sourceEndpointId);
    const targetEndpointId = normalizeOpaqueId(candidate.targetEndpointId);
    const expectedSessionRevision = normalizeRevision(
        candidate.expectedSessionRevision
    );
    const expectedQueueRevision = normalizeRevision(candidate.expectedQueueRevision);
    const targetClaimSequence = normalizePositiveSequence(candidate.targetClaimSequence);

    if (
        candidate.protocolVersion !== 1
        || !commandEpoch
        || !handoffId
        || !sourceEndpointId
        || !targetEndpointId
        || expectedSessionRevision === null
        || expectedQueueRevision === null
        || targetClaimSequence === null
        || typeof candidate.force !== 'boolean'
    ) {
        return null;
    }

    return {
        protocolVersion: 1,
        commandEpoch,
        handoffId,
        sourceEndpointId,
        targetEndpointId,
        expectedSessionRevision,
        expectedQueueRevision,
        targetClaimSequence,
        force: candidate.force
    };
};

const requestFingerprint = (request: PlaybackHandoffRequest) => JSON.stringify(request);

const handoffError = (
    code: PlaybackHandoffErrorCode,
    message: string,
    retryable = false,
    forceAllowed = false
): PlaybackHandoffError => ({ code, message, retryable, forceAllowed });

const normalizeTargetError = (value: unknown): PlaybackHandoffError | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Partial<PlaybackHandoffError>;
    if (
        !PLAYBACK_HANDOFF_ERROR_CODES.includes(
            candidate.code as PlaybackHandoffErrorCode
        )
        || typeof candidate.message !== 'string'
        || candidate.message.length > 500
        || typeof candidate.retryable !== 'boolean'
        || typeof candidate.forceAllowed !== 'boolean'
    ) {
        return null;
    }

    return {
        code: candidate.code as PlaybackHandoffErrorCode,
        message: candidate.message,
        retryable: candidate.retryable,
        forceAllowed: candidate.forceAllowed
    };
};

const isReleaseAck = (
    value: unknown,
    reservation: PlaybackHandoffReservation
): value is PlaybackHandoffReleaseAck => {
    if (!value || typeof value !== 'object' || !reservation.sourceRoute) {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffReleaseAck>;
    const shared = candidate.protocolVersion === 1
        && candidate.handoffId === reservation.request.handoffId
        && candidate.handoffSequence === reservation.handoffSequence
        && candidate.sourceEndpointId === reservation.sourceRoute.endpointId
        && candidate.sourceRegistrationGeneration
            === reservation.sourceRoute.registrationGeneration;

    if (!shared) {
        return false;
    }

    return candidate.status === 'released'
        ? normalizePositiveSequence(candidate.endpointSequence) !== null
            && Number.isFinite(candidate.positionMs)
        : candidate.status === 'rejected'
            ? normalizeRevision(candidate.lastEndpointSequence) !== null
                && normalizeTargetError(candidate.error) !== null
            : false;
};

const isActivationAck = (
    value: unknown,
    reservation: PlaybackHandoffReservation
): value is PlaybackHandoffActivationAck => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffActivationAck>;
    const shared = candidate.protocolVersion === 1
        && candidate.handoffId === reservation.request.handoffId
        && candidate.handoffSequence === reservation.handoffSequence
        && candidate.targetEndpointId === reservation.targetRoute.endpointId
        && candidate.targetRegistrationGeneration
            === reservation.targetRoute.registrationGeneration;

    if (!shared) {
        return false;
    }

    return candidate.status === 'completed'
        ? normalizePositiveSequence(candidate.endpointSequence) !== null
            && Number.isFinite(candidate.positionMs)
        : candidate.status === 'rejected'
            ? normalizeRevision(candidate.lastEndpointSequence) !== null
                && normalizeTargetError(candidate.error) !== null
            : false;
};

const isSourceSettleAck = (
    value: unknown,
    reservation: PlaybackHandoffReservation
): value is PlaybackHandoffSourceSettleAck => {
    if (!value || typeof value !== 'object' || !reservation.sourceRoute) {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffSourceSettleAck>;
    const shared = candidate.protocolVersion === 1
        && candidate.handoffId === reservation.request.handoffId
        && candidate.handoffSequence === reservation.handoffSequence
        && candidate.sourceEndpointId === reservation.sourceRoute.endpointId
        && candidate.sourceRegistrationGeneration
            === reservation.sourceRoute.registrationGeneration;

    if (!shared) {
        return false;
    }

    return candidate.status === 'settled'
        ? normalizePositiveSequence(candidate.endpointSequence) !== null
            && Number.isFinite(candidate.positionMs)
        : candidate.status === 'rejected'
            ? normalizeRevision(candidate.lastEndpointSequence) !== null
                && normalizeTargetError(candidate.error) !== null
            : false;
};

const isTargetAbortAck = (
    value: unknown,
    reservation: PlaybackHandoffReservation
): value is PlaybackHandoffTargetAbortAck => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<PlaybackHandoffTargetAbortAck>;
    return candidate.protocolVersion === 1
        && candidate.handoffId === reservation.request.handoffId
        && candidate.handoffSequence === reservation.handoffSequence
        && candidate.targetEndpointId === reservation.targetRoute.endpointId
        && candidate.targetRegistrationGeneration
            === reservation.targetRoute.registrationGeneration
        && candidate.status === 'paused';
};

export class PlaybackHandoffCoordinator {
    readonly commandEpoch: string;

    private readonly now: () => number;
    private readonly getRoute: (endpointId: string) => PlaybackEndpointRoute | null;
    private readonly resolveHandoff: typeof resolvePlaybackHandoff;
    private readonly claimHandoff: typeof claimPlaybackHandoff;
    private readonly completeHandoff: typeof completePlaybackHandoff;
    private readonly rollbackHandoff: typeof rollbackPlaybackHandoff;
    private readonly completeRollback: typeof completePlaybackHandoffRollback;
    private readonly onStateChanged: () => Promise<void> | void;
    private readonly reservations = new Map<string, PlaybackHandoffReservation>();
    private requestRateBySocket = new WeakMap<Socket, {
        startedAtMs: number;
        attempts: number;
    }>();
    private guardHandoffId: string | null = null;
    private lastHandoffSequence = 0;

    constructor(dependencies: PlaybackHandoffCoordinatorDependencies = {}) {
        this.now = dependencies.now ?? Date.now;
        this.commandEpoch = dependencies.commandEpoch
            ?? playbackEndpointRegistry.commandEpoch;
        this.getRoute = dependencies.getRoute
            ?? (endpointId => playbackEndpointRegistry.getRoute(endpointId));
        this.resolveHandoff = dependencies.resolveHandoff ?? resolvePlaybackHandoff;
        this.claimHandoff = dependencies.claimHandoff ?? claimPlaybackHandoff;
        this.completeHandoff = dependencies.completeHandoff ?? completePlaybackHandoff;
        this.rollbackHandoff = dependencies.rollbackHandoff ?? rollbackPlaybackHandoff;
        this.completeRollback = dependencies.completeRollback
            ?? completePlaybackHandoffRollback;
        this.onStateChanged = dependencies.onStateChanged ?? (async () => {
            const snapshot = await getPlaybackSessionSnapshot();
            if (!snapshot) {
                return;
            }

            connectors.notify(PLAYBACK_STATE_UPDATED, snapshot);
            connectors.notify(PLAYBACK_ENDPOINTS_INVALIDATED, {
                reason: 'active-changed',
                deviceId: null,
                endpointId: snapshot.activeDeviceId
            });
        });
    }

    async request(socket: Socket, input: unknown): Promise<PlaybackHandoffRequestAck> {
        this.pruneExpired();
        const request = normalizeRequest(input);

        if (!request) {
            return this.detachedStatus(input, handoffError(
                'INVALID_HANDOFF',
                'The playback handoff request is invalid.'
            ));
        }

        if (!this.acceptRequestAttempt(socket)) {
            return this.detachedStatus(request, handoffError(
                'HANDOFF_IN_PROGRESS',
                'The playback handoff request rate limit was reached.',
                true
            ));
        }

        const requesterRoute = this.getRequesterRoute(socket);
        if (
            !requesterRoute
            || requesterRoute.endpointId !== request.targetEndpointId
            || request.commandEpoch !== this.commandEpoch
        ) {
            return this.detachedStatus(request, handoffError(
                'UNAUTHORIZED_HANDOFF',
                'A current target endpoint registration is required.'
            ));
        }

        const fingerprint = requestFingerprint(request);
        const existing = this.reservations.get(request.handoffId);
        if (existing) {
            if (
                existing.requesterEndpointId !== requesterRoute.endpointId
                || existing.fingerprint !== fingerprint
            ) {
                return this.detachedStatus(request, handoffError(
                    'INVALID_HANDOFF',
                    'The handoff id is already reserved for another request.'
                ));
            }

            existing.controllerSockets.add(socket);
            if (existing.latestStatus) {
                return { ...existing.latestStatus, deduplicated: true };
            }

            const status = await existing.initialStatus;
            return { ...status, deduplicated: true };
        }

        if (this.reservations.size >= PLAYBACK_HANDOFF_MAX_RETAINED) {
            return this.detachedStatus(request, handoffError(
                'HANDOFF_IN_PROGRESS',
                'The playback handoff coordinator is temporarily at capacity.',
                true
            ));
        }

        const reservation = this.createReservation(
            request,
            fingerprint,
            requesterRoute,
            socket
        );
        this.reservations.set(request.handoffId, reservation);
        void this.validateAndStart(reservation);
        return reservation.initialStatus;
    }

    handleSocketDisconnected(socketId: string) {
        for (const reservation of this.reservations.values()) {
            if (reservation.state === 'terminal') {
                continue;
            }

            const sourceDisconnected = reservation.sourceRoute?.socketId === socketId;
            const targetDisconnected = reservation.targetRoute.socketId === socketId;

            if (sourceDisconnected && reservation.state === 'releasing') {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'SOURCE_OFFLINE',
                    'The source endpoint disconnected before it released playback.',
                    true,
                    true
                ));
                continue;
            }

            if (!targetDisconnected) {
                continue;
            }

            if (reservation.claimed) {
                void this.recoverAfterClaim(reservation, handoffError(
                    'RECOVERY_REQUIRED',
                    'The target endpoint disconnected during activation.',
                    true
                ));
            } else {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'UNAUTHORIZED_HANDOFF',
                    'The target endpoint disconnected before ownership was claimed.',
                    true
                ));
            }
        }
    }

    clear() {
        for (const reservation of this.reservations.values()) {
            this.clearTimer(reservation);
        }
        this.reservations.clear();
        this.requestRateBySocket = new WeakMap();
        this.guardHandoffId = null;
        this.lastHandoffSequence = 0;
    }

    private createReservation(
        request: PlaybackHandoffRequest,
        fingerprint: string,
        targetRoute: PlaybackEndpointRoute,
        socket: Socket
    ): PlaybackHandoffReservation {
        let resolveInitialStatus!: (status: PlaybackHandoffStatus) => void;
        const initialStatus = new Promise<PlaybackHandoffStatus>((resolve) => {
            resolveInitialStatus = resolve;
        });

        return {
            request,
            fingerprint,
            requesterEndpointId: targetRoute.endpointId,
            controllerSockets: new Set([socket]),
            state: 'validating',
            handoffSequence: null,
            sourceRoute: null,
            targetRoute,
            resolved: null,
            claimed: null,
            sourceReleaseSequence: null,
            latestStatus: null,
            initialStatus,
            resolveInitialStatus,
            initialStatusSettled: false,
            timer: null,
            expiresAtMs: null
        };
    }

    private async validateAndStart(reservation: PlaybackHandoffReservation) {
        try {
            const targetRoute = this.getRoute(reservation.request.targetEndpointId);
            if (!targetRoute || !this.sameRoute(targetRoute, reservation.targetRoute)) {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'UNAUTHORIZED_HANDOFF',
                    'The target endpoint registration changed before validation.',
                    true
                ));
                return;
            }

            if (!targetRoute.capabilities.includes('handoff')) {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'UNSUPPORTED_HANDOFF',
                    'This browser does not support atomic playback handoff.'
                ));
                return;
            }

            if (reservation.request.targetClaimSequence <= targetRoute.lastEndpointSequence) {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'TARGET_STATE_MISMATCH',
                    'The target endpoint sequence is stale.',
                    true
                ));
                return;
            }

            const resolved = await this.resolveHandoff(
                reservation.request,
                new Date(this.now())
            );
            if (reservation.state !== 'validating') {
                return;
            }

            const currentTargetRoute = this.getRoute(reservation.request.targetEndpointId);
            if (
                !currentTargetRoute
                || !this.sameRoute(currentTargetRoute, reservation.targetRoute)
            ) {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'UNAUTHORIZED_HANDOFF',
                    'The target endpoint registration changed before the handoff started.',
                    true
                ));
                return;
            }

            const sourceRoute = this.getRoute(reservation.request.sourceEndpointId);
            if (reservation.request.force && sourceRoute) {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'SOURCE_STILL_ONLINE',
                    'The source endpoint is still online and must release playback normally.',
                    true
                ));
                return;
            }

            if (!reservation.request.force && !sourceRoute) {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'SOURCE_OFFLINE',
                    'The source endpoint is offline. Confirm a forced handoff to continue here.',
                    true,
                    true
                ), resolved.snapshot.sessionRevision, resolved.snapshot.queueRevision);
                return;
            }

            if (
                sourceRoute
                && !sourceRoute.capabilities.includes('handoff')
            ) {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'UNSUPPORTED_HANDOFF',
                    'The source endpoint does not support atomic playback handoff.'
                ), resolved.snapshot.sessionRevision, resolved.snapshot.queueRevision);
                return;
            }

            if (this.guardHandoffId !== null) {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    'HANDOFF_IN_PROGRESS',
                    'Another playback handoff already owns the current server revision.',
                    true
                ), resolved.snapshot.sessionRevision, resolved.snapshot.queueRevision);
                return;
            }

            this.guardHandoffId = reservation.request.handoffId;
            reservation.resolved = resolved;
            reservation.sourceRoute = sourceRoute;
            reservation.handoffSequence = this.allocateHandoffSequence();

            if (reservation.request.force) {
                reservation.state = 'claiming';
                this.publish(reservation, 'claiming', null,
                    resolved.snapshot.sessionRevision,
                    resolved.snapshot.queueRevision);
                void this.claimAndActivate(
                    reservation,
                    resolved.snapshot.positionMs,
                    null
                );
                return;
            }

            reservation.state = 'releasing';
            this.publish(reservation, 'releasing', null,
                resolved.snapshot.sessionRevision,
                resolved.snapshot.queueRevision);
            this.dispatchRelease(reservation);
        } catch (error) {
            if (isPlaybackHandoffServiceError(error)) {
                this.failBeforeClaim(reservation, 'rejected', handoffError(
                    error.code,
                    error.message,
                    error.retryable
                ), error.sessionRevision, error.queueRevision);
                return;
            }

            console.error(error);
            this.failBeforeClaim(reservation, 'rejected', handoffError(
                'CLAIM_FAILED',
                'The playback handoff could not be validated.',
                true
            ));
        }
    }

    private dispatchRelease(reservation: PlaybackHandoffReservation) {
        const { resolved, sourceRoute } = reservation;
        if (!resolved || !sourceRoute || reservation.handoffSequence === null) {
            this.failBeforeClaim(reservation, 'rejected', handoffError(
                'CLAIM_FAILED',
                'The source handoff route is unavailable.',
                true
            ));
            return;
        }

        const issuedAtMs = this.now();
        const dispatch: PlaybackHandoffReleaseDispatch = {
            protocolVersion: 1,
            commandEpoch: this.commandEpoch,
            handoffId: reservation.request.handoffId,
            handoffSequence: reservation.handoffSequence,
            sourceEndpointId: sourceRoute.endpointId,
            sourceRegistrationGeneration: sourceRoute.registrationGeneration,
            targetEndpointId: reservation.targetRoute.endpointId,
            targetRegistrationGeneration: reservation.targetRoute.registrationGeneration,
            issuedAt: new Date(issuedAtMs).toISOString(),
            releaseBy: new Date(issuedAtMs + HANDOFF_RELEASE_TIMEOUT_MS).toISOString(),
            snapshot: resolved.snapshot
        };

        this.setTimer(reservation, HANDOFF_RELEASE_TIMEOUT_MS, () => {
            this.failBeforeClaim(reservation, 'timed_out', handoffError(
                'RELEASE_TIMEOUT',
                'The source endpoint did not confirm playback release in time.',
                true
            ), resolved.snapshot.sessionRevision, resolved.snapshot.queueRevision);
        });

        try {
            sourceRoute.socket.emit(
                PLAYBACK_HANDOFF_RELEASE,
                dispatch,
                (acknowledgement: unknown) => {
                    this.handleReleaseAck(reservation, acknowledgement);
                }
            );
        } catch {
            this.failBeforeClaim(reservation, 'rejected', handoffError(
                'SOURCE_OFFLINE',
                'The release request could not be delivered to the source endpoint.',
                true,
                true
            ), resolved.snapshot.sessionRevision, resolved.snapshot.queueRevision);
        }
    }

    private handleReleaseAck(
        reservation: PlaybackHandoffReservation,
        acknowledgement: unknown
    ) {
        if (reservation.state !== 'releasing' || !reservation.resolved) {
            return;
        }

        this.clearTimer(reservation);
        if (!isReleaseAck(acknowledgement, reservation)) {
            this.failBeforeClaim(reservation, 'rejected', handoffError(
                'SOURCE_STATE_MISMATCH',
                'The source endpoint returned an invalid release acknowledgement.',
                true
            ));
            return;
        }

        if (acknowledgement.status === 'rejected') {
            this.failBeforeClaim(
                reservation,
                'rejected',
                normalizeTargetError(acknowledgement.error) ?? handoffError(
                    'SOURCE_STATE_MISMATCH',
                    'The source endpoint rejected playback release.',
                    true
                )
            );
            return;
        }

        if (
            acknowledgement.endpointSequence
            <= reservation.resolved.sourceActiveDeviceSequence
        ) {
            this.failBeforeClaim(reservation, 'rejected', handoffError(
                'SOURCE_STATE_MISMATCH',
                'The source endpoint release sequence is stale.',
                true
            ));
            return;
        }

        reservation.sourceReleaseSequence = acknowledgement.endpointSequence;
        reservation.state = 'claiming';
        this.publish(
            reservation,
            'claiming',
            null,
            reservation.resolved.snapshot.sessionRevision,
            reservation.resolved.snapshot.queueRevision
        );
        void this.claimAndActivate(
            reservation,
            acknowledgement.positionMs,
            acknowledgement.endpointSequence
        );
    }

    private async claimAndActivate(
        reservation: PlaybackHandoffReservation,
        releasedPositionMs: number,
        sourceReleaseSequence: number | null
    ) {
        const resolved = reservation.resolved;
        if (!resolved || reservation.state !== 'claiming') {
            return;
        }

        try {
            const claimed = await this.claimHandoff(
                resolved,
                releasedPositionMs,
                new Date(this.now())
            );
            if (reservation.state !== 'claiming') {
                return;
            }

            reservation.claimed = claimed;
            reservation.sourceReleaseSequence = sourceReleaseSequence;
            await this.notifyStateChanged();
            reservation.state = 'activating';
            this.publish(
                reservation,
                'activating',
                null,
                claimed.sessionRevision,
                claimed.queueRevision
            );
            this.dispatchActivation(reservation);
        } catch (error) {
            const protocol = isPlaybackHandoffServiceError(error)
                ? handoffError(error.code, error.message, error.retryable)
                : handoffError(
                    'CLAIM_FAILED',
                    'The playback handoff claim could not be committed.',
                    true
                );
            if (!isPlaybackHandoffServiceError(error)) {
                console.error(error);
            }
            this.failBeforeClaim(
                reservation,
                'rejected',
                protocol,
                isPlaybackHandoffServiceError(error)
                    ? error.sessionRevision
                    : resolved.snapshot.sessionRevision,
                isPlaybackHandoffServiceError(error)
                    ? error.queueRevision
                    : resolved.snapshot.queueRevision
            );
        }
    }

    private dispatchActivation(reservation: PlaybackHandoffReservation) {
        const { claimed, resolved } = reservation;
        if (!claimed || !resolved || reservation.handoffSequence === null) {
            void this.recoverAfterClaim(reservation, handoffError(
                'RECOVERY_REQUIRED',
                'The claimed handoff snapshot is unavailable.',
                true
            ));
            return;
        }

        const targetRoute = this.getRoute(reservation.targetRoute.endpointId);
        if (!targetRoute || !this.sameRoute(targetRoute, reservation.targetRoute)) {
            void this.recoverAfterClaim(reservation, handoffError(
                'RECOVERY_REQUIRED',
                'The target endpoint disconnected after ownership was claimed.',
                true
            ));
            return;
        }

        const dispatch: PlaybackHandoffActivationDispatch = {
            protocolVersion: 1,
            commandEpoch: this.commandEpoch,
            handoffId: reservation.request.handoffId,
            handoffSequence: reservation.handoffSequence,
            sourceEndpointId: resolved.sourceEndpointId,
            targetEndpointId: resolved.targetEndpointId,
            targetRegistrationGeneration: targetRoute.registrationGeneration,
            claimSessionRevision: claimed.sessionRevision,
            activateBy: new Date(
                this.now() + HANDOFF_ACTIVATION_TIMEOUT_MS
            ).toISOString(),
            snapshot: claimed.snapshot
        };

        this.setTimer(reservation, HANDOFF_ACTIVATION_TIMEOUT_MS, () => {
            void this.recoverAfterClaim(reservation, handoffError(
                'ACTIVATION_TIMEOUT',
                'This browser did not confirm handoff activation in time.',
                true
            ));
        });

        try {
            targetRoute.socket.emit(
                PLAYBACK_HANDOFF_ACTIVATE,
                dispatch,
                (acknowledgement: unknown) => {
                    void this.handleActivationAck(reservation, acknowledgement);
                }
            );
        } catch {
            void this.recoverAfterClaim(reservation, handoffError(
                'RECOVERY_REQUIRED',
                'The activation request could not be delivered to this browser.',
                true
            ));
        }
    }

    private async handleActivationAck(
        reservation: PlaybackHandoffReservation,
        acknowledgement: unknown
    ) {
        if (
            reservation.state !== 'activating'
            || !reservation.resolved
            || !reservation.claimed
        ) {
            return;
        }

        this.clearTimer(reservation);
        if (!isActivationAck(acknowledgement, reservation)) {
            await this.recoverAfterClaim(reservation, handoffError(
                'TARGET_STATE_MISMATCH',
                'This browser returned an invalid activation acknowledgement.',
                true
            ));
            return;
        }

        if (acknowledgement.status === 'rejected') {
            await this.recoverAfterClaim(
                reservation,
                normalizeTargetError(acknowledgement.error) ?? handoffError(
                    'TARGET_STATE_MISMATCH',
                    'This browser rejected handoff activation.',
                    true
                ),
                true
            );
            return;
        }

        try {
            const committed = await this.completeHandoff(
                reservation.resolved,
                reservation.claimed,
                {
                    endpointSequence: acknowledgement.endpointSequence,
                    positionMs: acknowledgement.positionMs
                },
                new Date(this.now())
            );
            if (reservation.state !== 'activating') {
                return;
            }

            await this.notifyStateChanged();
            this.settleSource(reservation, 'complete', null);
            this.terminalize(
                reservation,
                'completed',
                null,
                committed.sessionRevision,
                committed.queueRevision
            );
        } catch (error) {
            const protocol = isPlaybackHandoffServiceError(error)
                ? handoffError(error.code, error.message, error.retryable)
                : handoffError(
                    'CLAIM_FAILED',
                    'The activated handoff could not be committed.',
                    true
                );
            if (!isPlaybackHandoffServiceError(error)) {
                console.error(error);
            }
            await this.recoverAfterClaim(reservation, protocol);
        }
    }

    private async recoverAfterClaim(
        reservation: PlaybackHandoffReservation,
        activationError: PlaybackHandoffError,
        targetAlreadyPaused = false
    ) {
        if (
            reservation.state === 'terminal'
            || reservation.state === 'rolling_back'
            || !reservation.resolved
            || !reservation.claimed
        ) {
            return;
        }

        this.clearTimer(reservation);
        reservation.state = 'rolling_back';
        const targetPaused = targetAlreadyPaused
            || await this.abortTarget(reservation, activationError);
        if (!targetPaused || reservation.state !== 'rolling_back') {
            this.terminalize(
                reservation,
                'recovery_required',
                handoffError(
                    'RECOVERY_REQUIRED',
                    `${activationError.message} The target could not confirm silence, so the source was not resumed; playback remains paused for explicit recovery.`,
                    true
                ),
                reservation.claimed.sessionRevision,
                reservation.claimed.queueRevision
            );
            return;
        }

        const sourceRoute = reservation.sourceRoute
            ? this.getRoute(reservation.sourceRoute.endpointId)
            : null;
        const canRestoreSource = Boolean(
            sourceRoute
            && reservation.sourceRoute
            && this.sameRoute(sourceRoute, reservation.sourceRoute)
            && reservation.sourceReleaseSequence !== null
        );

        if (!canRestoreSource || !sourceRoute || reservation.sourceReleaseSequence === null) {
            this.terminalize(
                reservation,
                'recovery_required',
                handoffError(
                    'RECOVERY_REQUIRED',
                    `${activationError.message} Playback is safely paused on this browser; use Resume here to recover.`,
                    true
                ),
                reservation.claimed.sessionRevision,
                reservation.claimed.queueRevision
            );
            return;
        }

        try {
            const rolledBack = await this.rollbackHandoff(
                reservation.resolved,
                reservation.claimed,
                reservation.sourceReleaseSequence,
                new Date(this.now())
            );
            if (reservation.state !== 'rolling_back') {
                return;
            }

            await this.notifyStateChanged();
            const acknowledgement = await this.restoreSource(
                reservation,
                rolledBack,
                activationError
            );
            let sessionRevision = rolledBack.sessionRevision;
            if (acknowledgement?.status === 'settled') {
                try {
                    const restored = await this.completeRollback(
                        reservation.resolved,
                        rolledBack,
                        reservation.sourceReleaseSequence,
                        {
                            endpointSequence: acknowledgement.endpointSequence,
                            positionMs: acknowledgement.positionMs
                        },
                        new Date(this.now())
                    );
                    sessionRevision = restored.sessionRevision;
                    await this.notifyStateChanged();
                } catch (error) {
                    if (!isPlaybackHandoffServiceError(error)) {
                        console.error(error);
                    }
                }
            }

            this.terminalize(
                reservation,
                'rolled_back',
                activationError,
                sessionRevision,
                rolledBack.queueRevision
            );
        } catch (error) {
            if (!isPlaybackHandoffServiceError(error)) {
                console.error(error);
            }
            this.terminalize(
                reservation,
                'recovery_required',
                handoffError(
                    'RECOVERY_REQUIRED',
                    `${activationError.message} The automatic rollback could not be confirmed; playback remains paused for explicit recovery.`,
                    true
                ),
                isPlaybackHandoffServiceError(error)
                    ? error.sessionRevision
                    : reservation.claimed.sessionRevision,
                isPlaybackHandoffServiceError(error)
                    ? error.queueRevision
                    : reservation.claimed.queueRevision
            );
        }
    }

    private abortTarget(
        reservation: PlaybackHandoffReservation,
        reason: PlaybackHandoffError
    ): Promise<boolean> {
        return new Promise((resolve) => {
            const targetRoute = this.getRoute(reservation.targetRoute.endpointId);
            if (
                !targetRoute
                || !this.sameRoute(targetRoute, reservation.targetRoute)
                || reservation.handoffSequence === null
            ) {
                resolve(false);
                return;
            }

            let settled = false;
            const finish = (confirmed: boolean) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.clearTimer(reservation);
                resolve(confirmed);
            };
            const dispatch: PlaybackHandoffTargetAbortDispatch = {
                protocolVersion: 1,
                commandEpoch: this.commandEpoch,
                handoffId: reservation.request.handoffId,
                handoffSequence: reservation.handoffSequence,
                targetEndpointId: targetRoute.endpointId,
                targetRegistrationGeneration: targetRoute.registrationGeneration,
                reason
            };
            this.setTimer(reservation, HANDOFF_TARGET_ABORT_TIMEOUT_MS, () => {
                finish(false);
            });

            try {
                targetRoute.socket.emit(
                    PLAYBACK_HANDOFF_ABORT_TARGET,
                    dispatch,
                    (value: unknown) => {
                        finish(isTargetAbortAck(value, reservation));
                    }
                );
            } catch {
                finish(false);
            }
        });
    }

    private restoreSource(
        reservation: PlaybackHandoffReservation,
        rolledBack: ClaimedPlaybackHandoff,
        reason: PlaybackHandoffError
    ): Promise<PlaybackHandoffSourceSettleAck | null> {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value: PlaybackHandoffSourceSettleAck | null) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.clearTimer(reservation);
                resolve(value);
            };
            this.setTimer(reservation, HANDOFF_SOURCE_SETTLE_TIMEOUT_MS, () => {
                finish(null);
            });
            this.settleSource(reservation, 'restore', reason, rolledBack, (value) => {
                finish(isSourceSettleAck(value, reservation) ? value : null);
            });
        });
    }

    private settleSource(
        reservation: PlaybackHandoffReservation,
        action: PlaybackHandoffSourceSettleDispatch['action'],
        reason: PlaybackHandoffError | null,
        state = reservation.claimed,
        acknowledge?: (value: unknown) => void
    ) {
        const sourceRoute = reservation.sourceRoute;
        const resolved = reservation.resolved;
        if (
            !sourceRoute
            || !resolved
            || reservation.handoffSequence === null
        ) {
            return;
        }

        const currentRoute = this.getRoute(sourceRoute.endpointId);
        if (!currentRoute || !this.sameRoute(currentRoute, sourceRoute)) {
            return;
        }

        const dispatch: PlaybackHandoffSourceSettleDispatch = {
            protocolVersion: 1,
            commandEpoch: this.commandEpoch,
            handoffId: reservation.request.handoffId,
            handoffSequence: reservation.handoffSequence,
            sourceEndpointId: sourceRoute.endpointId,
            sourceRegistrationGeneration: sourceRoute.registrationGeneration,
            action,
            sessionRevision: state?.sessionRevision ?? null,
            queueRevision: resolved.snapshot.queueRevision,
            snapshot: state?.snapshot ?? resolved.snapshot,
            reason
        };

        try {
            if (acknowledge) {
                currentRoute.socket.emit(
                    PLAYBACK_HANDOFF_SETTLE_SOURCE,
                    dispatch,
                    acknowledge
                );
            } else {
                currentRoute.socket.emit(PLAYBACK_HANDOFF_SETTLE_SOURCE, dispatch);
            }
        } catch {
            acknowledge?.(null);
        }
    }

    private failBeforeClaim(
        reservation: PlaybackHandoffReservation,
        phase: 'rejected' | 'timed_out',
        error: PlaybackHandoffError,
        sessionRevision = reservation.resolved?.snapshot.sessionRevision ?? null,
        queueRevision = reservation.resolved?.snapshot.queueRevision ?? null
    ) {
        if (reservation.state === 'terminal' || reservation.claimed) {
            return;
        }

        this.clearTimer(reservation);
        if (reservation.sourceRoute && reservation.resolved) {
            this.settleSource(reservation, 'cancel', error);
        }
        this.terminalize(
            reservation,
            phase,
            error,
            sessionRevision,
            queueRevision
        );
    }

    private terminalize(
        reservation: PlaybackHandoffReservation,
        phase: Extract<PlaybackHandoffPhase,
            'completed' | 'rolled_back' | 'rejected' | 'timed_out' | 'recovery_required'>,
        error: PlaybackHandoffError | null,
        sessionRevision: number | null,
        queueRevision: number | null
    ) {
        if (reservation.state === 'terminal') {
            return reservation.latestStatus!;
        }

        this.clearTimer(reservation);
        reservation.state = 'terminal';
        reservation.expiresAtMs = this.now() + HANDOFF_RESULT_RETENTION_MS;
        if (this.guardHandoffId === reservation.request.handoffId) {
            this.guardHandoffId = null;
        }
        return this.publish(
            reservation,
            phase,
            error,
            sessionRevision,
            queueRevision
        );
    }

    private publish(
        reservation: PlaybackHandoffReservation,
        phase: PlaybackHandoffPhase,
        error: PlaybackHandoffError | null,
        sessionRevision: number | null,
        queueRevision: number | null
    ) {
        const status: PlaybackHandoffStatus = {
            protocolVersion: 1,
            commandEpoch: this.commandEpoch,
            handoffId: reservation.request.handoffId,
            sourceEndpointId: reservation.request.sourceEndpointId,
            targetEndpointId: reservation.request.targetEndpointId,
            handoffSequence: reservation.handoffSequence,
            phase,
            deduplicated: false,
            sessionRevision,
            queueRevision,
            occurredAt: new Date(this.now()).toISOString(),
            error
        };
        reservation.latestStatus = status;

        if (!reservation.initialStatusSettled) {
            reservation.initialStatusSettled = true;
            reservation.resolveInitialStatus(status);
        }

        for (const socket of reservation.controllerSockets) {
            if (!socket.connected) {
                reservation.controllerSockets.delete(socket);
                continue;
            }
            try {
                socket.emit(PLAYBACK_HANDOFF_STATUS, status);
            } catch {
                // A later idempotent request can recover the retained status.
            }
        }
        return status;
    }

    private detachedStatus(
        input: unknown,
        error: PlaybackHandoffError
    ): PlaybackHandoffStatus {
        const request = normalizeRequest(input);
        const candidate = input && typeof input === 'object'
            ? input as Partial<PlaybackHandoffRequest>
            : null;

        return {
            protocolVersion: 1,
            commandEpoch: this.commandEpoch,
            handoffId: request?.handoffId
                ?? normalizeOpaqueId(candidate?.handoffId)
                ?? '',
            sourceEndpointId: request?.sourceEndpointId
                ?? normalizeOpaqueId(candidate?.sourceEndpointId)
                ?? '',
            targetEndpointId: request?.targetEndpointId
                ?? normalizeOpaqueId(candidate?.targetEndpointId)
                ?? '',
            handoffSequence: null,
            phase: 'rejected',
            deduplicated: false,
            sessionRevision: null,
            queueRevision: null,
            occurredAt: new Date(this.now()).toISOString(),
            error
        };
    }

    private getRequesterRoute(socket: Socket) {
        const endpointId = normalizeOpaqueId(socket.data.playbackEndpointId);
        const generation = normalizePositiveSequence(
            socket.data.playbackRegistrationGeneration
        );
        if (!endpointId || generation === null) {
            return null;
        }

        const route = this.getRoute(endpointId);
        return route
            && route.socketId === socket.id
            && route.registrationGeneration === generation
            ? route
            : null;
    }

    private sameRoute(
        left: Pick<PlaybackEndpointRoute,
            'socketId' | 'endpointId' | 'registrationGeneration'>,
        right: Pick<PlaybackEndpointRoute,
            'socketId' | 'endpointId' | 'registrationGeneration'>
    ) {
        return left.socketId === right.socketId
            && left.endpointId === right.endpointId
            && left.registrationGeneration === right.registrationGeneration;
    }

    private acceptRequestAttempt(socket: Socket) {
        const now = this.now();
        const current = this.requestRateBySocket.get(socket);
        if (
            !current
            || now - current.startedAtMs >= PLAYBACK_HANDOFF_REQUEST_RATE_WINDOW_MS
        ) {
            this.requestRateBySocket.set(socket, { startedAtMs: now, attempts: 1 });
            return true;
        }

        if (current.attempts >= PLAYBACK_HANDOFF_REQUEST_RATE_LIMIT) {
            return false;
        }

        current.attempts += 1;
        return true;
    }

    private allocateHandoffSequence() {
        this.lastHandoffSequence = this.lastHandoffSequence
            >= PLAYBACK_HANDOFF_MAX_SEQUENCE
            ? 1
            : this.lastHandoffSequence + 1;
        return this.lastHandoffSequence;
    }

    private setTimer(
        reservation: PlaybackHandoffReservation,
        delayMs: number,
        callback: () => void
    ) {
        this.clearTimer(reservation);
        reservation.timer = setTimeout(callback, delayMs);
        reservation.timer.unref?.();
    }

    private clearTimer(reservation: PlaybackHandoffReservation) {
        if (!reservation.timer) {
            return;
        }
        clearTimeout(reservation.timer);
        reservation.timer = null;
    }

    private pruneExpired() {
        const now = this.now();
        for (const [handoffId, reservation] of this.reservations) {
            if (
                reservation.state === 'terminal'
                && reservation.expiresAtMs !== null
                && reservation.expiresAtMs <= now
            ) {
                this.reservations.delete(handoffId);
            }
        }
    }

    private async notifyStateChanged() {
        try {
            await this.onStateChanged();
        } catch (error) {
            console.error(error);
        }
    }
}

export const playbackHandoffCoordinator = new PlaybackHandoffCoordinator();

export const playbackHandoffListener = (
    socket: Socket,
    coordinator = playbackHandoffCoordinator
) => {
    socket.on(PLAYBACK_HANDOFF_REQUEST, (input, acknowledge) => {
        void coordinator.request(socket, input).then((result) => {
            if (typeof acknowledge === 'function') {
                acknowledge(result);
            }
        });
    });
};
