import { describe, expect, it } from 'vitest';
import { readOfflinePlaylists, removeOfflinePlaylist, updateOfflinePlaylist, writeOfflinePlaylists } from './offline-playlists';
describe('offline playlist state', () => {
    it('replaces progress by playlist and removes completed downloads', () => {
        const first = { playlistId: '1', status: 'downloading' as const, completed: 1, total: 2 };
        expect(updateOfflinePlaylist([first], { ...first, status: 'complete', completed: 2 })[0].status).toBe('complete');
        expect(removeOfflinePlaylist([first], '1')).toEqual([]);
    });
    it('persists valid state and tolerates corrupt storage', () => {
        let value = '';
        writeOfflinePlaylists([], { setItem: (_key, next) => { value = next; } });
        expect(value).toBe('[]');
        expect(readOfflinePlaylists({ getItem: () => '{' })).toEqual([]);
    });
});
