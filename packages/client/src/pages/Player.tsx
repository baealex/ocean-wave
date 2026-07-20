import * as Dialog from '@baejino/react-ui/modal/dialog';

import { cva } from 'class-variance-authority';
import classNames from 'classnames';
import {
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
    type TouchEvent as ReactTouchEvent,
    useEffect,
    useRef,
    useState
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MusicActionPanelContent,
    MusicPlayerDiskStyle,
    MusicPlayerVisualizerStyle,
    PlaybackCommandFeedback,
    PlaybackDeviceMenu,
    RemotePlaybackControls,
    RemotePlaybackUnavailable
} from '~/components/music';
import { IconButton, IconTextButton, PageContainer, StateMessage, Text } from '~/components/shared';
import { dialogChromeClass, dialogContentClass, dialogOverlayClass } from '~/components/shared/Modal/DialogShell';
import { useBack, useDominantColor, useRemotePlayback, useStoreValue } from '~/hooks';
import * as Icon from '~/icon';
import { getImage } from '~/modules/image';
import { panel } from '~/modules/panel';
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
import type { PlayerVisualizerMode } from '~/store/theme';
import { themeStore } from '~/store/theme';

const cx = classNames;

const PLAYER_VISUALIZER_MODES: Array<{
    value: PlayerVisualizerMode;
    label: string;
    description: string;
}> = [
    {
        value: 'disk',
        label: 'CD',
        description: 'Simple disk player'
    },
    {
        value: 'round',
        label: 'Dancing',
        description: 'Sound points dance'
    },
    {
        value: 'line',
        label: 'Trace',
        description: 'Low spectrum trace'
    }
];

const MIX_MODES = [
    {
        value: 'none',
        label: 'No transition',
        description: 'Change tracks immediately'
    },
    {
        value: 'mix',
        label: 'Mix fade',
        description: 'Fade tracks across 20 seconds'
    }
] as const;

const remotePlaybackStateLabel = {
    playing: 'Playing',
    paused: 'Paused',
    stopped: 'Stopped'
} as const;

const visualizerFrameClass = cva(
    'relative aspect-square w-[min(72vw,34dvh,288px)] drop-shadow-[0_28px_56px_rgba(0,0,0,0.45)] sm:w-[min(54vw,36dvh,360px)] lg:w-[clamp(340px,32vw,460px)]',
    {
        variants: {
            effect: {
                true: "overflow-hidden rounded-[var(--b-radius-player-visualizer)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[var(--b-radius-player-visualizer)] after:shadow-[var(--b-shadow-inset-visualizer-ring)] after:content-['']",
                false: ''
            }
        },
        defaultVariants: {
            effect: false
        }
    }
);

const audioMenuDialogClass = {
    overlay: dialogOverlayClass({ layer: 'form', tone: 'strong' }),
    content: dialogContentClass({ layer: 'form', width: 'form', padding: 'none' }),
    panel: dialogChromeClass.panel,
    header: dialogChromeClass.stickyHeader,
    heading: dialogChromeClass.header,
    body: dialogChromeClass.body,
    title: dialogChromeClass.title,
    description: dialogChromeClass.description,
    sections: 'flex flex-col gap-5'
};

interface AudioMenuSectionProps {
    titleId: string;
    title: string;
    description: string;
    children: ReactNode;
}

const AudioMenuSection = ({
    titleId,
    title,
    description,
    children
}: AudioMenuSectionProps) => (
    <section className="flex flex-col gap-2.5" aria-labelledby={titleId}>
        <div className="flex flex-col gap-1">
            <h3 id={titleId} className="m-0 text-xs font-semibold uppercase leading-tight tracking-normal text-[var(--b-color-text-secondary)]">
                {title}
            </h3>
            <Text as="p" variant="tertiary" size="xs">
                {description}
            </Text>
        </div>

        {children}
    </section>
);

interface AudioMenuOptionProps {
    label: string;
    description: ReactNode;
    active?: boolean;
    disabled?: boolean;
    leadingIcon?: ReactNode;
    onClick: () => void;
    pressed?: boolean;
    variant?: 'option' | 'action';
}

const AudioMenuOption = ({
    label,
    description,
    active = false,
    disabled = false,
    leadingIcon,
    onClick,
    pressed,
    variant = 'option'
}: AudioMenuOptionProps) => (
    <IconTextButton
        size="menu"
        variant="secondary"
        layout={variant === 'option' ? 'between' : 'start'}
        fullWidth
        active={active}
        aria-pressed={pressed}
        disabled={disabled}
        icon={leadingIcon}
        label={label}
        meta={description}
        trailing={variant === 'option' && active ? <Icon.Check /> : undefined}
        onClick={onClick}
    />
);

export default function PlayerDetail() {
    const back = useBack();
    const navigate = useNavigate();

    const [currentTrackId] = useStoreValue(queueStore, 'currentTrackId');
    const [selected] = useStoreValue(queueStore, 'selected');
    const [queueLength] = useStoreValue(queueStore, 'queueLength');
    const [currentTime] = useStoreValue(queueStore, 'currentTime');
    const [progress] = useStoreValue(queueStore, 'progress');
    const [isPlaying] = useStoreValue(queueStore, 'isPlaying');
    const [repeatMode] = useStoreValue(queueStore, 'repeatMode');
    const [shuffle] = useStoreValue(queueStore, 'shuffle');
    const [mixMode] = useStoreValue(queueStore, 'mixMode');
    const [queueItems] = useStoreValue(queueStore, 'items');
    const [{ playerVisualizerMode }] = useStore(themeStore);
    const [{ musicMap }] = useStore(musicStore);
    const [{ registry }] = useStore(playbackDevicesStore);
    const [remoteControl] = useStore(remotePlaybackControlStore);
    const remotePlayback = useRemotePlayback();
    const hasRemotePlayback = remotePlayback !== null;
    const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false);
    const audioMenuTriggerRef = useRef<HTMLButtonElement>(null);
    const remoteTouchStartRef = useRef<{
        identifier: number;
        clientX: number;
        clientY: number;
    } | null>(null);
    const lastRemoteTouchEndAtRef = useRef(Number.NEGATIVE_INFINITY);

    const currentMusic = currentTrackId
        ? musicMap.get(currentTrackId)
        : null;
    const displayMusic = remotePlayback ? remotePlayback.music : currentMusic;
    const coverImage = displayMusic ? getImage(displayMusic.album.cover) : '';
    const dominantColor = useDominantColor(coverImage);
    const duration = displayMusic?.duration || 0;
    const displayCurrentTime = remotePlayback
        ? remotePlayback.positionMs / 1000
        : currentTime;
    const displayProgress = remotePlayback?.progress ?? progress;
    const displayIsPlaying = remotePlayback?.state === 'playing' || (!remotePlayback && isPlaying);
    const remoteQueueIndex = remotePlayback?.music
        ? queueItems.indexOf(remotePlayback.music.id)
        : -1;
    const queuePosition = remotePlayback
        ? remoteQueueIndex >= 0 ? remoteQueueIndex + 1 : null
        : selected !== null ? selected + 1 : null;
    const publishedYear = displayMusic?.album?.publishedYear?.trim() || '';
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
    const ambientBackground = dominantColor
        ? [
            `radial-gradient(circle at 28% 42%, rgba(${dominantColor.r}, ${dominantColor.g}, ${dominantColor.b}, 0.28) 0%, rgba(${dominantColor.r}, ${dominantColor.g}, ${dominantColor.b}, 0) 42%)`,
            `radial-gradient(circle at 76% 58%, rgba(${dominantColor.r}, ${dominantColor.g}, ${dominantColor.b}, 0.12) 0%, rgba(${dominantColor.r}, ${dominantColor.g}, ${dominantColor.b}, 0) 38%)`,
            'linear-gradient(180deg, rgba(9, 9, 11, 0.68) 0%, rgba(9, 9, 11, 0.9) 70%, #09090b 100%)'
        ].join(', ')
        : 'var(--b-gradient-subpage-fullscreen)';

    const seekFromClientX = (clientX: number, target: HTMLDivElement) => {
        const { width, left, right } = target.getBoundingClientRect();
        if (width <= 0) {
            return;
        }

        const x = Math.max(left, Math.min(clientX, right));
        const percent = (x - left) / width;

        if (duration <= 0) {
            return;
        }

        if (remotePlayback) {
            if (!canSendRemoteCommand('seek')) {
                return;
            }

            void remotePlaybackControlStore.send({
                type: 'seek',
                positionMs: Math.round(duration * 1000 * percent)
            });
            return;
        }

        if (!localControlsBlocked) {
            queueStore.seek(duration * percent);
        }
    };

    const handleClickProgress = (event: ReactMouseEvent<HTMLDivElement>) => {
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

    const handleMoveProgress = (
        event: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>
    ) => {
        if (remotePlayback) {
            return;
        }

        if ('buttons' in event && event.buttons === 1) {
            seekFromClientX(event.clientX, event.currentTarget);
            return;
        }

        if ('touches' in event && event.touches.length === 1) {
            seekFromClientX(event.touches[0].clientX, event.currentTarget);
        }
    };

    const handleTouchStartProgress = (event: ReactTouchEvent<HTMLDivElement>) => {
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

    const handleTouchEndProgress = (event: ReactTouchEvent<HTMLDivElement>) => {
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

    const handleKeyDownProgress = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (duration <= 0) {
            return;
        }

        const step = e.shiftKey ? 10 : 5;
        const nextTime = {
            ArrowLeft: displayCurrentTime - step,
            ArrowDown: displayCurrentTime - step,
            ArrowRight: displayCurrentTime + step,
            ArrowUp: displayCurrentTime + step,
            Home: 0,
            End: duration
        }[e.key];

        if (nextTime !== undefined) {
            e.preventDefault();
            seekToSeconds(Math.max(0, Math.min(nextTime, duration)));
        }
    };

    const playerEffectMode = remotePlayback ? 'disk' : playerVisualizerMode;
    const isVisualizerEffect = playerEffectMode !== 'disk';
    const openCurrentMusicActions = () => {
        if (!displayMusic) {
            return;
        }

        setIsAudioMenuOpen(false);
        panel.open({
            title: 'More actions',
            content: <MusicActionPanelContent id={displayMusic.id} />
        });
    };

    function seekToSeconds(seconds: number) {
        if (remotePlayback) {
            if (!canSendRemoteCommand('seek')) {
                return;
            }

            void remotePlaybackControlStore.send({
                type: 'seek',
                positionMs: Math.round(Math.max(0, Math.min(seconds, duration)) * 1000)
            });
            return;
        }

        if (!localControlsBlocked) {
            queueStore.seek(seconds);
        }
    }

    const sendRemoteCommand = (type: 'play' | 'pause' | 'next' | 'previous') => {
        if (!canSendRemoteCommand(type)) {
            return;
        }

        void remotePlaybackControlStore.send({ type });
    };

    useEffect(() => {
        if (!displayMusic || hasRemotePlayback) {
            setIsAudioMenuOpen(false);
        }
    }, [displayMusic, hasRemotePlayback]);

    return (
        <div className="relative h-full min-h-full w-full overflow-hidden bg-[var(--b-color-background)] max-lg:overflow-y-auto max-lg:overflow-x-hidden">
            <div
                className="pointer-events-none absolute inset-0"
                style={{ background: ambientBackground }}
                aria-hidden="true"
            />
            <div className="relative z-[1] flex min-h-full flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4 max-lg:pt-0">
                <Dialog.Root
                    open={Boolean(currentMusic && !remotePlayback && isAudioMenuOpen)}
                    onOpenChange={setIsAudioMenuOpen}>
                    <div className="mb-3.5 flex w-full min-w-0 shrink-0 items-center justify-between gap-[var(--b-spacing-md)] max-lg:-mx-4 max-lg:h-16 max-lg:w-auto max-lg:border-b max-lg:border-[var(--b-color-border-subtle)] max-lg:bg-[var(--b-color-background)] max-lg:px-3">
                        <IconButton
                            size="utility"
                            tone="muted"
                            aria-label="Go back"
                            onClick={back}>
                            <Icon.ChevronLeft />
                        </IconButton>

                        <div className="ml-auto flex items-center gap-1">
                            {(displayMusic || remotePlayback) && (
                                <PlaybackDeviceMenu compact />
                            )}
                            {currentMusic && !remotePlayback && (
                                <Dialog.Trigger asChild>
                                    <IconButton
                                        ref={audioMenuTriggerRef}
                                        size="utility"
                                        tone="muted"
                                        active={isAudioMenuOpen}
                                        aria-label="Open audio menu"
                                        aria-haspopup="dialog"
                                        aria-expanded={isAudioMenuOpen}>
                                        <Icon.Settings />
                                    </IconButton>
                                </Dialog.Trigger>
                            )}
                        </div>
                    </div>

                {currentMusic && !remotePlayback && (
                    <Dialog.Portal>
                        <Dialog.Overlay className={audioMenuDialogClass.overlay} />

                        <Dialog.Content
                            className={audioMenuDialogClass.content}
                            onCloseAutoFocus={(event) => {
                                event.preventDefault();
                                window.setTimeout(() => {
                                    audioMenuTriggerRef.current?.focus();
                                }, 0);
                            }}>
                            <div className={audioMenuDialogClass.panel}>
                                <header className={audioMenuDialogClass.header}>
                                    <div className={audioMenuDialogClass.heading}>
                                        <Dialog.Title asChild>
                                            <Text as="h2" size="md" weight="semibold" className={audioMenuDialogClass.title}>
                                                Audio
                                            </Text>
                                        </Dialog.Title>

                                        <Dialog.Description asChild>
                                            <Text as="p" variant="secondary" size="sm" className={audioMenuDialogClass.description}>
                                                Visualizer and playback tools
                                            </Text>
                                        </Dialog.Description>
                                    </div>

                                    <Dialog.Close asChild>
                                        <IconButton
                                            size="utility"
                                            tone="muted"
                                            className="shrink-0"
                                            aria-label="Close audio menu">
                                            <Icon.Close />
                                        </IconButton>
                                    </Dialog.Close>
                                </header>

                                <div className={audioMenuDialogClass.body}>
                                    <div className={audioMenuDialogClass.sections}>
                                        <AudioMenuSection
                                            titleId="player-effects-title"
                                            title="Player Effect"
                                            description="Choose how the album art reacts.">
                                            <div className="flex flex-col gap-1" aria-label="Visualizer mode">
                                                {PLAYER_VISUALIZER_MODES.map(({ value, label, description }) => (
                                                    <AudioMenuOption
                                                        key={value}
                                                        label={label}
                                                        description={description}
                                                        active={playerEffectMode === value}
                                                        pressed={playerEffectMode === value}
                                                        onClick={() => themeStore.setPlayerVisualizerMode(value)}
                                                    />
                                                ))}
                                            </div>
                                        </AudioMenuSection>

                                        <AudioMenuSection
                                            titleId="transition-title"
                                            title="Transition"
                                            description="Control how tracks blend.">
                                            <div className="flex flex-col gap-1" aria-label="Transition effect">
                                                {MIX_MODES.map(({ value, label, description }) => (
                                                    <AudioMenuOption
                                                        key={value}
                                                        label={label}
                                                        description={description}
                                                        active={mixMode === value}
                                                        pressed={mixMode === value}
                                                        onClick={() => queueStore.setMixMode(value)}
                                                    />
                                                ))}
                                            </div>
                                        </AudioMenuSection>

                                        <AudioMenuSection
                                            titleId="audio-tools-title"
                                            title="Audio Tools"
                                            description="Tune output and playback.">
                                            <AudioMenuOption
                                                variant="action"
                                                label="Open Equalizer"
                                                description="Adjust frequency bands and presets"
                                                leadingIcon={<Icon.Settings />}
                                                onClick={() => {
                                                    setIsAudioMenuOpen(false);
                                                    navigate('/equalizer');
                                                }}
                                            />

                                            <AudioMenuOption
                                                variant="action"
                                                label="Playback Settings"
                                                description="Quality and queue behavior"
                                                leadingIcon={<Icon.Gear />}
                                                onClick={() => {
                                                    setIsAudioMenuOpen(false);
                                                    navigate('/setting');
                                                }}
                                            />
                                        </AudioMenuSection>
                                    </div>
                                </div>
                            </div>
                        </Dialog.Content>
                    </Dialog.Portal>
                )}
                </Dialog.Root>

                <PlaybackCommandFeedback className="mx-auto mb-4 w-full max-w-[480px]" />

                {displayMusic ? (
                    <PageContainer
                        width="wide"
                        padding="none"
                        className="my-auto grid w-full items-center justify-center gap-7 py-4 max-lg:flex max-lg:flex-col max-sm:gap-5 max-sm:py-2 lg:grid-cols-[minmax(340px,460px)_minmax(360px,480px)] lg:gap-[clamp(56px,7vw,112px)]">
                        <div className="relative flex w-full justify-center lg:justify-start">
                            <div className={visualizerFrameClass({ effect: isVisualizerEffect })}>
                                {playerEffectMode === 'disk' && (
                                    <MusicPlayerDiskStyle
                                        isPlaying={displayIsPlaying}
                                        src={coverImage}
                                        alt={displayMusic.album.name}
                                    />
                                )}

                                {isVisualizerEffect && (
                                    <MusicPlayerVisualizerStyle
                                        type={playerEffectMode}
                                        isPlaying={displayIsPlaying}
                                        src={coverImage}
                                        alt={displayMusic.album.name}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="flex w-full min-w-0 max-w-[480px] flex-col gap-6 max-lg:items-center max-sm:gap-5">
                            <div className="flex w-full min-w-0 flex-col items-center gap-2 text-center lg:items-start lg:text-left">
                                <Text
                                    as="span"
                                    variant="muted"
                                    size="xs"
                                    weight="medium"
                                    className="uppercase tracking-[0.12em]">
                                    {remotePlayback
                                        ? `${remotePlaybackStateLabel[remotePlayback.state]} on ${remoteDeviceName} · ${remoteDeviceStatus}`
                                        : `${isPlaying ? 'Playing' : 'Paused'} on ${currentDevice?.name ?? 'this browser'} · ${currentDevice?.online ? 'Online' : 'Connecting'}`}
                                </Text>
                                <Text
                                    as="h1"
                                    size="2xl"
                                    weight="bold"
                                    className="w-full truncate leading-[1.06] tracking-[-0.025em] lg:text-[clamp(2.5rem,4vw,3.75rem)] lg:leading-[1.02]">
                                    {displayMusic.name}
                                </Text>

                                <Text
                                    as="p"
                                    variant="secondary"
                                    size="md"
                                    weight="medium"
                                    className="w-full truncate lg:text-lg">
                                    {displayMusic.artist.name}
                                </Text>

                                <div className="flex w-full min-w-0 flex-nowrap items-center justify-center gap-2.5 lg:justify-start [&>*]:min-w-0 [&>*]:truncate [&>:first-child]:flex-[0_1_auto] [&>:last-child]:shrink-0">
                                    <Text as="span" variant="tertiary" size="sm" weight="medium">
                                        {displayMusic.album.name}
                                    </Text>

                                    {publishedYear && (
                                        <Text as="span" variant="muted" size="sm">
                                            {publishedYear}
                                        </Text>
                                    )}
                                </div>
                            </div>

                            <div className="w-full pt-1">
                                <div
                                    className={cx(
                                        'group relative flex h-6 w-full items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--b-color-focus)]',
                                        remotePlayback
                                            ? canSendRemoteCommand('seek')
                                                ? 'cursor-pointer'
                                                : 'cursor-not-allowed opacity-60'
                                            : !localControlsBlocked
                                            ? 'cursor-pointer'
                                            : 'cursor-not-allowed opacity-60'
                                    )}
                                    role="slider"
                                    tabIndex={duration > 0 && (
                                        remotePlayback
                                            ? canSendRemoteCommand('seek')
                                            : !localControlsBlocked
                                    ) ? 0 : -1}
                                    aria-disabled={remotePlayback
                                        ? !canSendRemoteCommand('seek')
                                        : localControlsBlocked}
                                    aria-label={remotePlayback
                                        ? `Seek playback on ${remoteDeviceName}`
                                        : 'Seek playback position'}
                                    aria-valuenow={Math.round(displayCurrentTime)}
                                    aria-valuemin={0}
                                    aria-valuemax={Math.round(duration)}
                                    aria-valuetext={`${makePlayTime(displayCurrentTime)} of ${makePlayTime(duration)}`}
                                    onClick={handleClickProgress}
                                    onKeyDown={handleKeyDownProgress}
                                    onMouseMove={handleMoveProgress}
                                    onTouchStart={handleTouchStartProgress}
                                    onTouchMove={handleMoveProgress}
                                    onTouchEnd={handleTouchEndProgress}
                                    onTouchCancel={() => {
                                        remoteTouchStartRef.current = null;
                                    }}>
                                    <div className="relative h-1.5 w-full rounded-full bg-[var(--b-color-surface-input)]">
                                        <div
                                            className="absolute left-0 top-0 h-full w-full origin-left rounded-full bg-[var(--b-gradient-primary)]"
                                            style={{ transform: `scaleX(${displayProgress / 100})` }}
                                        />
                                        <div
                                            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--b-color-text)] shadow-none"
                                            style={{ left: `${displayProgress}%` }}
                                        />
                                    </div>
                                </div>
                                <div className="mt-3 flex justify-between gap-[var(--b-spacing-md)]">
                                    <Text variant="tertiary" size="sm">
                                        {makePlayTime(displayCurrentTime)}
                                    </Text>
                                    <Text variant="tertiary" size="sm">
                                        {makePlayTime(duration)}
                                    </Text>
                                </div>
                            </div>

                            {remotePlayback ? (
                                <RemotePlaybackControls
                                    canSend={canSendRemoteCommand}
                                    deviceName={remoteDeviceName}
                                    layout="detail"
                                    onCommand={sendRemoteCommand}
                                    state={remotePlayback.state}
                                />
                            ) : (
                                <div className="grid w-full grid-cols-5 items-center gap-2.5 max-sm:gap-2">
                                <IconButton
                                    size="control"
                                    tone="muted"
                                    active={shuffle}
                                    aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
                                    disabled={localControlsBlocked}
                                    onClick={() => queueStore.toggleShuffle()}>
                                    <Icon.Shuffle />
                                </IconButton>

                                <IconButton
                                    size="control"
                                    tone="muted"
                                    aria-label="Previous track"
                                    disabled={localControlsBlocked}
                                    onClick={() => queueStore.prev()}>
                                    <Icon.SkipBack />
                                </IconButton>

                                <IconButton
                                    size="controlLg"
                                    tone="gradient"
                                    aria-label={isPlaying ? 'Pause playback' : 'Resume playback'}
                                    disabled={localControlsBlocked}
                                    onClick={() => isPlaying ? queueStore.pause() : queueStore.play()}>
                                    {isPlaying ? <Icon.Pause /> : <Icon.Play />}
                                </IconButton>

                                <IconButton
                                    size="control"
                                    tone="muted"
                                    aria-label="Next track"
                                    disabled={localControlsBlocked}
                                    onClick={() => queueStore.next()}>
                                    <Icon.SkipForward />
                                </IconButton>

                                <IconButton
                                    size="control"
                                    tone="muted"
                                    aria-label={`Repeat mode ${repeatMode}`}
                                    disabled={localControlsBlocked}
                                    onClick={() => queueStore.changeRepeatMode()}>
                                    {repeatMode === 'all' && <Icon.Repeat />}
                                    {repeatMode === 'one' && <Icon.Infinite />}
                                    {repeatMode === 'none' && <Icon.RightLeft />}
                                </IconButton>
                                </div>
                            )}

                            <div className="flex w-full flex-wrap items-center justify-center gap-2.5 max-sm:gap-2 lg:justify-start">
                                <PlaybackDeviceMenu />
                                <IconTextButton
                                    size="sm"
                                    shape="pill"
                                    active={displayMusic.isLiked}
                                    filled={displayMusic.isLiked}
                                    icon={<Icon.Heart />}
                                    label={displayMusic.isLiked ? 'Liked' : 'Like'}
                                    aria-pressed={displayMusic.isLiked}
                                    onClick={() => MusicListener.like(displayMusic.id, !displayMusic.isLiked)}
                                />
                                <IconTextButton
                                    size="sm"
                                    shape="pill"
                                    icon={<Icon.Menu />}
                                    label="More"
                                    onClick={openCurrentMusicActions}
                                />
                                {queuePosition !== null && (
                                    <IconTextButton
                                        size="sm"
                                        shape="pill"
                                        icon={<Icon.ListMusic />}
                                        label={(
                                            <>
                                                <span className="sm:hidden">Queue</span>
                                                <span className="max-sm:hidden">Queue {queuePosition}/{queueLength}</span>
                                            </>
                                        )}
                                        aria-label={`Open queue, ${queuePosition} of ${queueLength}`}
                                        onClick={() => navigate('/queue')}
                                    />
                                )}
                            </div>
                        </div>
                    </PageContainer>
                ) : remotePlayback ? (
                    <RemotePlaybackUnavailable
                        canSend={canSendRemoteCommand}
                        deviceName={remoteDeviceName}
                        deviceStatus={remoteDeviceStatus}
                        onCommand={sendRemoteCommand}
                        onOpenQueue={() => navigate('/queue')}
                        state={remotePlayback.state}
                    />
                ) : (
                    <StateMessage
                        surface
                        className="m-auto"
                        icon={<Icon.Music />}
                        heading="Nothing is playing."
                        description="Start something from your library or queue to return here."
                        actions={(
                            <>
                                <IconTextButton
                                    size="lg"
                                    shape="pill"
                                    variant="primary"
                                    className="max-sm:w-full"
                                    icon={<Icon.Music />}
                                    label="Open library"
                                    onClick={() => navigate('/')}
                                />
                                <IconTextButton
                                    size="lg"
                                    shape="pill"
                                    className="max-sm:w-full"
                                    icon={<Icon.ListMusic />}
                                    label="Open queue"
                                    onClick={() => navigate('/queue')}
                                />
                            </>
                        )}
                    />
                )}
            </div>
        </div>
    );
}
