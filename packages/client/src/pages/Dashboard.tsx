import { Link } from 'react-router-dom';

import { useAppStore as useStore } from '~/store/base-store';
import { albumStore } from '~/store/album';
import { artistStore } from '~/store/artist';
import { musicStore } from '~/store/music';
import { playlistStore } from '~/store/playlist';
import { queueStore } from '~/store/queue';
import { Image, Surface, Text } from '~/components/shared';
import { useResetQueue } from '~/hooks';
import * as Icon from '~/icon';

import type { Music } from '~/models/type';

const TRACK_LIMIT = 5;
const RECENT_LIMIT = 4;
const DORMANT_DAYS = 30;

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

const isLossless = (music: Music) => {
    const codec = music.codec.toLowerCase();

    return codec.includes('flac') || codec.includes('alac') || codec.includes('wav');
};

const isDormant = (music: Music) => {
    if (!music.lastPlayedAt) return true;

    const lastPlayedAt = new Date(music.lastPlayedAt).getTime();

    if (Number.isNaN(lastPlayedAt)) return true;

    return Date.now() - lastPlayedAt > DORMANT_DAYS * 24 * 60 * 60 * 1000;
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
    <Surface className="flex min-h-32 min-w-0 flex-col justify-between gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-4">
        <div className="flex items-start justify-between gap-3">
            <Text as="span" variant="muted" size="xs" weight="medium" className="tracking-[0.08em] uppercase">
                {label}
            </Text>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--b-color-surface-subtle)] text-[var(--b-color-point-light)] [&_svg]:h-4 [&_svg]:w-4">
                {icon}
            </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
            <Text as="strong" size="xl" weight="bold" className="truncate tracking-[-0.03em]">
                {value}
            </Text>
            <Text as="span" variant="tertiary" size="xs" className="truncate">
                {meta}
            </Text>
        </div>
    </Surface>
);

const ActionCard = ({
    title,
    description,
    count,
    icon,
    disabled,
    onClick
}: {
    title: string;
    description: string;
    count: string;
    icon: React.ReactNode;
    disabled?: boolean;
    onClick: () => void;
}) => (
    <button
        type="button"
        disabled={disabled}
        className="flex min-h-28 w-full min-w-0 flex-col justify-between gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-3.5 text-left text-[var(--b-color-text)] transition-[background-color,border-color,opacity] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onClick}>
        <span className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-semibold">{title}</span>
                <span className="line-clamp-2 text-xs leading-[1.45] text-[var(--b-color-text-tertiary)]">{description}</span>
            </span>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--b-color-surface-subtle)] text-[var(--b-color-point)] [&_svg]:h-4 [&_svg]:w-4">
                {icon}
            </span>
        </span>
        <span className="text-xs font-medium text-[var(--b-color-text-muted)]">{count}</span>
    </button>
);

const DiscoveryTrack = ({ music, index, maxDormantDays }: { music: Music; index: number; maxDormantDays: number }) => {
    const lastPlayedAt = music.lastPlayedAt ? new Date(music.lastPlayedAt).getTime() : null;
    const dormantDays = lastPlayedAt && !Number.isNaN(lastPlayedAt)
        ? Math.max(Math.floor((Date.now() - lastPlayedAt) / 24 / 60 / 60 / 1000), 0)
        : DORMANT_DAYS;
    const width = maxDormantDays > 0 ? Math.max((dormantDays / maxDormantDays) * 100, 8) : 8;

    return (
        <Link
            to="/player"
            className="grid min-h-15 min-w-0 grid-cols-[1.5rem_3rem_minmax(0,1fr)] items-center gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-2.5 text-[var(--b-color-text)] no-underline transition-[background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]">
            <span className="text-center text-xs font-medium text-[var(--b-color-text-muted)]">{index + 1}</span>
            <Image
                className="h-12 w-12 shrink-0 overflow-hidden rounded-[var(--b-radius-md)] object-cover"
                src={music.album.cover}
                alt={music.album.name}
                icon={<Icon.Disc />}
            />
            <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium text-[var(--b-color-text)]">{music.name}</span>
                <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">{music.artist.name} · {music.playCount > 0 ? `${dormantDays}d quiet` : 'unheard'}</span>
                <span className="h-1 overflow-hidden rounded-full bg-[var(--b-color-border-subtle)]" aria-hidden="true">
                    <span className="block h-full rounded-[inherit] bg-[var(--b-color-point)]" style={{ width: `${width}%` }} />
                </span>
            </span>
        </Link>
    );
};

const RecentTrack = ({ music }: { music: Music }) => (
    <div className="grid min-h-15 min-w-0 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-2.5">
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
        <span className="shrink-0 text-xs text-[var(--b-color-text-muted)]">{formatDate(music.lastPlayedAt)}</span>
    </div>
);

export default function Dashboard() {
    const resetQueue = useResetQueue();

    const [{ loaded, musics }] = useStore(musicStore);
    const [{ albums }] = useStore(albumStore);
    const [{ artists }] = useStore(artistStore);
    const [{ playlists }] = useStore(playlistStore);
    const [{ queueLength, isPlaying }] = useStore(queueStore);

    const availableMusics = musics.filter(music => !music.isHated);
    const likedMusics = availableMusics.filter(music => music.isLiked);
    const playedMusics = availableMusics.filter(music => music.playCount > 0);
    const unplayedMusics = availableMusics.filter(music => music.playCount === 0);
    const losslessMusics = availableMusics.filter(isLossless);
    const dormantFavorites = likedMusics.filter(isDormant);
    const recentMusics = [...playedMusics]
        .sort((a, b) => new Date(b.lastPlayedAt ?? 0).getTime() - new Date(a.lastPlayedAt ?? 0).getTime())
        .slice(0, RECENT_LIMIT);
    const discoveryMusics = [...availableMusics]
        .sort((a, b) => {
            if (a.playCount === 0 && b.playCount !== 0) return -1;
            if (a.playCount !== 0 && b.playCount === 0) return 1;

            return new Date(a.lastPlayedAt ?? 0).getTime() - new Date(b.lastPlayedAt ?? 0).getTime();
        })
        .slice(0, TRACK_LIMIT);
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
    const maxDormantDays = Math.max(...discoveryMusics.map((music) => {
        if (!music.lastPlayedAt) return DORMANT_DAYS;

        const lastPlayedAt = new Date(music.lastPlayedAt).getTime();

        if (Number.isNaN(lastPlayedAt)) return DORMANT_DAYS;

        return Math.max(Math.floor((Date.now() - lastPlayedAt) / 24 / 60 / 60 / 1000), 0);
    }), DORMANT_DAYS);
    const maxArtistPlayCount = Math.max(...topArtistsByPlays.map(artist => artist.playCount), 0);
    const topArtist = topArtistsByPlays[0] ?? null;
    const topArtistMusics = topArtist
        ? availableMusics
            .filter(music => music.artist.id === topArtist.id)
            .sort((a, b) => b.playCount - a.playCount)
        : [];

    return (
        <div className="mx-auto flex w-[min(100%,72rem)] flex-col gap-[clamp(1rem,2.4vw,1.5rem)] p-[clamp(1rem,3vw,2rem)] pb-[calc(clamp(1.5rem,4vw,3rem)+env(safe-area-inset-bottom))] text-[var(--b-color-text)] max-sm:p-[var(--b-spacing-md)] max-sm:pb-[calc(var(--b-spacing-xl)+env(safe-area-inset-bottom))]">
            <Surface as="section" className="relative overflow-hidden rounded-[var(--b-radius-2xl)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] p-[clamp(1rem,3vw,1.5rem)]">
                <div className="absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--b-color-point),transparent)]" aria-hidden="true" />
                <div className="flex flex-wrap items-end justify-between gap-5">
                    <div className="flex min-w-0 flex-col gap-3">
                        <Text as="span" variant="muted" size="xs" weight="medium" className="tracking-[0.1em] text-[var(--b-color-point)] uppercase">
                            Dashboard
                        </Text>
                        <Text as="h1" size="2xl" weight="bold" className="max-w-[34rem] leading-[1.08] tracking-[-0.04em]">
                            What to play next, and what your library is hiding.
                        </Text>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] px-3 py-2 text-xs font-medium text-[var(--b-color-text-secondary)]">
                            {loaded ? `${formatNumber(albums.length)} albums · ${formatNumber(artists.length)} artists · ${formatNumber(playlists.length)} playlists` : 'Loading library'}
                        </span>
                        <span className="rounded-full border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] px-3 py-2 text-xs font-medium text-[var(--b-color-text-secondary)]">
                            {isPlaying ? 'Playing now' : `${formatNumber(queueLength)} queued`}
                        </span>
                    </div>
                </div>
            </Surface>

            <div className="grid grid-cols-4 gap-3 max-[980px]:grid-cols-2 max-sm:grid-cols-1">
                <DashboardStat label="Unplayed" value={formatNumber(unplayedMusics.length)} meta={`${formatPercent(playedCoverage)} of library has been heard`} icon={<Icon.Search />} />
                <DashboardStat label="Favorites to revisit" value={formatNumber(dormantFavorites.length)} meta={`Liked but quiet for ${DORMANT_DAYS}+ days`} icon={<Icon.Heart />} />
                <DashboardStat label="Listening time" value={formatHours(totalPlayedMs)} meta={`Recorded from ${formatNumber(totalPlayCount)} counted plays`} icon={<Icon.Play />} />
                <DashboardStat label="Lossless" value={formatPercent(losslessRatio)} meta={`${formatNumber(losslessMusics.length)} of ${formatNumber(availableMusics.length)} tracks`} icon={<Icon.Activity />} />
            </div>

            <Surface as="section" className="flex flex-col gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent p-[clamp(1rem,2.4vw,1.25rem)]">
                <div>
                    <Text as="span" variant="muted" size="xs" weight="medium" className="tracking-[0.06em] uppercase">Next actions</Text>
                    <h2 className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">Turn the dashboard into a queue</h2>
                </div>

                <div className="grid grid-cols-4 gap-2.5 max-[980px]:grid-cols-2 max-sm:grid-cols-1">
                    <ActionCard
                        title="Play unheard tracks"
                        description="Surface the songs that are still invisible in your library."
                        count={`${formatNumber(unplayedMusics.length)} tracks`}
                        icon={<Icon.Search />}
                        disabled={unplayedMusics.length === 0}
                        onClick={() => void resetQueue(takeIds(unplayedMusics))}
                    />
                    <ActionCard
                        title="Revisit favorites"
                        description="Bring back liked songs that have been out of rotation."
                        count={`${formatNumber(dormantFavorites.length)} tracks`}
                        icon={<Icon.Heart />}
                        disabled={dormantFavorites.length === 0}
                        onClick={() => void resetQueue(takeIds(dormantFavorites))}
                    />
                    <ActionCard
                        title="Follow your top artist"
                        description={topArtist ? `Continue where ${topArtist.name} is strongest.` : 'Top artists appear after playback.'}
                        count={topArtist ? `${formatNumber(topArtistMusics.length)} tracks` : 'No signal yet'}
                        icon={<Icon.User />}
                        disabled={topArtistMusics.length === 0}
                        onClick={() => void resetQueue(takeIds(topArtistMusics))}
                    />
                    <ActionCard
                        title="Play liked tracks"
                        description="A safe starting point when you just want the room moving."
                        count={`${formatNumber(likedMusics.length)} tracks`}
                        icon={<Icon.Play />}
                        disabled={likedMusics.length === 0}
                        onClick={() => void resetQueue(takeIds(likedMusics))}
                    />
                </div>
            </Surface>

            <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] gap-[clamp(1rem,2.4vw,1.5rem)] max-[980px]:grid-cols-1">
                <Surface as="section" className="flex min-w-0 flex-col gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent p-[clamp(1rem,2.4vw,1.25rem)]">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <Text as="span" variant="muted" size="xs" weight="medium" className="tracking-[0.06em] uppercase">Discovery</Text>
                            <h2 className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">Tracks worth surfacing</h2>
                        </div>
                        <Link to="/library" className="rounded-full border border-[var(--b-color-border-subtle)] bg-transparent px-2.5 py-1.5 text-sm font-medium text-[var(--b-color-text-tertiary)] no-underline transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]">Open</Link>
                    </div>

                    {discoveryMusics.length > 0 ? (
                        <div className="flex flex-col gap-2.5">
                            {discoveryMusics.map((music, index) => (
                                <DiscoveryTrack key={music.id} music={music} index={index} maxDormantDays={maxDormantDays} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-40 items-center rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-item)] p-4">
                            <Text as="p" variant="secondary" size="sm">Hidden tracks and quiet favorites will appear here.</Text>
                        </div>
                    )}
                </Surface>

                <Surface as="section" className="flex min-w-0 flex-col gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent p-[clamp(1rem,2.4vw,1.25rem)]">
                    <div>
                        <Text as="span" variant="muted" size="xs" weight="medium" className="tracking-[0.06em] uppercase">Momentum</Text>
                        <h2 className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">Recent plays</h2>
                    </div>

                    {recentMusics.length > 0 ? (
                        <div className="flex flex-col gap-2.5">
                            {recentMusics.map(music => <RecentTrack key={music.id} music={music} />)}
                        </div>
                    ) : (
                        <div className="flex min-h-40 items-center rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-item)] p-4">
                            <Text as="p" variant="secondary" size="sm">Recent playback will be tracked after your next session.</Text>
                        </div>
                    )}
                </Surface>
            </div>

            <Surface as="section" className="flex flex-col gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent p-[clamp(1rem,2.4vw,1.25rem)]">
                <div>
                    <Text as="span" variant="muted" size="xs" weight="medium" className="tracking-[0.06em] uppercase">Listening bias</Text>
                    <h2 className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">Artists you actually play</h2>
                </div>

                <div className="grid grid-cols-5 gap-2.5 max-[980px]:grid-cols-2 max-sm:grid-cols-1">
                    {topArtistsByPlays.map((artist) => {
                        const width = maxArtistPlayCount > 0 ? Math.max((artist.playCount / maxArtistPlayCount) * 100, 8) : 0;

                        return (
                            <Link key={artist.id} to={`/artist/${artist.id}`} className="flex min-h-28 min-w-0 flex-col justify-between gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-3.5 text-[var(--b-color-text)] no-underline transition-[background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)]">
                                <span className="flex min-w-0 flex-col gap-1">
                                    <span className="truncate text-sm font-medium">{artist.name}</span>
                                    <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">{formatNumber(artist.playCount)} plays · {formatNumber(artist.musicCount)} songs</span>
                                </span>
                                <span className="h-1.5 overflow-hidden rounded-full bg-[var(--b-color-border-subtle)]" aria-hidden="true">
                                    <span className="block h-full rounded-[inherit] bg-[var(--b-color-point)]" style={{ width: `${width}%` }} />
                                </span>
                            </Link>
                        );
                    })}
                </div>

                {topArtistsByPlays.length === 0 && (
                    <div className="flex min-h-32 items-center rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-item)] p-4">
                        <Text as="p" variant="secondary" size="sm">Artist bias becomes useful once playback data starts building up.</Text>
                    </div>
                )}
            </Surface>
        </div>
    );
}
