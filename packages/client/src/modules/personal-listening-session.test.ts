import { describe, expect, it } from 'vitest';

import {
    getPersonalListeningSessionReasonLabel,
    personalListeningSessionMatchesQueue
} from './personal-listening-session';

describe('personal listening session presentation', () => {
    it('uses the most useful relationship reason instead of exposing codes', () => {
        expect(getPersonalListeningSessionReasonLabel([
            'SAME_ARTIST',
            'SHARED_TAG',
            'SHARED_SMART_VIEW'
        ])).toBe('Matches the same View');
        expect(getPersonalListeningSessionReasonLabel(['START_TRACK']))
            .toBe('Session start');
    });

    it('shows reasons only while they still describe the exact queue revision', () => {
        const items = [
            { musicId: '1', reasonCodes: ['START_TRACK' as const] },
            { musicId: '2', reasonCodes: ['SHARED_TAG' as const] }
        ];

        expect(personalListeningSessionMatchesQueue({
            items,
            musicIds: ['1', '2'],
            queueRevision: 4,
            revision: 4
        })).toBe(true);
        expect(personalListeningSessionMatchesQueue({
            items,
            musicIds: ['2', '1'],
            queueRevision: 4,
            revision: 4
        })).toBe(false);
        expect(personalListeningSessionMatchesQueue({
            items,
            musicIds: ['1', '2'],
            queueRevision: 4,
            revision: 5
        })).toBe(false);
    });
});
