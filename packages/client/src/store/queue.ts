import type { PlaybackQueueSnapshot } from '~/api/playback-queue';
import {
    type AudioChannel,
    type AudioChannelEventHandler,
    WebAudioChannel
} from '~/modules/audio-channel';
import {
    deletePlaybackCheckpoint,
    savePlaybackCheckpoint
} from '~/modules/playback-checkpoint-store';
import {
    isLocalPlaybackMutationBarrierActive,
    isPlaybackCommandBarrierActive,
    isPlaybackCommandExecutionBarrierActive,
    isPlaybackControllerCommandBarrierActive
} from '~/modules/playback-command-barrier';
import { isRemotePlaybackOwnershipActive } from '~/modules/playback-ownership';
import { PlaybackSessionTracker } from '~/modules/playback-session';
import { getNextSelectedIndexAfterRemovingCurrent } from '~/modules/queue-selection';
import {
    deriveQueueState,
    deriveQueueStateFromTrack,
    moveQueueItemToIndex,
    reorderQueueItems,
    restoreQueueState
} from '~/modules/queue-state';
import { resolveSharedPlaybackPositionMs } from '~/modules/shared-playback';
import { shuffle } from '~/modules/shuffle';
import { convertToMillisecond, convertToSecond } from '~/modules/time';
import { toast } from '~/modules/toast';
import { MusicListener } from '~/socket';
import type {
    PlaybackCommandDispatch,
    PlaybackCommandError,
    PlaybackCommandState
} from '~/socket/playback-command-contract';
import { BaseStore } from './base-store';
import { musicStore } from './music';
import { playbackQueueStore } from './playback-queue';
import { playbackSessionStore } from './playback-session';

const PLAYBACK_CHECKPOINT_INTERVAL_MS = 10_000;
const SERVER_QUEUE_SAVE_DELAY_MS = 1_000;
const PLAYBACK_COMMAND_RECOVERY_REQUEST_TIMEOUT_MS = 5_000;
const PLAYBACK_COMMAND_MEDIA_RECOVERY_TIMEOUT_MS = 2_000;

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

const playbackCommandError = (
    code: PlaybackCommandError['code'],
    message: string,
    retryable = false
): PlaybackCommandError => ({ code, message, retryable });

const remotePlaybackOwnsAudio = () => isRemotePlaybackOwnershipActive(
    playbackSessionStore.state.snapshot,
    playbackSessionStore.endpointId
);

const controllerCommandBlocksAudioCallbacks = () => (
    isPlaybackControllerCommandBarrierActive()
    && !isPlaybackCommandExecutionBarrierActive()
);

const isLocalAudioClaimBlocked = () => (
    controllerCommandBlocksAudioCallbacks()
    || remotePlaybackOwnsAudio()
);

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
                if (isLocalAudioClaimBlocked()) {
                    this.audioChannel.pause();
                    this.set({ isPlaying: false });
                    return;
                }

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
                if (isLocalPlaybackMutationBarrierActive() || remotePlaybackOwnsAudio()) return;
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
                if (isLocalAudioClaimBlocked()) {
                    return;
                }

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

            if (
                !this.musicLoaded
                || isPlaybackCommandBarrierActive()
                || state.restoreVersion === this.appliedRestoreVersion
            ) {
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
        if (isLocalPlaybackMutationBarrierActive() || remotePlaybackOwnsAudio()) return;
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
        if (isLocalPlaybackMutationBarrierActive()) return;
        const localClaimBlocked = remotePlaybackOwnsAudio();
        if (this.state.items.includes(id)) {
            if (this.state.playMode === 'immediately' && !localClaimBlocked) {
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
        if (localClaimBlocked) {
            return;
        }
        if (this.state.playMode === 'immediately') {
            this.select(nextItems.indexOf(id));
            return;
        }
        if (nextQueueState.selected === null) {
            this.select(0);
        }
    }

    async removeItems(ids: string[]) {
        if (isLocalPlaybackMutationBarrierActive()) return;
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
        if (isLocalPlaybackMutationBarrierActive()) return;
        if (play && remotePlaybackOwnsAudio()) return;
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
        if (isLocalPlaybackMutationBarrierActive() || remotePlaybackOwnsAudio()) return;
        if (this.state.selected !== null) {
            this.audioChannel.play();
        }
    }

    pause() {
        if (isLocalPlaybackMutationBarrierActive()) return;
        this.audioChannel.pause();
    }

    stop() {
        if (isLocalPlaybackMutationBarrierActive()) return;
        this.commitPlaybackEvent('queue-stop');
        this.audioChannel.stop();
    }

    seek(time: number) {
        if (isLocalPlaybackMutationBarrierActive()) return;
        this.audioChannel.seek(time);
        this.reportSharedPlaybackState(
            this.state.isPlaying ? 'playing' : 'paused',
            this.state.isPlaying,
            time
        );
    }

    preparePlaybackCommand(dispatch: PlaybackCommandDispatch): PlaybackCommandError | null {
        if (isPlaybackControllerCommandBarrierActive()) {
            return playbackCommandError(
                'TARGET_STATE_MISMATCH',
                'This player is already controlling another playback command.',
                true
            );
        }

        const session = playbackSessionStore.state.snapshot;
        const queue = playbackQueueStore.state.snapshot;

        if (
            playbackSessionStore.hasPendingReport
            || playbackQueueStore.hasPendingSave
            || this.serverQueueSaveTimer
        ) {
            return playbackCommandError(
                'TARGET_STATE_MISMATCH',
                'The target has a playback snapshot write in progress.',
                true
            );
        }

        if (
            !session
            || session.revision !== dispatch.expectedSource.sessionRevision
            || session.activeDeviceId !== dispatch.targetEndpointId
            || session.state !== dispatch.expectedSource.state
            || session.currentMusicId !== dispatch.expectedSource.currentMusicId
        ) {
            return playbackCommandError(
                'TARGET_STATE_MISMATCH',
                'The target playback session does not match the command source.',
                true
            );
        }

        if (
            dispatch.expectedSource.queueRevision !== null
            && (
                !queue
                || queue.revision !== dispatch.expectedSource.queueRevision
                || queue.currentIndex !== dispatch.expectedSource.currentIndex
                || queue.shuffle !== this.state.shuffle
                || queue.repeatMode !== this.state.repeatMode
                || queue.musicIds.length !== this.state.items.length
                || queue.musicIds.some((id, index) => id !== this.state.items[index])
                || queue.sourceMusicIds.length !== this.state.sourceItems.length
                || queue.sourceMusicIds.some(
                    (id, index) => id !== this.state.sourceItems[index]
                )
            )
        ) {
            return playbackCommandError(
                'TARGET_STATE_MISMATCH',
                'The target playback queue does not match the command source.',
                true
            );
        }

        const localState = this.state.isPlaying ? 'playing' : (
            session.state === 'stopped' ? 'stopped' : 'paused'
        );
        const localTrackMatches = session.state === 'stopped'
            ? true
            : this.state.currentTrackId === dispatch.expectedSource.currentMusicId;

        if (
            localState !== dispatch.expectedSource.state
            || !localTrackMatches
            || this.state.selected !== dispatch.expectedSource.currentIndex
        ) {
            return playbackCommandError(
                'TARGET_STATE_MISMATCH',
                'The target audio state does not match the command source.',
                true
            );
        }

        if (
            dispatch.desiredResult.currentMusicId
            && !getMusic(dispatch.desiredResult.currentMusicId)
        ) {
            return playbackCommandError(
                'MEDIA_UNAVAILABLE',
                'The resolved playback item is unavailable on the target.'
            );
        }

        return null;
    }

    async executePlaybackCommand(dispatch: PlaybackCommandDispatch): Promise<
        | { status: 'completed'; resultingState: PlaybackCommandState }
        | { status: 'rejected'; error: PlaybackCommandError }
    > {
        const desired = dispatch.desiredResult;
        const desiredPositionMs = desired.position.mode === 'absolute'
            ? desired.position.positionMs
            : convertToMillisecond(this.state.currentTime);
        const desiredPosition = convertToSecond(desiredPositionMs);
        const trackChanged = desired.currentMusicId !== this.state.currentTrackId
            || desired.currentIndex !== this.state.selected;

        try {
            if (trackChanged) {
                const music = desired.currentMusicId
                    ? getMusic(desired.currentMusicId)
                    : undefined;

                if (!music || desired.currentIndex === null) {
                    return {
                        status: 'rejected',
                        error: playbackCommandError(
                            'MEDIA_UNAVAILABLE',
                            'The resolved playback item is unavailable on the target.'
                        )
                    };
                }

                const nextQueueState = createQueueState(
                    this.state.items,
                    desired.currentIndex
                );
                if (nextQueueState.currentTrackId !== desired.currentMusicId) {
                    return {
                        status: 'rejected',
                        error: playbackCommandError(
                            'TARGET_STATE_MISMATCH',
                            'The resolved queue selection is unavailable on the target.',
                            true
                        )
                    };
                }

                document.title = `${music.name} - ${music.artist.name}`;
                this.set({
                    ...nextQueueState,
                    progress: getProgress(desiredPosition, music.duration),
                    currentTime: desiredPosition,
                    isPlaying: desired.state === 'playing'
                });
                this.audioChannel.load(music);
                if (
                    desiredPosition > 0
                    && !this.audioChannel.seekWithResult(desiredPosition)
                ) {
                    return {
                        status: 'rejected',
                        error: playbackCommandError(
                            'MEDIA_NOT_READY',
                            'The target media position is not ready for this command.',
                            true
                        )
                    };
                }
            } else if (desired.position.mode === 'absolute') {
                if (!this.audioChannel.seekWithResult(desiredPosition)) {
                    return {
                        status: 'rejected',
                        error: playbackCommandError(
                            'MEDIA_NOT_READY',
                            'The target media position is not ready for this command.',
                            true
                        )
                    };
                }
                this.set({
                    currentTime: desiredPosition,
                    progress: getProgress(
                        desiredPosition,
                        desired.currentMusicId
                            ? getMusic(desired.currentMusicId)?.duration
                            : undefined
                    )
                });
            }

            const shouldStartAudio = desired.state === 'playing' && (
                dispatch.expectedSource.state !== 'playing' || trackChanged
            );

            if (shouldStartAudio) {
                await this.audioChannel.playWithResult();
                this.set({ isPlaying: true });
            } else if (
                desired.state === 'paused'
                && dispatch.expectedSource.state === 'playing'
            ) {
                this.audioChannel.pause();
                this.set({ isPlaying: false });
            }

            const resultingPositionMs = desired.position.mode === 'absolute'
                ? desired.position.positionMs
                : convertToMillisecond(this.audioChannel.getCurrentTime());

            if (!Number.isFinite(resultingPositionMs) || resultingPositionMs < 0) {
                return {
                    status: 'rejected',
                    error: playbackCommandError(
                        'MEDIA_NOT_READY',
                        'The target media position is unavailable.',
                        true
                    )
                };
            }

            return {
                status: 'completed',
                resultingState: {
                    state: desired.state,
                    currentMusicId: desired.currentMusicId,
                    currentIndex: desired.currentIndex,
                    positionMs: Math.max(Math.round(resultingPositionMs), 0)
                }
            };
        } catch (error) {
            const name = error instanceof DOMException ? error.name : '';
            if (name === 'NotAllowedError') {
                return {
                    status: 'rejected',
                    error: playbackCommandError(
                        'AUTOPLAY_BLOCKED',
                        'Browser autoplay policy blocked the remote playback command.'
                    )
                };
            }
            if (name === 'NotSupportedError') {
                return {
                    status: 'rejected',
                    error: playbackCommandError(
                        'MEDIA_UNAVAILABLE',
                        'The resolved media cannot be played on the target.'
                    )
                };
            }

            return {
                status: 'rejected',
                error: playbackCommandError(
                    'MEDIA_NOT_READY',
                    'The target media element is not ready for this command.',
                    true
                )
            };
        }
    }

    async recoverPlaybackCommand(fence: {
        sessionRevision: number | null;
        queueRevision: number | null;
    }, beginReconciliation: () => boolean) {
        if (this.serverQueueSaveTimer) {
            clearTimeout(this.serverQueueSaveTimer);
            this.serverQueueSaveTimer = null;
        }

        const sessionReady = playbackSessionStore.quiesceForPlaybackCommandRecovery();
        const queueReady = playbackQueueStore.quiesceForPlaybackCommandRecovery();
        if (!sessionReady || !queueReady) {
            throw new Error(
                'Playback command recovery is waiting for prior snapshot writes.'
            );
        }

        const [sessionResult, queueResult] = await Promise.allSettled([
            playbackSessionStore.refresh(PLAYBACK_COMMAND_RECOVERY_REQUEST_TIMEOUT_MS),
            playbackQueueStore.refresh(PLAYBACK_COMMAND_RECOVERY_REQUEST_TIMEOUT_MS)
        ]);

        if (
            sessionResult.status !== 'fulfilled'
            || queueResult.status !== 'fulfilled'
            || sessionResult.value.type !== 'success'
            || queueResult.value.type !== 'success'
        ) {
            throw new Error('Playback command recovery could not refresh both snapshots.');
        }

        const queue = queueResult.value.snapshot;
        const session = sessionResult.value.snapshot;
        const endpointId = playbackSessionStore.endpointId;

        if (!endpointId) {
            throw new Error(
                'Playback command recovery requires an active endpoint registration.'
            );
        }

        if (
            fence.sessionRevision !== null
            && (!session || session.revision < fence.sessionRevision)
        ) {
            throw new Error('Playback command recovery returned a stale session snapshot.');
        }

        if (
            fence.queueRevision !== null
            && (!queue || queue.revision < fence.queueRevision)
        ) {
            throw new Error('Playback command recovery returned a stale queue snapshot.');
        }

        if (!beginReconciliation()) {
            throw new Error('Playback command recovery is no longer current.');
        }

        if (queue) {
            await this.restoreServerQueue(queue, true);
            this.appliedRestoreVersion = playbackQueueStore.state.restoreVersion;
        }

        if (
            !session
            || session.activeDeviceId !== playbackSessionStore.endpointId
            || !session.currentMusicId
            || session.state === 'stopped'
        ) {
            if (this.state.isPlaying) {
                this.audioChannel.pause();
            }
            await this.set({ isPlaying: false });
            this.assertPlaybackCommandRecoveryCurrent(session, queue, endpointId);
            return;
        }

        const music = getMusic(session.currentMusicId);
        if (!music) {
            this.audioChannel.pause();
            await this.set({ isPlaying: false });
            this.assertPlaybackCommandRecoveryCurrent(session, queue, endpointId);
            return;
        }

        const positionMs = resolveSharedPlaybackPositionMs({
            snapshot: session,
            receivedAtMs: playbackSessionStore.state.receivedAtMs,
            nowMs: Date.now(),
            durationMs: convertToMillisecond(music.duration)
        });
        const position = convertToSecond(positionMs);
        this.audioChannel.seek(position);
        await this.set({
            currentTime: position,
            progress: getProgress(position, music.duration)
        });

        if (session.state === 'playing') {
            if (!this.state.isPlaying) {
                try {
                    await this.playRecoveredAudio();
                } catch {
                    this.audioChannel.pause();
                    this.set({ isPlaying: false });
                    setTimeout(() => {
                        this.reportSharedPlaybackState('paused');
                    }, 0);
                    this.assertPlaybackCommandRecoveryCurrent(session, queue, endpointId);
                    return;
                }
            }
            this.set({ isPlaying: true });
        } else {
            if (this.state.isPlaying) {
                this.audioChannel.pause();
            }
            this.set({ isPlaying: false });
        }
        this.assertPlaybackCommandRecoveryCurrent(session, queue, endpointId);
    }

    private assertPlaybackCommandRecoveryCurrent(
        session: typeof playbackSessionStore.state.snapshot,
        queue: typeof playbackQueueStore.state.snapshot,
        endpointId: string | null
    ) {
        if (
            playbackSessionStore.state.snapshot === session
            && playbackQueueStore.state.snapshot === queue
            && playbackSessionStore.endpointId === endpointId
        ) {
            return;
        }

        this.audioChannel.pause();
        this.set({ isPlaying: false });
        throw new Error('Playback command recovery was superseded by newer state.');
    }

    private playRecoveredAudio() {
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Playback command media recovery timed out.'));
            }, PLAYBACK_COMMAND_MEDIA_RECOVERY_TIMEOUT_MS);

            void this.audioChannel.playWithResult().then(() => {
                clearTimeout(timer);
                resolve();
            }, (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
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
        if (isLocalPlaybackMutationBarrierActive()) return;
        const repeatRotate = ['none', 'all', 'one'] as const;
        const current = repeatRotate.indexOf(this.state.repeatMode);
        const next = repeatRotate[(current + 1) % repeatRotate.length];
        this.set({ repeatMode: next });
    }

    reorder(activeId: string, overId: string) {
        if (isLocalPlaybackMutationBarrierActive()) return;
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
        if (isLocalPlaybackMutationBarrierActive()) return;
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
        if (isLocalPlaybackMutationBarrierActive()) return;
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
        if (isLocalPlaybackMutationBarrierActive() || remotePlaybackOwnsAudio()) return;
        if (this.state.selected !== null) {
            this.select((this.state.selected + 1) % this.state.items.length);
            this.audioChannel.play();
        }
    }

    prev() {
        if (isLocalPlaybackMutationBarrierActive() || remotePlaybackOwnsAudio()) return;
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
            && !isPlaybackCommandBarrierActive()
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

    private async restoreServerQueue(snapshot: PlaybackQueueSnapshot, force = false) {
        if (this.state.isPlaying && !force) {
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
        if (
            isLocalAudioClaimBlocked()
            || !this.state.currentTrackId
        ) {
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
