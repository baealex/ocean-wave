import {
    fetchPlaybackQueue,
    savePlaybackQueue,
    type PlaybackQueueRepeatMode,
    type PlaybackQueueSnapshot
} from '~/api/playback-queue';
import { socket } from '~/socket';
import { isPlaybackCommandBarrierActive } from '~/modules/playback-command-barrier';

import { BaseStore } from './base-store';

export interface LocalPlaybackQueueSnapshot {
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex: number | null;
    shuffle: boolean;
    repeatMode: PlaybackQueueRepeatMode;
}

interface PlaybackQueueStoreState {
    snapshot: PlaybackQueueSnapshot | null;
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
    private sending = false;
    private pending: LocalPlaybackQueueSnapshot | null = null;
    private refreshSequence = 0;

    constructor() {
        super();
        this.state = {
            snapshot: null,
            restoreVersion: 0,
            initialized: false,
            loading: false,
            error: null
        };
    }

    get hasPendingSave() {
        return this.pending !== null || this.sending;
    }

    quiesceForPlaybackCommandRecovery() {
        this.pending = null;
        return !this.sending;
    }

    connect() {
        if (this.connected) {
            return;
        }

        this.connected = true;
        socket.on('connect', this.handleSocketConnect);
        void this.refresh();
    }

    disconnect() {
        if (!this.connected) {
            return;
        }

        this.connected = false;
        this.refreshSequence += 1;
        socket.off('connect', this.handleSocketConnect);
    }

    async refresh(requestTimeoutMs?: number): Promise<PlaybackQueueRefreshResult> {
        const refreshSequence = ++this.refreshSequence;
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

        this.set((state) => ({
            snapshot: response.playbackQueue,
            restoreVersion: state.restoreVersion + 1,
            initialized: true,
            loading: false,
            error: null
        }));
        void this.flushPending();
        return { type: 'success', snapshot: this.state.snapshot };
    }

    save(snapshot: LocalPlaybackQueueSnapshot) {
        if (isPlaybackCommandBarrierActive()) {
            return;
        }

        this.pending = snapshot;

        if (this.state.initialized) {
            void this.flushPending();
        }
    }

    private async flushPending() {
        if (
            isPlaybackCommandBarrierActive()
            || this.sending
            || !this.pending
            || !this.state.initialized
        ) {
            return;
        }

        const pending = this.pending;
        this.pending = null;
        this.sending = true;
        let continueFlushing = true;

        try {
            const response = await savePlaybackQueue({
                ...pending,
                expectedRevision: this.state.snapshot?.revision ?? 0
            });

            if (response.type === 'error') {
                this.set({
                    error: response.errors[0]?.message ?? 'Unable to save the server queue.'
                });

                if (response.category === 'network') {
                    this.pending ??= pending;
                    continueFlushing = false;
                }
                return;
            }

            this.set({
                snapshot: response.savePlaybackQueue.queue,
                error: response.savePlaybackQueue.type === 'conflict'
                    ? 'The server queue changed in another web player.'
                    : null
            });

            if (response.savePlaybackQueue.type === 'conflict') {
                this.pending = null;
                continueFlushing = false;
            }
        } finally {
            this.sending = false;

            if (continueFlushing && this.pending) {
                void this.flushPending();
            }
        }
    }

    private handleSocketConnect = () => {
        void this.refresh();
    };
}

export const playbackQueueStore = new PlaybackQueueStore();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        playbackQueueStore.disconnect();
    });
}
