import { Link } from 'react-router-dom';

import { useAppStore as useStore } from '~/store/base-store';
import { albumStore } from '~/store/album';
import { artistStore } from '~/store/artist';
import { musicStore } from '~/store/music';
import { playlistStore } from '~/store/playlist';
import { queueStore } from '~/store/queue';
import { Image, Surface, Text } from '~/components/shared';
import * as Icon from '~/icon';

import type { Music } from '~/models/type';

const TOP_LIMIT = 5;
const RECENT_LIMIT = 4;

const formatNumber = (value: number) => value.toLocaleString();

const formatHours = (milliseconds: number) => {
    const hours = milliseconds / 1000 / 60 / 60;

    if (hours < 1) {
        return `${Math.round(hours * 60)}m`;
    }

    return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
};

const formatDate = (value: string | null) => {
    if (!value) return 'Never played';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Unknown';
    }

    return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric'
    }).format(date);
};

const formatBitrate = (value: number) => {
    if (!value) return '—';

    return `${Math.round(value / 1000)} kbps`;
};

const getListenedRatio = (music: Music) => {
    if (!music.duration || !music.totalPlayedMs) return 0;

    return Math.min(music.totalPlayedMs / (music.duration * 1000), 1);
};

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

const RankedTrack = ({ music, index, maxPlayCount }: { music: Music; index: number; maxPlayCount: number }) => {
    const width = maxPlayCount > 0 ? Math.max((music.playCount / maxPlayCount) * 100, 8) : 0;

    return (
        <Link
            to="/player"
            className="group grid min-h-15 min-w-0 grid-cols-[1.5rem_3rem_minmax(0,1fr)] items-center gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-2.5 text-[var(--b-color-text)] no-underline transition-[background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]">
            <span className="text-center text-xs font-medium text-[var(--b-color-text-muted)]">{index + 1}</span>
            <Image
                className="h-12 w-12 shrink-0 overflow-hidden rounded-[var(--b-radius-md)] object-cover"
                src={music.album.cover}
                alt={music.album.name}
                icon={<Icon.Disc />}
            />
            <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium text-[var(--b-color-text)]">{music.name}</span>
                <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">{music.artist.name} · {formatNumber(music.playCount)} plays</span>
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
    const [{ loaded, musics }] = useStore(musicStore);
    const [{ albums }] = useStore(albumStore);
    const [{ artists }] = useStore(artistStore);
    const [{ playlists }] = useStore(playlistStore);
    const [{ queueLength, isPlaying }] = useStore(queueStore);

    const availableMusics = musics.filter(music => !music.isHated);
    const likedMusics = availableMusics.filter(music => music.isLiked);
    const playedMusics = availableMusics.filter(music => music.playCount > 0);
    const recentMusics = [...playedMusics]
        .sort((a, b) => new Date(b.lastPlayedAt ?? 0).getTime() - new Date(a.lastPlayedAt ?? 0).getTime())
        .slice(0, RECENT_LIMIT);
    const topMusics = [...playedMusics]
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, TOP_LIMIT);
    const topArtists = [...artists]
        .sort((a, b) => b.musicCount - a.musicCount)
        .slice(0, TOP_LIMIT);

    const totalPlayCount = availableMusics.reduce((sum, music) => sum + music.playCount, 0);
    const totalPlayedMs = availableMusics.reduce((sum, music) => sum + music.totalPlayedMs, 0);
    const averageBitrate = availableMusics.length
        ? availableMusics.reduce((sum, music) => sum + (music.bitrate || 0), 0) / availableMusics.length
        : 0;
    const listenedRatio = availableMusics.length
        ? playedMusics.reduce((sum, music) => sum + getListenedRatio(music), 0) / availableMusics.length
        : 0;
    const maxPlayCount = Math.max(...topMusics.map(music => music.playCount), 0);
    const maxArtistMusicCount = Math.max(...topArtists.map(artist => artist.musicCount), 0);

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
                            Library signal, playback pulse, and collection health.
                        </Text>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] px-3 py-2 text-xs font-medium text-[var(--b-color-text-secondary)]">
                            {loaded ? 'Library loaded' : 'Loading library'}
                        </span>
                        <span className="rounded-full border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] px-3 py-2 text-xs font-medium text-[var(--b-color-text-secondary)]">
                            {isPlaying ? 'Playing now' : `${formatNumber(queueLength)} queued`}
                        </span>
                    </div>
                </div>
            </Surface>

            <div className="grid grid-cols-4 gap-3 max-[980px]:grid-cols-2 max-sm:grid-cols-1">
                <DashboardStat label="Songs" value={formatNumber(availableMusics.length)} meta={`${formatNumber(likedMusics.length)} liked`} icon={<Icon.Music />} />
                <DashboardStat label="Plays" value={formatNumber(totalPlayCount)} meta={`${formatHours(totalPlayedMs)} listened`} icon={<Icon.Play />} />
                <DashboardStat label="Collection" value={formatNumber(albums.length)} meta={`${formatNumber(artists.length)} artists · ${formatNumber(playlists.length)} playlists`} icon={<Icon.Disc />} />
                <DashboardStat label="Average quality" value={formatBitrate(averageBitrate)} meta={`${Math.round(listenedRatio * 100)}% listened coverage`} icon={<Icon.Settings />} />
            </div>

            <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] gap-[clamp(1rem,2.4vw,1.5rem)] max-[980px]:grid-cols-1">
                <Surface as="section" className="flex min-w-0 flex-col gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent p-[clamp(1rem,2.4vw,1.25rem)]">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <Text as="span" variant="muted" size="xs" weight="medium" className="tracking-[0.06em] uppercase">Signal</Text>
                            <h2 className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">Most played tracks</h2>
                        </div>
                        <Link to="/library" className="rounded-full border border-[var(--b-color-border-subtle)] bg-transparent px-2.5 py-1.5 text-sm font-medium text-[var(--b-color-text-tertiary)] no-underline transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]">Open</Link>
                    </div>

                    {topMusics.length > 0 ? (
                        <div className="flex flex-col gap-2.5">
                            {topMusics.map((music, index) => (
                                <RankedTrack key={music.id} music={music} index={index} maxPlayCount={maxPlayCount} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-40 items-center rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-item)] p-4">
                            <Text as="p" variant="secondary" size="sm">Play a few tracks and the strongest signals will appear here.</Text>
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
                    <Text as="span" variant="muted" size="xs" weight="medium" className="tracking-[0.06em] uppercase">Library shape</Text>
                    <h2 className="m-0 text-[1.05rem] font-semibold leading-tight text-[var(--b-color-text)]">Artist weight</h2>
                </div>

                <div className="grid grid-cols-5 gap-2.5 max-[980px]:grid-cols-2 max-sm:grid-cols-1">
                    {topArtists.map((artist) => {
                        const width = maxArtistMusicCount > 0 ? Math.max((artist.musicCount / maxArtistMusicCount) * 100, 8) : 0;

                        return (
                            <Link key={artist.id} to={`/artist/${artist.id}`} className="flex min-h-28 min-w-0 flex-col justify-between gap-4 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-3.5 text-[var(--b-color-text)] no-underline transition-[background-color,border-color] duration-150 hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)]">
                                <span className="flex min-w-0 flex-col gap-1">
                                    <span className="truncate text-sm font-medium">{artist.name}</span>
                                    <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">{formatNumber(artist.musicCount)} songs · {formatNumber(artist.albumCount)} albums</span>
                                </span>
                                <span className="h-1.5 overflow-hidden rounded-full bg-[var(--b-color-border-subtle)]" aria-hidden="true">
                                    <span className="block h-full rounded-[inherit] bg-[var(--b-color-point)]" style={{ width: `${width}%` }} />
                                </span>
                            </Link>
                        );
                    })}
                </div>
            </Surface>
        </div>
    );
}
