import type {
    Music,
    MusicFileVersion,
    MusicGroupingCandidate
} from '~/models/type';
import { Badge, Button, Surface, Text } from '~/components/shared';

const formatQuality = (file: MusicFileVersion) => [
    file.codec ? file.codec.toUpperCase() : 'Unknown codec',
    file.bitrate ? `${Math.round(file.bitrate / 1_000)} kbps` : null,
    file.sampleRate ? `${Math.round(file.sampleRate / 1_000)} kHz` : null
].filter(Boolean).join(' · ');

const versionLabel = (music: Music) => [
    music.recordingVersionTitle,
    music.releaseVersionTitle
].filter(Boolean).join(' · ');

export default function MusicVersionManager({
    music,
    busy,
    onSetPreferred,
    onUngroupFile,
    onGroupCandidate,
    onUnlinkRecording
}: {
    music: Music;
    busy: boolean;
    onSetPreferred: (fileId: string | null) => void;
    onUngroupFile: (fileId: string) => void;
    onGroupCandidate: (candidate: MusicGroupingCandidate) => void;
    onUnlinkRecording: () => void;
}) {
    const files = music.files ?? [];
    const appearances = music.recordingAppearances ?? [];
    const candidates = music.groupingCandidates ?? [];
    const hasManualPreference = files.some(file => file.isPreferred);

    return (
        <Surface as="section" variant="panel" padding="responsive" className="grid gap-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Text as="h2" size="sectionTitle" weight="semibold">Versions &amp; files</Text>
                    <Text as="p" variant="muted" size="xs" className="mt-1 max-w-[720px] leading-relaxed">
                        Recording links keep album and single appearances related. Alternate files keep one musical item while playback selects a preferred or best available encoding.
                    </Text>
                </div>
                <div className="flex flex-wrap gap-2">
                    {music.recordingVersionTitle && (
                        <Badge tone="accent">Recording: {music.recordingVersionTitle}</Badge>
                    )}
                    {music.releaseVersionTitle && (
                        <Badge>Release: {music.releaseVersionTitle}</Badge>
                    )}
                </div>
            </div>

            <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <Text as="h3" size="sm" weight="semibold">Playback files</Text>
                        <Text as="p" variant="muted" size="xs" className="mt-1">
                            Missing defaults stay remembered and fall back to the next readable file.
                        </Text>
                    </div>
                    {hasManualPreference && (
                        <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => onSetPreferred(null)}>
                            Use quality fallback
                        </Button>
                    )}
                </div>
                <div className="grid gap-2">
                    {files.map(file => (
                        <div
                            key={file.id}
                            className="grid gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Text as="span" size="sm" weight="semibold">
                                        {formatQuality(file)}
                                    </Text>
                                    {file.isSelected && <Badge tone="accent">Playing</Badge>}
                                    {file.isPreferred && <Badge>Preferred</Badge>}
                                    {!file.isPlayable && <Badge>Unavailable</Badge>}
                                </div>
                                <Text as="p" variant="muted" size="xs" className="mt-1 break-all">
                                    {file.filePath}
                                </Text>
                            </div>
                            <div className="flex flex-wrap gap-2 sm:justify-end">
                                {!file.isPreferred && (
                                    <Button
                                        type="button"
                                        size="xs"
                                        disabled={busy}
                                        onClick={() => onSetPreferred(file.id)}>
                                        Make default
                                    </Button>
                                )}
                                {files.length > 1 && (
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() => onUngroupFile(file.id)}>
                                        Separate file
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="grid gap-3 border-t border-[var(--b-color-border-subtle)] pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <Text as="h3" size="sm" weight="semibold">Recording appearances</Text>
                        <Text as="p" variant="muted" size="xs" className="mt-1">
                            The same performance may appear on more than one release.
                        </Text>
                    </div>
                    {appearances.length > 0 && (
                        <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busy}
                            onClick={onUnlinkRecording}>
                            Separate this release
                        </Button>
                    )}
                </div>
                {appearances.length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                        {appearances.map(appearance => (
                            <div
                                key={appearance.id}
                                className="rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] p-3">
                                <Text as="p" size="sm" weight="semibold">{appearance.album.name}</Text>
                                <Text as="p" variant="muted" size="xs" className="mt-1">
                                    {appearance.name}
                                    {versionLabel(appearance) ? ` · ${versionLabel(appearance)}` : ''}
                                </Text>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Text as="p" variant="muted" size="sm">No linked release appearances.</Text>
                )}
            </section>

            <section className="grid gap-3 border-t border-[var(--b-color-border-subtle)] pt-5">
                <div>
                    <Text as="h3" size="sm" weight="semibold">Suggested matches</Text>
                    <Text as="p" variant="muted" size="xs" className="mt-1 max-w-[720px] leading-relaxed">
                        Suggestions require matching normalized title, ordered credits, compatible version labels, and duration. Ocean Wave never merges these automatically.
                    </Text>
                </div>
                {candidates.length ? (
                    <div className="grid gap-2">
                        {candidates.map(candidate => (
                            <div
                                key={`${candidate.kind}-${candidate.music.id}`}
                                className="grid gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Text as="p" size="sm" weight="semibold">
                                            {candidate.music.name}
                                        </Text>
                                        <Badge>
                                            {candidate.kind === 'ALTERNATE_FILE'
                                                ? 'Alternate file'
                                                : 'Same recording'}
                                        </Badge>
                                    </div>
                                    <Text as="p" variant="secondary" size="xs" className="mt-1">
                                        {candidate.music.artistDisplayName} · {candidate.music.album.name}
                                    </Text>
                                    <Text as="p" variant="muted" size="xs" className="mt-1 leading-relaxed">
                                        {candidate.reasons.join(' · ')}
                                    </Text>
                                </div>
                                <Button
                                    type="button"
                                    size="xs"
                                    disabled={busy}
                                    onClick={() => onGroupCandidate(candidate)}>
                                    {candidate.kind === 'ALTERNATE_FILE'
                                        ? 'Add as alternate'
                                        : 'Link recording'}
                                </Button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Text as="p" variant="muted" size="sm">No safe suggestions found.</Text>
                )}
            </section>
        </Surface>
    );
}
