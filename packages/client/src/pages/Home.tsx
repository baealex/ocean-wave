import { Link, useNavigate } from 'react-router-dom';

import { useAppStore as useStore } from '~/store/base-store';
import { IconTextButton, Image, Surface, Text } from '~/components/shared';
import * as Icon from '~/icon';
import { useResetQueue } from '~/hooks';
import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';

import type { Music } from '~/models/type';

const QUEUE_PREVIEW_LIMIT = 3;
const RECENTLY_ADDED_LIMIT = 4;

const isMusic = (music: Music | undefined): music is Music => Boolean(music);

const formatCount = (count: number, singular: string, plural = `${singular}s`) => {
    return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
};

export default function Home() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();

    const [{ loaded, musics, musicMap }] = useStore(musicStore);
    const [{
        currentTrackId,
        isPlaying,
        items,
        progress,
        queueLength,
        selected
    }] = useStore(queueStore);

    const currentMusic = currentTrackId ? musicMap.get(currentTrackId) : null;
    const availableMusics = musics.filter(music => !music.isHated);
    const likedMusics = availableMusics.filter(music => music.isLiked);
    const albumCount = new Set(availableMusics.map(music => music.album.id)).size;
    const artistCount = new Set(availableMusics.map(music => music.artist.id)).size;
    const queuePreviewStartIndex = selected === null ? 0 : selected + 1;
    const queuePreviewMusics = items
        .slice(queuePreviewStartIndex)
        .filter(id => id !== currentTrackId)
        .slice(0, QUEUE_PREVIEW_LIMIT)
        .map(id => musicMap.get(id))
        .filter(isMusic);
    const upNextCount = selected === null
        ? queueLength
        : Math.max(queueLength - selected - 1, 0);
    const recentlyAddedMusics = [...availableMusics]
        .filter(music => music.id !== currentTrackId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, RECENTLY_ADDED_LIMIT);

    const handlePrimaryAction = () => {
        if (currentMusic) {
            if (isPlaying) {
                queueStore.pause();
                return;
            }
            queueStore.play();
            return;
        }

        void resetQueue(availableMusics.map(music => music.id));
    };

    const handlePlayFavorites = () => {
        void resetQueue(likedMusics.map(music => music.id));
    };

    const shortcutItems = [
        {
            label: 'Songs',
            meta: formatCount(availableMusics.length, 'song'),
            path: '/library',
            icon: <Icon.Music />
        },
        {
            label: 'Favorites',
            meta: formatCount(likedMusics.length, 'song'),
            path: '/favorite',
            icon: <Icon.Heart />
        },
        {
            label: 'Albums',
            meta: formatCount(albumCount, 'album'),
            path: '/album',
            icon: <Icon.Disc />
        },
        {
            label: 'Artists',
            meta: formatCount(artistCount, 'artist'),
            path: '/artist',
            icon: <Icon.User />
        }
    ];

    return (
        <>
            <Surface as="section" variant="panel" radius="2xl" className="relative grid min-h-[clamp(15rem,34vw,22rem)] grid-cols-[minmax(9rem,0.44fr)_minmax(0,1fr)] items-center gap-[clamp(1.25rem,4vw,3rem)] overflow-hidden rounded-[var(--b-radius-2xl)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] p-[clamp(1rem,3vw,1.5rem)] shadow-[var(--b-card-shadow-main)] max-[900px]:min-h-0 max-[900px]:grid-cols-1 max-sm:rounded-[var(--b-radius-xl)]">
                <div className="relative flex min-w-0 justify-center before:absolute before:left-1/2 before:top-1/2 before:h-[78%] before:w-[78%] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:border before:border-[rgba(139,92,246,0.26)] before:content-[''] after:absolute after:left-1/2 after:top-1/2 after:h-[92%] after:w-[92%] after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-[var(--b-radius-2xl)] after:border after:border-[rgba(244,244,245,0.08)] after:content-['']">
                    {currentMusic ? (
                        <Image
                            className="relative z-[1] aspect-square w-[min(100%,12.5rem)] rounded-[var(--b-radius-2xl)] border border-[rgba(244,244,245,0.08)] object-cover shadow-[0_18px_42px_rgba(0,0,0,0.28)] max-sm:w-[min(100%,14rem)] max-sm:rounded-[var(--b-radius-xl)]"
                            src={currentMusic.album.cover}
                            alt={currentMusic.album.name}
                            loading="eager"
                            icon={<Icon.Disc />}
                        />
                    ) : (
                        <div className="relative z-[1] flex aspect-square w-[min(100%,12.5rem)] items-center justify-center rounded-[var(--b-radius-2xl)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] text-[var(--b-color-point-light)] shadow-[0_18px_42px_rgba(0,0,0,0.24)] max-sm:w-[min(100%,14rem)] max-sm:rounded-[var(--b-radius-xl)] [&_svg]:h-16 [&_svg]:w-16">
                            <Icon.Music />
                        </div>
                    )}
                </div>

                <div className="flex min-w-0 flex-col items-start gap-3.5 max-[900px]:items-center max-[900px]:text-center">
                    <Text
                        as="span"
                        variant="muted"
                        size="xs"
                        weight="medium"
                        className="tracking-[0.08em] text-[var(--b-color-point-light)] uppercase">
                        {currentMusic ? 'Now playing' : 'Listening room'}
                    </Text>

                    <Text
                        as="h1"
                        size="2xl"
                        weight="bold"
                        title={currentMusic?.name}
                        className="max-w-[min(100%,28rem)] overflow-hidden break-all leading-[1.08] tracking-[-0.04em] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] max-[900px]:max-w-[min(100%,24rem)]">
                        {currentMusic?.name ?? (loaded ? 'Ready when you are.' : 'Loading your library.')}
                    </Text>

                    <Text as="p" variant="secondary" size="md" className="max-w-[34rem] leading-[1.6] max-sm:hidden">
                        {currentMusic
                            ? `${currentMusic.artist.name} · ${currentMusic.album.name}`
                            : 'Start a calm session from your own collection.'}
                    </Text>

                    {currentMusic && (
                        <div className="mt-1 h-1.5 w-[min(100%,22rem)] overflow-hidden rounded-full bg-[var(--b-color-border-subtle)] max-[900px]:w-full" aria-hidden="true">
                            <div
                                className="h-full w-full origin-left rounded-[inherit] bg-[var(--b-gradient-primary)]"
                                style={{ transform: `scaleX(${progress / 100})` }}
                            />
                        </div>
                    )}

                    <div className="flex flex-wrap gap-3 max-[900px]:justify-center max-sm:w-full">
                        <IconTextButton
                            className="min-h-11 rounded-[var(--b-radius-md)] max-sm:w-full"
                            variant="primary"
                            size="lg"
                            icon={currentMusic && isPlaying ? <Icon.Pause /> : <Icon.Play />}
                            label={currentMusic ? (isPlaying ? 'Pause' : 'Resume') : 'Start library'}
                            disabled={!currentMusic && availableMusics.length === 0}
                            onClick={handlePrimaryAction}
                        />

                        <IconTextButton
                            className="min-h-11 rounded-[var(--b-radius-md)] max-sm:w-full"
                            variant="secondary"
                            size="lg"
                            icon={currentMusic ? <Icon.Music /> : <Icon.ListMusic />}
                            label={currentMusic ? 'Open player' : 'Open library'}
                            onClick={() => navigate(currentMusic ? '/player' : '/library')}
                        />
                    </div>
                </div>
            </Surface>

            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)] gap-[clamp(1rem,2.4vw,1.5rem)] max-[900px]:grid-cols-1">
                <Surface as="section" className="flex min-w-0 flex-col gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent p-[clamp(1rem,2.4vw,1.25rem)] max-sm:rounded-[var(--b-radius-xl)]" aria-labelledby="home-queue-title">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <Text
                                as="span"
                                variant="muted"
                                size="xs"
                                weight="medium"
                                className="tracking-[0.06em] uppercase">
                                Up next
                            </Text>
                            <h2 id="home-queue-title" className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">
                                Queue
                            </h2>
                        </div>
                        <button
                            type="button"
                            className="min-h-9 rounded-full border border-[var(--b-color-border-subtle)] bg-transparent px-2.5 py-1.5 text-sm font-medium text-[var(--b-color-text-tertiary)] transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                            onClick={() => navigate('/queue')}>
                            Open
                        </button>
                    </div>

                    {queuePreviewMusics.length > 0 ? (
                        <div className="flex flex-col gap-2.5">
                            {queuePreviewMusics.map((music, index) => (
                                <button
                                    key={music.id}
                                    type="button"
                                    className="grid min-h-15 w-full min-w-0 grid-cols-[1.5rem_3rem_minmax(0,1fr)] items-center gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-2.5 text-left text-[var(--b-color-text)] transition-[color,background-color,border-color,transform] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                                    onClick={() => {
                                        const queueIndex = items.indexOf(music.id);

                                        if (queueIndex >= 0) {
                                            queueStore.select(queueIndex);
                                        }
                                    }}>
                                    <span className="text-center text-sm font-medium text-[var(--b-color-text-muted)]">{index + 1}</span>
                                    <Image
                                        className="h-12 w-12 shrink-0 overflow-hidden rounded-[var(--b-radius-md)] object-cover"
                                        src={music.album.cover}
                                        alt={music.album.name}
                                        icon={<Icon.Disc />}
                                    />
                                    <span className="flex min-w-0 flex-col gap-0.5">
                                        <span className="truncate text-sm font-medium text-[var(--b-color-text)]">{music.name}</span>
                                        <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">{music.artist.name}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-32 items-center rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-item)] p-4">
                            <Text as="p" variant="secondary" size="sm">
                                {queueLength > 0
                                    ? 'Queue ends after the current track.'
                                    : 'Build a queue when you want the session to keep moving.'}
                            </Text>
                        </div>
                    )}

                    <Text as="p" variant="muted" size="xs" className="mt-auto max-sm:hidden">
                        {upNextCount > 0
                            ? `${formatCount(upNextCount, 'track')} waiting after this moment.`
                            : 'No upcoming tracks yet.'}
                    </Text>
                </Surface>

                <Surface as="section" className="flex min-w-0 flex-col gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent p-[clamp(1rem,2.4vw,1.25rem)] max-sm:rounded-[var(--b-radius-xl)]" aria-labelledby="home-actions-title">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <Text
                                as="span"
                                variant="muted"
                                size="xs"
                                weight="medium"
                                className="tracking-[0.06em] uppercase">
                                Quick start
                            </Text>
                            <h2 id="home-actions-title" className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">
                                Choose a flow
                            </h2>
                        </div>
                    </div>

                    <div className="flex flex-col flex-wrap gap-2.5">
                        <IconTextButton
                            className="w-full min-h-15 rounded-[var(--b-radius-lg)]"
                            icon={<Icon.Play />}
                            label="Play library"
                            meta={formatCount(availableMusics.length, 'song')}
                            disabled={availableMusics.length === 0}
                            onClick={() => void resetQueue(availableMusics.map(music => music.id))}
                        />
                        <IconTextButton
                            className="w-full min-h-15 rounded-[var(--b-radius-lg)]"
                            icon={<Icon.Heart />}
                            label="Play favorites"
                            meta={formatCount(likedMusics.length, 'song')}
                            disabled={likedMusics.length === 0}
                            onClick={handlePlayFavorites}
                        />
                    </div>
                </Surface>
            </div>

            <Surface as="section" className="flex flex-col gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent p-[clamp(1rem,2.4vw,1.25rem)] max-sm:rounded-[var(--b-radius-xl)]" aria-labelledby="home-library-title">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <Text
                            as="span"
                            variant="muted"
                            size="xs"
                            weight="medium"
                            className="tracking-[0.06em] uppercase">
                            Library
                        </Text>
                        <h2 id="home-library-title" className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">
                            Browse quietly
                        </h2>
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-sm:grid-cols-1">
                    {shortcutItems.map(item => (
                        <Link key={item.path} to={item.path} className="flex min-h-21 min-w-0 flex-col justify-between gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-3.5 text-[var(--b-color-text)] no-underline transition-[color,background-color,border-color,transform] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]">
                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--b-color-surface-subtle)] text-[var(--b-color-point-light)] [&_svg]:h-[1.125rem] [&_svg]:w-[1.125rem]">{item.icon}</span>
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate text-sm font-medium text-[var(--b-color-text)]">{item.label}</span>
                                <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">{item.meta}</span>
                            </span>
                        </Link>
                    ))}
                </div>
            </Surface>

            {recentlyAddedMusics.length > 0 && (
                <Surface as="section" className="flex flex-col gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent p-[clamp(1rem,2.4vw,1.25rem)] max-sm:rounded-[var(--b-radius-xl)]" aria-labelledby="home-focus-title">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <Text
                                as="span"
                                variant="muted"
                                size="xs"
                                weight="medium"
                                className="tracking-[0.06em] uppercase">
                                New in library
                            </Text>
                            <h2 id="home-focus-title" className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">
                                Recently added
                            </h2>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 max-[900px]:grid-cols-2 max-sm:grid-cols-1">
                        {recentlyAddedMusics.map(music => (
                            <button
                                key={music.id}
                                type="button"
                                className="grid min-h-15 w-full min-w-0 grid-cols-[3rem_minmax(0,1fr)_1.25rem] items-center gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-2.5 text-left text-[var(--b-color-text)] transition-[color,background-color,border-color,transform] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-[var(--b-color-text-muted)]"
                                onClick={() => void queueStore.add(music.id)}>
                                <Image
                                    className="h-12 w-12 shrink-0 overflow-hidden rounded-[var(--b-radius-md)] object-cover"
                                    src={music.album.cover}
                                    alt={music.album.name}
                                    icon={<Icon.Disc />}
                                />
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="truncate text-sm font-medium text-[var(--b-color-text)]">{music.name}</span>
                                    <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">{music.artist.name}</span>
                                </span>
                                <Icon.Play />
                            </button>
                        ))}
                    </div>
                </Surface>
            )}
        </>
    );
}
