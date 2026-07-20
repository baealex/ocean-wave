import {
    fetchPlaybackSession,
    type PlaybackSessionSnapshot,
    type ReportPlaybackStateInput,
    reportPlaybackState,
    type SharedPlaybackState
} from '~/api/playback-session';
import { isPlaybackCommandBarrierActive } from '~/modules/playback-command-barrier';
import { PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS } from '~/modules/playback-controller';
import { nextPlaybackEndpointSequence } from '~/modules/playback-device';
import { isNewerPlaybackSnapshot } from '~/modules/shared-playback';
import { PlaybackListener } from '~/socket';
import {
    type PlaybackEndpointRegistrationState,
    playbackEndpointRegistration
} from '~/socket/playback-endpoint';
import { socket } from '~/socket/socket';

import { BaseStore } from './base-store';

const PLAYBACK_REPORT_INTERVAL_MS = 10_000;

interface PlaybackSessionStoreState {
    snapshot: PlaybackSessionSnapshot | null;
    receivedAtMs: number;
    endpointId: string | null;
    loading: boolean;
    error: string | null;
}

export type PlaybackSessionRefreshResult =
    | { type: 'success'; snapshot: PlaybackSessionSnapshot | null }
    | { type: 'error' | 'superseded' };

interface LocalPlaybackReport {
    state: SharedPlaybackState;
    currentMusicId: string | null;
    positionMs: number;
}

interface ReportOptions {
    claimActive?: boolean;
    checkpoint?: boolean;
}

interface PendingPlaybackIntent {
    local: LocalPlaybackReport;
}

interface InFlightPlaybackReport {
    token: symbol;
    identityKey: string;
    intent: PendingPlaybackIntent;
    claimRequired: boolean;
    claimVersion: number;
}

const registrationIdentityKey = (
    registration: PlaybackEndpointRegistrationState
) => {
    return [
        registration.endpointId,
        registration.registrationGeneration,
        registration.registrationProof
    ].join('\u0000');
};

export class PlaybackSessionStore extends BaseStore<PlaybackSessionStoreState> {
    private listener = new PlaybackListener();
    private connected = false;
    private registration: PlaybackEndpointRegistrationState | null = null;
    private unsubscribeRegistration: (() => void) | null = null;
    private pendingIntent: PendingPlaybackIntent | null = null;
    private inFlight: InFlightPlaybackReport | null = null;
    private readonly outstandingReports = new Set<symbol>();
    private claimRequired = false;
    private claimVersion = 0;
    private registrationGapEndpointId: string | null = null;
    private lastReportAtMs = 0;
    private refreshSequence = 0;

    constructor() {
        super();
        this.state = {
            snapshot: null,
            receivedAtMs: 0,
            endpointId: null,
            loading: false,
            error: null
        };
    }

    get endpointId() {
        return this.state.endpointId;
    }

    get deviceId() {
        return this.endpointId;
    }

    get hasPendingReport() {
        return this.pendingIntent !== null
            || this.inFlight !== null
            || this.outstandingReports.size > 0;
    }

    quiesceForPlaybackCommandRecovery() {
        this.pendingIntent = null;

        if (this.outstandingReports.size > 0) {
            return false;
        }

        this.claimRequired = false;
        this.claimVersion += 1;
        return true;
    }

    connect() {
        if (this.connected) {
            return;
        }

        this.connected = true;
        this.unsubscribeRegistration = playbackEndpointRegistration.subscribe(
            this.handleRegistrationChanged
        );
        this.handleRegistrationChanged(playbackEndpointRegistration.current);
        this.listener.connect({
            onStateUpdated: (snapshot) => {
                this.applySnapshot(snapshot);
            }
        });
        socket.on('connect', this.handleSocketConnect);
        void this.refresh();
    }

    disconnect() {
        if (!this.connected) {
            return;
        }

        this.connected = false;
        this.listener.disconnect();
        socket.off('connect', this.handleSocketConnect);
        this.unsubscribeRegistration?.();
        this.unsubscribeRegistration = null;
        this.registration = null;
        this.pendingIntent = null;
        this.inFlight = null;
        this.claimRequired = false;
        this.claimVersion = 0;
        this.registrationGapEndpointId = null;
        this.refreshSequence += 1;
        this.set({ endpointId: null });
    }

    async refresh(
        requestTimeoutMs = PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
    ): Promise<PlaybackSessionRefreshResult> {
        const refreshSequence = ++this.refreshSequence;
        this.set({ loading: true });
        const response = await fetchPlaybackSession(requestTimeoutMs);

        if (refreshSequence !== this.refreshSequence) {
            return { type: 'superseded' };
        }

        if (response.type === 'error') {
            this.set({
                loading: false,
                error: response.errors[0]?.message ?? 'Unable to read shared playback state.'
            });
            return { type: 'error' };
        }

        if (response.playbackSession) {
            this.applySnapshot(response.playbackSession, true);
        } else {
            this.set({
                snapshot: null,
                receivedAtMs: Date.now()
            });
        }
        this.set({ loading: false, error: null });
        return { type: 'success', snapshot: this.state.snapshot };
    }

    report(local: LocalPlaybackReport, options: ReportOptions = {}) {
        if (isPlaybackCommandBarrierActive()) {
            return;
        }

        const now = Date.now();
        const claimActive = options.claimActive === true;
        const isCurrentEndpointActive = Boolean(
            this.registration
            && this.state.snapshot?.activeDeviceId === this.registration.endpointId
        );
        const canBufferThroughRegistrationGap = Boolean(
            !this.registration && this.registrationGapEndpointId
        );

        if (options.checkpoint && now - this.lastReportAtMs < PLAYBACK_REPORT_INTERVAL_MS) {
            return;
        }

        if (
            !claimActive
            && !this.claimRequired
            && !isCurrentEndpointActive
            && !canBufferThroughRegistrationGap
        ) {
            return;
        }

        const intent: PendingPlaybackIntent = {
            local: {
                state: local.state,
                currentMusicId: local.currentMusicId,
                positionMs: Math.max(Math.round(local.positionMs), 0)
            }
        };

        if (claimActive) {
            this.claimRequired = true;
            this.claimVersion += 1;
        }
        this.lastReportAtMs = now;
        this.pendingIntent = intent;
        void this.flushPending();
    }

    private applySnapshot(snapshot: PlaybackSessionSnapshot, acceptSameRevision = false) {
        const current = this.state.snapshot;

        if (current && snapshot.revision < current.revision) {
            return;
        }

        if (!acceptSameRevision && !isNewerPlaybackSnapshot(current, snapshot)) {
            return;
        }

        this.set({
            snapshot,
            receivedAtMs: Date.now(),
            error: null
        });
    }

    private async flushPending() {
        const registration = this.registration;

        if (
            isPlaybackCommandBarrierActive()
            || this.inFlight
            || !this.pendingIntent
            || !registration
        ) {
            return;
        }

        const intent = this.pendingIntent;
        this.pendingIntent = null;
        const token = Symbol('playback-report');
        const identityKey = registrationIdentityKey(registration);
        const claimRequired = this.claimRequired;
        const claimVersion = this.claimVersion;
        this.inFlight = {
            token,
            identityKey,
            intent,
            claimRequired,
            claimVersion
        };
        this.outstandingReports.add(token);
        let continueFlushing = true;
        const input: ReportPlaybackStateInput = {
            deviceId: registration.endpointId,
            registrationGeneration: registration.registrationGeneration,
            registrationProof: registration.registrationProof,
            sequence: nextPlaybackEndpointSequence(),
            claimActive: claimRequired,
            state: intent.local.state,
            currentMusicId: intent.local.currentMusicId,
            positionMs: intent.local.positionMs,
            observedAt: new Date().toISOString()
        };

        try {
            const response = await reportPlaybackState(input);

            if (
                this.inFlight?.token !== token
                || !this.registration
                || registrationIdentityKey(this.registration) !== identityKey
            ) {
                return;
            }

            if (response.type === 'error') {
                this.set({ error: response.errors[0]?.message ?? 'Unable to share playback state.' });

                const registrationRequired = response.errors.some((error) => (
                    error.code === 'PLAYBACK_ENDPOINT_REGISTRATION_REQUIRED'
                ));

                if (response.category === 'network' || registrationRequired) {
                    if (!this.pendingIntent) {
                        this.pendingIntent = intent;
                    }
                    continueFlushing = false;
                }
                return;
            }

            this.applySnapshot(response.reportPlaybackState.session, true);

            if (
                claimRequired
                && this.claimVersion === claimVersion
            ) {
                this.claimRequired = false;
            }
        } finally {
            this.outstandingReports.delete(token);
            if (this.inFlight?.token === token) {
                this.inFlight = null;

                if (continueFlushing && this.pendingIntent) {
                    void this.flushPending();
                }
            }
        }
    }

    private handleRegistrationChanged = (
        registration: PlaybackEndpointRegistrationState | null
    ) => {
        const previousKey = this.registration
            ? registrationIdentityKey(this.registration)
            : null;
        const nextKey = registration ? registrationIdentityKey(registration) : null;

        if (previousKey === nextKey) {
            return;
        }

        const latestIntent = this.pendingIntent ?? this.inFlight?.intent ?? null;
        const previousRegistration = this.registration;
        const previousEndpointWasActive = Boolean(
            previousRegistration
            && this.state.snapshot?.activeDeviceId === previousRegistration.endpointId
        );
        const bufferedEndpointId = this.registrationGapEndpointId
            ?? (previousEndpointWasActive ? previousRegistration?.endpointId ?? null : null);

        if (!registration) {
            this.registrationGapEndpointId = bufferedEndpointId;
        } else {
            this.registrationGapEndpointId = null;
        }

        this.registration = registration;
        this.pendingIntent = latestIntent;
        this.inFlight = null;
        this.set({ endpointId: registration?.endpointId ?? null });

        if (registration) {
            void this.flushPending();
        }
    };

    private handleSocketConnect = () => {
        void this.refresh().finally(() => {
            void this.flushPending();
        });
    };
}

export const playbackSessionStore = new PlaybackSessionStore();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        playbackSessionStore.disconnect();
    });
}
