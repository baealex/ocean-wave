import { withLibraryMetadataLock } from './library-metadata-lock';

describe('library metadata lock', () => {
    it('serializes metadata edits and scans through one process-wide queue', async () => {
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const first = withLibraryMetadataLock(async () => {
            events.push('edit-start');
            await firstGate;
            events.push('edit-end');
        });
        await Promise.resolve();
        const second = withLibraryMetadataLock(async () => {
            events.push('scan-start');
        });
        await Promise.resolve();

        expect(events).toEqual(['edit-start']);
        releaseFirst();
        await Promise.all([first, second]);
        expect(events).toEqual(['edit-start', 'edit-end', 'scan-start']);
    });
});
