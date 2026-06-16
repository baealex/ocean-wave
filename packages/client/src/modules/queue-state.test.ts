import { describe, expect, it } from 'vitest';

import {
    deriveQueueState,
    deriveQueueStateFromTrack,
    getSafeResumeTime,
    moveQueueItemToIndex,
    reorderQueueItems,
    restoreQueueState
} from './queue-state';

describe('queue-state', () => {
    it('derives the current track id and queue length from a valid selection', () => {
        expect(deriveQueueState(['a', 'b', 'c'], 1)).toEqual({
            selected: 1,
            currentTrackId: 'b',
            queueLength: 3
        });
    });

    it('preserves the selected track when the queue shape changes', () => {
        expect(deriveQueueStateFromTrack(['x', 'a', 'b'], 'a')).toEqual({
            selected: 1,
            currentTrackId: 'a',
            queueLength: 3
        });
    });

    it('clears selection when the selected track disappears from the queue', () => {
        expect(deriveQueueStateFromTrack(['a', 'c'], 'b')).toEqual({
            selected: null,
            currentTrackId: null,
            queueLength: 2
        });
    });

    it('reorders queue items by id', () => {
        expect(reorderQueueItems(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual([
            'a',
            'd',
            'b',
            'c'
        ]);
    });

    it('moves a queue item to an explicit index', () => {
        expect(moveQueueItemToIndex(['a', 'b', 'c', 'd'], 'a', 2)).toEqual([
            'b',
            'c',
            'a',
            'd'
        ]);
    });

    it('restores a persisted queue around the selected track and prunes missing songs', () => {
        expect(restoreQueueState({
            items: ['missing', 'a', 'b'],
            sourceItems: ['b', 'missing', 'a'],
            selected: 2,
            currentTrackId: 'b',
            currentTime: 42
        }, id => id !== 'missing', id => id === 'b' ? 120 : 60)).toEqual({
            items: ['a', 'b'],
            sourceItems: ['b', 'a'],
            selected: 1,
            currentTrackId: 'b',
            queueLength: 2,
            currentTime: 42,
            progress: 0
        });
    });

    it('clears invalid persisted selection safely', () => {
        expect(restoreQueueState({
            items: ['a'],
            selected: 4,
            currentTime: 12
        }, () => true, () => 60)).toEqual({
            items: ['a'],
            sourceItems: [],
            selected: null,
            currentTrackId: null,
            queueLength: 1,
            currentTime: 0,
            progress: 0
        });
    });

    it('does not select a different song when the persisted current track disappeared', () => {
        expect(restoreQueueState({
            items: ['a', 'b'],
            selected: 1,
            currentTrackId: 'missing',
            currentTime: 12
        }, id => id !== 'missing', () => 60)).toEqual({
            items: ['a', 'b'],
            sourceItems: [],
            selected: null,
            currentTrackId: null,
            queueLength: 2,
            currentTime: 0,
            progress: 0
        });
    });

    it('does not resume too close to the end of a track', () => {
        expect(getSafeResumeTime(118, 120)).toBe(0);
        expect(getSafeResumeTime(60, 120)).toBe(60);
    });
});
