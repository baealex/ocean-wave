import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode
} from 'react';

import { cva } from 'class-variance-authority';

import * as Dialog from '@baejino/react-ui/modal/dialog';
import { useNavigate } from 'react-router-dom';
import { useAppStore as useStore } from '~/store/base-store';

import {
    MusicActionPanelContent,
    MusicPlayerDiskStyle,
    MusicPlayerVisualizerStyle
} from '~/components/music';
import { IconButton, IconTextButton, PageContainer, StateMessage, Text } from '~/components/shared';
import { dialogChromeClass, dialogContentClass, dialogOverlayClass } from '~/components/shared/Modal/DialogShell';
import * as Icon from '~/icon';

import { useBack, useStoreValue } from '~/hooks';

import { getImage } from '~/modules/image';
import { panel } from '~/modules/panel';
import { makePlayTime } from '~/modules/time';

import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';
import { themeStore } from '~/store/theme';
import type { PlayerVisualizerMode } from '~/store/theme';
import { MusicListener } from '~/socket';

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

const visualizerFrameClass = cva(
    'relative aspect-square w-[min(100%,304px)] max-sm:w-[min(100%,256px)]',
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
    content: dialogContentClass({ layer: 'form', width: 'form', padding: 'form' }),
    panel: 'flex max-h-[min(82dvh,640px)] flex-col gap-5 overflow-y-auto',
    header: 'flex items-start justify-between gap-4 border-b border-[var(--b-color-border-subtle)] pb-4',
    heading: dialogChromeClass.header,
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
    const [{ playerVisualizerMode }] = useStore(themeStore);
    const [{ musicMap }] = useStore(musicStore);
    const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false);
    const audioMenuTriggerRef = useRef<HTMLButtonElement>(null);

    const currentMusic = currentTrackId
        ? musicMap.get(currentTrackId)
        : null;
    const coverImage = currentMusic ? getImage(currentMusic.album.cover) : '';
    const duration = currentMusic?.duration || 0;
    const queuePosition = selected !== null ? selected + 1 : null;
    const publishedYear = currentMusic?.album?.publishedYear?.trim() || '';

    // TODO: Fix type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleClickProgress = (e: any) => {
        const { width, left, right } = (e.currentTarget as HTMLDivElement).getBoundingClientRect();

        let x = e.touches ? e.touches[0].clientX : e.clientX;
        x = x < left ? left : x > right ? right : x;
        const percent = (x - left) / width;

        if (duration <= 0) {
            return;
        }

        queueStore.seek(duration * percent);
    };

    // TODO: Fix type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMoveProgress = (e: any) => {
        if (e.buttons === 1) {
            handleClickProgress(e);
            return;
        }

        if (e.touches?.length === 1) {
            handleClickProgress(e);
        }
    };

    const handleKeyDownProgress = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (duration <= 0) {
            return;
        }

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            queueStore.seek(Math.max(0, currentTime - 5));
        }

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            queueStore.seek(Math.min(duration, currentTime + 5));
        }

        if (e.key === 'Home') {
            e.preventDefault();
            queueStore.seek(0);
        }

        if (e.key === 'End') {
            e.preventDefault();
            queueStore.seek(duration);
        }
    };

    const playerEffectMode = playerVisualizerMode;
    const isVisualizerEffect = playerEffectMode !== 'disk';
    const openCurrentMusicActions = () => {
        if (!currentMusic) {
            return;
        }

        setIsAudioMenuOpen(false);
        panel.open({
            title: 'More actions',
            content: <MusicActionPanelContent id={currentMusic.id} />
        });
    };

    useEffect(() => {
        if (!currentMusic) {
            setIsAudioMenuOpen(false);
        }
    }, [currentMusic]);

    return (
        <div className="relative h-full min-h-full w-full overflow-hidden bg-[var(--b-gradient-page)] max-sm:overflow-y-auto max-sm:overflow-x-hidden">
            {currentMusic && <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[var(--b-color-background)]" aria-hidden="true" />}

            <div className="relative z-[1] flex min-h-full flex-col px-4 pb-6 pt-4 max-lg:pt-0">
                <Dialog.Root
                    open={Boolean(currentMusic && isAudioMenuOpen)}
                    onOpenChange={setIsAudioMenuOpen}>
                    <div className="mb-3.5 flex w-full min-w-0 shrink-0 items-center justify-between gap-[var(--b-spacing-md)] max-lg:-mx-4 max-lg:h-16 max-lg:w-auto max-lg:border-b max-lg:border-[var(--b-color-border-subtle)] max-lg:bg-[var(--b-color-background)] max-lg:px-3">
                        <IconButton
                            size="utility"
                            tone="muted"
                            aria-label="Go back"
                            onClick={back}>
                            <Icon.ChevronLeft />
                        </IconButton>

                        {currentMusic && (
                            <Dialog.Trigger asChild>
                                <IconButton
                                    ref={audioMenuTriggerRef}
                                    size="utility"
                                    tone="muted"
                                    active={isAudioMenuOpen}
                                    className="ml-auto"
                                    aria-label="Open audio menu"
                                    aria-haspopup="dialog"
                                    aria-expanded={isAudioMenuOpen}>
                                    <Icon.Settings />
                                </IconButton>
                            </Dialog.Trigger>
                        )}
                    </div>

                {currentMusic && (
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
                        </Dialog.Content>
                    </Dialog.Portal>
                )}
                </Dialog.Root>

                {currentMusic ? (
                    <PageContainer width="player" padding="none" className="m-auto flex flex-col items-center gap-6 max-sm:gap-5">
                        <div className="flex w-full justify-center">
                            <div className={visualizerFrameClass({ effect: isVisualizerEffect })}>
                                {playerEffectMode === 'disk' && (
                                    <MusicPlayerDiskStyle
                                        isPlaying={isPlaying}
                                        src={coverImage}
                                        alt={currentMusic.album.name}
                                    />
                                )}

                                {isVisualizerEffect && (
                                    <MusicPlayerVisualizerStyle
                                        type={playerEffectMode}
                                        isPlaying={isPlaying}
                                        src={coverImage}
                                        alt={currentMusic.album.name}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="flex w-full min-w-0 flex-col items-center gap-2 text-center">
                            <Text
                                as="span"
                                variant="muted"
                                size="xs"
                                weight="medium"
                                className="uppercase tracking-normal">
                                Now playing
                            </Text>
                            <Text as="h1" size="2xl" weight="bold" className="w-full max-w-[min(100%,384px)] truncate leading-[1.08] tracking-normal max-sm:max-w-[min(100%,336px)]">
                                {currentMusic.name}
                            </Text>

                            <Text
                                as="p"
                                variant="secondary"
                                size="md"
                                weight="medium"
                                className="w-full max-w-[min(100%,352px)] truncate max-sm:max-w-[min(100%,320px)]">
                                {currentMusic.artist.name}
                            </Text>

                            <div className="flex w-full min-w-0 max-w-[min(100%,352px)] flex-nowrap items-center justify-center gap-2.5 max-sm:max-w-[min(100%,320px)] [&>*]:min-w-0 [&>*]:truncate [&>:first-child]:flex-[0_1_auto] [&>:last-child]:shrink-0">
                                <Text as="span" variant="tertiary" size="sm" weight="medium">
                                    {currentMusic.album.name}
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
                                className="relative h-1.5 w-full cursor-pointer rounded-full bg-[var(--b-color-surface-input)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--b-color-focus)]"
                                role="slider"
                                tabIndex={duration > 0 ? 0 : -1}
                                aria-label="Seek playback position"
                                aria-valuenow={Math.round(currentTime)}
                                aria-valuemin={0}
                                aria-valuemax={Math.round(duration)}
                                aria-valuetext={`${makePlayTime(currentTime)} of ${makePlayTime(duration)}`}
                                onClick={handleClickProgress}
                                onKeyDown={handleKeyDownProgress}
                                onMouseMove={handleMoveProgress}
                                onTouchMove={handleMoveProgress}>
                                <div
                                    className="absolute left-0 top-0 h-full w-full origin-left rounded-full bg-[var(--b-gradient-primary)]"
                                    style={{ transform: `scaleX(${progress / 100})` }}
                                />
                                <div
                                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--b-color-text)] shadow-none"
                                    style={{ left: `${progress}%` }}
                                />
                            </div>
                            <div className="mt-3 flex justify-between gap-[var(--b-spacing-md)]">
                                <Text variant="tertiary" size="sm">
                                    {makePlayTime(currentTime)}
                                </Text>
                                <Text variant="tertiary" size="sm">
                                    {makePlayTime(duration)}
                                </Text>
                            </div>
                        </div>

                        <div className="grid w-full grid-cols-5 items-center gap-2.5 max-sm:gap-2">
                            <IconButton
                                size="control"
                                tone="muted"
                                active={shuffle}
                                aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
                                onClick={() => queueStore.toggleShuffle()}>
                                <Icon.Shuffle />
                            </IconButton>

                            <IconButton
                                size="control"
                                tone="muted"
                                aria-label="Previous track"
                                onClick={() => queueStore.prev()}>
                                <Icon.SkipBack />
                            </IconButton>

                            <IconButton
                                size="controlLg"
                                tone="gradient"
                                aria-label={isPlaying ? 'Pause playback' : 'Resume playback'}
                                onClick={() => isPlaying ? queueStore.pause() : queueStore.play()}>
                                {isPlaying ? <Icon.Pause /> : <Icon.Play />}
                            </IconButton>

                            <IconButton
                                size="control"
                                tone="muted"
                                aria-label="Next track"
                                onClick={() => queueStore.next()}>
                                <Icon.SkipForward />
                            </IconButton>

                            <IconButton
                                size="control"
                                tone="muted"
                                aria-label={`Repeat mode ${repeatMode}`}
                                onClick={() => queueStore.changeRepeatMode()}>
                                {repeatMode === 'all' && <Icon.Repeat />}
                                {repeatMode === 'one' && <Icon.Infinite />}
                                {repeatMode === 'none' && <Icon.RightLeft />}
                            </IconButton>
                        </div>

                        <div className="flex w-full flex-wrap items-center justify-center gap-2.5 max-sm:gap-2">
                            <IconTextButton
                                size="sm"
                                shape="pill"
                                active={currentMusic.isLiked}
                                filled={currentMusic.isLiked}
                                icon={<Icon.Heart />}
                                label={currentMusic.isLiked ? 'Liked' : 'Like'}
                                aria-pressed={currentMusic.isLiked}
                                onClick={() => MusicListener.like(currentMusic.id, !currentMusic.isLiked)}
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
                    </PageContainer>
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
