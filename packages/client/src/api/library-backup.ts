import axios from 'axios';

export interface LibraryRestorePreview {
    manifestId: string;
    alreadyApplied: boolean;
    counts: { playlists: number; recordingStates: number; tags: number; smartViews: number; playbackEvents: number };
    matching: { recordings: number; playlistTracks: number; missingPlaylistTracks: number };
}

export const libraryBackupUrl = '/api/library/backup';
export const previewLibraryRestore = async (content: string) => (await axios.post<LibraryRestorePreview>('/api/library/restore/preview', { content })).data;
export const applyLibraryRestore = async (content: string, mode: 'merge' | 'replace') => (await axios.post<{ alreadyApplied: boolean }>('/api/library/restore/apply', { content, mode })).data;
