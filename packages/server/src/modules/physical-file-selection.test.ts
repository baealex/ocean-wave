import type { PhysicalFile } from '~/models';
import {
    selectReadablePhysicalFile,
    sortPhysicalFilesByPreference
} from './physical-file-selection';

const createFile = (
    id: number,
    overrides: Partial<PhysicalFile> = {}
): PhysicalFile => ({
    id,
    stableId: `file-${id}`,
    releaseTrackId: 1,
    filePath: `/music/${id}.mp3`,
    contentHash: null,
    hashVersion: null,
    durationMs: 180_000,
    codec: 'mp3',
    container: 'mp3',
    bitrate: 320_000,
    sampleRate: 44_100,
    fileSizeBytes: BigInt(id),
    tagSnapshotJson: null,
    tagSnapshotVersion: null,
    legacyMetadataOverride: null,
    preferenceRank: null,
    isExplicitlyActivated: false,
    metadataRevision: 0,
    lastSeenAt: null,
    missingSinceAt: null,
    syncStatus: 'active',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides
});

describe('physical file selection', () => {
    it('uses manual preference before deterministic quality fallback', () => {
        const preferredMp3 = createFile(2, { preferenceRank: 0 });
        const lossless = createFile(1, {
            codec: 'flac',
            container: 'flac',
            bitrate: 900_000,
            sampleRate: 96_000
        });

        expect(sortPhysicalFilesByPreference([lossless, preferredMp3]).map(file => file.id))
            .toEqual([2, 1]);
        expect(sortPhysicalFilesByPreference([
            lossless,
            { ...preferredMp3, preferenceRank: null }
        ]).map(file => file.id)).toEqual([1, 2]);
    });

    it('keeps a missing preference stored while selecting the next readable active file', () => {
        const missingPreferred = createFile(1, {
            preferenceRank: 0,
            syncStatus: 'missing'
        });
        const unreadableLossless = createFile(2, { codec: 'flac' });
        const readableFallback = createFile(3, { bitrate: 256_000 });

        expect(selectReadablePhysicalFile(
            [missingPreferred, unreadableLossless, readableFallback],
            file => file.id === readableFallback.id
        )?.id).toBe(readableFallback.id);
        expect(missingPreferred.preferenceRank).toBe(0);
    });

    it('uses id as the final stable tie-breaker', () => {
        expect(sortPhysicalFilesByPreference([
            createFile(9, { fileSizeBytes: 100n }),
            createFile(4, { fileSizeBytes: 100n })
        ]).map(file => file.id)).toEqual([4, 9]);
    });
});
