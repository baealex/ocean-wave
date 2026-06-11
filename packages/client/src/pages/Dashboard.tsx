import { useAppStore as useStore } from '~/store/base-store';
import { albumStore } from '~/store/album';
import { artistStore } from '~/store/artist';
import { musicStore } from '~/store/music';
import { playlistStore } from '~/store/playlist';
import { queueStore } from '~/store/queue';
import { Badge, CompactTrackRow, LibraryActionCard, SectionEmptyState, SectionHeader, SectionHeaderAction, Surface, Text } from '~/components/shared';
import { useResetQueue } from '~/hooks';
import * as Icon from '~/icon';
import {
    DORMANT_FAVORITE_DAYS,
    buildSmartMusicBuckets,
    sortMusicsByHeavyRotation,
    sortMusicsByLeastHeard,
    sortMusicsByRecentPlay
} from '~/modules/smart-music-filters';

import type { Music } from '~/models/type';

const TRACK_LIMIT = 4;
const RECENT_LIMIT = 4;

const formatNumber = (value: number) => value.toLocaleString();

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const formatHours = (milliseconds: number) => {
    const minutes = Math.round(milliseconds / 1000 / 60);

    if (minutes < 60) {
        return `${minutes}m`;
    }

    const hours = minutes / 60;

    return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
};

const formatDate = (value: string | null) => {
    if (!value) return 'Never';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Unknown';
    }

    return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric'
    }).format(date);
};

const takeIds = (musics: Music[], limit = 80) => musics.slice(0, limit).map(music => music.id);

const DashboardStat = ({
    label,
    value,
    meta,
    icon
}: {
    label: string;
    value: string;
    meta: string;
    icon: React.ReactNode;
}) => (
    <Surface variant="item" radius="lg" padding="md" className="flex min-h-32 min-w-0 flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
            <Text as="span" variant="muted" size="overline" weight="medium">
                {label}
            </Text>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--b-color-surface-subtle)] text-[var(--b-color-text-muted)] [&_svg]:h-4 [&_svg]:w-4">
                {icon}
            </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
            <Text as="strong" size="xl" weight="bold" className="truncate">
                {value}
            </Text>
            <Text as="span" variant="tertiary" size="xs" className="truncate">
                {meta}
            </Text>
        </div>
    </Surface>
);

export default function Dashboard() {
    const resetQueue = useResetQueue();

    const [{ loaded, musics }] = useStore(musicStore);
    const [{ albums }] = useStore(albumStore);
    const [{ artists }] = useStore(artistStore);
    const [{ playlists }] = useStore(playlistStore);
    const [{ queueLength, isPlaying }] = useStore(queueStore);

    const {
        availableMusics,
        likedMusics,
        playedMusics,
        unplayedMusics,
        losslessMusics,
        dormantFavorites
    } = buildSmartMusicBuckets(musics);
    const recentMusics = sortMusicsByRecentPlay(playedMusics).slice(0, RECENT_LIMIT);
    const topMusics = sortMusicsByHeavyRotation(playedMusics).slice(0, TRACK_LIMIT);
    const leastHeardMusics = sortMusicsByLeastHeard(availableMusics).slice(0, TRACK_LIMIT);
    const topArtistsByPlays = [...availableMusics]
        .reduce<Array<{ id: string; name: string; playCount: number; musicCount: number }>>((items, music) => {
            const current = items.find(item => item.id === music.artist.id);

            if (current) {
                current.playCount += music.playCount;
                current.musicCount += 1;
                return items;
            }

            return [...items, {
                id: music.artist.id,
                name: music.artist.name,
                playCount: music.playCount,
                musicCount: 1
            }];
        }, [])
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, TRACK_LIMIT);

    const totalPlayCount = availableMusics.reduce((sum, music) => sum + music.playCount, 0);
    const totalPlayedMs = availableMusics.reduce((sum, music) => sum + music.totalPlayedMs, 0);
    const playedCoverage = availableMusics.length ? playedMusics.length / availableMusics.length : 0;
    const losslessRatio = availableMusics.length ? losslessMusics.length / availableMusics.length : 0;
    const maxPlayCount = Math.max(...topMusics.map(music => music.playCount), 0);
    const maxArtistPlayCount = Math.max(...topArtistsByPlays.map(artist => artist.playCount), 0);
    const topArtist = topArtistsByPlays[0] ?? null;
    const topArtistMusics = topArtist
        ? availableMusics
            .filter(music => music.artist.id === topArtist.id)
            .sort((a, b) => b.playCount - a.playCount)
        : [];

    return (
        <div className="mx-auto flex w-[min(100%,1152px)] flex-col gap-[clamp(16px,2.4vw,24px)] p-[clamp(16px,3vw,32px)] pb-[calc(clamp(24px,4vw,48px)+env(safe-area-inset-bottom))] text-[var(--b-color-text)] max-sm:p-[var(--b-spacing-md)] max-sm:pb-[calc(var(--b-spacing-xl)+env(safe-area-inset-bottom))]">
            <Surface as="section" variant="subtle" radius="2xl" padding="hero" className="relative overflow-hidden">
                <div className="absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--b-color-point),transparent)]" aria-hidden="true" />
                <div className="flex flex-wrap items-end justify-between gap-5">
                    <div className="flex min-w-0 flex-col gap-3">
                        <Text as="span" variant="muted" size="overline" weight="medium">
                            Dashboard
                        </Text>
                        <Text as="h1" size="2xl" weight="bold" className="max-w-[544px] leading-[1.08]">
                            What to play next, and what your library is hiding.
                        </Text>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Badge tone="subtle" size="md">
                            {loaded ? `${formatNumber(albums.length)} albums · ${formatNumber(artists.length)} artists · ${formatNumber(playlists.length)} playlists` : 'Loading library'}
                        </Badge>
                        <Badge tone="subtle" size="md">
                            {isPlaying ? 'Playing now' : `${formatNumber(queueLength)} queued`}
                        </Badge>
                    </div>
                </div>
            </Surface>

            <div className="grid grid-cols-4 gap-3 max-[980px]:grid-cols-2 max-sm:grid-cols-1">
                <DashboardStat label="Unplayed" value={formatNumber(unplayedMusics.length)} meta={`${formatPercent(playedCoverage)} of library has been heard`} icon={<Icon.Search />} />
                <DashboardStat label="Favorites to revisit" value={formatNumber(dormantFavorites.length)} meta={`Liked but quiet for ${DORMANT_FAVORITE_DAYS}+ days`} icon={<Icon.Heart />} />
                <DashboardStat label="Listening time" value={formatHours(totalPlayedMs)} meta={`Recorded from ${formatNumber(totalPlayCount)} counted plays`} icon={<Icon.Play />} />
                <DashboardStat label="Lossless" value={formatPercent(losslessRatio)} meta={`${formatNumber(losslessMusics.length)} of ${formatNumber(availableMusics.length)} tracks`} icon={<Icon.Activity />} />
            </div>

            <Surface as="section" variant="transparent" radius="lg" padding="responsive" className="flex flex-col gap-4">
                <SectionHeader eyebrow="Next actions" heading="Turn the dashboard into a queue" />

                <div className="grid grid-cols-4 gap-2.5 max-[980px]:grid-cols-2 max-sm:grid-cols-1">
                    <LibraryActionCard
                        layout="action"
                        title="Play unheard tracks"
                        description="Surface the songs that are still invisible in your library."
                        meta={`${formatNumber(unplayedMusics.length)} tracks`}
                        icon={<Icon.Search />}
                        disabled={unplayedMusics.length === 0}
                        onClick={() => void resetQueue(takeIds(unplayedMusics))}
                    />
                    <LibraryActionCard
                        layout="action"
                        title="Revisit favorites"
                        description="Bring back liked songs that have been out of rotation."
                        meta={`${formatNumber(dormantFavorites.length)} tracks`}
                        icon={<Icon.Heart />}
                        disabled={dormantFavorites.length === 0}
                        onClick={() => void resetQueue(takeIds(dormantFavorites))}
                    />
                    <LibraryActionCard
                        layout="action"
                        title="Follow your top artist"
                        description={topArtist ? `Continue where ${topArtist.name} is strongest.` : 'Top artists appear after playback.'}
                        meta={topArtist ? `${formatNumber(topArtistMusics.length)} tracks` : 'No signal yet'}
                        icon={<Icon.User />}
                        disabled={topArtistMusics.length === 0}
                        onClick={() => void resetQueue(takeIds(topArtistMusics))}
                    />
                    <LibraryActionCard
                        layout="action"
                        title="Play liked tracks"
                        description="A safe starting point when you just want the room moving."
                        meta={`${formatNumber(likedMusics.length)} tracks`}
                        icon={<Icon.Play />}
                        disabled={likedMusics.length === 0}
                        onClick={() => void resetQueue(takeIds(likedMusics))}
                    />
                </div>
            </Surface>

            <div className="grid grid-cols-2 gap-[clamp(16px,2.4vw,24px)] max-[980px]:grid-cols-1">
                <Surface as="section" variant="transparent" radius="lg" padding="responsive" className="flex min-w-0 flex-col gap-4">
                    <SectionHeader
                        eyebrow="Played a lot"
                        heading="Heavy rotation"
                        actions={(
                            <SectionHeaderAction to="/library">Open</SectionHeaderAction>
                        )}
                    />

                    {topMusics.length > 0 ? (
                        <div className="flex flex-col gap-2.5">
                            {topMusics.map((music, index) => (
                                <CompactTrackRow
                                    key={music.id}
                                    to="/player"
                                    music={music}
                                    rank={index + 1}
                                    subtitle={`${music.artist.name} · ${formatNumber(music.playCount)} plays · ${formatHours(music.totalPlayedMs)}`}
                                    meter={{
                                        ratio: maxPlayCount > 0 ? music.playCount / maxPlayCount : 0,
                                        tone: 'primary'
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <SectionEmptyState size="md">Heavy rotation appears after a few counted plays.</SectionEmptyState>
                    )}
                </Surface>

                <Surface as="section" variant="transparent" radius="lg" padding="responsive" className="flex min-w-0 flex-col gap-4">
                    <SectionHeader eyebrow="Barely played" heading="Unexplored tracks" />

                    {leastHeardMusics.length > 0 ? (
                        <div className="flex flex-col gap-2.5">
                            {leastHeardMusics.map((music, index) => (
                                <CompactTrackRow
                                    key={music.id}
                                    to="/player"
                                    music={music}
                                    rank={index + 1}
                                    subtitle={`${music.artist.name} · ${music.playCount === 0 ? 'unheard' : `${formatHours(music.totalPlayedMs)} listened`}`}
                                />
                            ))}
                        </div>
                    ) : (
                        <SectionEmptyState size="md">Tracks with low listening time will appear here.</SectionEmptyState>
                    )}
                </Surface>
            </div>

            <Surface as="section" variant="transparent" radius="lg" padding="responsive" className="flex min-w-0 flex-col gap-4">
                <SectionHeader
                    eyebrow="History"
                    heading="Listening history"
                    actions={(
                        <SectionHeaderAction disabled>
                            Open soon
                        </SectionHeaderAction>
                    )}
                />

                {recentMusics.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2.5 max-[980px]:grid-cols-1">
                        {recentMusics.map(music => (
                            <CompactTrackRow
                                key={music.id}
                                music={music}
                                trailing={formatDate(music.lastPlayedAt)}
                            />
                        ))}
                    </div>
                ) : (
                    <SectionEmptyState>History will start filling in after your next session.</SectionEmptyState>
                )}
            </Surface>

            <Surface as="section" variant="transparent" radius="lg" padding="responsive" className="flex flex-col gap-4">
                <SectionHeader eyebrow="Listening bias" heading="Artists you actually play" />

                <div className="grid grid-cols-5 gap-2.5 max-[980px]:grid-cols-2 max-sm:grid-cols-1">
                    {topArtistsByPlays.map((artist) => {
                        const width = maxArtistPlayCount > 0 ? Math.max((artist.playCount / maxArtistPlayCount) * 100, 8) : 0;

                        return (
                            <LibraryActionCard
                                key={artist.id}
                                layout="action"
                                to={`/artist/${artist.id}`}
                                title={artist.name}
                                description={`${formatNumber(artist.playCount)} plays · ${formatNumber(artist.musicCount)} songs`}
                                meta={(
                                    <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--b-color-border-subtle)]" aria-hidden="true">
                                        <span className="block h-full rounded-[inherit] bg-[var(--b-color-point)]" style={{ width: `${width}%` }} />
                                    </span>
                                )}
                            />
                        );
                    })}
                </div>

                {topArtistsByPlays.length === 0 && (
                    <SectionEmptyState>Artist bias becomes useful once playback data starts building up.</SectionEmptyState>
                )}
            </Surface>
        </div>
    );
}
