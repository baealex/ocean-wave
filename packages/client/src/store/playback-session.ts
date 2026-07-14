import {
    fetchPlaybackSession,
    reportPlaybackState,
    type PlaybackSessionSnapshot,
    type ReportPlaybackStateInput,
    type SharedPlaybackState
} from '~/api/playback-session';
import {
    getPlaybackDeviceId,
    nextPlaybackDeviceSequence
} from '~/modules/playback-device';
import { isNewerPlaybackSnapshot } from '~/modules/shared-playback';
import {
    PlaybackListener,
    socket
} from '~/socket';

import { BaseStore } from './base-store';

const PLAYBACK_REPORT_INTERVAL_MS = 10_000;

interface PlaybackSessionStoreState {
    snapshot: PlaybackSessionSnapshot | null;
    receivedAtMs: number;
    loading: boolean;
    error: string | null;
}

interface LocalPlaybackReport {
    state: SharedPlaybackState;
    currentMusicId: string | null;
    positionMs: number;
}

interface ReportOptions {
    claimActive?: boolean;
    checkpoint?: boolean;
}

export class PlaybackSessionStore extends BaseStore<PlaybackSessionStoreState> {
    private listener = new PlaybackListener();
    private connected = false;
    private sending = false;
    private pending: ReportPlaybackStateInput | null = null;
    private hasPendingClaim = false;
    private lastReportAtMs = 0;

    constructor() {
        super();
        this.state = {
            snapshot: null,
            receivedAtMs: 0,
            loading: false,
            error: null
        };
    }

    get deviceId() {
        return getPlaybackDeviceId();
    }

    connect() {
        if (this.connected) {
            return;
        }

        this.connected = true;
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
    }

    async refresh() {
        this.set({ loading: true });
        const response = await fetchPlaybackSession();

        if (response.type === 'error') {
            this.set({
                loading: false,
                error: response.errors[0]?.message ?? 'Unable to read shared playback state.'
            });
            return;
        }

        if (response.playbackSession) {
            this.applySnapshot(response.playbackSession, true);
        }
        this.set({ loading: false, error: null });
    }

    report(local: LocalPlaybackReport, options: ReportOptions = {}) {
        const now = Date.now();
        const claimActive = options.claimActive === true;
        const isCurrentDeviceActive = this.state.snapshot?.activeDeviceId === this.deviceId;

        if (options.checkpoint && now - this.lastReportAtMs < PLAYBACK_REPORT_INTERVAL_MS) {
            return;
        }

        if (!claimActive && !this.hasPendingClaim && !isCurrentDeviceActive) {
            return;
        }

        const input: ReportPlaybackStateInput = {
            deviceId: this.deviceId,
            sequence: nextPlaybackDeviceSequence(),
            claimActive,
            state: local.state,
            currentMusicId: local.currentMusicId,
            positionMs: Math.max(Math.round(local.positionMs), 0),
            observedAt: new Date(now).toISOString()
        };

        if (claimActive) {
            this.hasPendingClaim = true;
        }
        this.lastReportAtMs = now;
        this.pending = input;
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

        this.hasPendingClaim = snapshot.activeDeviceId === this.deviceId;
        this.set({
            snapshot,
            receivedAtMs: Date.now(),
            error: null
        });
    }

    private async flushPending() {
        if (this.sending || !this.pending) {
            return;
        }

        const input = this.pending;
        this.pending = null;
        this.sending = true;
        let continueFlushing = true;

        try {
            const response = await reportPlaybackState(input);

            if (response.type === 'error') {
                this.set({ error: response.errors[0]?.message ?? 'Unable to share playback state.' });

                if (response.category === 'network') {
                    const pendingAfterRequest = this.pending as ReportPlaybackStateInput | null;

                    if (!pendingAfterRequest || pendingAfterRequest.sequence < input.sequence) {
                        this.pending = input;
                    }
                    continueFlushing = false;
                }
                return;
            }

            this.applySnapshot(response.reportPlaybackState.session, true);

            if (response.reportPlaybackState.type === 'conflict') {
                this.hasPendingClaim = false;
            }
        } finally {
            this.sending = false;

            if (continueFlushing && this.pending) {
                void this.flushPending();
            }
        }
    }

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
