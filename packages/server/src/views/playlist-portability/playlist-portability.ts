import type { Request, Response } from 'express';
import {
    applyPlaylistImport,
    exportStoredPlaylist,
    getPlaylistImportReport,
    previewPlaylistImport,
    relinkPlaylistImport,
    updatePlaylistImportMappings
} from '~/features/playlist/services/playlist-imports';
import type { PlaylistFormat, PlaylistImportMode } from '~/features/playlist/services/playlist-portability';

const formats = new Set<PlaylistFormat>(['m3u', 'xspf', 'json']);
const modes = new Set<PlaylistImportMode>(['create', 'replace', 'merge']);

const formatFrom = (value: unknown): PlaylistFormat => {
    if (typeof value !== 'string' || !formats.has(value as PlaylistFormat)) throw new Error('Unsupported playlist format.');
    return value as PlaylistFormat;
};

export const previewPlaylist = async (req: Request, res: Response) => {
    const { content, fallbackName, mode } = req.body as { content?: unknown; fallbackName?: unknown; mode?: unknown };
    if (typeof content !== 'string') {
        res.status(400).json({ message: 'Playlist content is required.' });
        return;
    }
    if (mode !== undefined && (typeof mode !== 'string' || !modes.has(mode as PlaylistImportMode))) {
        res.status(400).json({ message: 'Unsupported import mode.' });
        return;
    }
    const report = await previewPlaylistImport({
        format: formatFrom(req.body.format), content,
        fallbackName: typeof fallbackName === 'string' ? fallbackName : undefined,
        mode: mode as PlaylistImportMode | undefined
    });
    res.status(201).json(report);
};

const param = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

export const getPlaylistReport = async (req: Request, res: Response) => {
    res.json(await getPlaylistImportReport(param(req.params.id)));
};

export const mapPlaylistItems = async (req: Request, res: Response) => {
    const mappings = Array.isArray(req.body.mappings) ? req.body.mappings : [];
    res.json(await updatePlaylistImportMappings(param(req.params.id), mappings));
};

export const relinkPlaylistItems = async (req: Request, res: Response) => {
    res.json(await relinkPlaylistImport(param(req.params.id)));
};

export const applyPlaylist = async (req: Request, res: Response) => {
    const target = req.body.targetPlaylistId;
    res.json(await applyPlaylistImport(param(req.params.id), target === undefined ? undefined : Number(target)));
};

export const downloadPlaylist = async (req: Request, res: Response) => {
    const format = formatFrom(req.query.format ?? 'json');
    const id = param(req.params.id);
    const content = await exportStoredPlaylist(Number(id), format);
    const types = { json: 'application/json', m3u: 'audio/x-mpegurl', xspf: 'application/xspf+xml' };
    res.type(types[format]).setHeader('Content-Disposition', `attachment; filename="playlist-${id}.${format === 'm3u' ? 'm3u8' : format}"`);
    res.send(content);
};
