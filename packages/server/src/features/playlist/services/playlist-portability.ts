import path from 'node:path';

export const PLAYLIST_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const OCEAN_WAVE_PLAYLIST_VERSION = 1;

export type PlaylistFormat = 'm3u' | 'xspf' | 'json';
export type PlaylistImportMode = 'create' | 'replace' | 'merge';
export type PlaylistMatchStatus = 'matched' | 'ambiguous' | 'missing' | 'rejected';

export interface PortableTrack {
    stableId?: string;
    path?: string;
    title?: string;
    artist?: string;
    album?: string;
    durationMs?: number;
}

export interface PortablePlaylist {
    version: number;
    name: string;
    tracks: PortableTrack[];
}

export interface LibraryTrack extends PortableTrack {
    id: number;
}

export interface PlaylistImportItem {
    index: number;
    source: PortableTrack;
    status: PlaylistMatchStatus;
    reason: string;
    candidates: Array<{ id: number; title?: string; artist?: string }>;
    selectedId?: number;
}

export class PlaylistPortabilityError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = 'PlaylistPortabilityError';
    }
}

const assertSafeText = (content: string) => {
    if (Buffer.byteLength(content, 'utf8') > PLAYLIST_IMPORT_MAX_BYTES) {
        throw new PlaylistPortabilityError('PLAYLIST_TOO_LARGE', 'Playlist files cannot exceed 2 MB.');
    }
    if (content.includes('\0') || content.includes('\uFFFD')) {
        throw new PlaylistPortabilityError('INVALID_ENCODING', 'The playlist is not valid UTF-8 text.');
    }
};

const safePathHint = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return undefined;
    const normalized = trimmed.replaceAll('\\', '/');
    if (normalized.split('/').includes('..')) return undefined;
    return normalized;
};

const parseDurationSeconds = (value: string) => {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : undefined;
};

export const parseM3u = (content: string, fallbackName = 'Imported playlist'): PortablePlaylist => {
    assertSafeText(content);
    const tracks: PortableTrack[] = [];
    let pending: Omit<PortableTrack, 'path'> = {};

    for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF:')) {
            const match = /^#EXTINF:([^,]*),(.*)$/.exec(line);
            if (match) {
                const separator = match[2].indexOf(' - ');
                const artist = separator >= 0 ? match[2].slice(0, separator) : match[2];
                const title = separator >= 0 ? match[2].slice(separator + 3) : undefined;
                pending = {
                    durationMs: parseDurationSeconds(match[1]),
                    ...(title ? { artist, title } : { title: match[2] })
                };
            }
            continue;
        }
        if (line.startsWith('#')) continue;
        const pathHint = safePathHint(line);
        tracks.push(pathHint ? { ...pending, path: pathHint } : { ...pending });
        pending = {};
    }

    return { version: OCEAN_WAVE_PLAYLIST_VERSION, name: fallbackName, tracks };
};

const decodeXml = (value: string) => value
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'").replaceAll('&amp;', '&');

const xmlValue = (xml: string, name: string) => {
    const lower = xml.toLocaleLowerCase();
    const opening = lower.indexOf(`<${name.toLocaleLowerCase()}`);
    if (opening < 0) return undefined;
    const contentStart = lower.indexOf('>', opening);
    if (contentStart < 0) return undefined;
    const closing = lower.indexOf(`</${name.toLocaleLowerCase()}>`, contentStart + 1);
    return closing < 0 ? undefined : decodeXml(xml.slice(contentStart + 1, closing).trim());
};

const xmlTrackBlocks = (xml: string) => {
    const blocks: string[] = [];
    const lower = xml.toLocaleLowerCase();
    let cursor = 0;
    while (cursor < lower.length) {
        const opening = lower.indexOf('<track', cursor);
        if (opening < 0) break;
        const contentStart = lower.indexOf('>', opening);
        if (contentStart < 0) break;
        const closing = lower.indexOf('</track>', contentStart + 1);
        if (closing < 0) break;
        blocks.push(xml.slice(contentStart + 1, closing));
        cursor = closing + '</track>'.length;
    }
    return blocks;
};

export const parseXspf = (content: string, fallbackName = 'Imported playlist'): PortablePlaylist => {
    assertSafeText(content);
    if (/<!DOCTYPE|<!ENTITY/i.test(content)) {
        throw new PlaylistPortabilityError('UNSAFE_XML', 'DTD and entity declarations are not supported.');
    }
    const tracks = xmlTrackBlocks(content).map((trackXml) => {
        const location = xmlValue(trackXml, 'location');
        const identifier = xmlValue(trackXml, 'identifier');
        const duration = Number(xmlValue(trackXml, 'duration'));
        return {
            ...(identifier?.startsWith('urn:ocean-wave:track:')
                ? { stableId: identifier.slice('urn:ocean-wave:track:'.length) }
                : {}),
            ...(location ? { path: safePathHint(decodeURIComponent(location.replace(/^file:\/\//, ''))) } : {}),
            title: xmlValue(trackXml, 'title'),
            artist: xmlValue(trackXml, 'creator'),
            album: xmlValue(trackXml, 'album'),
            durationMs: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined
        };
    });
    return {
        version: OCEAN_WAVE_PLAYLIST_VERSION,
        name: xmlValue(content, 'title') ?? fallbackName,
        tracks
    };
};

export const parseOceanWaveJson = (content: string): PortablePlaylist => {
    assertSafeText(content);
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        throw new PlaylistPortabilityError('INVALID_JSON', 'The playlist JSON is invalid.');
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new PlaylistPortabilityError('INVALID_JSON', 'The playlist JSON must be an object.');
    }
    const value = parsed as Partial<PortablePlaylist>;
    if (value.version !== OCEAN_WAVE_PLAYLIST_VERSION) {
        throw new PlaylistPortabilityError('UNSUPPORTED_VERSION', `Playlist version ${String(value.version)} is not supported.`);
    }
    if (typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.tracks)) {
        throw new PlaylistPortabilityError('INVALID_JSON', 'The playlist name and tracks are required.');
    }
    const tracks = value.tracks.map((track, index) => {
        if (!track || typeof track !== 'object') {
            throw new PlaylistPortabilityError('INVALID_TRACK', `Track ${index + 1} is invalid.`);
        }
        const candidate = track as PortableTrack;
        return {
            ...(typeof candidate.stableId === 'string' ? { stableId: candidate.stableId } : {}),
            ...(typeof candidate.path === 'string' ? { path: safePathHint(candidate.path) } : {}),
            ...(typeof candidate.title === 'string' ? { title: candidate.title } : {}),
            ...(typeof candidate.artist === 'string' ? { artist: candidate.artist } : {}),
            ...(typeof candidate.album === 'string' ? { album: candidate.album } : {}),
            ...(typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs)
                ? { durationMs: Math.max(0, Math.round(candidate.durationMs)) } : {})
        };
    });
    return { version: OCEAN_WAVE_PLAYLIST_VERSION, name: value.name.trim(), tracks };
};

export const parsePlaylist = (format: PlaylistFormat, content: string, fallbackName?: string) => {
    if (format === 'm3u') return parseM3u(content, fallbackName);
    if (format === 'xspf') return parseXspf(content, fallbackName);
    return parseOceanWaveJson(content);
};

const normalize = (value?: string) => value?.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const basename = (value?: string) => value ? path.posix.basename(value.replaceAll('\\', '/')).toLocaleLowerCase() : undefined;

export const createImportReport = (
    playlist: PortablePlaylist,
    library: LibraryTrack[],
    manualMappings: Record<number, number> = {}
): PlaylistImportItem[] => playlist.tracks.map((source, index) => {
    const manualId = manualMappings[index];
    const manual = library.find(track => track.id === manualId);
    if (manual) return { index, source, status: 'matched', reason: 'manual', candidates: [manual], selectedId: manual.id };

    const stable = source.stableId
        ? library.filter(track => track.stableId === source.stableId)
        : [];
    if (stable.length === 1) return { index, source, status: 'matched', reason: 'stable-id', candidates: stable, selectedId: stable[0].id };

    const pathMatches = source.path
        ? library.filter(track => basename(track.path) === basename(source.path))
        : [];
    const metadata = library.filter(track => (
        normalize(track.title) === normalize(source.title)
        && (!source.artist || normalize(track.artist) === normalize(source.artist))
        && (!source.album || normalize(track.album) === normalize(source.album))
        && (source.durationMs === undefined || track.durationMs === undefined
            || Math.abs(track.durationMs - source.durationMs) <= 2_000)
    ));
    const candidates = [...new Map([...pathMatches, ...metadata].map(track => [track.id, track])).values()];
    if (candidates.length === 1) return { index, source, status: 'matched', reason: pathMatches.length ? 'path-filename' : 'metadata', candidates, selectedId: candidates[0].id };
    if (candidates.length > 1) return { index, source, status: 'ambiguous', reason: 'multiple-candidates', candidates };
    if (!source.stableId && !source.path && !source.title) return { index, source, status: 'rejected', reason: 'missing-identifiers', candidates: [] };
    return { index, source, status: 'missing', reason: 'no-candidate', candidates: [] };
});

const xmlEscape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export const exportPlaylist = (playlist: PortablePlaylist, format: PlaylistFormat) => {
    if (format === 'json') return JSON.stringify(playlist, null, 2);
    if (format === 'm3u') return [
        '#EXTM3U',
        ...playlist.tracks.flatMap(track => [
            `#EXTINF:${track.durationMs === undefined ? -1 : Math.round(track.durationMs / 1_000)},${track.artist ? `${track.artist} - ` : ''}${track.title ?? 'Unknown track'}`,
            track.path ?? `ocean-wave://${track.stableId ?? 'unresolved'}`
        ])
    ].join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/"><title>${xmlEscape(playlist.name)}</title><trackList>${playlist.tracks.map(track => `<track>${track.stableId ? `<identifier>urn:ocean-wave:track:${xmlEscape(track.stableId)}</identifier>` : ''}${track.path ? `<location>file://${xmlEscape(track.path)}</location>` : ''}${track.title ? `<title>${xmlEscape(track.title)}</title>` : ''}${track.artist ? `<creator>${xmlEscape(track.artist)}</creator>` : ''}${track.album ? `<album>${xmlEscape(track.album)}</album>` : ''}${track.durationMs === undefined ? '' : `<duration>${track.durationMs}</duration>`}</track>`).join('')}</trackList></playlist>`;
};
