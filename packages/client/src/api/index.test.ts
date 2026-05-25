import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { graphQLRequest } from './graphql';
import { getArtist } from './library';

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
});
