import {
    useEffect,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode
} from 'react';

import classNames from 'classnames';
const cx = classNames;

import { useNavigate } from 'react-router-dom';
import { useAppStore as useStore } from '~/store/base-store';

import {
    MusicPlayerDiskStyle,
    MusicPlayerVisualizerStyle
} from '~/components/music';
import { IconTextButton, PageContainer, Surface, Text } from '~/components/shared';
import * as Icon from '~/icon';

import { useBack, useStoreValue } from '~/hooks';

import { getImage } from '~/modules/image';
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

const PLAYER_PRIMARY_COLOR = {
    r: 139,
    g: 92,
    b: 246
} as const;

const playerUtilityButtonClass = 'inline-flex h-11 w-11 items-center justify-center rounded-full border-0 bg-transparent text-[var(--b-color-text-secondary)] transition-[color,background-color] duration-150 hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] max-lg:h-10 max-lg:w-10 max-lg:text-inherit [&_svg]:h-[1.125rem] [&_svg]:w-[1.125rem] max-lg:[&_svg]:h-5 max-lg:[&_svg]:w-5';
const playerControlButtonClass = 'inline-flex h-[clamp(2.75rem,10vw,3.25rem)] w-[clamp(2.75rem,10vw,3.25rem)] items-center justify-center justify-self-center rounded-full border-0 bg-transparent text-[var(--b-color-text-secondary)] transition-[color,background-color] duration-150 hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] [&_svg]:h-5 [&_svg]:w-5';
const playerSecondaryActionClass = 'min-h-9 rounded-full border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-3 py-2 text-sm font-medium text-[var(--b-color-text-tertiary)] transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] [&_svg]:h-[0.95rem] [&_svg]:w-[0.95rem]';
const playerEmptyButtonClass = 'min-h-11 rounded-full border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] px-4 py-3 text-[var(--b-color-text-secondary)] transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-surface-input)] hover:text-[var(--b-color-text)] max-sm:w-full [&_svg]:h-4 [&_svg]:w-4';
const audioOptionBaseClass = 'flex min-h-[3.25rem] w-full items-center justify-between gap-3 rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-3 py-2.5 text-left text-[var(--b-color-text-secondary)] transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0';

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
            <h3 id={titleId} className="m-0 text-xs font-semibold uppercase leading-tight tracking-[0.08em] text-[var(--b-color-text-secondary)]">
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
    <button
        type="button"
        className={cx(
            audioOptionBaseClass,
            variant === 'action' && 'justify-start [&>svg]:h-[1.125rem] [&>svg]:w-[1.125rem] [&>svg]:text-[var(--b-color-text-tertiary)]',
            active && 'border-[var(--b-color-focus)] bg-[var(--b-color-active)] text-[var(--b-color-text)]',
            disabled && 'cursor-not-allowed opacity-50'
        )}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}>
        {leadingIcon}
        <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold leading-[1.35] text-inherit">{label}</span>
            <span className="text-xs font-normal leading-[1.35] text-[var(--b-color-text-tertiary)]">{description}</span>
        </span>
        {variant === 'option' && active && <Icon.Check />}
    </button>
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

    useEffect(() => {
        if (!isAudioMenuOpen) {
            return;
        }

        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsAudioMenuOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isAudioMenuOpen]);

    useEffect(() => {
        if (!currentMusic) {
            setIsAudioMenuOpen(false);
        }
    }, [currentMusic]);

    return (
        <div className="relative h-full min-h-full w-full overflow-hidden bg-[var(--b-gradient-page)]">
            {currentMusic && <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[var(--b-color-background)]" aria-hidden="true" />}

            <div className="relative z-[1] flex min-h-full flex-col px-4 pb-6 pt-4 max-lg:pt-0">
                <div className="mb-3.5 flex w-full min-w-0 shrink-0 items-center justify-between gap-[var(--b-spacing-md)] max-lg:-mx-4 max-lg:h-16 max-lg:w-auto max-lg:border-b max-lg:border-[var(--b-color-border-subtle)] max-lg:bg-[var(--b-color-background)] max-lg:px-3">
                    <button
                        type="button"
                        className={playerUtilityButtonClass}
                        aria-label="Go back"
                        onClick={back}>
                        <Icon.ChevronLeft />
                    </button>

                    {currentMusic && (
                        <button
                            type="button"
                            className={cx(playerUtilityButtonClass, 'ml-auto', isAudioMenuOpen && 'bg-[var(--b-color-active)] text-[var(--b-color-text)]')}
                            aria-label="Open audio menu"
                            aria-haspopup="dialog"
                            aria-expanded={isAudioMenuOpen}
                            onClick={() => setIsAudioMenuOpen(true)}>
                            <Icon.Menu />
                        </button>
                    )}
                </div>

                {currentMusic && isAudioMenuOpen && (
                    <div className="fixed inset-0 z-30 flex justify-end max-sm:block">
                        <button
                            type="button"
                            className="absolute inset-0 border-0 bg-transparent max-sm:hidden"
                            aria-label="Close audio menu"
                            onClick={() => setIsAudioMenuOpen(false)}
                        />

                        <Surface
                            as="aside"
                            variant="panel"
                            radius="none"
                            className="relative z-[1] m-0 flex h-dvh w-[min(22rem,34vw)] min-w-80 flex-col gap-6 overflow-y-auto rounded-none border-l border-[var(--b-color-border-subtle)] bg-[var(--b-color-background)] p-5 text-[var(--b-color-text)] shadow-none max-sm:h-dvh max-sm:w-screen max-sm:min-w-0 max-sm:border-0 max-sm:p-4"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Audio menu">
                            <header className="flex items-start justify-between gap-4 border-b border-[var(--b-color-border-subtle)] pb-4">
                                <div>
                                    <Text as="h2" size="md" weight="semibold">
                                        Audio
                                    </Text>
                                    <Text as="p" variant="tertiary" size="xs">
                                        Visualizer and playback tools
                                    </Text>
                                </div>

                                <button
                                    type="button"
                                    className={cx(playerUtilityButtonClass, "shrink-0 text-[var(--b-color-text-secondary)]")}
                                    aria-label="Close audio menu"
                                    onClick={() => setIsAudioMenuOpen(false)}>
                                    <Icon.Close />
                                </button>
                            </header>

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
                        </Surface>
                    </div>
                )}

                {currentMusic ? (
                    <PageContainer width="player" padding="none" className="m-auto flex flex-col items-center gap-6 max-sm:gap-5">
                        <div className="flex w-full justify-center">
                            <div className={cx(
                                'relative aspect-square w-[min(100%,19rem)] max-sm:w-[min(100%,16rem)]',
                                isVisualizerEffect && "overflow-hidden rounded-[2rem] after:pointer-events-none after:absolute after:inset-0 after:rounded-[2rem] after:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] after:content-['']"
                            )}>
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
                                        accentColor={PLAYER_PRIMARY_COLOR}
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
                            <Text as="h1" size="2xl" weight="bold" className="w-full max-w-[min(100%,24rem)] truncate leading-[1.08] tracking-normal max-sm:max-w-[min(100%,21rem)]">
                                {currentMusic.name}
                            </Text>

                            <Text
                                as="p"
                                variant="secondary"
                                size="md"
                                weight="medium"
                                className="w-full max-w-[min(100%,22rem)] truncate max-sm:max-w-[min(100%,20rem)]">
                                {currentMusic.artist.name}
                            </Text>

                            <div className="flex w-full min-w-0 max-w-[min(100%,22rem)] flex-nowrap items-center justify-center gap-2.5 max-sm:max-w-[min(100%,20rem)] [&>*]:min-w-0 [&>*]:truncate [&>:first-child]:flex-[0_1_auto] [&>:last-child]:shrink-0">
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
                            <button
                                type="button"
                                className={cx(playerControlButtonClass, shuffle && '!text-[var(--b-color-point)] hover:!text-[var(--b-color-point)] [&_svg]:!stroke-[var(--b-color-point)] [&_path]:!stroke-[var(--b-color-point)]')}
                                aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
                                onClick={() => queueStore.toggleShuffle()}>
                                <Icon.Shuffle />
                            </button>

                            <button
                                type="button"
                                className={playerControlButtonClass}
                                aria-label="Previous track"
                                onClick={() => queueStore.prev()}>
                                <Icon.SkipBack />
                            </button>

                            <button
                                type="button"
                                className="inline-flex h-[clamp(4.25rem,14vw,4.75rem)] w-[clamp(4.25rem,14vw,4.75rem)] items-center justify-center justify-self-center rounded-full border-0 bg-[var(--b-gradient-primary)] text-[var(--b-color-background)] transition-[color,background-color] duration-150 hover:text-[var(--b-color-background)] [&_svg]:h-7 [&_svg]:w-7"
                                aria-label={isPlaying ? 'Pause playback' : 'Resume playback'}
                                onClick={() => isPlaying ? queueStore.pause() : queueStore.play()}>
                                {isPlaying ? <Icon.Pause /> : <Icon.Play />}
                            </button>

                            <button
                                type="button"
                                className={playerControlButtonClass}
                                aria-label="Next track"
                                onClick={() => queueStore.next()}>
                                <Icon.SkipForward />
                            </button>

                            <button
                                type="button"
                                className={playerControlButtonClass}
                                aria-label={`Repeat mode ${repeatMode}`}
                                onClick={() => queueStore.changeRepeatMode()}>
                                {repeatMode === 'all' && <Icon.Repeat />}
                                {repeatMode === 'one' && <Icon.Infinite />}
                                {repeatMode === 'none' && <Icon.RightLeft />}
                            </button>
                        </div>

                        <div className="flex w-full flex-wrap items-center justify-center gap-2.5 max-sm:gap-2">
                            <IconTextButton
                                className={cx(
                                    playerSecondaryActionClass,
                                    currentMusic.isLiked && 'border-[var(--b-color-focus)] bg-[var(--b-color-active)] !text-[var(--b-color-point)] [&_svg]:!fill-[var(--b-color-point)] [&_svg]:!stroke-[var(--b-color-point)]'
                                )}
                                size="sm"
                                icon={<Icon.Heart />}
                                label={currentMusic.isLiked ? 'Liked' : 'Like'}
                                aria-pressed={currentMusic.isLiked}
                                onClick={() => MusicListener.like(currentMusic.id, !currentMusic.isLiked)}
                            />
                            <IconTextButton
                                className={playerSecondaryActionClass}
                                size="sm"
                                icon={<Icon.Music />}
                                label="Artist"
                                onClick={() => navigate(`/artist/${currentMusic.artist.id}`)}
                            />
                            <IconTextButton
                                className={playerSecondaryActionClass}
                                size="sm"
                                icon={<Icon.Disc />}
                                label="Album"
                                onClick={() => navigate(`/album/${currentMusic.album.id}`)}
                            />
                            {queuePosition !== null && (
                                <IconTextButton
                                    className={playerSecondaryActionClass}
                                    size="sm"
                                    icon={<Icon.ListMusic />}
                                    label={`Queue ${queuePosition}/${queueLength}`}
                                    onClick={() => navigate('/queue')}
                                />
                            )}
                        </div>
                    </PageContainer>
                ) : (
                    <Surface variant="panel" radius="2xl" padding="lg" className="m-auto flex w-[min(100%,28rem)] flex-col items-center gap-6 text-center">
                        <div className="flex h-20 w-20 items-center justify-center rounded-[1.5rem] border border-[var(--b-color-border)] bg-[var(--b-color-surface-item)] text-[var(--b-color-point-light)] [&_svg]:h-8 [&_svg]:w-8">
                            <Icon.Music />
                        </div>

                        <div className="flex flex-col gap-3">
                            <Text as="h1" size="2xl" weight="bold">
                                Nothing is playing.
                            </Text>
                            <Text as="p" variant="secondary" size="md">
                                Start something from your library or queue to return here.
                            </Text>
                        </div>

                        <div className="flex flex-wrap justify-center gap-3 max-sm:w-full max-sm:flex-col">
                            <IconTextButton
                                className={cx(playerEmptyButtonClass, 'text-[var(--b-color-text)]')}
                                icon={<Icon.Music />}
                                label="Open library"
                                onClick={() => navigate('/')}
                            />
                            <IconTextButton
                                className={playerEmptyButtonClass}
                                icon={<Icon.ListMusic />}
                                label="Open queue"
                                onClick={() => navigate('/queue')}
                            />
                        </div>
                    </Surface>
                )}
            </div>
        </div>
    );
}
