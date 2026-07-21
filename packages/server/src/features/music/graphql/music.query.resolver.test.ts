import { createLibraryRediscoveryQueryResolver } from './music.query.resolver';

describe('music query resolvers', () => {
    it('passes the bounded result limit to the rediscovery service', async () => {
        const result = {
            dormantLiked: [],
            eligibleMusicCount: 0,
            fallback: [],
            forgottenAlbums: [],
            generatedAt: '2026-07-21T00:00:00.000Z',
            metrics: {
                candidatePoolSize: 0,
                logicalQueryCount: 8,
                sourcePoolLimit: 48
            },
            recentlyAdded: [],
            underplayed: []
        };
        const read = jest.fn().mockResolvedValue(result);
        const resolver = createLibraryRediscoveryQueryResolver(read);

        await expect(resolver(null, { limit: 6 })).resolves.toBe(result);
        expect(read).toHaveBeenCalledWith({ limit: 6 });
    });

    it('uses service defaults when a limit is omitted', async () => {
        const read = jest.fn().mockResolvedValue({});
        const resolver = createLibraryRediscoveryQueryResolver(read);

        await resolver(null);

        expect(read).toHaveBeenCalledWith({ limit: undefined });
    });
});
