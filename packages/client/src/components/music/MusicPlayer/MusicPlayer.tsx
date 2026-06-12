import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';
import type { KeyboardEvent, MouseEvent, TouchEvent } from 'react';

import { IconButton, Image } from '~/components/shared';
import { useStoreValue } from '~/hooks';
import * as Icon from '~/icon';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';
import { MusicListener } from '~/socket';

const cx = classNames;

const MusicPlayer = () => {
    const navigate = useNavigate();

    const [currentTrackId] = useStoreValue(queueStore, 'currentTrackId');
    const [progress] = useStoreValue(queueStore, 'progress');
    const [isPlaying] = useStoreValue(queueStore, 'isPlaying');
    const [repeatMode] = useStoreValue(queueStore, 'repeatMode');
    const [shuffle] = useStoreValue(queueStore, 'shuffle');
    const [{ musicMap }] = useStore(musicStore);

    const currentMusic = currentTrackId
        ? musicMap.get(currentTrackId)
        : null;

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

    return (
        <div className="overflow-hidden border-t border-[var(--b-color-border-subtle)] bg-[var(--b-color-player-background)] lg:col-span-2">
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
            <div className="flex items-center justify-between gap-[var(--b-spacing-md)] px-[var(--b-spacing-md)] py-[var(--b-spacing-sm)] lg:px-[var(--b-spacing-lg)]">
                <button
                    type="button"
                    className={cx(
                        'flex min-w-0 flex-1 items-center gap-[var(--b-spacing-sm)] border-0 bg-transparent p-0 text-left lg:gap-[var(--b-spacing-md)]',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                        currentMusic ? 'cursor-pointer' : 'cursor-default'
                    )}
                    disabled={!currentMusic}
                    onClick={() => currentMusic && navigate('/player')}>
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[var(--b-radius-md)] bg-[var(--b-color-surface-subtle)]">
                        <Image
                            className="h-full w-full object-cover"
                            src={currentMusic?.album.cover}
                            alt={currentMusic?.album.name ?? ''}
                            loading="eager"
                            icon={<Icon.Disc />}
                        />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium text-[var(--b-color-text)]">
                            {currentMusic?.name ?? 'No music'}
                        </span>
                        <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">
                            {currentMusic?.artist.name ?? ''}
                        </span>
                    </div>
                </button>
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
            </div>
        </div>
    );
};

export default MusicPlayer;
