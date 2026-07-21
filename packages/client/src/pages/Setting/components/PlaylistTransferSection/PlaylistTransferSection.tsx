import { useState } from 'react';
import {
    applyPlaylistImport,
    type PlaylistImportReport,
    playlistExportUrl,
    previewPlaylistImport,
    updatePlaylistImportMappings
} from '~/api/playlist-portability';
import { Button, SettingItem, SettingSection, Text } from '~/components/shared';
import useStoreValue from '~/hooks/useStoreValue';
import { toast } from '~/modules/toast';
import { playlistStore } from '~/store/playlist';

export const PlaylistTransferSection = () => {
    const [playlists] = useStoreValue(playlistStore, 'playlists');
    const [report, setReport] = useState<PlaylistImportReport>();
    const [busy, setBusy] = useState(false);

    const preview = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        try {
            setReport(await previewPlaylistImport(file));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not read the playlist.');
        } finally {
            setBusy(false);
        }
    };

    const apply = async () => {
        if (!report) return;
        setBusy(true);
        try {
            const result = await applyPlaylistImport(report.id);
            toast.success(`Imported ${result.matched} songs. ${result.unresolved} items remain available for relinking.`);
            playlistStore.sync();
        } finally {
            setBusy(false);
        }
    };

    const setCandidate = async (index: number, value: string) => {
        if (!report) return;
        setReport(await updatePlaylistImportMappings(report.id, [{
            index,
            ...(value === 'skip' ? { skip: true } : { musicId: Number(value) })
        }]));
    };

    const counts = report?.items.reduce<Record<string, number>>((result, item) => {
        result[item.status] = (result[item.status] ?? 0) + 1;
        return result;
    }, {});

    return (
        <SettingSection title="Playlist transfer" description="Move playlists with M3U8, XSPF, or versioned Ocean Wave JSON files.">
            <SettingItem title="Import playlist" description="Review matched, ambiguous, missing, and rejected songs before creating the playlist.">
                <label className="inline-flex cursor-pointer items-center rounded-[var(--b-radius-md)] border border-[var(--b-color-border)] px-3 py-2 text-sm font-semibold">
                    {busy ? 'Reading…' : 'Choose file'}
                    <input className="sr-only" type="file" accept=".m3u,.m3u8,.xspf,.json" disabled={busy} onChange={event => preview(event.target.files?.[0])} />
                </label>
            </SettingItem>
            {report && (
                <div className="border-b border-[var(--b-color-border-subtle)] py-4">
                    <Text as="p" size="sm" weight="semibold">{report.name}</Text>
                    <Text as="p" size="xs" variant="muted" className="mt-1">
                        {counts?.matched ?? 0} matched · {counts?.ambiguous ?? 0} ambiguous · {counts?.missing ?? 0} missing · {counts?.rejected ?? 0} rejected
                    </Text>
                    <div className="mt-3 grid max-h-72 gap-2 overflow-auto">
                        {report.items.filter(item => item.status !== 'matched').map(item => (
                            <div key={item.index} className="rounded-lg border border-[var(--b-color-border-subtle)] p-3 text-sm">
                                <div className="font-medium">{item.source.artist ? `${item.source.artist} — ` : ''}{item.source.title ?? item.source.path ?? `Item ${item.index + 1}`}</div>
                                <div className="mt-1 text-xs text-[var(--b-color-text-muted)]">{item.status}: {item.reason}</div>
                                {item.candidates.length > 0 && (
                                    <select className="mt-2 rounded border bg-transparent p-1" defaultValue="" onChange={event => setCandidate(item.index, event.target.value)}>
                                        <option value="" disabled>Choose a match</option>
                                        {item.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.artist ? `${candidate.artist} — ` : ''}{candidate.title ?? candidate.id}</option>)}
                                        <option value="skip">Skip this item</option>
                                    </select>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 flex justify-end"><Button disabled={busy} onClick={apply}>Create playlist</Button></div>
                </div>
            )}
            <SettingItem title="Export playlists" description="JSON preserves every identifier and duplicate. M3U8 and XSPF include portable metadata hints." divider={false}>
                <div className="grid gap-2">
                    {playlists.map(playlist => (
                        <div key={playlist.id} className="flex flex-wrap items-center justify-end gap-2 text-sm">
                            <span className="mr-1">{playlist.name}</span>
                            {(['json', 'm3u', 'xspf'] as const).map(format => <a key={format} className="underline" href={playlistExportUrl(playlist.id, format)}>{format.toUpperCase()}</a>)}
                        </div>
                    ))}
                    {playlists.length === 0 && <Text as="span" size="sm" variant="muted">No playlists to export.</Text>}
                </div>
            </SettingItem>
        </SettingSection>
    );
};
