import type { Music } from '~/models';

import { musicFieldResolvers } from './music.field.resolver';

describe('music field resolvers', () => {
    it('serializes playback signal dates as ISO strings with safe nulls', () => {
        const resolvers = musicFieldResolvers as {
            lastPlayedAt: (music: Pick<Music, 'lastPlayedAt'>) => string | null;
            lastSkippedAt: (music: Pick<Music, 'lastSkippedAt'>) => string | null;
            lastCompletedAt: (
                music: Pick<Music, 'lastCompletedAt'>
            ) => string | null;
        };
        const playedAt = new Date('2026-07-21T00:00:01.000Z');
        const completedAt = new Date('2026-07-21T00:03:00.000Z');

        expect(resolvers.lastPlayedAt({ lastPlayedAt: playedAt })).toBe(
            playedAt.toISOString()
        );
        expect(resolvers.lastSkippedAt({ lastSkippedAt: null })).toBeNull();
        expect(resolvers.lastCompletedAt({
            lastCompletedAt: completedAt
        })).toBe(completedAt.toISOString());
    });
});
