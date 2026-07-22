import classNames from 'classnames';
import {
    type KeyboardEvent,
    type MouseEvent,
    type TouchEvent,
    useEffect,
    useRef
} from 'react';
import { useNavigate } from 'react-router-dom';

import { IconButton, Image } from '~/components/shared';
import { useRemotePlayback, useStoreValue } from '~/hooks';
import * as Icon from '~/icon';
import { observeMiniPlayerToastOffset } from '~/modules/mini-player-toast-offset';
import { makePlayTime } from '~/modules/time';
import { MusicListener } from '~/socket';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import {
    playbackDevicesStore,
    resolveActivePlaybackTarget
} from '~/store/playback-devices';
import { queueStore } from '~/store/queue';
import {
    isRemotePlaybackControllerReady,
    isRemotePlaybackControlPending,
    remotePlaybackControlStore
} from '~/store/remote-playback-control';

import PlaybackCommandFeedback from '../PlaybackCommandFeedback';
import PlaybackDeviceMenu from '../PlaybackDeviceMenu';
import RemotePlaybackControls from '../RemotePlaybackControls';

const cx = classNames;

const playbackStateLabel = {
    playing: 'Playing',
    paused: 'Paused',
    stopped: 'Stopped'
} as const;

export const seekLocalPlaybackToPercent = (
    seek: (positionSeconds: number) => void,
    durationSeconds: number | null,
    percent: number,
    controlsBlocked: boolean
) => {
    if (durationSeconds === null || controlsBlocked) {
        return false;
    }

    seek((durationSeconds || 1) * Math.max(0, Math.min(percent, 1)));
    return true;
};

interface MusicPlayerProps {
    hasBottomNavigation?: boolean;
}

const MusicPlayer = ({ hasBottomNavigation = false }: MusicPlayerProps) => {
    const navigate = useNavigate();
    const miniPlayerRef = useRef<HTMLDivElement>(null);
    const remoteTouchStartRef = useRef<{
        identifier: number;
        clientX: number;
        clientY: number;
    } | null>(null);
    const lastRemoteTouchEndAtRef = useRef(Number.NEGATIVE_INFINITY);

    const [currentTrackId] = useStoreValue(queueStore, 'currentTrackId');
    const [progress] = useStoreValue(queueStore, 'progress');
    const [isPlaying] = useStoreValue(queueStore, 'isPlaying');
    const [repeatMode] = useStoreValue(queueStore, 'repeatMode');
    const [shuffle] = useStoreValue(queueStore, 'shuffle');
    const [{ musicMap }] = useStore(musicStore);
    const [{ registry }] = useStore(playbackDevicesStore);
    const [remoteControl] = useStore(remotePlaybackControlStore);
    const remotePlayback = useRemotePlayback();

    const currentMusic = currentTrackId
        ? musicMap.get(currentTrackId)
        : null;
    const displayMusic = remotePlayback ? remotePlayback.music : currentMusic;
    const displayProgress = remotePlayback?.progress ?? progress;
    const activeTarget = resolveActivePlaybackTarget(registry);
    const currentDevice = registry?.devices.find(
        device => device.id === playbackDevicesStore.currentDeviceId
    ) ?? null;
    const remoteTarget = remotePlayback
        && activeTarget?.endpoint.id === remotePlayback.targetEndpointId
        ? activeTarget
        : null;
    const remoteDeviceName = remoteTarget?.device.name ?? 'Remote web player';
    const remoteDeviceStatus = remoteTarget
        ? remoteTarget.endpoint.online ? 'Online' : 'Offline'
        : 'Refreshing connection';
    const remoteCommandPending = isRemotePlaybackControlPending(remoteControl.phase);
    const controllerReady = isRemotePlaybackControllerReady();
    const remoteCommandAvailable = Boolean(remoteTarget?.endpoint.online)
        && controllerReady
        && !remoteCommandPending;
    const localControlsBlocked = !remotePlayback && remoteCommandPending;
    const canSendRemoteCommand = (command: 'play' | 'pause' | 'seek' | 'next' | 'previous') => (
        remoteCommandAvailable
        && Boolean(remoteTarget?.endpoint.capabilities.includes(command))
        && (command !== 'seek' || Boolean(remotePlayback?.music))
        && !(
            remotePlayback?.state === 'stopped'
            && (command === 'pause' || command === 'seek')
        )
    );

    const toggleCurrentMusicLike = () => {
        if (!currentMusic) {
            return;
        }

        MusicListener.like(currentMusic.id, !currentMusic.isLiked);
    };

    const seekToPercent = (percent: number) => {
        const boundedPercent = Math.max(0, Math.min(percent, 1));

        if (remotePlayback) {
            if (!canSendRemoteCommand('seek')) {
                return;
            }

            void remotePlaybackControlStore.send({
                type: 'seek',
                positionMs: Math.round(
                    (remotePlayback.music?.duration ?? 0) * 1000 * boundedPercent
                )
            });
            return;
        }

        seekLocalPlaybackToPercent(
            positionSeconds => queueStore.seek(positionSeconds),
            currentMusic?.duration ?? null,
            boundedPercent,
            localControlsBlocked
        );
    };

    const seekFromClientX = (clientX: number, target: HTMLDivElement) => {
        const { width, left, right } = target.getBoundingClientRect();
        if (width <= 0) {
            return;
        }
        const x = Math.max(left, Math.min(clientX, right));

        seekToPercent((x - left) / width);
    };

    const handleClickProgress = (event: MouseEvent<HTMLDivElement>) => {
        const elapsedFromRemoteTouch = event.timeStamp - lastRemoteTouchEndAtRef.current;
        if (
            remotePlayback
            && elapsedFromRemoteTouch >= 0
            && elapsedFromRemoteTouch < 750
        ) {
            return;
        }

        seekFromClientX(event.clientX, event.currentTarget);
    };

    const handleMoveProgress = (event: MouseEvent<HTMLDivElement>) => {
        if (!remotePlayback && event.buttons === 1) {
            seekFromClientX(event.clientX, event.currentTarget);
            return;
        }
    };

    const handleTouchMoveProgress = (event: TouchEvent<HTMLDivElement>) => {
        if (!remotePlayback && event.touches.length === 1) {
            seekFromClientX(event.touches[0].clientX, event.currentTarget);
        }
    };

    const handleTouchStartProgress = (event: TouchEvent<HTMLDivElement>) => {
        if (!remotePlayback || event.touches.length !== 1) {
            remoteTouchStartRef.current = null;
            return;
        }

        const touch = event.touches[0];
        remoteTouchStartRef.current = {
            identifier: touch.identifier,
            clientX: touch.clientX,
            clientY: touch.clientY
        };
    };

    const handleTouchEndProgress = (event: TouchEvent<HTMLDivElement>) => {
        const start = remoteTouchStartRef.current;
        remoteTouchStartRef.current = null;
        if (!remotePlayback || !start) {
            return;
        }

        const touch = Array.from(event.changedTouches).find(
            candidate => candidate.identifier === start.identifier
        );
        if (!touch) {
            return;
        }

        const horizontalDistance = Math.abs(touch.clientX - start.clientX);
        const verticalDistance = Math.abs(touch.clientY - start.clientY);
        lastRemoteTouchEndAtRef.current = event.timeStamp;
        if (verticalDistance > 10 && verticalDistance > horizontalDistance) {
            return;
        }

        event.preventDefault();
        seekFromClientX(touch.clientX, event.currentTarget);
    };

    const handleProgressKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!displayMusic) {
            return;
        }

        const step = event.shiftKey ? 10 : 5;
        const nextProgress = {
            ArrowLeft: displayProgress - step,
            ArrowDown: displayProgress - step,
            ArrowRight: displayProgress + step,
            ArrowUp: displayProgress + step,
            Home: 0,
            End: 100
        }[event.key];

        if (nextProgress !== undefined) {
            event.preventDefault();
            seekToPercent(nextProgress / 100);
        }
    };

    const sendRemoteCommand = (type: 'play' | 'pause' | 'next' | 'previous') => {
        if (!canSendRemoteCommand(type)) {
            return;
        }

        void remotePlaybackControlStore.send({ type });
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
                    {displayMusic?.name ?? (remotePlayback
                        ? 'Remote playback item unavailable'
                        : 'No music')}
                </span>
                {remotePlayback ? (
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-[var(--b-color-text-tertiary)]">
                        <span
                            className={cx(
                                'h-1.5 w-1.5 shrink-0 rounded-full',
                                remoteTarget?.endpoint.online
                                    ? 'bg-[var(--b-color-point)]'
                                    : 'bg-[var(--b-color-text-muted)]'
                            )}
                            aria-hidden="true"
                        />
                        <span className="min-w-0 truncate">
                            {playbackStateLabel[remotePlayback.state]} on {remoteDeviceName} · {remoteDeviceStatus}
                        </span>
                    </span>
                ) : (
                    <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">
                        {displayMusic?.artistDisplayName ?? ''}
                        {currentDevice
                            ? ` · ${currentDevice.name} · ${currentDevice.online ? 'Online' : 'Connecting'}`
                            : ' · This browser'}
                    </span>
                )}
            </div>
        </>
    );

    useEffect(() => {
        const miniPlayer = miniPlayerRef.current;
        if (!miniPlayer) {
            return;
        }

        return observeMiniPlayerToastOffset(miniPlayer);
    }, []);

    return (
        <div
            ref={miniPlayerRef}
            className="overflow-hidden border-t border-[var(--b-color-border-subtle)] bg-[var(--b-color-player-background)] lg:col-span-2">
            {remotePlayback ? (
                <div
                    className={cx(
                        'group flex h-6 w-full items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                        canSendRemoteCommand('seek')
                            ? 'cursor-pointer'
                            : 'cursor-not-allowed opacity-60'
                    )}
                    role="slider"
                    tabIndex={canSendRemoteCommand('seek') ? 0 : -1}
                    aria-disabled={!canSendRemoteCommand('seek')}
                    aria-label={`Seek playback on ${remoteDeviceName}`}
                    aria-valuenow={Math.round(displayProgress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={`${makePlayTime(remotePlayback.positionMs / 1000)} of ${makePlayTime(remotePlayback.music?.duration ?? 0)}`}
                    onClick={handleClickProgress}
                    onKeyDown={handleProgressKeyDown}
                    onMouseMove={handleMoveProgress}
                    onTouchStart={handleTouchStartProgress}
                    onTouchMove={handleTouchMoveProgress}
                    onTouchEnd={handleTouchEndProgress}
                    onTouchCancel={() => {
                        remoteTouchStartRef.current = null;
                    }}>
                    <div className="h-[3px] w-full overflow-hidden bg-[var(--b-color-progress-track)] transition-[height] duration-150 group-hover:h-1 group-focus-visible:h-1">
                        <div
                            className="h-full w-full bg-[var(--b-color-point)]"
                            style={{ transform: `translateX(-${100 - displayProgress}%)` }}
                        />
                    </div>
                </div>
            ) : (
                <div
                    className={cx(
                        'group flex h-6 w-full items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                        currentMusic && !localControlsBlocked
                            ? 'cursor-pointer'
                            : 'cursor-not-allowed opacity-60'
                    )}
                    role="slider"
                    tabIndex={currentMusic && !localControlsBlocked ? 0 : -1}
                    aria-disabled={!currentMusic || localControlsBlocked}
                    aria-label="Seek playback position"
                    aria-valuenow={Math.round(progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={`${Math.round(progress)}%`}
                    onClick={handleClickProgress}
                    onKeyDown={handleProgressKeyDown}
                    onMouseMove={handleMoveProgress}
                    onTouchMove={handleTouchMoveProgress}>
                    <div className="h-[3px] w-full overflow-hidden bg-[var(--b-color-progress-track)] transition-[height] duration-150 group-hover:h-1 group-focus-visible:h-1">
                        <div
                            className="h-full w-full bg-[var(--b-color-point)]"
                            style={{ transform: `translateX(-${100 - progress}%)` }}
                        />
                    </div>
                </div>
            )}
            <div className={cx(
                'flex items-center justify-between gap-[var(--b-spacing-md)] px-[var(--b-spacing-md)] pt-[var(--b-spacing-sm)] lg:px-[var(--b-spacing-lg)] lg:py-[var(--b-spacing-sm)]',
                remotePlayback && 'max-[520px]:flex-wrap max-[520px]:gap-[var(--b-spacing-sm)]',
                hasBottomNavigation
                    ? 'pb-[var(--b-spacing-sm)]'
                    : 'pb-[calc(var(--b-spacing-sm)+env(safe-area-inset-bottom))]'
            )}>
                <button
                    type="button"
                    className={cx(
                        'flex min-w-0 flex-1 items-center gap-[var(--b-spacing-sm)] border-0 bg-transparent p-0 text-left lg:gap-[var(--b-spacing-md)]',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                        displayMusic || remotePlayback ? 'cursor-pointer' : 'cursor-default',
                        remotePlayback && 'max-[520px]:basis-full'
                    )}
                    disabled={!displayMusic && !remotePlayback}
                    onClick={() => (displayMusic || remotePlayback) && navigate('/player')}>
                    {trackSummary}
                </button>

                {remotePlayback ? (
                    <div className="flex shrink-0 items-center gap-[var(--b-spacing-xs)] max-[520px]:w-full max-[520px]:justify-center">
                        <span className="hidden tabular-nums text-xs text-[var(--b-color-text-tertiary)] md:inline">
                            {makePlayTime(remotePlayback.positionMs / 1000)} / {makePlayTime(remotePlayback.music?.duration ?? 0)}
                        </span>
                        <RemotePlaybackControls
                            canSend={canSendRemoteCommand}
                            deviceName={remoteDeviceName}
                            onCommand={sendRemoteCommand}
                            state={remotePlayback.state}
                        />
                        <PlaybackDeviceMenu compact />
                        <IconButton
                            size="compact"
                            tone="muted"
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
                            disabled={localControlsBlocked}
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
                            disabled={localControlsBlocked}
                            onClick={() => queueStore.prev()}>
                            <Icon.SkipBack />
                        </IconButton>
                        <IconButton
                            size="play"
                            tone="primary"
                            className="max-[768px]:order-2"
                            aria-label={isPlaying ? 'Pause playback' : 'Resume playback'}
                            disabled={localControlsBlocked}
                            onClick={() => isPlaying ? queueStore.pause() : queueStore.play()}>
                            {isPlaying ? <Icon.Pause /> : <Icon.Play />}
                        </IconButton>
                        <IconButton
                            size="compact"
                            tone="muted"
                            className="max-[768px]:hidden"
                            aria-label="Next track"
                            disabled={localControlsBlocked}
                            onClick={() => queueStore.next()}>
                            <Icon.SkipForward />
                        </IconButton>
                        <IconButton
                            size="compact"
                            tone="muted"
                            active={shuffle}
                            className="max-[768px]:hidden"
                            aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
                            disabled={localControlsBlocked}
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
                        <PlaybackDeviceMenu
                            compact
                            className="max-[768px]:hidden"
                        />
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
            <PlaybackCommandFeedback
                compact
                className="mx-[var(--b-spacing-md)] mb-[var(--b-spacing-sm)] lg:mx-[var(--b-spacing-lg)]"
            />
            <span className="sr-only" role="status" aria-live="polite">
                {remotePlayback
                    ? remotePlayback.music
                        ? `${playbackStateLabel[remotePlayback.state]} on ${remoteDeviceName}: ${remotePlayback.music.name} by ${remotePlayback.music.artistDisplayName}. ${remoteDeviceStatus}.`
                        : `${playbackStateLabel[remotePlayback.state]} on ${remoteDeviceName}: playback item unavailable. ${remoteDeviceStatus}.`
                    : ''}
            </span>
        </div>
    );
};

export default MusicPlayer;
