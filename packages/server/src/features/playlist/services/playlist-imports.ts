import models from '~/models';
import { selectPhysicalFileForReleaseTrack } from '~/modules/physical-file-selection';
import {
    createImportReport,
    exportPlaylist,
    type LibraryTrack,
    type PlaylistFormat,
    type PlaylistImportMode,
    parsePlaylist,
    type PortablePlaylist,
    type PortableTrack
} from './playlist-portability';

const loadLibrary = async (): Promise<LibraryTrack[]> => {
    const tracks = await models.releaseTrack.findMany({
        include: {
            Recording: true,
            Release: true,
            ArtistCredit: { include: { Artist: true }, orderBy: { position: 'asc' } }
        }
    });
    return Promise.all(tracks.map(async track => {
        const file = await selectPhysicalFileForReleaseTrack(track.id);
        const recordingCredits = track.ArtistCredit.length ? [] : await models.artistCredit.findMany({
            where: { recordingId: track.recordingId }, include: { Artist: true }, orderBy: { position: 'asc' }
        });
        const credits = track.ArtistCredit.length ? track.ArtistCredit : recordingCredits;
        return {
            id: track.id,
            stableId: track.stableId,
            path: file?.filePath,
            title: track.titleOverride ?? track.Recording.title,
            artist: credits.map(credit => credit.creditedName ?? credit.Artist.name).join(', '),
            album: track.Release.title,
            durationMs: file?.durationMs
        };
    }));
};

const serializeItem = (item: Awaited<ReturnType<typeof models.playlistImportItem.findMany>>[number]) => ({
    index: item.order,
    source: JSON.parse(item.sourceJson) as PortableTrack,
    status: item.skipped ? 'rejected' : item.status,
    reason: item.skipped ? 'skipped-by-user' : item.reason,
    candidates: JSON.parse(item.candidateIdsJson) as Array<{ id: number; title?: string; artist?: string }>,
    selectedId: item.selectedMusicId ?? undefined
});

export const previewPlaylistImport = async ({
    format,
    content,
    fallbackName,
    mode = 'create'
}: {
    format: PlaylistFormat;
    content: string;
    fallbackName?: string;
    mode?: PlaylistImportMode;
}) => {
    const playlist = parsePlaylist(format, content, fallbackName);
    const report = createImportReport(playlist, await loadLibrary());
    const session = await models.playlistImportSession.create({
        data: {
            name: playlist.name,
            format,
            mode,
            sourceJson: JSON.stringify(playlist),
            Item: {
                create: report.map(item => ({
                    order: item.index,
                    sourceJson: JSON.stringify(item.source),
                    status: item.status,
                    reason: item.reason,
                    candidateIdsJson: JSON.stringify(item.candidates),
                    selectedMusicId: item.selectedId
                }))
            }
        },
        include: { Item: { orderBy: { order: 'asc' } } }
    });
    return { id: session.id, name: session.name, mode: session.mode, items: session.Item.map(serializeItem) };
};

export const updatePlaylistImportMappings = async (
    sessionId: string,
    mappings: Array<{ index: number; musicId?: number; skip?: boolean }>
) => {
    await models.$transaction(mappings.map(mapping => models.playlistImportItem.update({
        where: { sessionId_order: { sessionId, order: mapping.index } },
        data: mapping.skip
            ? { skipped: true, selectedMusicId: null }
            : { skipped: false, selectedMusicId: mapping.musicId, status: mapping.musicId ? 'matched' : 'missing', reason: mapping.musicId ? 'manual' : 'no-candidate' }
    })));
    return getPlaylistImportReport(sessionId);
};

export const getPlaylistImportReport = async (sessionId: string) => {
    const session = await models.playlistImportSession.findUnique({
        where: { id: sessionId }, include: { Item: { orderBy: { order: 'asc' } } }
    });
    if (!session) throw new Error('Import session not found.');
    return { id: session.id, name: session.name, mode: session.mode, playlistId: session.playlistId, status: session.status, items: session.Item.map(serializeItem) };
};

export const relinkPlaylistImport = async (sessionId: string) => {
    const session = await models.playlistImportSession.findUnique({ where: { id: sessionId }, include: { Item: true } });
    if (!session) throw new Error('Import session not found.');
    const unresolved = session.Item.filter(item => !item.selectedMusicId && !item.skipped);
    const report = createImportReport({ version: 1, name: session.name, tracks: unresolved.map(item => JSON.parse(item.sourceJson)) }, await loadLibrary());
    await models.$transaction(report.map((item, position) => models.playlistImportItem.update({
        where: { id: unresolved[position].id },
        data: { status: item.status, reason: item.reason, candidateIdsJson: JSON.stringify(item.candidates), selectedMusicId: item.selectedId }
    })));
    return getPlaylistImportReport(sessionId);
};

export const applyPlaylistImport = async (sessionId: string, targetPlaylistId?: number) => models.$transaction(async tx => {
    const session = await tx.playlistImportSession.findUnique({ where: { id: sessionId }, include: { Item: { orderBy: { order: 'asc' } } } });
    if (!session) throw new Error('Import session not found.');
    if (session.status === 'applied' && session.playlistId) return { playlistId: session.playlistId, alreadyApplied: true };
    const selectedIds = session.Item.filter(item => item.selectedMusicId && !item.skipped).map(item => item.selectedMusicId as number);
    let playlistId = targetPlaylistId;
    if (session.mode === 'create' || !playlistId) {
        const playlist = await tx.playlist.create({ data: { name: session.name } });
        playlistId = playlist.id;
    } else if (session.mode === 'replace') {
        await tx.playlistMusic.deleteMany({ where: { playlistId } });
    }
    const existingCount = session.mode === 'merge' ? await tx.playlistMusic.count({ where: { playlistId } }) : 0;
    await tx.playlistMusic.createMany({ data: selectedIds.map((musicId, index) => ({ playlistId: playlistId as number, musicId, order: existingCount + index })) });
    await tx.playlistImportSession.update({ where: { id: sessionId }, data: { playlistId, status: 'applied' } });
    return { playlistId, alreadyApplied: false, matched: selectedIds.length, unresolved: session.Item.length - selectedIds.length };
});

export const exportStoredPlaylist = async (playlistId: number, format: PlaylistFormat) => {
    const playlist = await models.playlist.findUnique({ where: { id: playlistId }, include: { PlaylistMusic: { orderBy: { order: 'asc' } } } });
    if (!playlist) throw new Error('Playlist not found.');
    const library = new Map((await loadLibrary()).map(track => [track.id, track]));
    const portable: PortablePlaylist = { version: 1, name: playlist.name, tracks: playlist.PlaylistMusic.flatMap(item => {
        const track = library.get(item.musicId);
        return track ? [track] : [];
    }) };
    return exportPlaylist(portable, format);
};
