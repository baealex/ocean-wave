import { describe, expect, it } from 'vitest';

import {
    GENERAL_PLAYBACK_QUEUE_CONTEXT,
    normalizePlaybackQueueContext
} from './playback-queue-context';

describe('normalizePlaybackQueueContext', () => {
    it('keeps a bounded collection origin', () => {
        expect(normalizePlaybackQueueContext({
            type: 'playlist',
            id: '42',
            title: '  Night Drive  '
        })).toEqual({
            type: 'playlist',
            id: '42',
            title: 'Night Drive'
        });
    });

    it('turns malformed or general persisted values into a plain queue', () => {
        expect(normalizePlaybackQueueContext({
            type: 'album',
            id: '../album',
            title: 'Unsafe id'
        })).toEqual(GENERAL_PLAYBACK_QUEUE_CONTEXT);
        expect(normalizePlaybackQueueContext({
            type: 'queue',
            id: '42',
            title: 'Unexpected collection'
        })).toEqual(GENERAL_PLAYBACK_QUEUE_CONTEXT);
        expect(normalizePlaybackQueueContext(null)).toEqual(
            GENERAL_PLAYBACK_QUEUE_CONTEXT
        );
    });
});
