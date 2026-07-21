import { createHash, randomUUID } from 'node:crypto';
import models from '~/models';

export const LIBRARY_BACKUP_VERSION = 1;
export const LIBRARY_BACKUP_MAX_BYTES = 10 * 1024 * 1024;
type RestoreMode = 'merge' | 'replace';

interface LibraryBackup {
    version: number;
    manifestId: string;
    createdAt: string;
    playlists: Array<{ name: string; tracks: string[] }>;
    recordingStates: Array<{ stableId: string; liked: boolean; hidden: boolean; playCount: number; skipCount: number; completionCount: number; totalPlayedMs: number; lastPlayedAt?: string }>;
    tags: Array<{ name: string; color?: string; description?: string; recordingStableIds: string[] }>;
    smartViews: Array<{ name: string; tagMode: string; filterVersion: number; filterJson?: string; sortKey?: string; tags: Array<{ name: string; polarity: string; order: number }> }>;
    playbackEvents: Array<{ id: number; recordingStableId: string; releaseTrackStableId: string; startedAt: string; endedAt: string; playedMs: number; completionRate: number; countedAsPlay: boolean; outcome: string; endReason: string; hadSeek: boolean; source: string }>;
}

export class LibraryBackupError extends Error {
    constructor(public readonly code: string, message: string) { super(message); this.name = 'LibraryBackupError'; }
}

const normalizeName = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const hash = (content: string) => createHash('sha256').update(content).digest('hex');

export const createLibraryBackup = async (): Promise<LibraryBackup> => {
    const [playlists, recordings, tags, smartViews, playbackEvents] = await Promise.all([
        models.playlist.findMany({ include: { PlaylistMusic: { orderBy: { order: 'asc' }, include: { ReleaseTrack: true } } }, orderBy: { order: 'asc' } }),
        models.recording.findMany({ include: { MusicLike: true, MusicHate: true } }),
        models.tag.findMany({ include: { MusicTag: { include: { Music: true } } }, orderBy: { order: 'asc' } }),
        models.smartView.findMany({ include: { SmartViewTag: { include: { Tag: true }, orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } }),
        models.playbackEvent.findMany({ include: { Music: true, ReleaseTrack: true }, orderBy: { endedAt: 'asc' } })
    ]);
    return {
        version: LIBRARY_BACKUP_VERSION,
        manifestId: randomUUID(),
        createdAt: new Date().toISOString(),
        playlists: playlists.map(playlist => ({ name: playlist.name, tracks: playlist.PlaylistMusic.map(item => item.ReleaseTrack.stableId) })),
        recordingStates: recordings.map(recording => ({
            stableId: recording.stableId, liked: Boolean(recording.MusicLike), hidden: Boolean(recording.MusicHate),
            playCount: recording.playCount, skipCount: recording.skipCount, completionCount: recording.completionCount,
            totalPlayedMs: recording.totalPlayedMs, ...(recording.lastPlayedAt ? { lastPlayedAt: recording.lastPlayedAt.toISOString() } : {})
        })),
        tags: tags.map(tag => ({ name: tag.name, ...(tag.color ? { color: tag.color } : {}), ...(tag.description ? { description: tag.description } : {}), recordingStableIds: tag.MusicTag.map(item => item.Music.stableId) })),
        smartViews: smartViews.map(view => ({ name: view.name, tagMode: view.tagMode, filterVersion: view.filterVersion, ...(view.filterJson ? { filterJson: view.filterJson } : {}), ...(view.sortKey ? { sortKey: view.sortKey } : {}), tags: view.SmartViewTag.map(item => ({ name: item.Tag.name, polarity: item.polarity, order: item.order })) })),
        playbackEvents: playbackEvents.map(event => ({ id: event.id, recordingStableId: event.Music.stableId, releaseTrackStableId: event.ReleaseTrack.stableId, startedAt: event.startedAt.toISOString(), endedAt: event.endedAt.toISOString(), playedMs: event.playedMs, completionRate: event.completionRate, countedAsPlay: event.countedAsPlay, outcome: event.outcome, endReason: event.endReason, hadSeek: event.hadSeek, source: event.source }))
    };
};

export const parseLibraryBackup = (content: string): LibraryBackup => {
    if (Buffer.byteLength(content, 'utf8') > LIBRARY_BACKUP_MAX_BYTES) throw new LibraryBackupError('BACKUP_TOO_LARGE', 'Backup files cannot exceed 10 MB.');
    let value: unknown;
    try { value = JSON.parse(content); } catch { throw new LibraryBackupError('INVALID_BACKUP', 'The backup is not valid JSON.'); }
    if (!value || typeof value !== 'object') throw new LibraryBackupError('INVALID_BACKUP', 'The backup must be an object.');
    const backup = value as Partial<LibraryBackup>;
    if (backup.version !== LIBRARY_BACKUP_VERSION) throw new LibraryBackupError('UNSUPPORTED_VERSION', `Backup version ${String(backup.version)} is not supported.`);
    if (!backup.manifestId || !Array.isArray(backup.playlists) || !Array.isArray(backup.recordingStates) || !Array.isArray(backup.tags) || !Array.isArray(backup.smartViews) || !Array.isArray(backup.playbackEvents)) throw new LibraryBackupError('INVALID_BACKUP', 'The backup is missing required collections.');
    return backup as LibraryBackup;
};

export const inspectLibraryRestore = async (content: string) => {
    const backup = parseLibraryBackup(content);
    const [recordings, tracks, existing] = await Promise.all([
        models.recording.findMany({ select: { stableId: true } }),
        models.releaseTrack.findMany({ select: { stableId: true } }),
        models.libraryRestoreApplication.findUnique({ where: { manifestId: backup.manifestId } })
    ]);
    const recordingIds = new Set(recordings.map(item => item.stableId));
    const trackIds = new Set(tracks.map(item => item.stableId));
    const referencedTracks = backup.playlists.flatMap(playlist => playlist.tracks);
    return {
        manifestId: backup.manifestId,
        alreadyApplied: Boolean(existing),
        counts: { playlists: backup.playlists.length, recordingStates: backup.recordingStates.length, tags: backup.tags.length, smartViews: backup.smartViews.length, playbackEvents: backup.playbackEvents.length },
        matching: {
            recordings: backup.recordingStates.filter(item => recordingIds.has(item.stableId)).length,
            playlistTracks: referencedTracks.filter(id => trackIds.has(id)).length,
            missingPlaylistTracks: referencedTracks.filter(id => !trackIds.has(id)).length
        }
    };
};

export const restoreLibraryBackup = async (content: string, mode: RestoreMode) => {
    const backup = parseLibraryBackup(content);
    const manifestHash = hash(content);
    return models.$transaction(async tx => {
        const applied = await tx.libraryRestoreApplication.findUnique({ where: { manifestId: backup.manifestId } });
        if (applied) {
            if (applied.manifestHash !== manifestHash) throw new LibraryBackupError('MANIFEST_CHANGED', 'This manifest ID was already used with different content.');
            return { alreadyApplied: true, manifestId: backup.manifestId };
        }
        const [recordings, tracks] = await Promise.all([tx.recording.findMany(), tx.releaseTrack.findMany()]);
        const recordingByStableId = new Map(recordings.map(item => [item.stableId, item]));
        const trackByStableId = new Map(tracks.map(item => [item.stableId, item]));
        if (mode === 'replace') {
            await tx.playlist.deleteMany();
            await tx.smartView.deleteMany();
            await tx.musicTag.deleteMany();
            await tx.tag.deleteMany();
            await tx.musicLike.deleteMany();
            await tx.musicHate.deleteMany();
        }
        for (const state of backup.recordingStates) {
            const recording = recordingByStableId.get(state.stableId);
            if (!recording) continue;
            await tx.recording.update({ where: { id: recording.id }, data: { playCount: state.playCount, skipCount: state.skipCount, completionCount: state.completionCount, totalPlayedMs: state.totalPlayedMs, lastPlayedAt: state.lastPlayedAt ? new Date(state.lastPlayedAt) : null } });
            if (state.liked) await tx.musicLike.upsert({ where: { musicId: recording.id }, create: { musicId: recording.id }, update: {} });
            if (state.hidden) await tx.musicHate.upsert({ where: { musicId: recording.id }, create: { musicId: recording.id }, update: {} });
        }
        const tagByName = new Map<string, number>();
        for (const [order, source] of backup.tags.entries()) {
            const tag = await tx.tag.upsert({ where: { scopeKey_normalizedName: { scopeKey: 'local', normalizedName: normalizeName(source.name) } }, create: { name: source.name, normalizedName: normalizeName(source.name), order, color: source.color, description: source.description }, update: { color: source.color, description: source.description } });
            tagByName.set(normalizeName(source.name), tag.id);
            for (const stableId of source.recordingStableIds) {
                const recording = recordingByStableId.get(stableId);
                if (recording) await tx.musicTag.upsert({ where: { musicId_tagId: { musicId: recording.id, tagId: tag.id } }, create: { musicId: recording.id, tagId: tag.id }, update: {} });
            }
        }
        for (const [order, source] of backup.smartViews.entries()) {
            const view = await tx.smartView.upsert({ where: { scopeKey_normalizedName: { scopeKey: 'local', normalizedName: normalizeName(source.name) } }, create: { name: source.name, normalizedName: normalizeName(source.name), tagMode: source.tagMode, filterVersion: source.filterVersion, filterJson: source.filterJson, sortKey: source.sortKey, order }, update: { tagMode: source.tagMode, filterVersion: source.filterVersion, filterJson: source.filterJson, sortKey: source.sortKey } });
            await tx.smartViewTag.deleteMany({ where: { smartViewId: view.id } });
            await tx.smartViewTag.createMany({ data: source.tags.flatMap(item => { const tagId = tagByName.get(normalizeName(item.name)); return tagId ? [{ smartViewId: view.id, tagId, polarity: item.polarity, order: item.order }] : []; }) });
        }
        for (const [order, source] of backup.playlists.entries()) {
            const playlist = await tx.playlist.create({ data: { name: source.name, order } });
            await tx.playlistMusic.createMany({ data: source.tracks.flatMap((stableId, index) => { const track = trackByStableId.get(stableId); return track ? [{ playlistId: playlist.id, musicId: track.id, order: index }] : []; }) });
        }
        for (const source of backup.playbackEvents) {
            const recording = recordingByStableId.get(source.recordingStableId);
            const track = trackByStableId.get(source.releaseTrackStableId);
            if (!recording || !track) continue;
            await tx.playbackEvent.create({ data: { startedAt: new Date(source.startedAt), endedAt: new Date(source.endedAt), playedMs: source.playedMs, completionRate: source.completionRate, countedAsPlay: source.countedAsPlay, outcome: source.outcome, endReason: source.endReason, hadSeek: source.hadSeek, source: source.source, clientSessionId: `backup:${backup.manifestId}:${source.id}`, musicId: recording.id, releaseTrackId: track.id } });
        }
        await tx.libraryRestoreApplication.create({ data: { manifestId: backup.manifestId, manifestHash, mode } });
        return { alreadyApplied: false, manifestId: backup.manifestId };
    });
};
