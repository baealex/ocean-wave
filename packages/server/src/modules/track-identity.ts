export const TRACK_SYNC_STATUS = {
    active: 'active',
    missing: 'missing',
    duplicate: 'duplicate'
} as const;

export type TrackSyncStatus = typeof TRACK_SYNC_STATUS[keyof typeof TRACK_SYNC_STATUS];

export interface TrackIdentityRecord {
    id: number;
    releaseTrackId?: number;
    filePath: string;
    contentHash: string | null;
    isExplicitlyActivated: boolean;
    lastSeenAt: Date | null;
    missingSinceAt: Date | null;
    syncStatus: TrackSyncStatus;
}

export interface TrackIdentityCandidate {
    filePath: string;
    contentHash: string | null;
}

export type TrackIdentityMatch =
    | { kind: 'path-match'; record: TrackIdentityRecord }
    | { kind: 'moved'; record: TrackIdentityRecord }
    | { kind: 'duplicate'; record: TrackIdentityRecord }
    | { kind: 'new' };

export interface TrackPresenceUpdate {
    id: number;
    lastSeenAt: Date | null;
    missingSinceAt: Date | null;
    syncStatus: TrackSyncStatus;
}

const sortByLowestId = (records: TrackIdentityRecord[]) => {
    return [...records].sort((left, right) => left.id - right.id);
};

export const resolveVisibleTrackSyncStatus = (
    records: TrackIdentityRecord[],
    record: TrackIdentityRecord,
    visiblePaths: Set<string>
) => {
    if (!record.contentHash) {
        return TRACK_SYNC_STATUS.active;
    }

    const visibleHashMatches = records.filter((candidate) => {
        return candidate.contentHash === record.contentHash && visiblePaths.has(candidate.filePath);
    });

    if (record.isExplicitlyActivated) {
        return TRACK_SYNC_STATUS.active;
    }

    if (visibleHashMatches.length <= 1) {
        return TRACK_SYNC_STATUS.active;
    }

    const primaryVisibleId = sortByLowestId(visibleHashMatches)[0].id;

    return record.id === primaryVisibleId
        ? TRACK_SYNC_STATUS.active
        : TRACK_SYNC_STATUS.duplicate;
};

export const classifyTrackIdentityCandidate = (
    records: TrackIdentityRecord[],
    candidate: TrackIdentityCandidate,
    visiblePaths: Set<string>
): TrackIdentityMatch => {
    const pathMatch = records.find((record) => record.filePath === candidate.filePath);

    if (pathMatch) {
        return {
            kind: 'path-match',
            record: pathMatch
        };
    }

    if (!candidate.contentHash) {
        return { kind: 'new' };
    }

    const hashMatches = sortByLowestId(records.filter((record) => record.contentHash === candidate.contentHash));

    if (hashMatches.length === 0) {
        return { kind: 'new' };
    }

    const movedMatch = hashMatches.find((record) => !visiblePaths.has(record.filePath));

    if (movedMatch) {
        return {
            kind: 'moved',
            record: movedMatch
        };
    }

    return {
        kind: 'duplicate',
        record: hashMatches[0]
    };
};

export const deriveTrackPresenceUpdates = (
    records: TrackIdentityRecord[],
    visiblePaths: Set<string>,
    observedAt: Date
) => {
    return records.flatMap<TrackPresenceUpdate>((record) => {
        if (visiblePaths.has(record.filePath)) {
            return [{
                id: record.id,
                lastSeenAt: observedAt,
                missingSinceAt: null,
                syncStatus: resolveVisibleTrackSyncStatus(records, record, visiblePaths)
            }];
        }

        if (record.syncStatus === TRACK_SYNC_STATUS.missing) {
            return [];
        }

        return [{
            id: record.id,
            lastSeenAt: record.lastSeenAt,
            missingSinceAt: record.missingSinceAt ?? observedAt,
            syncStatus: TRACK_SYNC_STATUS.missing
        }];
    });
};
