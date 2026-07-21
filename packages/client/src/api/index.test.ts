import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { graphQLRequest } from './graphql';
import { getArtist, getMusic, getMusics } from './library';

interface GraphqlPayload {
    operationName?: string;
    query: string;
    variables?: Record<string, unknown>;
}

describe('GraphQL API requests', () => {
    it('sends variables through the GraphQL request body', async () => {
        const request = vi.spyOn(axios, 'request').mockResolvedValue({
            data: { data: { artist: { id: '7' } } }
        });

        await getArtist('7');

        const payload = request.mock.calls[0]?.[0]?.data as GraphqlPayload;

        expect(payload.operationName).toBe('Artist');
        expect(payload.variables).toEqual({ id: '7' });
        expect(payload.query).toContain('query Artist($id: ID!)');
        expect(payload.query).toContain('artist(id: $id)');
        expect(payload.query).toContain('appearsOn');
        expect(payload.query).toContain('releaseType');
        expect(payload.query).toContain('totalDiscs');
        expect(payload.query).not.toContain('artist(id: "7")');
    });

    it('keeps operationName and variables in the typed wrapper', async () => {
        const request = vi.spyOn(axios, 'request').mockResolvedValue({
            data: { data: { item: { id: '1' } } }
        });

        await graphQLRequest<'item', { id: string }, { id: string }>({
            operationName: 'FetchItem',
            query: 'query FetchItem($id: ID!) { item(id: $id) { id } }',
            variables: { id: '1' }
        });

        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            data: {
                operationName: 'FetchItem',
                query: 'query FetchItem($id: ID!) { item(id: $id) { id } }',
                variables: { id: '1' }
            }
        }));
    });

    it('requests the playback signals needed for library rediscovery', async () => {
        const request = vi.spyOn(axios, 'request').mockResolvedValue({
            data: { data: { allMusics: [] } }
        });

        await getMusics();

        const payload = request.mock.calls[0]?.[0]?.data as GraphqlPayload;

        expect(payload.query).toContain('lastPlayedAt');
        expect(payload.query).toContain('totalPlayedMs');
        expect(payload.query).toContain('skipCount');
        expect(payload.query).toContain('lastSkippedAt');
        expect(payload.query).toContain('completionCount');
        expect(payload.query).toContain('lastCompletedAt');
        expect(payload.query).toContain('artistDisplayName');
        expect(payload.query).toContain('artistCredits');
        expect(payload.query).toContain('joinPhrase');
        expect(payload.query).toContain('discNumber');
        expect(payload.query).toContain('releaseType');
    });

    it('requests recording versions, grouped files, and conservative suggestions on detail', async () => {
        const request = vi.spyOn(axios, 'request').mockResolvedValue({
            data: { data: { music: { id: '1' } } }
        });

        await getMusic('1');

        const payload = request.mock.calls[0]?.[0]?.data as GraphqlPayload;

        expect(payload.query).toContain('recordingVersionTitle');
        expect(payload.query).toContain('releaseVersionTitle');
        expect(payload.query).toContain('files');
        expect(payload.query).toContain('isPreferred');
        expect(payload.query).toContain('isSelected');
        expect(payload.query).toContain('recordingAppearances');
        expect(payload.query).toContain('groupingCandidates');
        expect(payload.query).toContain('reasons');
    });
});
