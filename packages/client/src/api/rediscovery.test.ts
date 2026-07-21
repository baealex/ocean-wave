import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { getLibraryRediscovery } from './rediscovery';

interface GraphqlPayload {
    operationName?: string;
    query: string;
    variables?: Record<string, unknown>;
}

describe('library rediscovery API', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('requests bounded explainable candidates through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    libraryRediscovery: {
                        dormantLiked: [],
                        eligibleMusicCount: 0,
                        fallback: [],
                        forgottenAlbums: [],
                        generatedAt: '2026-07-21T00:00:00.000Z',
                        recentlyAdded: [],
                        underplayed: []
                    }
                }
            }
        });

        await getLibraryRediscovery(6);

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;
        expect(payload.operationName).toBe('LibraryRediscovery');
        expect(payload.variables).toEqual({ limit: 6 });
        expect(payload.query).toContain('libraryRediscovery(limit: $limit)');
        expect(payload.query).toContain('reasonCodes');
        expect(payload.query).toContain('forgottenAlbums');
        expect(payload.query).not.toContain('limit: 6');
    });
});
