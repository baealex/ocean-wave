import { BaseStore } from './base-store';

import { musicStore } from './music';
import { playbackSessionStore } from './playback-session';
import { playbackQueueStore } from './playback-queue';
import type { PlaybackQueueSnapshot } from '~/api/playback-queue';

import {
    type AudioChannel,
    type AudioChannelEventHandler,
    WebAudioChannel
} from '~/modules/audio-channel';
import { getNextSelectedIndexAfterRemovingCurrent } from '~/modules/queue-selection';
import {
    deriveQueueState,
    deriveQueueStateFromTrack,
    moveQueueItemToIndex,
    reorderQueueItems,
    restoreQueueState
} from '~/modules/queue-state';
import { toast } from '~/modules/toast';
import { convertToMillisecond } from '~/modules/time';
import { PlaybackSessionTracker } from '~/modules/playback-session';
import {
    deletePlaybackCheckpoint,
    savePlaybackCheckpoint
} from '~/modules/playback-checkpoint-store';
import { MusicListener } from '~/socket';
import { shuffle } from '~/modules/shuffle';

const PLAYBACK_CHECKPOINT_INTERVAL_MS = 10_000;
const SERVER_QUEUE_SAVE_DELAY_MS = 1_000;

interface QueueStoreState {
    selected: number | null;
    currentTrackId: string | null;
    queueLength: number;
    isPlaying: boolean;
    shuffle: boolean;
    insertMode: 'first' | 'last' | 'after';
    repeatMode: 'none' | 'one' | 'all';
    playMode: 'later' | 'immediately';
    mixMode: 'none' | 'mix';
    currentTime: number;
    progress: number;
    items: string[];
    sourceItems: string[];
}

const getMusic = (id: string) => {
    const musicMap = musicStore.state.musicMap;
    return musicMap.get(id);
};

const createQueueState = (items: string[], selected: number | null) => ({
    items,
    ...deriveQueueState(items, selected)
});

const getProgress = (time: number, duration: number | undefined) => {
    if (!duration) {
        return 0;
    }

    return Number((time / duration * 100).toFixed(2));
};

class QueueStore extends BaseStore<QueueStoreState> {
    saveTimer: ReturnType<typeof setTimeout> | null = null;
    audioChannel: AudioChannel;
    playbackSessionTracker: PlaybackSessionTracker;
    lastCheckpointClientSessionId: string | null = null;
    lastCheckpointPlayedMs = 0;
    private musicStoreUnsubscribe: (() => void) | null = null;
    private playbackQueueStoreUnsubscribe: (() => void) | null = null;
    private serverQueueSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private applyingQueueSnapshot = false;
    private musicLoaded = false;
    private appliedRestoreVersion = 0;

    constructor() {
        super();
        this.saveTimer = null;
        this.playbackSessionTracker = new PlaybackSessionTracker();
        this.lastCheckpointClientSessionId = null;
        this.lastCheckpointPlayedMs = 0;
        this.state = {
            selected: null,
            currentTrackId: null,
            queueLength: 0,
            isPlaying: false,
            shuffle: false,
            insertMode: 'last',
            repeatMode: 'none',
            playMode: 'later',
            mixMode: 'none',
            currentTime: 0,
            progress: 0,
            items: [],
            sourceItems: []
        };

        const audioChannelEventHandler: AudioChannelEventHandler = {
            onPlay: () => {
                if (!this.state.currentTrackId) {
                    return;
                }

                const currentMusic = getMusic(this.state.currentTrackId);

                if (currentMusic) {
                    this.playbackSessionTracker.play({
                        id: currentMusic.id,
                        durationMs: convertToMillisecond(currentMusic.duration)
                    });
                }

                this.set({ isPlaying: true });
                this.reportSharedPlaybackState('playing', true);
            },
            onPause: () => {
                const now = Date.now();
                this.playbackSessionTracker.pause(now);
                void this.persistPlaybackCheckpoint('queue-pause', true, now).persisted;
                this.set({ isPlaying: false });
                this.reportSharedPlaybackState('paused');
            },
            onStop: () => {
                const now = Date.now();
                this.playbackSessionTracker.pause(now);
                void this.persistPlaybackCheckpoint('queue-stop', true, now).persisted;
                this.set({ isPlaying: false });
                this.reportSharedPlaybackState('stopped');
            },
            onEnded: () => {
                if (this.state.selected === null) return;

                if (this.state.repeatMode === 'one') {
                    this.commitPlaybackEvent('queue-repeat-one');
                    this.select(this.state.selected);
                    return;
                }
                if (this.state.repeatMode === 'all') {
                    this.commitPlaybackEvent('queue-track-change');
                    this.select((this.state.selected + 1) % this.state.items.length);
                    this.audioChannel.play();
                    return;
                }
                if (this.state.repeatMode === 'none') {
                    if (this.state.selected + 1 < this.state.items.length) {
                        this.commitPlaybackEvent('queue-track-change');
                        this.select(this.state.selected + 1);
                        this.audioChannel.play();
                    } else {
                        this.commitPlaybackEvent('queue-ended');
                        this.audioChannel.stop();
                        this.set({ isPlaying: false });
                    }
                }
            },
            onTimeUpdate: (time, mix) => {
                const music = this.state.currentTrackId
                    ? getMusic(this.state.currentTrackId)
                    : undefined;
                const progress = Number((time / (music?.duration || 1) * 100).toFixed(2));

                if (this.state.mixMode === 'mix') {
                    mix(20, () => undefined);
                }

                const now = Date.now();

                this.playbackSessionTracker.tick(now);
                void this.persistPlaybackCheckpoint('queue-checkpoint', false, now).persisted;
                this.set({
                    currentTime: time,
                    progress
                });
                this.reportSharedPlaybackState('playing', false, time, true);
            },
            onSkipToNext: () => {
                this.next();
            },
            onSkipToPrevious: () => {
                this.prev();
            }
        };

        this.audioChannel = new WebAudioChannel(audioChannelEventHandler);

        this.playbackQueueStoreUnsubscribe = playbackQueueStore.subscribe((state, previousState) => {
            if (state.error && state.error !== previousState.error) {
                toast(state.error);
            }

            if (!this.musicLoaded || state.restoreVersion === this.appliedRestoreVersion) {
                return;
            }

            this.appliedRestoreVersion = state.restoreVersion;

            if (playbackQueueStore.hasPendingSave) {
                return;
            }

            if (state.snapshot) {
                void this.restoreServerQueue(state.snapshot);
                return;
            }

            if (this.state.items.length > 0) {
                this.saveServerQueue();
            }
        });

        this.musicStoreUnsubscribe = musicStore.subscribe(async ({ loaded }) => {
            if (loaded) {
                this.musicLoaded = true;
                this.applyingQueueSnapshot = true;
                const queue = localStorage.getItem('queue');
                if (queue) {
                    const persistedState = JSON.parse(queue) as Partial<QueueStoreState>;
                    const restoredQueueState = restoreQueueState(
                        persistedState,
                        id => getMusic(id) !== undefined,
                        id => getMusic(id)?.duration
                    );

                    await this.set({
                        ...restoredQueueState,
                        isPlaying: false,
                        shuffle: persistedState.shuffle ?? false,
                        insertMode: persistedState.insertMode ?? 'last',
                        repeatMode: persistedState.repeatMode ?? 'none',
                        playMode: persistedState.playMode ?? 'later',
                        mixMode: persistedState.mixMode ?? 'none',
                        progress: getProgress(
                            restoredQueueState.currentTime,
                            restoredQueueState.currentTrackId
                                ? getMusic(restoredQueueState.currentTrackId)?.duration
                                : undefined
                        )
                    });

                    if (restoredQueueState.selected !== null) {
                        this.select(restoredQueueState.selected, false);
                        if (restoredQueueState.currentTime > 0) {
                            this.audioChannel.seek(restoredQueueState.currentTime);
                            this.set({
                                currentTime: restoredQueueState.currentTime,
                                progress: getProgress(
                                    restoredQueueState.currentTime,
                                    restoredQueueState.currentTrackId
                                        ? getMusic(restoredQueueState.currentTrackId)?.duration
                                        : undefined
                                )
                            });
                        }
                    }
                }
                this.applyingQueueSnapshot = false;

                if (playbackQueueStore.state.initialized) {
                    this.appliedRestoreVersion = playbackQueueStore.state.restoreVersion;

                    if (playbackQueueStore.state.snapshot && !playbackQueueStore.hasPendingSave) {
                        await this.restoreServerQueue(playbackQueueStore.state.snapshot);
                    } else if (!playbackQueueStore.state.snapshot && this.state.items.length > 0) {
                        this.saveServerQueue();
                    }
                }
                this.musicStoreUnsubscribe?.();
                this.musicStoreUnsubscribe = null;
            }
        });

        window.addEventListener('beforeunload', this.handleBeforeUnload);
        window.addEventListener('pagehide', this.handlePageHide);
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    commitPlaybackEvent(source: string) {
        const now = Date.now();
        const { checkpoint, persisted } = this.persistPlaybackCheckpoint(source, true, now);
        const payload = this.playbackSessionTracker.commit(now);

        if (!payload || !checkpoint) {
            return;
        }

        void this.flushCommittedPlaybackEvent(payload.clientSessionId, persisted, {
            ...payload,
            source
        });
    }

    async reset(ids: string[]) {
        this.commitPlaybackEvent('queue-reset');
        this.reportSharedPlaybackState('stopped');

        await this.set({
            ...createQueueState(ids, null),
            sourceItems: [],
            shuffle: false,
            currentTime: 0,
            progress: 0,
            isPlaying: false
        });
        this.select(0);
    }

    async add(id: string) {
        if (this.state.items.includes(id)) {
            if (this.state.playMode === 'immediately') {
                this.select(this.state.items.indexOf(id));
                return;
            }
            toast('Already added to queue');
            return;
        }

        const currentTrackId = this.state.currentTrackId;
        let nextItems = this.state.items;
        let nextSourceItems = this.state.sourceItems;

        if (this.state.shuffle) {
            nextSourceItems = [...this.state.sourceItems, id];
        }
        if (this.state.insertMode === 'first') {
            nextItems = [id, ...this.state.items];
        }
        if (this.state.insertMode === 'last') {
            nextItems = [...this.state.items, id];
        }
        if (this.state.insertMode === 'after') {
            if (this.state.selected === null) {
                nextItems = [...this.state.items, id];
            } else {
                nextItems = [
                    ...this.state.items.slice(0, this.state.selected + 1),
                    id,
                    ...this.state.items.slice(this.state.selected + 1)
                ];
            }
        }

        const nextQueueState = deriveQueueStateFromTrack(nextItems, currentTrackId);

        this.set({
            ...nextQueueState,
            items: nextItems,
            sourceItems: nextSourceItems
        });

        toast('Added to queue');
        if (this.state.playMode === 'immediately') {
            this.select(nextItems.indexOf(id));
            return;
        }
        if (nextQueueState.selected === null) {
            this.select(0);
        }
    }

    async removeItems(ids: string[]) {
        const newItems = this.state.items.filter((i) => !ids.includes(i));
        const newSourceItems = this.state.sourceItems.filter((i) => !ids.includes(i));

        const prevSelected = this.state.selected;
        const prevSelectedItem = this.state.currentTrackId;

        if (prevSelectedItem && ids.includes(prevSelectedItem)) {
            this.commitPlaybackEvent('queue-remove');
        }

        if (newItems.length === 0) {
            this.reportSharedPlaybackState('stopped');
        }

        await this.set({
            ...deriveQueueStateFromTrack(newItems, prevSelectedItem),
            items: newItems,
            sourceItems: newSourceItems
        });

        if (newItems.length === 0) {
            this.audioChannel.stop();
            this.set({
                currentTime: 0,
                progress: 0,
                isPlaying: false
            });
            return;
        }

        if (prevSelectedItem) {
            if (!ids.includes(prevSelectedItem)) {
                return;
            }
            if (ids.includes(prevSelectedItem)) {
                this.select(getNextSelectedIndexAfterRemovingCurrent(
                    prevSelected!,
                    this.state.items.length
                ));
                return;
            }
        }
    }

    select(index: number, play = true) {
        this.commitPlaybackEvent('queue-track-change');

        const nextQueueState = createQueueState(this.state.items, index);

        this.set({
            ...nextQueueState,
            progress: 0,
            currentTime: 0,
            isPlaying: play
        });

        const music = nextQueueState.currentTrackId
            ? getMusic(nextQueueState.currentTrackId)
            : undefined;
        if (music === undefined) return;

        document.title = `${music.name} - ${music.artist.name}`;

        this.audioChannel.load(music);
        play && this.audioChannel.play();
    }

    play() {
        if (this.state.selected !== null) {
            this.audioChannel.play();
        }
    }

    pause() {
        this.audioChannel.pause();
    }

    stop() {
        this.commitPlaybackEvent('queue-stop');
        this.audioChannel.stop();
    }

    seek(time: number) {
        this.audioChannel.seek(time);
        this.reportSharedPlaybackState(
            this.state.isPlaying ? 'playing' : 'paused',
            this.state.isPlaying,
            time
        );
    }

    setPlayMode(mode: 'later' | 'immediately') {
        this.set({ playMode: mode });
    }

    setInsertMode(mode: 'first' | 'last' | 'after') {
        this.set({ insertMode: mode });
    }

    setMixMode(mode: 'none' | 'mix') {
        this.set({ mixMode: mode });
    }

    changeRepeatMode() {
        const repeatRotate = ['none', 'all', 'one'] as const;
        const current = repeatRotate.indexOf(this.state.repeatMode);
        const next = repeatRotate[(current + 1) % repeatRotate.length];
        this.set({ repeatMode: next });
    }

    reorder(activeId: string, overId: string) {
        const nextItems = reorderQueueItems(this.state.items, activeId, overId);

        if (nextItems === this.state.items) {
            return;
        }

        this.set({
            ...deriveQueueStateFromTrack(nextItems, this.state.currentTrackId),
            items: nextItems
        });
    }

    reorderToIndex(activeId: string, targetIndex: number) {
        const nextItems = moveQueueItemToIndex(this.state.items, activeId, targetIndex);

        if (nextItems === this.state.items) {
            return;
        }

        this.set({
            ...deriveQueueStateFromTrack(nextItems, this.state.currentTrackId),
            items: nextItems
        });
    }

    toggleShuffle() {
        const selectedMusic = this.state.currentTrackId;

        if (!selectedMusic) {
            return;
        }

        if (this.state.shuffle) {
            const nextItems = [...this.state.sourceItems];

            this.set({
                shuffle: false,
                ...deriveQueueStateFromTrack(nextItems, selectedMusic),
                items: nextItems,
                sourceItems: []
            });
            return;
        }

        const newItems = shuffle([...this.state.items]).filter((item) =>
            item !== selectedMusic
        );
        newItems.unshift(selectedMusic);

        this.set({
            shuffle: true,
            ...deriveQueueStateFromTrack(newItems, selectedMusic),
            items: newItems,
            sourceItems: [...this.state.items]
        });
    }

    next() {
        if (this.state.selected !== null) {
            this.select((this.state.selected + 1) % this.state.items.length);
            this.audioChannel.play();
        }
    }

    prev() {
        if (this.state.selected !== null) {
            if (this.state.currentTime > 10) {
                this.audioChannel.seek(0);
                return;
            }
            this.select((this.state.selected - 1 + this.state.items.length) % this.state.items.length);
            this.audioChannel.play();
        }
    }

    download(id: string) {
        this.audioChannel.download(getMusic(id)!);
    }

    afterStateChange(state: QueueStoreState, previousState: QueueStoreState) {
        if (
            this.musicLoaded
            && !this.applyingQueueSnapshot
            && this.hasServerQueueChange(state, previousState)
        ) {
            this.scheduleServerQueueSave();
        }

        if (this.saveTimer) {
            return;
        }

        this.saveTimer = setTimeout(() => {
            this.persistQueueState();
            this.saveTimer = null;
        }, 3000);
    }

    dispose() {
        this.persistQueueState();

        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        if (this.serverQueueSaveTimer) {
            clearTimeout(this.serverQueueSaveTimer);
            this.serverQueueSaveTimer = null;
            this.saveServerQueue();
        }

        this.musicStoreUnsubscribe?.();
        this.musicStoreUnsubscribe = null;
        this.playbackQueueStoreUnsubscribe?.();
        this.playbackQueueStoreUnsubscribe = null;
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
        window.removeEventListener('pagehide', this.handlePageHide);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        this.audioChannel.dispose();
    }

    private persistQueueState() {
        localStorage.setItem('queue', JSON.stringify({
            ...this.state,
            isPlaying: false
        }));
    }

    private hasServerQueueChange(state: QueueStoreState, previousState: QueueStoreState) {
        return state.items !== previousState.items
            || state.sourceItems !== previousState.sourceItems
            || state.selected !== previousState.selected
            || state.shuffle !== previousState.shuffle
            || state.repeatMode !== previousState.repeatMode;
    }

    private scheduleServerQueueSave() {
        if (this.serverQueueSaveTimer) {
            clearTimeout(this.serverQueueSaveTimer);
        }

        this.serverQueueSaveTimer = setTimeout(() => {
            this.serverQueueSaveTimer = null;
            this.saveServerQueue();
        }, SERVER_QUEUE_SAVE_DELAY_MS);
    }

    private saveServerQueue() {
        if (!this.musicLoaded || this.applyingQueueSnapshot) {
            return;
        }

        playbackQueueStore.save({
            musicIds: this.state.items,
            sourceMusicIds: this.state.shuffle ? this.state.sourceItems : [],
            currentIndex: this.state.selected,
            shuffle: this.state.shuffle,
            repeatMode: this.state.repeatMode
        });
    }

    private async restoreServerQueue(snapshot: PlaybackQueueSnapshot) {
        if (this.state.isPlaying) {
            return;
        }

        this.applyingQueueSnapshot = true;

        try {
            const selectedMusicId = snapshot.currentIndex === null
                ? null
                : snapshot.musicIds[snapshot.currentIndex];
            const resumeTime = selectedMusicId === this.state.currentTrackId
                ? this.state.currentTime
                : 0;
            const restoredQueueState = restoreQueueState({
                items: snapshot.musicIds,
                sourceItems: snapshot.sourceMusicIds,
                selected: snapshot.currentIndex,
                currentTrackId: selectedMusicId,
                currentTime: resumeTime
            }, id => getMusic(id) !== undefined, id => getMusic(id)?.duration);
            const progress = getProgress(
                restoredQueueState.currentTime,
                restoredQueueState.currentTrackId
                    ? getMusic(restoredQueueState.currentTrackId)?.duration
                    : undefined
            );

            await this.set({
                ...restoredQueueState,
                isPlaying: false,
                shuffle: snapshot.shuffle,
                repeatMode: snapshot.repeatMode,
                progress
            });

            const music = restoredQueueState.currentTrackId
                ? getMusic(restoredQueueState.currentTrackId)
                : undefined;

            if (music) {
                document.title = `${music.name} - ${music.artist.name}`;
                this.audioChannel.load(music);

                if (restoredQueueState.currentTime > 0) {
                    this.audioChannel.seek(restoredQueueState.currentTime);
                }
            }
        } finally {
            this.applyingQueueSnapshot = false;
        }
    }

    private handleBeforeUnload = () => {
        this.commitPlaybackEvent('queue-unload');
        this.persistQueueState();
        this.audioChannel.stop();
    };

    private handlePageHide = () => {
        this.persistQueueState();
        this.reportSharedPlaybackState(
            this.state.isPlaying ? 'playing' : 'paused'
        );
        void this.persistPlaybackCheckpoint('queue-pagehide', true).persisted;
    };

    private handleVisibilityChange = () => {
        if (document.hidden) {
            this.persistQueueState();
            this.reportSharedPlaybackState(
                this.state.isPlaying ? 'playing' : 'paused'
            );
            void this.persistPlaybackCheckpoint('queue-visibilitychange', true).persisted;
        }
    };

    private reportSharedPlaybackState(
        state: 'playing' | 'paused' | 'stopped',
        claimActive = false,
        currentTime = this.state.currentTime,
        checkpoint = false
    ) {
        if (!this.state.currentTrackId) {
            return;
        }

        playbackSessionStore.report({
            state,
            currentMusicId: this.state.currentTrackId,
            positionMs: convertToMillisecond(currentTime)
        }, {
            claimActive,
            checkpoint
        });
    }

    private persistPlaybackCheckpoint(source: string, force: boolean, now = Date.now()) {
        const checkpoint = this.playbackSessionTracker.createCheckpoint(source, now);

        if (!checkpoint) {
            return {
                checkpoint: null,
                persisted: Promise.resolve()
            };
        }

        if (this.lastCheckpointClientSessionId !== checkpoint.clientSessionId) {
            this.lastCheckpointClientSessionId = checkpoint.clientSessionId;
            this.lastCheckpointPlayedMs = 0;
        }

        const playedDelta = checkpoint.accumulatedPlayedMs - this.lastCheckpointPlayedMs;

        if (!force && playedDelta < PLAYBACK_CHECKPOINT_INTERVAL_MS) {
            return {
                checkpoint,
                persisted: Promise.resolve()
            };
        }

        this.lastCheckpointClientSessionId = checkpoint.clientSessionId;
        this.lastCheckpointPlayedMs = checkpoint.accumulatedPlayedMs;
        const persisted = savePlaybackCheckpoint(checkpoint);

        return {
            checkpoint,
            persisted
        };
    }

    private async flushCommittedPlaybackEvent(
        clientSessionId: string,
        persisted: Promise<void>,
        payload: Parameters<typeof MusicListener.count>[0]
    ) {
        await persisted;

        const delivered = await MusicListener.count(payload);

        if (!delivered) {
            return;
        }

        await deletePlaybackCheckpoint(clientSessionId);
    }
}

export const queueStore = new QueueStore();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        queueStore.dispose();
    });
}
