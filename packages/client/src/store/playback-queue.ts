import {
    fetchPlaybackQueue,
    type PlaybackQueueContext,
    type PlaybackQueueRepeatMode,
    type PlaybackQueueSnapshot,
    savePlaybackQueue
} from '~/api/playback-queue';
import { isPlaybackCommandBarrierActive } from '~/modules/playback-command-barrier';
import { PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS } from '~/modules/playback-controller';
import {
    isOwnRealtimeNotification,
    PLAYBACK_QUEUE_INVALIDATED,
    type PlaybackQueueInvalidatedNotification,
    socket
} from '~/socket';

import { BaseStore } from './base-store';

export interface LocalPlaybackQueueSnapshot {
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex: number | null;
    context: PlaybackQueueContext;
    shuffle: boolean;
    repeatMode: PlaybackQueueRepeatMode;
}

export interface PlaybackQueueConflictState {
    authoritative: PlaybackQueueSnapshot;
    local: LocalPlaybackQueueSnapshot;
}

interface PendingPlaybackQueueSave {
    local: LocalPlaybackQueueSnapshot;
    expectedRevision: number;
    followsSaveToken: symbol | null;
}

interface InFlightPlaybackQueueSave {
    token: symbol;
    request: PendingPlaybackQueueSave;
}

interface PlaybackQueueStoreState {
    snapshot: PlaybackQueueSnapshot | null;
    conflict: PlaybackQueueConflictState | null;
    restoreVersion: number;
    initialized: boolean;
    loading: boolean;
    error: string | null;
}

export type PlaybackQueueRefreshResult =
    | { type: 'success'; snapshot: PlaybackQueueSnapshot | null }
    | { type: 'error' | 'superseded' };

export class PlaybackQueueStore extends BaseStore<PlaybackQueueStoreState> {
    private connected = false;
    private inFlight: InFlightPlaybackQueueSave | null = null;
    private pending: PendingPlaybackQueueSave | null = null;
    private refreshSequence = 0;
    private snapshotVersion = 0;

    constructor() {
        super();
        this.state = {
            snapshot: null,
            conflict: null,
            restoreVersion: 0,
            initialized: false,
            loading: false,
            error: null
        };
    }

    get hasPendingSave() {
        return this.pending !== null
            || this.inFlight !== null
            || this.state.conflict !== null;
    }

    quiesceForPlaybackCommandRecovery() {
        this.pending = null;
        return this.inFlight === null && this.state.conflict === null;
    }

    adoptExternalSnapshot(snapshot: PlaybackQueueSnapshot) {
        const current = this.state.snapshot;

        if (current && current.revision > snapshot.revision) {
            return current;
        }

        this.refreshSequence += 1;
        this.snapshotVersion += 1;
        this.set({
            snapshot,
            conflict: null,
            initialized: true,
            loading: false,
            error: null
        });
        return snapshot;
    }

    connect() {
        if (this.connected) {
            return;
        }

        this.connected = true;
        socket.on('connect', this.handleSocketConnect);
        socket.on(PLAYBACK_QUEUE_INVALIDATED, this.handleQueueInvalidated);
        void this.refresh();
    }

    disconnect() {
        if (!this.connected) {
            return;
        }

        this.connected = false;
        this.refreshSequence += 1;
        socket.off('connect', this.handleSocketConnect);
        socket.off(PLAYBACK_QUEUE_INVALIDATED, this.handleQueueInvalidated);
    }

    async refresh(
        requestTimeoutMs = PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
    ): Promise<PlaybackQueueRefreshResult> {
        const refreshSequence = ++this.refreshSequence;
        const snapshotVersion = this.snapshotVersion;
        const snapshotAtStart = this.state.snapshot;
        this.set({ loading: true });
        const response = await fetchPlaybackQueue(requestTimeoutMs);

        if (refreshSequence !== this.refreshSequence) {
            return { type: 'superseded' };
        }

        if (response.type === 'error') {
            this.set({
                initialized: true,
                loading: false,
                error: response.errors[0]?.message ?? 'Unable to read the server queue.'
            });
            return { type: 'error' };
        }

        const refreshed = response.playbackQueue;
        const current = this.state.snapshot;
        const shouldApplySnapshot = Boolean(
            refreshed
            && (!current || refreshed.revision > current.revision)
        );
        const shouldApplyNull = !refreshed
            && snapshotVersion === this.snapshotVersion
            && this.state.snapshot === snapshotAtStart;

        if (shouldApplySnapshot || shouldApplyNull) {
            this.snapshotVersion += 1;
            this.set((state) => ({
                snapshot: refreshed,
                conflict: state.conflict && refreshed
                    ? {
                        ...state.conflict,
                        authoritative: refreshed
                    }
                    : state.conflict,
                restoreVersion: state.restoreVersion + 1,
                initialized: true,
                loading: false,
                error: state.conflict ? state.error : null
            }));
        } else {
            this.set((state) => ({
                initialized: true,
                loading: false,
                error: state.conflict ? state.error : null
            }));
        }
        void this.flushPending();
        return { type: 'success', snapshot: this.state.snapshot };
    }

    save(snapshot: LocalPlaybackQueueSnapshot) {
        if (isPlaybackCommandBarrierActive()) {
            return;
        }

        if (this.state.conflict) {
            this.set({
                conflict: {
                    ...this.state.conflict,
                    local: snapshot
                }
            });
            return;
        }

        const lineage = this.pending ?? this.inFlight?.request ?? null;
        this.pending = {
            local: snapshot,
            expectedRevision: lineage?.expectedRevision
                ?? this.state.snapshot?.revision
                ?? 0,
            followsSaveToken: this.pending?.followsSaveToken
                ?? this.inFlight?.token
                ?? null
        };

        if (this.state.initialized) {
            void this.flushPending();
        }
    }

    retryConflict() {
        const conflict = this.state.conflict;
        if (!conflict || this.inFlight) {
            return false;
        }

        this.pending = {
            local: conflict.local,
            expectedRevision: conflict.authoritative.revision,
            followsSaveToken: null
        };
        this.set({ conflict: null, error: null });
        void this.flushPending();
        return true;
    }

    acceptServerConflict() {
        if (!this.state.conflict) {
            return false;
        }

        this.pending = null;
        this.set((state) => ({
            conflict: null,
            error: null,
            restoreVersion: state.restoreVersion + 1
        }));
        return true;
    }

    private async flushPending() {
        if (
            isPlaybackCommandBarrierActive()
            || this.inFlight
            || !this.pending
            || !this.state.initialized
        ) {
            return;
        }

        const pending = this.pending;
        this.pending = null;
        const token = Symbol('playback-queue-save');
        this.inFlight = { token, request: pending };
        let continueFlushing = true;

        try {
            const response = await savePlaybackQueue({
                musicIds: pending.local.musicIds,
                sourceMusicIds: pending.local.sourceMusicIds,
                currentIndex: pending.local.currentIndex,
                contextType: pending.local.context.type,
                contextId: pending.local.context.id,
                contextTitle: pending.local.context.title,
                shuffle: pending.local.shuffle,
                repeatMode: pending.local.repeatMode,
                expectedRevision: pending.expectedRevision
            });

            if (response.type === 'error') {
                this.set({
                    error: response.errors[0]?.message ?? 'Unable to save the server queue.'
                });

                if (response.category === 'network') {
                    const queued = this.pending as PendingPlaybackQueueSave | null;
                    if (!queued) {
                        this.pending = {
                            ...pending,
                            followsSaveToken: null
                        };
                    } else if (queued.followsSaveToken === token) {
                        this.pending = {
                            ...queued,
                            followsSaveToken: null
                        };
                    }
                    continueFlushing = false;
                }
                return;
            }

            const result = response.savePlaybackQueue;
            if (result.type === 'conflict') {
                const queued = this.pending as PendingPlaybackQueueSave | null;
                const latestLocal = queued?.followsSaveToken === token
                    ? queued.local
                    : pending.local;
                const authoritative = this.state.snapshot
                    && this.state.snapshot.revision >= result.queue.revision
                    ? this.state.snapshot
                    : result.queue;
                if (queued?.followsSaveToken === token) {
                    this.pending = null;
                }
                if (authoritative !== this.state.snapshot) {
                    this.snapshotVersion += 1;
                }
                this.set({
                    snapshot: authoritative,
                    conflict: {
                        authoritative,
                        local: latestLocal
                    },
                    error: 'The server queue changed in another web player.'
                });
                continueFlushing = false;
                return;
            }

            const queued = this.pending as PendingPlaybackQueueSave | null;
            if (queued?.followsSaveToken === token) {
                this.pending = {
                    ...queued,
                    expectedRevision: result.queue.revision,
                    followsSaveToken: null
                };
            }

            const authoritative = this.state.snapshot
                && this.state.snapshot.revision >= result.queue.revision
                ? this.state.snapshot
                : result.queue;
            if (authoritative !== this.state.snapshot) {
                this.snapshotVersion += 1;
            }

            this.set({
                snapshot: authoritative,
                conflict: null,
                error: null
            });
        } finally {
            if (this.inFlight?.token === token) {
                this.inFlight = null;
            }

            if (continueFlushing && this.pending) {
                void this.flushPending();
            }
        }
    }

    private handleSocketConnect = () => {
        void this.refresh();
    };

    private handleQueueInvalidated = (
        notification: PlaybackQueueInvalidatedNotification
    ) => {
        if (
            isOwnRealtimeNotification(notification)
            || (
                Number.isSafeInteger(notification.revision)
                && this.state.snapshot
                && this.state.snapshot.revision >= notification.revision
            )
        ) {
            return;
        }

        void this.refresh();
    };
}

export const playbackQueueStore = new PlaybackQueueStore();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        playbackQueueStore.disconnect();
    });
}
