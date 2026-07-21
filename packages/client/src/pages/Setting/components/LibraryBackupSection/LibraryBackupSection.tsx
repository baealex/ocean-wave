import { useState } from 'react';
import { applyLibraryRestore, libraryBackupUrl, type LibraryRestorePreview, previewLibraryRestore } from '~/api/library-backup';
import { Button, SettingItem, SettingSection, Text } from '~/components/shared';
import { toast } from '~/modules/toast';

export const LibraryBackupSection = () => {
    const [content, setContent] = useState('');
    const [preview, setPreview] = useState<LibraryRestorePreview>();
    const [busy, setBusy] = useState(false);
    const choose = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        try { const next = await file.text(); setContent(next); setPreview(await previewLibraryRestore(next)); }
        catch (error) { toast.error(error instanceof Error ? error.message : 'Could not inspect the backup.'); }
        finally { setBusy(false); }
    };
    const restore = async (mode: 'merge' | 'replace') => {
        setBusy(true);
        try { const result = await applyLibraryRestore(content, mode); toast.success(result.alreadyApplied ? 'This backup was already restored.' : 'Library state restored.'); }
        finally { setBusy(false); }
    };
    return (
        <SettingSection title="Library backup" description="Back up personal library state without copying audio files, passwords, sessions, or device presence.">
            <SettingItem title="Download backup" description="Includes playlists, likes, hidden songs, tags, Smart Views, and listening history.">
                <a className="rounded-[var(--b-radius-md)] border border-[var(--b-color-border)] px-3 py-2 text-sm font-semibold" href={libraryBackupUrl}>Download JSON</a>
            </SettingItem>
            <SettingItem title="Restore backup" description="Inspect library matches and conflicts before making changes." divider={false}>
                <label className="inline-flex cursor-pointer items-center rounded-[var(--b-radius-md)] border border-[var(--b-color-border)] px-3 py-2 text-sm font-semibold">
                    {busy ? 'Inspecting…' : 'Choose backup'}
                    <input className="sr-only" type="file" accept="application/json,.json" disabled={busy} onChange={event => choose(event.target.files?.[0])} />
                </label>
            </SettingItem>
            {preview && <div className="border-t border-[var(--b-color-border-subtle)] py-4">
                <Text as="p" size="sm">{preview.matching.recordings}/{preview.counts.recordingStates} recordings matched · {preview.matching.missingPlaylistTracks} playlist entries missing</Text>
                <Text as="p" size="xs" variant="muted" className="mt-1">{preview.counts.playlists} playlists · {preview.counts.tags} tags · {preview.counts.smartViews} Smart Views · {preview.counts.playbackEvents} history entries</Text>
                <div className="mt-3 flex justify-end gap-2"><Button disabled={busy || preview.alreadyApplied} onClick={() => restore('merge')}>Merge</Button><Button disabled={busy || preview.alreadyApplied} onClick={() => restore('replace')}>Replace personal state</Button></div>
            </div>}
        </SettingSection>
    );
};
