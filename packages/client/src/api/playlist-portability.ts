import axios from 'axios';

export type PlaylistFormat = 'm3u' | 'xspf' | 'json';
export interface PlaylistImportItem {
    index: number;
    source: { title?: string; artist?: string; path?: string; stableId?: string };
    status: 'matched' | 'ambiguous' | 'missing' | 'rejected';
    reason: string;
    candidates: Array<{ id: number; title?: string; artist?: string }>;
    selectedId?: number;
}
export interface PlaylistImportReport {
    id: string;
    name: string;
    mode: string;
    status?: string;
    items: PlaylistImportItem[];
}

export const previewPlaylistImport = async (file: File, mode: 'create' | 'replace' | 'merge' = 'create') => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const format: PlaylistFormat = extension === 'xspf' ? 'xspf' : extension === 'json' ? 'json' : 'm3u';
    const { data } = await axios.post<PlaylistImportReport>('/api/playlists/imports/preview', {
        format, mode, fallbackName: file.name.replace(/\.(m3u8?|xspf|json)$/i, ''), content: await file.text()
    });
    return data;
};

export const updatePlaylistImportMappings = async (id: string, mappings: Array<{ index: number; musicId?: number; skip?: boolean }>) => {
    const { data } = await axios.patch<PlaylistImportReport>(`/api/playlists/imports/${id}/mappings`, { mappings });
    return data;
};

export const applyPlaylistImport = async (id: string) => {
    const { data } = await axios.post<{ playlistId: number; matched: number; unresolved: number }>(`/api/playlists/imports/${id}/apply`, {});
    return data;
};

export const playlistExportUrl = (id: string, format: PlaylistFormat) => `/api/playlists/${id}/export?format=${format}`;
