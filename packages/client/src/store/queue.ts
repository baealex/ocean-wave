import type {
    PlaybackQueueContext,
    PlaybackQueueSnapshot
} from '~/api/playback-queue';
import {
    type AudioChannel,
    type AudioChannelEventHandler,
    WebAudioChannel
} from '~/modules/audio-channel';
import {
    clearPlaybackResumeCheckpoint,
    deletePlaybackCheckpoint,
    readPlaybackResumeCheckpoint,
    savePlaybackResumeCheckpoint,
    savePlaybackCheckpoint
} from '~/modules/playback-checkpoint-store';
import {
    getPlaybackCommandBarrierKey,
    isLocalPlaybackMutationBarrierActive,
    isPlaybackCommandBarrierActive,
    isPlaybackCommandExecutionBarrierActive,
    isPlaybackControllerCommandBarrierActive
} from '~/modules/playback-command-barrier';
import { nextPlaybackEndpointSequence } from '~/modules/playback-device';
import { isRemotePlaybackOwnershipActive } from '~/modules/playback-ownership';
import {
    type PlaybackSessionCheckpoint,
    type PlaybackSessionEndReason,
    PlaybackSessionTracker
} from '~/modules/playback-session';
import { PERSONAL_LISTENING_SESSION_COMMAND_PREFIX } from '~/modules/personal-listening-session';
import { getNextSelectedIndexAfterRemovingCurrent } from '~/modules/queue-selection';
import {
    GENERAL_PLAYBACK_QUEUE_CONTEXT,
    normalizePlaybackQueueContext
} from '~/modules/playback-queue-context';
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
import {
    playbackHandoffStateMatchesSource,
    type PlaybackHandoffActivationDispatch,
    type PlaybackHandoffError,
    type PlaybackHandoffReleaseDispatch,
    type PlaybackHandoffSnapshot,
    type PlaybackHandoffSourceSettleDispatch
} from '~/socket/playback-handoff-contract';
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
    context: PlaybackQueueContext;
}

export type PersonalListeningSessionStartBlocker =
    | 'library-loading'
    | 'playback-sync'
    | 'playback-transition'
    | 'queue-sync'
    | 'remote-playback';

export type PersonalListeningSessionBarrierSettlement =
    | 'accepted'
    | 'conflict'
    | 'failed';

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

const playbackHandoffError = (
    code: PlaybackHandoffError['code'],
    message: string,
    retryable = false,
    forceAllowed = false
): PlaybackHandoffError => ({ code, message, retryable, forceAllowed });

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
    private crossfadePlaybackSessionTracker: PlaybackSessionTracker | null = null;
    lastCheckpointClientSessionId: string | null = null;
    lastCheckpointBranchId: string | null = null;
    lastCheckpointPlayedMs = 0;
    private musicStoreUnsubscribe: (() => void) | null = null;
    private playbackQueueStoreUnsubscribe: (() => void) | null = null;
    private serverQueueSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private applyingQueueSnapshot = false;
    private musicLoaded = false;
    private appliedRestoreVersion = 0;
    private handoffAudioMode:
        | 'target-warmup'
        | 'target-active'
        | 'source-released'
        | null = null;
    private handoffAudioGeneration = 0;
    private handoffPlaybackSessionId: string | null = null;
    private audioBuffering = false;
    private pageUnloading = false;
    private deferredPersonalListeningSessionEnd = false;
    private personalListeningSessionQueueDiverged = false;

    constructor() {
        super();
        this.saveTimer = null;
        this.playbackSessionTracker = new PlaybackSessionTracker();
        this.lastCheckpointClientSessionId = null;
        this.lastCheckpointBranchId = null;
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
            sourceItems: [],
            context: GENERAL_PLAYBACK_QUEUE_CONTEXT
        };

        const audioChannelEventHandler: AudioChannelEventHandler = {
            onPlay: () => {
                if (this.handoffAudioMode || this.pageUnloading) {
                    return;
                }

                if (isLocalAudioClaimBlocked()) {
                    this.audioChannel.pause();
                    this.set({ isPlaying: false });
                    return;
                }

                if (!this.state.currentTrackId) {
                    return;
                }

                this.audioBuffering = false;

                const currentMusic = getMusic(this.state.currentTrackId);

                if (currentMusic) {
                    this.startPlaybackTracker(currentMusic.id);
                }

                this.set({ isPlaying: true });
                this.reportSharedPlaybackState('playing', true);
            },
            onPlaying: () => {
                if (
                    this.handoffAudioMode
                    || this.pageUnloading
                    || isLocalAudioClaimBlocked()
                ) {
                    return;
                }
                this.audioBuffering = false;
                if (this.state.currentTrackId) {
                    this.startPlaybackTracker(this.state.currentTrackId);
                    this.reportSharedPlaybackState('playing');
                }
            },
            onWaiting: () => {
                if (
                    this.handoffAudioMode
                    || this.pageUnloading
                    || isLocalAudioClaimBlocked()
                ) {
                    return;
                }

                const now = Date.now();
                this.audioBuffering = true;
                this.playbackSessionTracker.pause(now);
                void this.persistPlaybackCheckpoint(
                    'queue-buffering',
                    true,
                    now
                ).persisted;
                this.reportSharedPlaybackState('paused');
            },
            onPause: () => {
                if (this.handoffAudioMode || this.pageUnloading) {
                    return;
                }

                const now = Date.now();
                this.audioBuffering = false;
                this.playbackSessionTracker.pause(now);
                void this.persistPlaybackCheckpoint('queue-pause', true, now).persisted;
                this.set({ isPlaying: false });
                this.reportSharedPlaybackState('paused');
            },
            onStop: () => {
                if (this.handoffAudioMode || this.pageUnloading) {
                    return;
                }

                const now = Date.now();
                this.audioBuffering = false;
                this.playbackSessionTracker.pause(now);
                void this.persistPlaybackCheckpoint('queue-stop', true, now).persisted;
                this.set({ isPlaying: false });
                this.reportSharedPlaybackState('stopped');
            },
            onEnded: () => {
                if (isLocalPlaybackMutationBarrierActive()) {
                    const commandKey = getPlaybackCommandBarrierKey();
                    if (commandKey?.startsWith(PERSONAL_LISTENING_SESSION_COMMAND_PREFIX)) {
                        this.deferredPersonalListeningSessionEnd = true;
                    }
                    return;
                }

                this.handlePlaybackEnded();
            },
            onCrossfadeStart: () => {
                const now = Date.now();
                this.playbackSessionTracker.pause(now);
                void this.persistPlaybackCheckpoint(
                    'queue-mix-start',
                    true,
                    now
                ).persisted;
                this.crossfadePlaybackSessionTracker = this.playbackSessionTracker;
                this.playbackSessionTracker = new PlaybackSessionTracker();
            },
            onCrossfadeEnd: (listenedMs) => {
                const tracker = this.crossfadePlaybackSessionTracker;
                this.crossfadePlaybackSessionTracker = null;
                if (!tracker) {
                    return;
                }

                tracker.creditListenedMs(listenedMs);
                this.commitPlaybackTrackerEvent(
                    tracker,
                    'queue-mix-ended',
                    'ended'
                );
            },
            onTimeUpdate: (time, mix) => {
                if (this.handoffAudioMode || this.pageUnloading) {
                    return;
                }

                if (isLocalAudioClaimBlocked()) {
                    return;
                }

                const music = this.state.currentTrackId
                    ? getMusic(this.state.currentTrackId)
                    : undefined;
                const progress = Number((time / (music?.duration || 1) * 100).toFixed(2));

                const hasMixTarget = this.state.selected !== null && (
                    this.state.repeatMode !== 'none'
                    || this.state.selected + 1 < this.state.items.length
                );
                if (this.state.mixMode === 'mix' && hasMixTarget) {
                    const mixStarted = mix(20, () => undefined);
                    if (mixStarted) {
                        return;
                    }
                }

                const now = Date.now();

                this.playbackSessionTracker.tick(now);
                void this.persistPlaybackCheckpoint('queue-checkpoint', false, now).persisted;
                this.set({
                    currentTime: time,
                    progress
                });
                this.reportSharedPlaybackState(
                    this.state.isPlaying && !this.audioBuffering
                        ? 'playing'
                        : 'paused',
                    false,
                    time,
                    true
                );
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
                        context: normalizePlaybackQueueContext(persistedState.context),
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
                this.restorePlaybackSessionTracker();
                this.musicStoreUnsubscribe?.();
                this.musicStoreUnsubscribe = null;
            }
        });

        window.addEventListener('beforeunload', this.handleBeforeUnload);
        window.addEventListener('pagehide', this.handlePageHide);
        window.addEventListener('pageshow', this.handlePageShow);
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    private handlePlaybackEnded() {
        if (
            this.handoffAudioMode
            || this.pageUnloading
            || remotePlaybackOwnsAudio()
            || this.state.selected === null
        ) {
            return;
        }

        if (this.state.repeatMode === 'one') {
            this.commitPlaybackEvent('queue-repeat-one', 'ended');
            this.select(this.state.selected);
            return;
        }
        if (this.state.repeatMode === 'all') {
            this.commitPlaybackEvent('queue-track-change', 'ended');
            this.select((this.state.selected + 1) % this.state.items.length);
            this.audioChannel.play();
            return;
        }
        if (this.state.selected + 1 < this.state.items.length) {
            this.commitPlaybackEvent('queue-track-change', 'ended');
            this.select(this.state.selected + 1);
            this.audioChannel.play();
            return;
        }

        this.commitPlaybackEvent('queue-ended', 'ended');
        const duration = this.state.currentTrackId
            ? getMusic(this.state.currentTrackId)?.duration
            : undefined;
        if (duration !== undefined) {
            this.set({
                currentTime: duration,
                progress: 100,
                isPlaying: false
            });
        }
        this.audioChannel.stop();
        this.set({
            currentTime: 0,
            progress: 0,
            isPlaying: false
        });
    }

    commitPlaybackEvent(
        source: string,
        endReason: PlaybackSessionEndReason,
        preserveResume = false
    ) {
        this.commitPlaybackTrackerEvent(
            this.playbackSessionTracker,
            source,
            endReason,
            preserveResume
        );
    }

    private commitPlaybackTrackerEvent(
        tracker: PlaybackSessionTracker,
        source: string,
        endReason: PlaybackSessionEndReason,
        preserveResume = false
    ) {
        const now = Date.now();
        const checkpoint = tracker.createCheckpoint(
            source,
            now,
            endReason === 'skipped'
        );
        const payload = tracker.commit(endReason, now);

        if (!payload || !checkpoint) {
            return;
        }

        const terminalCheckpoint = {
            ...checkpoint,
            accumulatedPlayedMs: payload.playedMs,
            active: false,
            updatedAt: new Date(Math.max(
                new Date(payload.startedAt).getTime(),
                new Date(payload.endedAt).getTime()
            )).toISOString(),
            endedAt: payload.endedAt,
            endReason: payload.endReason,
            source
        };

        if (preserveResume) {
            savePlaybackResumeCheckpoint(terminalCheckpoint);
        }

        if (!preserveResume) {
            clearPlaybackResumeCheckpoint(payload.clientSessionId);
        }

        const persisted = savePlaybackCheckpoint(terminalCheckpoint);

        void this.flushCommittedPlaybackEvent(terminalCheckpoint, persisted, {
            ...payload,
            source
        });
    }

    async reset(
        ids: string[],
        context: PlaybackQueueContext = GENERAL_PLAYBACK_QUEUE_CONTEXT
    ) {
        if (isLocalPlaybackMutationBarrierActive() || remotePlaybackOwnsAudio()) return;
        this.commitPlaybackEvent('queue-reset', 'stopped');
        this.reportSharedPlaybackState('stopped');

        await this.set({
            ...createQueueState(ids, null),
            sourceItems: [],
            context: normalizePlaybackQueueContext(context),
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
            sourceItems: nextSourceItems,
            context: GENERAL_PLAYBACK_QUEUE_CONTEXT
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
            this.commitPlaybackEvent('queue-remove', 'skipped');
        }

        if (newItems.length === 0) {
            this.reportSharedPlaybackState('stopped');
        }

        await this.set({
            ...deriveQueueStateFromTrack(newItems, prevSelectedItem),
            items: newItems,
            sourceItems: newSourceItems,
            context: GENERAL_PLAYBACK_QUEUE_CONTEXT
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
        this.commitPlaybackEvent('queue-track-change', 'skipped');

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

    getPersonalListeningSessionStartBlocker(): PersonalListeningSessionStartBlocker | null {
        if (
            isPlaybackCommandBarrierActive()
            || isPlaybackControllerCommandBarrierActive()
        ) {
            return 'playback-transition';
        }
        if (!this.musicLoaded || this.applyingQueueSnapshot) {
            return 'library-loading';
        }
        if (
            !playbackSessionStore.mutationFence
            || playbackSessionStore.hasPendingReport
        ) {
            return 'playback-sync';
        }
        if (remotePlaybackOwnsAudio()) {
            return 'remote-playback';
        }
        if (
            !playbackQueueStore.state.initialized
            || playbackQueueStore.state.loading
            || playbackQueueStore.hasPendingSave
            || this.serverQueueSaveTimer
        ) {
            return 'queue-sync';
        }

        return null;
    }

    settlePersonalListeningSessionPlaybackBarrier(
        settlement: PersonalListeningSessionBarrierSettlement
    ) {
        const replayEnded = this.deferredPersonalListeningSessionEnd
            && settlement !== 'accepted';
        this.deferredPersonalListeningSessionEnd = false;

        if (settlement === 'conflict') {
            this.personalListeningSessionQueueDiverged = true;
            if (this.serverQueueSaveTimer) {
                clearTimeout(this.serverQueueSaveTimer);
                this.serverQueueSaveTimer = null;
            }
        }

        if (replayEnded) {
            this.handlePlaybackEnded();
        }
    }

    async activatePersonalListeningSession(
        snapshot: PlaybackQueueSnapshot
    ): Promise<'playing' | 'ready' | 'blocked'> {
        if (this.getPersonalListeningSessionStartBlocker()) {
            this.personalListeningSessionQueueDiverged = true;
            return 'blocked';
        }

        if (this.state.isPlaying) {
            this.audioChannel.pause();
        }

        await this.restoreServerQueue(snapshot, true);

        if (this.state.selected === null) {
            return 'ready';
        }

        try {
            await this.audioChannel.playWithResult();
            return 'playing';
        } catch {
            return 'ready';
        }
    }

    pause() {
        if (isLocalPlaybackMutationBarrierActive()) return;
        this.audioChannel.pause();
    }

    acceptServerQueueConflict() {
        if (!playbackQueueStore.state.conflict) {
            return false;
        }

        if (this.state.isPlaying) {
            this.audioChannel.pause();
            this.set({ isPlaying: false });
        }

        return playbackQueueStore.acceptServerConflict();
    }

    stop() {
        if (isLocalPlaybackMutationBarrierActive()) return;
        this.commitPlaybackEvent('queue-stop', 'stopped');
        this.audioChannel.stop();
    }

    seek(time: number) {
        if (isLocalPlaybackMutationBarrierActive()) return;
        this.playbackSessionTracker.markSeek();
        this.audioChannel.seek(time);
        this.reportSharedPlaybackState(
            this.state.isPlaying ? 'playing' : 'paused',
            this.state.isPlaying,
            time
        );
    }

    primePlaybackHandoff(snapshot: PlaybackHandoffSnapshot): Promise<
        | { status: 'ready' }
        | { status: 'rejected'; error: PlaybackHandoffError }
    > {
        const validationError = this.validatePlaybackHandoffTarget(snapshot);
        if (validationError) {
            return Promise.resolve({ status: 'rejected', error: validationError });
        }

        this.handoffAudioGeneration += 1;
        this.handoffAudioMode = 'target-warmup';
        this.applyPlaybackHandoffSnapshot(snapshot, false);
        if (snapshot.state === 'paused') {
            return Promise.resolve({ status: 'ready' });
        }

        let warmup: Promise<void>;
        try {
            // This call intentionally happens before the first await so the browser
            // can consume the Play Here click as the autoplay gesture.
            warmup = this.audioChannel.beginMutedPlayback();
        } catch (error) {
            this.abortPlaybackHandoffTarget();
            return Promise.resolve({
                status: 'rejected',
                error: this.playbackHandoffMediaError(error)
            });
        }

        return warmup.then(() => ({ status: 'ready' as const }), (error) => {
            this.abortPlaybackHandoffTarget();
            return {
                status: 'rejected' as const,
                error: this.playbackHandoffMediaError(error)
            };
        });
    }

    preparePlaybackHandoffRelease(
        dispatch: PlaybackHandoffReleaseDispatch
    ): PlaybackHandoffError | null {
        if (this.handoffAudioMode) {
            return playbackHandoffError(
                'SOURCE_STATE_MISMATCH',
                'This player is already participating in another playback handoff.',
                true
            );
        }

        if (
            playbackSessionStore.hasPendingReport
            || playbackQueueStore.hasPendingSave
            || this.serverQueueSaveTimer
        ) {
            return playbackHandoffError(
                'SOURCE_STATE_MISMATCH',
                'The source has a playback snapshot write in progress.',
                true
            );
        }

        const session = playbackSessionStore.state.snapshot;
        if (
            !session
            || session.revision !== dispatch.snapshot.sessionRevision
            || session.activeDeviceId !== dispatch.sourceEndpointId
            || !playbackHandoffStateMatchesSource(
                session.state,
                dispatch.snapshot.state
            )
            || session.currentMusicId !== dispatch.snapshot.currentMusicId
        ) {
            return playbackHandoffError(
                'SOURCE_STATE_MISMATCH',
                'The local source no longer matches the handoff session snapshot.',
                true
            );
        }

        if (!this.playbackQueueMatchesHandoff(dispatch.snapshot)) {
            return playbackHandoffError(
                'STALE_QUEUE_REVISION',
                'The local source queue no longer matches the handoff snapshot.',
                true
            );
        }

        const localState = this.state.isPlaying ? 'playing' : 'paused';
        if (
            localState !== dispatch.snapshot.state
            || this.state.currentTrackId !== dispatch.snapshot.currentMusicId
            || this.state.selected !== dispatch.snapshot.currentIndex
        ) {
            return playbackHandoffError(
                'SOURCE_STATE_MISMATCH',
                'The source audio state no longer matches the handoff snapshot.',
                true
            );
        }

        return null;
    }

    async releasePlaybackHandoff(
        dispatch: PlaybackHandoffReleaseDispatch
    ): Promise<
        | {
            status: 'released';
            endpointSequence: number;
            positionMs: number;
            playbackHistory: PlaybackHandoffActivationDispatch['playbackHistory'];
        }
        | { status: 'rejected'; error: PlaybackHandoffError }
    > {
        if (this.handoffAudioMode) {
            return {
                status: 'rejected',
                error: playbackHandoffError(
                    'SOURCE_STATE_MISMATCH',
                    'The source handoff state changed before release.',
                    true
                )
            };
        }

        this.handoffAudioGeneration += 1;
        this.handoffAudioMode = 'source-released';
        const positionMs = this.currentAudioPositionMs(dispatch.snapshot.positionMs);
        const now = Date.now();
        this.playbackSessionTracker.pause(now);
        const { checkpoint, persisted } = this.persistPlaybackCheckpoint(
            'queue-handoff-release',
            true,
            now
        );
        void persisted;
        if (this.state.isPlaying) {
            this.audioChannel.pause();
        }
        this.set({
            isPlaying: false,
            currentTime: convertToSecond(positionMs),
            progress: getProgress(
                convertToSecond(positionMs),
                getMusic(dispatch.snapshot.currentMusicId)?.duration
            )
        });

        return {
            status: 'released',
            endpointSequence: nextPlaybackEndpointSequence(),
            positionMs,
            playbackHistory: checkpoint ? {
                clientSessionId: checkpoint.clientSessionId,
                branchId: checkpoint.branchId ?? checkpoint.clientSessionId,
                parentBranchId: checkpoint.parentBranchId ?? null,
                branchBasePlayedMs: checkpoint.branchBasePlayedMs ?? 0,
                trackId: checkpoint.trackId,
                startedAt: checkpoint.startedAt,
                accumulatedPlayedMs: checkpoint.accumulatedPlayedMs,
                hadSeek: checkpoint.hadSeek === true,
                updatedAt: checkpoint.updatedAt
            } : null
        };
    }

    async settlePlaybackHandoffSource(
        dispatch: PlaybackHandoffSourceSettleDispatch
    ): Promise<
        | { status: 'settled'; endpointSequence: number; positionMs: number }
        | { status: 'rejected'; error: PlaybackHandoffError }
    > {
        if (this.handoffAudioMode !== 'source-released') {
            return {
                status: 'rejected',
                error: playbackHandoffError(
                    'SOURCE_STATE_MISMATCH',
                    'The released source context is no longer available.',
                    true
                )
            };
        }

        if (dispatch.action === 'complete') {
            const positionMs = this.currentAudioPositionMs(dispatch.snapshot.positionMs);
            this.audioChannel.pause();
            this.commitPlaybackEvent('queue-handoff', 'handoff');
            this.handoffAudioMode = null;
            this.set({ isPlaying: false });
            return {
                status: 'settled',
                endpointSequence: nextPlaybackEndpointSequence(),
                positionMs
            };
        }

        if (playbackSessionStore.endpointId !== dispatch.sourceEndpointId) {
            this.audioChannel.pause();
            this.set({ isPlaying: false });
            this.handoffAudioMode = null;
            return {
                status: 'rejected',
                error: playbackHandoffError(
                    'UNAUTHORIZED_HANDOFF',
                    'The source endpoint registration changed before settlement.',
                    true
                )
            };
        }

        const positionMs = dispatch.action === 'cancel'
            ? this.currentAudioPositionMs(dispatch.snapshot.positionMs)
            : dispatch.snapshot.positionMs;

        try {
            this.applyPlaybackHandoffSnapshot({
                ...dispatch.snapshot,
                positionMs
            }, true);
            if (dispatch.snapshot.state === 'playing') {
                await this.audioChannel.playWithResult();
                if (playbackSessionStore.endpointId !== dispatch.sourceEndpointId) {
                    this.audioChannel.pause();
                    this.set({ isPlaying: false });
                    this.handoffAudioMode = null;
                    return {
                        status: 'rejected',
                        error: playbackHandoffError(
                            'UNAUTHORIZED_HANDOFF',
                            'The source endpoint registration changed during settlement.',
                            true
                        )
                    };
                }
                this.set({ isPlaying: true });
                this.audioBuffering = false;
                this.startPlaybackTracker(dispatch.snapshot.currentMusicId);
            } else {
                this.set({ isPlaying: false });
            }
            this.handoffAudioMode = null;
            return {
                status: 'settled',
                endpointSequence: nextPlaybackEndpointSequence(),
                positionMs: this.currentAudioPositionMs(positionMs)
            };
        } catch (error) {
            this.audioChannel.pause();
            this.set({ isPlaying: false });
            this.handoffAudioMode = null;
            return {
                status: 'rejected',
                error: this.playbackHandoffMediaError(error)
            };
        }
    }

    async recoverPlaybackHandoffSource(
        dispatch: PlaybackHandoffReleaseDispatch
    ) {
        if (this.handoffAudioMode !== 'source-released') {
            return;
        }
        if (playbackSessionStore.endpointId !== dispatch.sourceEndpointId) {
            throw new Error('Playback handoff recovery requires the source registration.');
        }

        const sessionReady = playbackSessionStore.quiesceForPlaybackCommandRecovery();
        const queueReady = playbackQueueStore.quiesceForPlaybackCommandRecovery();
        if (!sessionReady || !queueReady) {
            throw new Error('Playback handoff recovery is waiting for snapshot writes.');
        }

        const [sessionResult, queueResult] = await Promise.all([
            playbackSessionStore.refresh(PLAYBACK_COMMAND_RECOVERY_REQUEST_TIMEOUT_MS),
            playbackQueueStore.refresh(PLAYBACK_COMMAND_RECOVERY_REQUEST_TIMEOUT_MS)
        ]);
        if (
            sessionResult.type !== 'success'
            || queueResult.type !== 'success'
        ) {
            throw new Error('Playback handoff recovery could not refresh server state.');
        }

        const session = sessionResult.snapshot;
        const queue = queueResult.snapshot;
        if (playbackSessionStore.endpointId !== dispatch.sourceEndpointId) {
            this.audioChannel.pause();
            this.set({ isPlaying: false });
            throw new Error('The source registration changed during handoff recovery.');
        }
        if (
            !session
            || session.activeDeviceId !== dispatch.sourceEndpointId
            || !session.currentMusicId
            || !queue
        ) {
            this.audioChannel.pause();
            this.set({ isPlaying: false });
            this.commitPlaybackEvent('queue-handoff-recovery', 'handoff');
            this.handoffAudioMode = null;
            return;
        }

        const music = getMusic(session.currentMusicId);
        if (!music) {
            this.audioChannel.pause();
            this.set({ isPlaying: false });
            this.commitPlaybackEvent('queue-handoff-recovery', 'handoff');
            this.handoffAudioMode = null;
            return;
        }

        const positionMs = resolveSharedPlaybackPositionMs({
            snapshot: session,
            receivedAtMs: playbackSessionStore.state.receivedAtMs,
            nowMs: Date.now(),
            durationMs: convertToMillisecond(music.duration)
        });
        this.applyPlaybackHandoffSnapshot({
            ...dispatch.snapshot,
            sessionRevision: session.revision,
            queueRevision: queue.revision,
            currentMusicId: session.currentMusicId,
            currentIndex: queue.currentIndex ?? dispatch.snapshot.currentIndex,
            positionMs,
            queue: {
                ...queue,
                currentIndex: queue.currentIndex ?? dispatch.snapshot.currentIndex
            }
        }, true);

        if (dispatch.snapshot.state === 'playing') {
            await this.audioChannel.playWithResult();
            if (playbackSessionStore.endpointId !== dispatch.sourceEndpointId) {
                this.audioChannel.pause();
                this.set({ isPlaying: false });
                throw new Error('The source registration changed during audio recovery.');
            }
            this.set({ isPlaying: true });
            this.audioBuffering = false;
            this.startPlaybackTracker(session.currentMusicId);
        } else {
            this.set({ isPlaying: false });
        }
        this.handoffAudioMode = null;
    }

    abandonPlaybackHandoffSource() {
        if (this.handoffAudioMode !== 'source-released') {
            return;
        }

        this.audioChannel.pause();
        this.set({ isPlaying: false });
        this.commitPlaybackEvent('queue-handoff-abandoned', 'handoff');
        this.handoffAudioMode = null;
    }

    async activatePlaybackHandoff(
        dispatch: PlaybackHandoffActivationDispatch
    ): Promise<
        | { status: 'completed'; endpointSequence: number; positionMs: number }
        | { status: 'rejected'; error: PlaybackHandoffError }
    > {
        if (
            this.handoffAudioMode !== 'target-warmup'
            || dispatch.snapshot.sessionRevision !== dispatch.claimSessionRevision
        ) {
            return {
                status: 'rejected',
                error: playbackHandoffError(
                    'TARGET_STATE_MISMATCH',
                    'The local handoff warm-up no longer matches the server claim.',
                    true
                )
            };
        }

        const validationError = this.validatePlaybackHandoffMedia(dispatch.snapshot);
        if (validationError) {
            this.abortPlaybackHandoffTarget();
            return { status: 'rejected', error: validationError };
        }

        try {
            this.applyPlaybackHandoffSnapshot(dispatch.snapshot, true);
            if (dispatch.playbackHistory) {
                const checkpoint = {
                    ...dispatch.playbackHistory,
                    lastResumedAt: null,
                    active: false,
                    source: 'queue-handoff-transfer'
                };
                const music = getMusic(dispatch.snapshot.currentMusicId);
                if (
                    !music
                    || !this.playbackSessionTracker.restore(checkpoint, {
                        id: music.id,
                        durationMs: convertToMillisecond(music.duration)
                    })
                ) {
                    throw new Error('The transferred playback history is invalid.');
                }
                savePlaybackResumeCheckpoint(checkpoint);
                this.setPlaybackCheckpointWatermark(checkpoint);
                this.handoffPlaybackSessionId = checkpoint.clientSessionId;
            } else {
                this.handoffPlaybackSessionId = null;
            }
            if (dispatch.snapshot.state === 'playing') {
                await this.audioChannel.commitMutedPlayback();
                this.set({ isPlaying: true });
            } else {
                this.audioChannel.cancelMutedPlayback();
                this.set({ isPlaying: false });
            }
            this.handoffAudioMode = 'target-active';
            return {
                status: 'completed',
                endpointSequence: nextPlaybackEndpointSequence(),
                positionMs: dispatch.snapshot.positionMs
            };
        } catch (error) {
            this.abortPlaybackHandoffTarget();
            return {
                status: 'rejected',
                error: this.playbackHandoffMediaError(error)
            };
        }
    }

    finishPlaybackHandoffTarget(completed: boolean) {
        if (
            this.handoffAudioMode !== 'target-warmup'
            && this.handoffAudioMode !== 'target-active'
        ) {
            return;
        }

        if (!completed) {
            this.abortPlaybackHandoffTarget();
            return;
        }

        this.handoffAudioMode = null;
        this.handoffPlaybackSessionId = null;
        if (this.state.isPlaying && this.state.currentTrackId) {
            this.audioBuffering = false;
            this.startPlaybackTracker(this.state.currentTrackId);
        }
    }

    abortPlaybackHandoffTarget(force = false) {
        if (
            this.handoffAudioMode !== 'target-warmup'
            && this.handoffAudioMode !== 'target-active'
            && !force
        ) {
            return;
        }

        this.handoffAudioMode ??= 'target-active';
        this.audioChannel.cancelMutedPlayback();
        this.set({ isPlaying: false });
        if (this.handoffPlaybackSessionId) {
            clearPlaybackResumeCheckpoint(this.handoffPlaybackSessionId);
            this.playbackSessionTracker.reset();
            this.handoffPlaybackSessionId = null;
        }
        this.handoffAudioMode = null;
    }

    silencePlaybackForSocketDisconnect(
        possibleOwnerEndpointId: string | null = null
    ) {
        if (this.pageUnloading) {
            this.set({ isPlaying: false });
            return;
        }

        const currentMusicId = this.state.currentTrackId;
        const positionMs = this.currentAudioPositionMs(
            convertToMillisecond(this.state.currentTime)
        );

        if (
            this.handoffAudioMode === 'target-warmup'
            || this.handoffAudioMode === 'target-active'
        ) {
            this.abortPlaybackHandoffTarget(true);
        } else {
            this.audioChannel.pause();
            this.set({ isPlaying: false });
        }

        if (currentMusicId) {
            const playbackHistory = this.playbackSessionTracker.createCheckpoint(
                'queue-socket-disconnect',
                Date.now(),
                true
            );
            playbackSessionStore.bufferSocketDisconnectPause({
                currentMusicId,
                positionMs,
                playbackHistory: playbackHistory ? {
                    clientSessionId: playbackHistory.clientSessionId,
                    branchId: playbackHistory.branchId,
                    parentBranchId: playbackHistory.parentBranchId,
                    branchBasePlayedMs: playbackHistory.branchBasePlayedMs,
                    startedAt: playbackHistory.startedAt,
                    accumulatedPlayedMs: playbackHistory.accumulatedPlayedMs,
                    hadSeek: playbackHistory.hadSeek === true,
                    updatedAt: playbackHistory.updatedAt
                } : null
            }, possibleOwnerEndpointId);
        }
    }

    async resumePlaybackHandoffHere() {
        const session = playbackSessionStore.state.snapshot;
        const endpointId = playbackSessionStore.endpointId;
        const currentTrackId = this.state.currentTrackId;
        const handoffAudioGeneration = this.handoffAudioGeneration;
        if (
            !session
            || !endpointId
            || this.handoffAudioMode
            || isLocalPlaybackMutationBarrierActive()
            || session.activeDeviceId !== endpointId
            || session.state !== 'paused'
            || session.currentMusicId !== currentTrackId
        ) {
            return false;
        }

        try {
            await this.audioChannel.playWithResult();
            const currentSession = playbackSessionStore.state.snapshot;
            if (
                this.handoffAudioMode
                || this.handoffAudioGeneration !== handoffAudioGeneration
                || isLocalPlaybackMutationBarrierActive()
                || playbackSessionStore.endpointId !== endpointId
                || currentSession?.activeDeviceId !== endpointId
                || currentSession.currentMusicId !== currentTrackId
                || currentSession.state === 'stopped'
            ) {
                this.audioChannel.pause();
                this.set({ isPlaying: false });
                return false;
            }
            return true;
        } catch {
            this.audioChannel.pause();
            this.set({ isPlaying: false });
            return false;
        }
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
                this.commitPlaybackEvent('queue-remote-track-change', 'skipped');
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
                this.playbackSessionTracker.markSeek();
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
            items: nextItems,
            context: GENERAL_PLAYBACK_QUEUE_CONTEXT
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
            items: nextItems,
            context: GENERAL_PLAYBACK_QUEUE_CONTEXT
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
                this.playbackSessionTracker.markSeek();
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
            && !this.personalListeningSessionQueueDiverged
            && !isLocalPlaybackMutationBarrierActive()
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
        window.removeEventListener('pageshow', this.handlePageShow);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        this.audioChannel.dispose();
    }

    private validatePlaybackHandoffTarget(
        snapshot: PlaybackHandoffSnapshot
    ): PlaybackHandoffError | null {
        if (this.handoffAudioMode || isPlaybackCommandBarrierActive()) {
            return playbackHandoffError(
                'HANDOFF_IN_PROGRESS',
                'This browser is already executing another playback transition.',
                true
            );
        }

        if (
            !this.musicLoaded
            || playbackSessionStore.hasPendingReport
            || playbackQueueStore.hasPendingSave
            || this.serverQueueSaveTimer
        ) {
            return playbackHandoffError(
                'MEDIA_NOT_READY',
                'This browser is still synchronizing its playback state.',
                true
            );
        }

        const session = playbackSessionStore.state.snapshot;
        const queue = playbackQueueStore.state.snapshot;
        if (
            !session
            || session.revision !== snapshot.sessionRevision
            || session.activeDeviceId === playbackSessionStore.endpointId
            || session.currentMusicId !== snapshot.currentMusicId
            || !playbackHandoffStateMatchesSource(session.state, snapshot.state)
        ) {
            return playbackHandoffError(
                'STALE_SESSION_REVISION',
                'The shared playback session changed before Play Here started.',
                true
            );
        }

        if (
            !queue
            || queue.revision !== snapshot.queueRevision
            || queue.currentIndex !== snapshot.currentIndex
        ) {
            return playbackHandoffError(
                'STALE_QUEUE_REVISION',
                'The shared playback queue changed before Play Here started.',
                true
            );
        }

        return this.validatePlaybackHandoffMedia(snapshot);
    }

    private validatePlaybackHandoffMedia(
        snapshot: PlaybackHandoffSnapshot
    ): PlaybackHandoffError | null {
        if (
            snapshot.currentIndex < 0
            || snapshot.currentIndex >= snapshot.queue.musicIds.length
            || snapshot.queue.musicIds[snapshot.currentIndex]
                !== snapshot.currentMusicId
        ) {
            return playbackHandoffError(
                'QUEUE_UNAVAILABLE',
                'The transferred queue does not contain the current playback item.',
                true
            );
        }

        if (snapshot.queue.musicIds.some(id => !getMusic(id))) {
            return playbackHandoffError(
                'MEDIA_UNAVAILABLE',
                'One or more transferred playback items are unavailable here.'
            );
        }

        return null;
    }

    private playbackQueueMatchesHandoff(snapshot: PlaybackHandoffSnapshot) {
        const queue = playbackQueueStore.state.snapshot;
        return Boolean(
            queue
            && queue.revision === snapshot.queueRevision
            && queue.currentIndex === snapshot.currentIndex
            && queue.shuffle === snapshot.queue.shuffle
            && queue.repeatMode === snapshot.queue.repeatMode
            && queue.musicIds.length === snapshot.queue.musicIds.length
            && queue.musicIds.every(
                (id, index) => id === snapshot.queue.musicIds[index]
            )
            && queue.sourceMusicIds.length === snapshot.queue.sourceMusicIds.length
            && queue.sourceMusicIds.every(
                (id, index) => id === snapshot.queue.sourceMusicIds[index]
            )
            && this.state.items.length === snapshot.queue.musicIds.length
            && this.state.items.every(
                (id, index) => id === snapshot.queue.musicIds[index]
            )
            && this.state.sourceItems.length === snapshot.queue.sourceMusicIds.length
            && this.state.sourceItems.every(
                (id, index) => id === snapshot.queue.sourceMusicIds[index]
            )
            && this.state.context.type === snapshot.queue.contextType
            && this.state.context.id === snapshot.queue.contextId
            && this.state.context.title === snapshot.queue.contextTitle
            && this.state.shuffle === snapshot.queue.shuffle
            && this.state.repeatMode === snapshot.queue.repeatMode
        );
    }

    private applyPlaybackHandoffSnapshot(
        snapshot: PlaybackHandoffSnapshot,
        preserveCurrentAudio: boolean
    ) {
        const music = getMusic(snapshot.currentMusicId);
        if (!music) {
            throw new Error('The transferred playback item is unavailable.');
        }

        const previousTrackId = this.state.currentTrackId;
        const position = convertToSecond(snapshot.positionMs);
        this.applyingQueueSnapshot = true;
        try {
            this.set({
                ...createQueueState(snapshot.queue.musicIds, snapshot.currentIndex),
                items: [...snapshot.queue.musicIds],
                sourceItems: snapshot.queue.shuffle
                    ? [...snapshot.queue.sourceMusicIds]
                    : [],
                context: normalizePlaybackQueueContext({
                    type: snapshot.queue.contextType,
                    id: snapshot.queue.contextId,
                    title: snapshot.queue.contextTitle
                }),
                shuffle: snapshot.queue.shuffle,
                repeatMode: snapshot.queue.repeatMode,
                currentTime: position,
                progress: getProgress(position, music.duration),
                isPlaying: false
            });

            document.title = `${music.name} - ${music.artist.name}`;
            if (!preserveCurrentAudio || previousTrackId !== snapshot.currentMusicId) {
                this.audioChannel.load(music);
            }
            this.audioChannel.seek(position);
        } finally {
            this.applyingQueueSnapshot = false;
        }
    }

    private currentAudioPositionMs(fallback: number) {
        const positionMs = convertToMillisecond(this.audioChannel.getCurrentTime());
        return Number.isFinite(positionMs)
            && positionMs >= 0
            && (positionMs > 0 || fallback <= 0)
            ? Math.round(positionMs)
            : Math.max(Math.round(fallback), 0);
    }

    private playbackHandoffMediaError(error: unknown): PlaybackHandoffError {
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError') {
            return playbackHandoffError(
                'AUTOPLAY_BLOCKED',
                'Browser autoplay policy blocked Play Here. Try again from this button.'
            );
        }
        if (name === 'NotSupportedError') {
            return playbackHandoffError(
                'MEDIA_UNAVAILABLE',
                'The transferred playback item cannot be played in this browser.'
            );
        }

        return playbackHandoffError(
            'MEDIA_NOT_READY',
            'This browser could not prepare the transferred playback item.',
            true
        );
    }

    private startPlaybackTracker(musicId: string) {
        const music = getMusic(musicId);
        if (!music) {
            return;
        }

        this.playbackSessionTracker.play({
            id: music.id,
            durationMs: convertToMillisecond(music.duration)
        });
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
            || state.context.type !== previousState.context.type
            || state.context.id !== previousState.context.id
            || state.context.title !== previousState.context.title
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
        if (
            !this.musicLoaded
            || this.applyingQueueSnapshot
            || this.personalListeningSessionQueueDiverged
        ) {
            return;
        }

        playbackQueueStore.save({
            musicIds: this.state.items,
            sourceMusicIds: this.state.shuffle ? this.state.sourceItems : [],
            currentIndex: this.state.selected,
            context: this.state.context,
            shuffle: this.state.shuffle,
            repeatMode: this.state.repeatMode
        });
    }

    private async restoreServerQueue(snapshot: PlaybackQueueSnapshot, force = false) {
        if (this.state.isPlaying && !force) {
            return;
        }

        this.personalListeningSessionQueueDiverged = false;
        this.applyingQueueSnapshot = true;

        try {
            const selectedMusicId = snapshot.currentIndex === null
                ? null
                : snapshot.musicIds[snapshot.currentIndex];
            if (
                this.state.currentTrackId
                && selectedMusicId !== this.state.currentTrackId
            ) {
                this.commitPlaybackEvent('queue-server-restore', 'stopped');
            }
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
                context: normalizePlaybackQueueContext({
                    type: snapshot.contextType,
                    id: snapshot.contextId,
                    title: snapshot.contextTitle
                }),
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

                this.restorePlaybackSessionTracker();
            }
        } finally {
            this.applyingQueueSnapshot = false;
        }
    }

    private handleBeforeUnload = () => {
        const now = Date.now();
        this.pageUnloading = true;
        this.audioBuffering = false;
        this.playbackSessionTracker.pause(now);
        this.set({ isPlaying: false });
        this.reportSharedPlaybackState('paused');
        this.commitPlaybackEvent('queue-unload', 'unload', true);
        this.persistQueueState();
        this.audioChannel.pause();
    };

    private handlePageHide = (event: PageTransitionEvent) => {
        this.persistQueueState();
        if (this.pageUnloading) {
            return;
        }

        if (event.persisted) {
            const now = Date.now();
            this.pageUnloading = true;
            this.audioBuffering = false;
            this.playbackSessionTracker.pause(now);
            this.set({ isPlaying: false });
            this.reportSharedPlaybackState('paused');
            void this.persistPlaybackCheckpoint(
                'queue-pagehide',
                true,
                now
            ).persisted;
            this.audioChannel.pause();
            return;
        }

        this.reportSharedPlaybackState(
            this.state.isPlaying ? 'playing' : 'paused'
        );
        void this.persistPlaybackCheckpoint('queue-pagehide', true).persisted;
    };

    private handlePageShow = (event: PageTransitionEvent) => {
        if (!event.persisted) {
            return;
        }

        this.pageUnloading = false;
        this.audioBuffering = false;
        this.set({ isPlaying: false });
        this.restorePlaybackSessionTracker();
        this.reportSharedPlaybackState('paused');
    };

    private handleVisibilityChange = () => {
        if (document.hidden) {
            this.persistQueueState();
            if (this.pageUnloading) {
                return;
            }
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

        const playbackHistory = this.playbackSessionTracker.createCheckpoint(
            'queue-shared-playback',
            Date.now(),
            true
        );
        playbackSessionStore.report({
            state,
            currentMusicId: this.state.currentTrackId,
            positionMs: convertToMillisecond(currentTime),
            playbackHistory: playbackHistory ? {
                clientSessionId: playbackHistory.clientSessionId,
                branchId: playbackHistory.branchId,
                parentBranchId: playbackHistory.parentBranchId,
                branchBasePlayedMs: playbackHistory.branchBasePlayedMs,
                startedAt: playbackHistory.startedAt,
                accumulatedPlayedMs: playbackHistory.accumulatedPlayedMs,
                hadSeek: playbackHistory.hadSeek === true,
                updatedAt: playbackHistory.updatedAt
            } : null
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

        const branchId = checkpoint.branchId ?? checkpoint.clientSessionId;
        if (
            this.lastCheckpointClientSessionId !== checkpoint.clientSessionId
            || this.lastCheckpointBranchId !== branchId
        ) {
            this.lastCheckpointClientSessionId = checkpoint.clientSessionId;
            this.lastCheckpointBranchId = branchId;
            this.lastCheckpointPlayedMs = checkpoint.branchBasePlayedMs ?? 0;
        }

        const playedDelta = checkpoint.accumulatedPlayedMs - this.lastCheckpointPlayedMs;

        if (!force && playedDelta < PLAYBACK_CHECKPOINT_INTERVAL_MS) {
            return {
                checkpoint,
                persisted: Promise.resolve()
            };
        }

        this.setPlaybackCheckpointWatermark(checkpoint);
        savePlaybackResumeCheckpoint(checkpoint);
        const persisted = savePlaybackCheckpoint(checkpoint);

        return {
            checkpoint,
            persisted
        };
    }

    private async flushCommittedPlaybackEvent(
        checkpoint: PlaybackSessionCheckpoint,
        persisted: Promise<void>,
        payload: Parameters<typeof MusicListener.count>[0]
    ) {
        try {
            await persisted;
        } catch {
            // A checkpoint failure must not block the independent history write.
        }

        let delivered = false;
        try {
            delivered = await MusicListener.count(payload);
        } catch {
            // History delivery remains best effort from the audio player's view.
            return;
        }

        if (!delivered) {
            return;
        }

        try {
            await deletePlaybackCheckpoint(checkpoint);
        } catch {
            // A duplicate recovery is safe because the server update is monotonic.
        }
    }

    private restorePlaybackSessionTracker() {
        if (this.playbackSessionTracker.hasSession()) {
            return;
        }

        const checkpoint = readPlaybackResumeCheckpoint();
        const currentMusic = this.state.currentTrackId
            ? getMusic(this.state.currentTrackId)
            : undefined;
        if (!checkpoint || !currentMusic) {
            return;
        }

        const restored = this.playbackSessionTracker.restore(checkpoint, {
            id: currentMusic.id,
            durationMs: convertToMillisecond(currentMusic.duration)
        });
        if (!restored) {
            clearPlaybackResumeCheckpoint(checkpoint.clientSessionId);
            return;
        }

        this.lastCheckpointClientSessionId = checkpoint.clientSessionId;
        this.lastCheckpointBranchId = checkpoint.branchId
            ?? checkpoint.clientSessionId;
        this.lastCheckpointPlayedMs = checkpoint.accumulatedPlayedMs;
    }

    private setPlaybackCheckpointWatermark(
        checkpoint: PlaybackSessionCheckpoint
    ) {
        this.lastCheckpointClientSessionId = checkpoint.clientSessionId;
        this.lastCheckpointBranchId = checkpoint.branchId
            ?? checkpoint.clientSessionId;
        this.lastCheckpointPlayedMs = checkpoint.accumulatedPlayedMs;
    }
}

export const queueStore = new QueueStore();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        queueStore.dispose();
    });
}
