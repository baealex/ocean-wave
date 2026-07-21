import {
    TRACK_SYNC_STATUS,
    classifyTrackIdentityCandidate,
    deriveTrackPresenceUpdates,
    resolveVisibleTrackSyncStatus,
    type TrackIdentityRecord
} from './track-identity';

const createRecord = (overrides?: Partial<TrackIdentityRecord>): TrackIdentityRecord => {
    return {
        id: overrides?.id ?? 1,
        releaseTrackId: overrides?.releaseTrackId,
        filePath: overrides?.filePath ?? 'library/track-a.mp3',
        contentHash: overrides?.contentHash ?? 'hash-a',
        isExplicitlyActivated: overrides?.isExplicitlyActivated ?? false,
        lastSeenAt: overrides?.lastSeenAt ?? null,
        missingSinceAt: overrides?.missingSinceAt ?? null,
        syncStatus: overrides?.syncStatus ?? TRACK_SYNC_STATUS.active
    };
};

describe('track identity', () => {
    it('classifies an exact file path as a path match before looking at hashes', () => {
        const record = createRecord({
            filePath: 'library/exact.mp3',
            contentHash: null
        });

        expect(classifyTrackIdentityCandidate(
            [record],
            {
                filePath: 'library/exact.mp3',
                contentHash: 'new-hash'
            },
            new Set(['library/exact.mp3'])
        )).toEqual({
            kind: 'path-match',
            record
        });
    });

    it('classifies a new path with a missing old hash match as a moved track', () => {
        const record = createRecord({
            id: 7,
            filePath: 'old/location.mp3',
            contentHash: 'same-hash'
        });

        expect(classifyTrackIdentityCandidate(
            [record],
            {
                filePath: 'new/location.mp3',
                contentHash: 'same-hash'
            },
            new Set(['new/location.mp3'])
        )).toEqual({
            kind: 'moved',
            record
        });
    });

    it('classifies a new path with an existing visible hash match as a duplicate', () => {
        const record = createRecord({
            id: 9,
            filePath: 'library/original.mp3',
            contentHash: 'same-hash'
        });

        expect(classifyTrackIdentityCandidate(
            [record],
            {
                filePath: 'library/copy.mp3',
                contentHash: 'same-hash'
            },
            new Set(['library/original.mp3', 'library/copy.mp3'])
        )).toEqual({
            kind: 'duplicate',
            record
        });
    });

    it('classifies a candidate with no known hash match as a new track', () => {
        expect(classifyTrackIdentityCandidate(
            [createRecord()],
            {
                filePath: 'library/new.mp3',
                contentHash: 'hash-new'
            },
            new Set(['library/new.mp3'])
        )).toEqual({ kind: 'new' });
    });

    it('marks unseen active tracks as missing and preserves the first missing timestamp', () => {
        const observedAt = new Date('2026-04-09T12:00:00.000Z');
        const firstMissingAt = new Date('2026-04-08T12:00:00.000Z');

        expect(deriveTrackPresenceUpdates(
            [
                createRecord({
                    id: 1,
                    filePath: 'library/seen.mp3',
                    lastSeenAt: null
                }),
                createRecord({
                    id: 2,
                    filePath: 'library/unseen.mp3',
                    lastSeenAt: null
                }),
                createRecord({
                    id: 3,
                    filePath: 'library/already-missing.mp3',
                    syncStatus: TRACK_SYNC_STATUS.missing,
                    missingSinceAt: firstMissingAt
                })
            ],
            new Set(['library/seen.mp3']),
            observedAt
        )).toEqual([
            {
                id: 1,
                lastSeenAt: observedAt,
                missingSinceAt: null,
                syncStatus: TRACK_SYNC_STATUS.active
            },
            {
                id: 2,
                lastSeenAt: null,
                missingSinceAt: observedAt,
                syncStatus: TRACK_SYNC_STATUS.missing
            }
        ]);
    });

    it('promotes the lowest visible hash match to active and keeps later copies duplicate', () => {
        const original = createRecord({
            id: 2,
            filePath: 'library/copy-a.mp3',
            contentHash: 'same-hash',
            syncStatus: TRACK_SYNC_STATUS.duplicate
        });
        const laterCopy = createRecord({
            id: 5,
            filePath: 'library/copy-b.mp3',
            contentHash: 'same-hash',
            syncStatus: TRACK_SYNC_STATUS.duplicate
        });
        const visiblePaths = new Set([original.filePath, laterCopy.filePath]);

        expect(resolveVisibleTrackSyncStatus([original, laterCopy], original, visiblePaths)).toBe(
            TRACK_SYNC_STATUS.active
        );
        expect(resolveVisibleTrackSyncStatus([original, laterCopy], laterCopy, visiblePaths)).toBe(
            TRACK_SYNC_STATUS.duplicate
        );
    });

    it('preserves explicitly activated exact copies inside one release-track group', () => {
        const original = createRecord({
            id: 2,
            releaseTrackId: 10,
            filePath: 'library/original.flac',
            contentHash: 'same-hash',
            syncStatus: TRACK_SYNC_STATUS.active
        });
        const activatedCopy = createRecord({
            id: 5,
            releaseTrackId: 10,
            filePath: 'library/copy.flac',
            contentHash: 'same-hash',
            isExplicitlyActivated: true,
            syncStatus: TRACK_SYNC_STATUS.active
        });
        const visiblePaths = new Set([original.filePath, activatedCopy.filePath]);

        expect(resolveVisibleTrackSyncStatus(
            [original, activatedCopy],
            activatedCopy,
            visiblePaths
        )).toBe(TRACK_SYNC_STATUS.active);
    });

    it('reactivates a manually separated exact copy after it returns from missing', () => {
        const original = createRecord({
            id: 2,
            releaseTrackId: 10,
            filePath: 'library/original.flac',
            contentHash: 'same-hash'
        });
        const separatedCopy = createRecord({
            id: 5,
            releaseTrackId: 20,
            filePath: 'library/separated.flac',
            contentHash: 'same-hash',
            isExplicitlyActivated: true,
            syncStatus: TRACK_SYNC_STATUS.missing
        });
        const visiblePaths = new Set([original.filePath, separatedCopy.filePath]);

        expect(resolveVisibleTrackSyncStatus(
            [original, separatedCopy],
            separatedCopy,
            visiblePaths
        )).toBe(TRACK_SYNC_STATUS.active);
    });
});
