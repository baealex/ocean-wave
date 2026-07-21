export type OfflineDownloadStatus = 'downloading' | 'complete' | 'failed';
export interface OfflinePlaylistState { playlistId: string; status: OfflineDownloadStatus; completed: number; total: number; message?: string }
const STORAGE_KEY = 'ocean-wave:offline-playlists:v1';

export const readOfflinePlaylists = (storage: Pick<Storage, 'getItem'> = localStorage): OfflinePlaylistState[] => {
    try { const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
};
export const writeOfflinePlaylists = (states: OfflinePlaylistState[], storage: Pick<Storage, 'setItem'> = localStorage) => storage.setItem(STORAGE_KEY, JSON.stringify(states));
export const updateOfflinePlaylist = (states: OfflinePlaylistState[], next: OfflinePlaylistState) => [...states.filter(item => item.playlistId !== next.playlistId), next];
export const removeOfflinePlaylist = (states: OfflinePlaylistState[], playlistId: string) => states.filter(item => item.playlistId !== playlistId);
