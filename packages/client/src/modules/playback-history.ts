import type { Music } from '~/models/type';

export type PlaybackHistoryAggregates = Pick<Music,
    | 'playCount'
    | 'lastPlayedAt'
    | 'totalPlayedMs'
    | 'skipCount'
    | 'lastSkippedAt'
    | 'completionCount'
    | 'lastCompletedAt'>;

const monotonicNumber = (current: number, incoming: number) => {
    return Number.isFinite(incoming)
        ? Math.max(current, incoming)
        : current;
};

const latestTimestamp = (
    current: string | null,
    incoming: string | null
) => {
    if (!incoming) {
        return current;
    }
    if (!current) {
        return incoming;
    }

    const currentMs = Date.parse(current);
    const incomingMs = Date.parse(incoming);
    if (!Number.isFinite(incomingMs)) {
        return current;
    }
    if (!Number.isFinite(currentMs)) {
        return incoming;
    }

    return incomingMs > currentMs ? incoming : current;
};

export const mergePlaybackHistoryAggregates = (
    current: PlaybackHistoryAggregates,
    incoming: PlaybackHistoryAggregates
): PlaybackHistoryAggregates => ({
    playCount: monotonicNumber(current.playCount, incoming.playCount),
    lastPlayedAt: latestTimestamp(current.lastPlayedAt, incoming.lastPlayedAt),
    totalPlayedMs: monotonicNumber(current.totalPlayedMs, incoming.totalPlayedMs),
    skipCount: monotonicNumber(current.skipCount, incoming.skipCount),
    lastSkippedAt: latestTimestamp(current.lastSkippedAt, incoming.lastSkippedAt),
    completionCount: monotonicNumber(
        current.completionCount,
        incoming.completionCount
    ),
    lastCompletedAt: latestTimestamp(
        current.lastCompletedAt,
        incoming.lastCompletedAt
    )
});
