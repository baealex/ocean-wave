import { useAppStore as useStore } from '~/store/base-store';
import { Badge, SectionEmptyState, SectionHeader, Surface, Text } from '~/components/shared';
import * as Icon from '~/icon';

import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';

const formatNumber = (value: number) => value.toLocaleString();

const formatHours = (milliseconds: number) => {
    const minutes = Math.round(milliseconds / 1000 / 60);

    if (minutes < 60) {
        return `${minutes}m`;
    }

    const hours = minutes / 60;

    return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
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
    <Surface variant="item" radius="lg" padding="md" className="flex min-h-28 min-w-0 flex-col justify-between gap-4">
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
    const [{ loaded, musics }] = useStore(musicStore);
    const [{ queueLength, isPlaying }] = useStore(queueStore);

    const availableMusics = musics.filter(music => !music.isHated);
    const playedMusics = availableMusics.filter(music => music.playCount > 0 || music.totalPlayedMs > 0);
    const totalPlayCount = availableMusics.reduce((sum, music) => sum + music.playCount, 0);
    const totalPlayedMs = availableMusics.reduce((sum, music) => sum + music.totalPlayedMs, 0);

    return (
        <div className="flex flex-col gap-[clamp(16px,2.4vw,24px)] text-[var(--b-color-text)]">
            <Surface as="section" variant="subtle" radius="2xl" padding="hero" className="relative overflow-hidden">
                <div className="absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--b-color-point),transparent)]" aria-hidden="true" />
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <Text as="h1" size="2xl" weight="bold" className="leading-[1.08]">
                        Dashboard
                    </Text>
                    <div className="flex flex-wrap gap-2">
                        <Badge tone="subtle" size="md">
                            {loaded ? `${formatNumber(availableMusics.length)} tracks` : 'Loading library'}
                        </Badge>
                        <Badge tone="subtle" size="md">
                            {isPlaying ? 'Playing now' : `${formatNumber(queueLength)} queued`}
                        </Badge>
                    </div>
                </div>
            </Surface>

            <div className="grid grid-cols-3 gap-3 max-[900px]:grid-cols-1">
                <DashboardStat
                    label="Played tracks"
                    value={formatNumber(playedMusics.length)}
                    meta={`${formatNumber(availableMusics.length)} tracks in library`}
                    icon={<Icon.Music />}
                />
                <DashboardStat
                    label="Play count"
                    value={formatNumber(totalPlayCount)}
                    meta="Recorded plays"
                    icon={<Icon.Play />}
                />
                <DashboardStat
                    label="Listening time"
                    value={formatHours(totalPlayedMs)}
                    meta="Recorded playback time"
                    icon={<Icon.Activity />}
                />
            </div>

            <section className="flex flex-col gap-4">
                <SectionHeader eyebrow="History" heading="Listening analytics" />
                <SectionEmptyState>
                    Weekly history, top artists, and top albums will appear here later.
                </SectionEmptyState>
            </section>
        </div>
    );
}
