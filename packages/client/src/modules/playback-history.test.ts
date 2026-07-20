import { describe, expect, it } from 'vitest';

import { mergePlaybackHistoryAggregates } from './playback-history';

describe('playback history aggregate merge', () => {
    it('does not let an older response regress realtime aggregates', () => {
        const current = {
            playCount: 5,
            lastPlayedAt: '2026-07-21T00:00:05.000Z',
            totalPlayedMs: 500_000,
            skipCount: 3,
            lastSkippedAt: '2026-07-21T00:00:04.000Z',
            completionCount: 2,
            lastCompletedAt: '2026-07-21T00:00:03.000Z'
        };
        const older = {
            playCount: 4,
            lastPlayedAt: '2026-07-21T00:00:01.000Z',
            totalPlayedMs: 400_000,
            skipCount: 2,
            lastSkippedAt: null,
            completionCount: 1,
            lastCompletedAt: '2026-07-21T00:00:02.000Z'
        };

        expect(mergePlaybackHistoryAggregates(current, older)).toEqual(current);
    });

    it('accepts independently newer counters and timestamps', () => {
        expect(mergePlaybackHistoryAggregates({
            playCount: 2,
            lastPlayedAt: null,
            totalPlayedMs: 20_000,
            skipCount: 0,
            lastSkippedAt: null,
            completionCount: 1,
            lastCompletedAt: '2026-07-21T00:00:01.000Z'
        }, {
            playCount: 3,
            lastPlayedAt: '2026-07-21T00:00:03.000Z',
            totalPlayedMs: 35_000,
            skipCount: 1,
            lastSkippedAt: '2026-07-21T00:00:02.000Z',
            completionCount: 1,
            lastCompletedAt: null
        })).toEqual({
            playCount: 3,
            lastPlayedAt: '2026-07-21T00:00:03.000Z',
            totalPlayedMs: 35_000,
            skipCount: 1,
            lastSkippedAt: '2026-07-21T00:00:02.000Z',
            completionCount: 1,
            lastCompletedAt: '2026-07-21T00:00:01.000Z'
        });
    });
});
