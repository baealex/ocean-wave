import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';
import {
    useEffect,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type TouchEvent
} from 'react';

import { IconButton, IconTextButton, Image } from '~/components/shared';
import { useRemotePlayback, useStoreValue } from '~/hooks';
import * as Icon from '~/icon';
import { makePlayTime } from '~/modules/time';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';
import { MusicListener } from '~/socket';

const cx = classNames;

const remoteStatusCopy = {
    playing: 'Playing on another web player',
    paused: 'Paused on another web player'
} as const;

const MusicPlayer = () => {
    const navigate = useNavigate();

    const [currentTrackId] = useStoreValue(queueStore, 'currentTrackId');
    const [progress] = useStoreValue(queueStore, 'progress');
    const [isPlaying] = useStoreValue(queueStore, 'isPlaying');
    const [repeatMode] = useStoreValue(queueStore, 'repeatMode');
    const [shuffle] = useStoreValue(queueStore, 'shuffle');
    const [queueItems] = useStoreValue(queueStore, 'items');
    const [{ musicMap }] = useStore(musicStore);
    const remotePlayback = useRemotePlayback();
    const [isTakingOver, setIsTakingOver] = useState(false);

    const currentMusic = currentTrackId
        ? musicMap.get(currentTrackId)
        : null;
    const displayMusic = remotePlayback?.music ?? currentMusic;
    const displayProgress = remotePlayback?.progress ?? progress;
    const remoteQueueIndex = remotePlayback
        ? queueItems.indexOf(remotePlayback.music.id)
        : -1;
    const hasRemotePlayback = remotePlayback !== null;

    useEffect(() => {
        if (!hasRemotePlayback) {
            setIsTakingOver(false);
            return;
        }

        if (!isTakingOver) {
            return;
        }

        const timeout = setTimeout(() => setIsTakingOver(false), 5_000);
        return () => clearTimeout(timeout);
    }, [hasRemotePlayback, isTakingOver]);

    const toggleCurrentMusicLike = () => {
        if (!currentMusic) {
            return;
        }

        MusicListener.like(currentMusic.id, !currentMusic.isLiked);
    };

    const seekToPercent = (percent: number) => {
        if (!currentMusic) {
            return;
        }

        const duration = currentMusic?.duration || 1;

        queueStore.seek(duration * Math.max(0, Math.min(percent, 1)));
    };

    const seekFromClientX = (clientX: number, target: HTMLDivElement) => {
        const { width, left, right } = target.getBoundingClientRect();
        const x = Math.max(left, Math.min(clientX, right));

        seekToPercent((x - left) / width);
    };

    const handleClickProgress = (event: MouseEvent<HTMLDivElement>) => {
        seekFromClientX(event.clientX, event.currentTarget);
    };

    const handleMoveProgress = (event: MouseEvent<HTMLDivElement>) => {
        if (event.buttons === 1) {
            seekFromClientX(event.clientX, event.currentTarget);
            return;
        }
    };

    const handleTouchMoveProgress = (event: TouchEvent<HTMLDivElement>) => {
        if (event.touches.length === 1) {
            seekFromClientX(event.touches[0].clientX, event.currentTarget);
        }
    };

    const handleProgressKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!currentMusic) {
            return;
        }

        const step = event.shiftKey ? 10 : 5;
        const nextProgress = {
            ArrowLeft: progress - step,
            ArrowDown: progress - step,
            ArrowRight: progress + step,
            ArrowUp: progress + step,
            Home: 0,
            End: 100
        }[event.key];

        if (nextProgress !== undefined) {
            event.preventDefault();
            seekToPercent(nextProgress / 100);
        }
    };

    const playRemoteHere = () => {
        if (!remotePlayback || remoteQueueIndex < 0 || isTakingOver) {
            return;
        }

        setIsTakingOver(true);
        queueStore.select(remoteQueueIndex, false);
        queueStore.seek(remotePlayback.positionMs / 1000);
        queueStore.play();
    };

    const trackSummary = (
        <>
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[var(--b-radius-md)] bg-[var(--b-color-surface-subtle)]">
                <Image
                    className="h-full w-full object-cover"
                    src={displayMusic?.album.cover}
                    alt={displayMusic?.album.name ?? ''}
                    loading="eager"
                    icon={<Icon.Disc />}
                />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-[var(--b-color-text)]">
                    {displayMusic?.name ?? 'No music'}
                </span>
                {remotePlayback ? (
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-[var(--b-color-text-tertiary)]">
                        <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--b-color-point)]"
                            aria-hidden="true"
                        />
                        <span className="shrink-0 sm:hidden">
                            {remotePlayback.state === 'playing' ? 'Playing elsewhere' : 'Paused elsewhere'}
                        </span>
                        <span className="hidden shrink-0 sm:inline">
                            {remoteStatusCopy[remotePlayback.state]}
                        </span>
                        <span className="hidden min-w-0 truncate min-[900px]:inline">
                            · {displayMusic?.artist.name}
                        </span>
                    </span>
                ) : (
                    <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">
                        {displayMusic?.artist.name ?? ''}
                    </span>
                )}
            </div>
        </>
    );

    return (
        <div className="overflow-hidden border-t border-[var(--b-color-border-subtle)] bg-[var(--b-color-player-background)] lg:col-span-2">
            {remotePlayback ? (
                <div
                    className="h-[3px] w-full overflow-hidden bg-[var(--b-color-progress-track)]"
                    role="progressbar"
                    aria-label="Playback position on another web player"
                    aria-valuenow={Math.round(displayProgress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={`${makePlayTime(remotePlayback.positionMs / 1000)} of ${makePlayTime(remotePlayback.music.duration)}`}>
                    <div
                        className="h-full w-full bg-[var(--b-color-point)]"
                        style={{ transform: `translateX(-${100 - displayProgress}%)` }}
                    />
                </div>
            ) : (
                <div
                    className={cx(
                        'h-[3px] w-full overflow-hidden bg-[var(--b-color-progress-track)] transition-[height] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                        currentMusic ? 'cursor-pointer hover:h-1 focus-visible:h-1' : 'cursor-default'
                    )}
                    role="slider"
                    tabIndex={currentMusic ? 0 : -1}
                    aria-disabled={!currentMusic}
                    aria-label="Seek playback position"
                    aria-valuenow={Math.round(progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={`${Math.round(progress)}%`}
                    onClick={handleClickProgress}
                    onKeyDown={handleProgressKeyDown}
                    onMouseMove={handleMoveProgress}
                    onTouchMove={handleTouchMoveProgress}>
                    <div
                        className="h-full w-full bg-[var(--b-color-point)]"
                        style={{ transform: `translateX(-${100 - progress}%)` }}
                    />
                </div>
            )}
            <div className="flex items-center justify-between gap-[var(--b-spacing-md)] px-[var(--b-spacing-md)] pb-[calc(var(--b-spacing-sm)+env(safe-area-inset-bottom))] pt-[var(--b-spacing-sm)] lg:px-[var(--b-spacing-lg)] lg:py-[var(--b-spacing-sm)]">
                {remotePlayback ? (
                    <div className="flex min-w-0 flex-1 items-center gap-[var(--b-spacing-sm)] text-left lg:gap-[var(--b-spacing-md)]">
                        {trackSummary}
                    </div>
                ) : (
                    <button
                        type="button"
                        className={cx(
                            'flex min-w-0 flex-1 items-center gap-[var(--b-spacing-sm)] border-0 bg-transparent p-0 text-left lg:gap-[var(--b-spacing-md)]',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                            currentMusic ? 'cursor-pointer' : 'cursor-default'
                        )}
                        disabled={!currentMusic}
                        onClick={() => currentMusic && navigate('/player')}>
                        {trackSummary}
                    </button>
                )}

                {remotePlayback ? (
                    <div className="flex shrink-0 items-center gap-[var(--b-spacing-xs)]">
                        <span className="hidden tabular-nums text-xs text-[var(--b-color-text-tertiary)] md:inline">
                            {makePlayTime(remotePlayback.positionMs / 1000)} / {makePlayTime(remotePlayback.music.duration)}
                        </span>
                        <IconTextButton
                            size="lg"
                            shape="pill"
                            variant="primary"
                            icon={<Icon.Play />}
                            label={remoteQueueIndex < 0
                                ? 'Syncing…'
                                : isTakingOver
                                    ? 'Connecting…'
                                    : 'Play here'}
                            aria-label={remoteQueueIndex < 0
                                ? 'Waiting for the shared queue to sync'
                                : isTakingOver
                                    ? `Connecting ${remotePlayback.music.name} to this device`
                                    : `Play ${remotePlayback.music.name} on this device`}
                            disabled={remoteQueueIndex < 0 || isTakingOver}
                            onClick={playRemoteHere}
                        />
                        <IconButton
                            size="compact"
                            tone="muted"
                            className="max-[520px]:hidden"
                            aria-label="Open queue"
                            onClick={() => navigate('/queue')}>
                            <Icon.ListMusic />
                        </IconButton>
                    </div>
                ) : (
                    <div className="flex items-center gap-[var(--b-spacing-xs)]">
                        <IconButton
                            size="compact"
                            tone="muted"
                            className="max-[768px]:hidden"
                            aria-label={`Repeat mode ${repeatMode}`}
                            onClick={() => queueStore.changeRepeatMode()}>
                            {repeatMode === 'all' && <Icon.Repeat />}
                            {repeatMode === 'one' && <Icon.Infinite />}
                            {repeatMode === 'none' && <Icon.RightLeft />}
                        </IconButton>
                        <IconButton
                            size="compact"
                            tone="muted"
                            className="max-[768px]:hidden"
                            aria-label="Previous track"
                            onClick={() => queueStore.prev()}>
                            <Icon.SkipBack />
                        </IconButton>
                        <IconButton
                            size="play"
                            tone="primary"
                            className="max-[768px]:order-2"
                            aria-label={isPlaying ? 'Pause playback' : 'Resume playback'}
                            onClick={() => isPlaying ? queueStore.pause() : queueStore.play()}>
                            {isPlaying ? <Icon.Pause /> : <Icon.Play />}
                        </IconButton>
                        <IconButton
                            size="compact"
                            tone="muted"
                            className="max-[768px]:hidden"
                            aria-label="Next track"
                            onClick={() => queueStore.next()}>
                            <Icon.SkipForward />
                        </IconButton>
                        <IconButton
                            size="compact"
                            tone="muted"
                            active={shuffle}
                            className="max-[768px]:hidden"
                            aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
                            onClick={() => queueStore.toggleShuffle()}>
                            <Icon.Shuffle />
                        </IconButton>
                        <IconButton
                            size="compact"
                            tone="muted"
                            active={currentMusic?.isLiked}
                            filled={currentMusic?.isLiked}
                            className="max-[768px]:order-3"
                            aria-label={currentMusic?.isLiked ? 'Unlike current music' : 'Like current music'}
                            aria-pressed={currentMusic?.isLiked}
                            disabled={!currentMusic}
                            onClick={toggleCurrentMusicLike}>
                            <Icon.Heart />
                        </IconButton>
                        <IconButton
                            size="compact"
                            tone="muted"
                            className="max-[768px]:order-4"
                            aria-label="Open queue"
                            onClick={() => navigate('/queue')}>
                            <Icon.ListMusic />
                        </IconButton>
                    </div>
                )}
            </div>
            <span className="sr-only" role="status" aria-live="polite">
                {remotePlayback
                    ? `${remoteStatusCopy[remotePlayback.state]}: ${remotePlayback.music.name} by ${remotePlayback.music.artist.name}`
                    : ''}
            </span>
        </div>
    );
};

export default MusicPlayer;
