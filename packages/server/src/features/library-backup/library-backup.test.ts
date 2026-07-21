import { parseLibraryBackup } from './library-backup';

const emptyBackup = { version: 1, manifestId: 'backup-1', createdAt: '2026-07-22T00:00:00.000Z', playlists: [], recordingStates: [], tags: [], smartViews: [], playbackEvents: [] };

describe('library backups', () => {
    it('accepts the current version without mutating the source', () => {
        const content = JSON.stringify(emptyBackup);
        expect(parseLibraryBackup(content)).toEqual(emptyBackup);
        expect(content).toBe(JSON.stringify(emptyBackup));
    });
    it('rejects future versions explicitly', () => {
        expect(() => parseLibraryBackup(JSON.stringify({ ...emptyBackup, version: 2 }))).toThrow('not supported');
    });
});
