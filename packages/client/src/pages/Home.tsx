import { useNavigate } from 'react-router-dom';

import { useAppStore as useStore } from '~/store/base-store';
import {
    CompactTrackRow,
    IconTextButton,
    Image,
    LibraryActionCard,
    SectionEmptyState,
    SectionHeader,
    SectionHeaderAction,
    Surface,
    Text
} from '~/components/shared';
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
            <Surface as="section" variant="subtle" radius="2xl" padding="hero" className="relative grid min-h-[clamp(240px,34vw,352px)] grid-cols-[minmax(144px,0.44fr)_minmax(0,1fr)] items-center gap-[clamp(20px,4vw,48px)] overflow-hidden shadow-[var(--b-card-shadow-main)] max-[900px]:min-h-0 max-[900px]:grid-cols-1">
                <div className="relative flex min-w-0 justify-center before:absolute before:left-1/2 before:top-1/2 before:h-[78%] before:w-[78%] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:border before:border-[var(--b-color-point-glow)] before:content-[''] after:absolute after:left-1/2 after:top-1/2 after:h-[92%] after:w-[92%] after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-[var(--b-radius-2xl)] after:border after:border-[var(--b-color-border-subtle)] after:content-['']">
                    {currentMusic ? (
                        <Image
                            className="relative z-[1] aspect-square w-[min(100%,200px)] rounded-[var(--b-radius-2xl)] border border-[var(--b-color-border-subtle)] object-cover shadow-[var(--b-shadow-artwork-hero)] max-sm:w-[min(100%,224px)] max-sm:rounded-[var(--b-radius-xl)]"
                            src={currentMusic.album.cover}
                            alt={currentMusic.album.name}
                            loading="eager"
                            icon={<Icon.Disc />}
                        />
                    ) : (
                        <div className="relative z-[1] flex aspect-square w-[min(100%,200px)] items-center justify-center rounded-[var(--b-radius-2xl)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] text-[var(--b-color-point-light)] shadow-[var(--b-shadow-artwork-placeholder)] max-sm:w-[min(100%,224px)] max-sm:rounded-[var(--b-radius-xl)] [&_svg]:h-16 [&_svg]:w-16">
                            <Icon.Music />
                        </div>
                    )}
                </div>

                <div className="flex min-w-0 flex-col items-start gap-3.5 max-[900px]:items-center max-[900px]:text-center">
                    <Text
                        as="span"
                        variant="muted"
                        size="overline"
                        weight="medium"
                        className="text-[var(--b-color-point-light)]">
                        {currentMusic ? 'Now playing' : 'Listening room'}
                    </Text>

                    <Text
                        as="h1"
                        size="2xl"
                        weight="bold"
                        title={currentMusic?.name}
                        className="max-w-[min(100%,448px)] overflow-hidden break-all leading-[1.08] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] max-[900px]:max-w-[min(100%,384px)]">
                        {currentMusic?.name ?? (loaded ? 'Ready when you are.' : 'Loading your library.')}
                    </Text>

                    <Text as="p" variant="secondary" size="md" className="max-w-[544px] leading-[1.6] max-sm:hidden">
                        {currentMusic
                            ? `${currentMusic.artist.name} · ${currentMusic.album.name}`
                            : 'Start a calm session from your own collection.'}
                    </Text>

                    {currentMusic && (
                        <div className="mt-1 h-1.5 w-[min(100%,352px)] overflow-hidden rounded-full bg-[var(--b-color-border-subtle)] max-[900px]:w-full" aria-hidden="true">
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

            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(288px,0.8fr)] gap-[clamp(16px,2.4vw,24px)] max-[900px]:grid-cols-1">
                <Surface as="section" variant="transparent" radius="lg" padding="responsive" className="flex min-w-0 flex-col gap-4" aria-labelledby="home-queue-title">
                    <SectionHeader
                        eyebrow="Up next"
                        heading="Queue"
                        headingId="home-queue-title"
                        actions={(
                            <SectionHeaderAction onClick={() => navigate('/queue')}>
                                Open
                            </SectionHeaderAction>
                        )}
                    />

                    {queuePreviewMusics.length > 0 ? (
                        <div className="flex flex-col gap-2.5">
                            {queuePreviewMusics.map((music, index) => (
                                <CompactTrackRow
                                    key={music.id}
                                    music={music}
                                    rank={index + 1}
                                    onClick={() => {
                                        const queueIndex = items.indexOf(music.id);

                                        if (queueIndex >= 0) {
                                            queueStore.select(queueIndex);
                                        }
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <SectionEmptyState>
                            {queueLength > 0
                                ? 'Queue ends after the current track.'
                                : 'Build a queue when you want the session to keep moving.'}
                        </SectionEmptyState>
                    )}

                    <Text as="p" variant="muted" size="xs" className="mt-auto max-sm:hidden">
                        {upNextCount > 0
                            ? `${formatCount(upNextCount, 'track')} waiting after this moment.`
                            : 'No upcoming tracks yet.'}
                    </Text>
                </Surface>

                <Surface as="section" variant="transparent" radius="lg" padding="responsive" className="flex min-w-0 flex-col gap-4" aria-labelledby="home-actions-title">
                    <SectionHeader eyebrow="Quick start" heading="Choose a flow" headingId="home-actions-title" />

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

            <Surface as="section" variant="transparent" radius="lg" padding="responsive" className="flex flex-col gap-4" aria-labelledby="home-library-title">
                <SectionHeader eyebrow="Library" heading="Browse quietly" headingId="home-library-title" />

                <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-sm:grid-cols-1">
                    {shortcutItems.map(item => (
                        <LibraryActionCard
                            key={item.path}
                            to={item.path}
                            title={item.label}
                            meta={item.meta}
                            icon={item.icon}
                        />
                    ))}
                </div>
            </Surface>

            {recentlyAddedMusics.length > 0 && (
                <Surface as="section" variant="transparent" radius="lg" padding="responsive" className="flex flex-col gap-4" aria-labelledby="home-focus-title">
                    <SectionHeader eyebrow="New in library" heading="Recently added" headingId="home-focus-title" />

                    <div className="grid grid-cols-2 gap-2.5 max-[900px]:grid-cols-2 max-sm:grid-cols-1">
                        {recentlyAddedMusics.map(music => (
                            <CompactTrackRow
                                key={music.id}
                                music={music}
                                trailing={<Icon.Play />}
                                onClick={() => void queueStore.add(music.id)}
                            />
                        ))}
                    </div>
                </Surface>
            )}
        </>
    );
}
