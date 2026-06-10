import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const socketState = vi.hoisted(() => ({
    id: 'client-1'
}));

vi.mock('~/socket/socket', () => ({
    getOriginClientId: () => socketState.id
}));

import {
    createTagView,
    deleteTagView,
    fetchTagViews,
    renameTagView
} from './tag-views';

interface GraphqlPayload {
    operationName?: string;
    query: string;
    variables?: Record<string, unknown>;
}

describe('tag view API requests', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches tag views through GraphQL', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    tagViews: {
                        totalCount: 0,
                        views: []
                    }
                }
            }
        });

        await fetchTagViews();

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.query).toContain('query FetchTagViews');
        expect(payload.query).toContain('tagViews');
    });

    it('creates a tag view through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    createTagView: {
                        id: '1',
                        name: 'Night Drive'
                    }
                }
            }
        });

        await createTagView({
            name: 'Night Drive',
            tagIds: ['1', '2'],
            tagMode: 'all'
        });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            name: 'Night Drive',
            tagIds: ['1', '2'],
            tagMode: 'all',
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('createTagView(');
        expect(payload.query).not.toContain('Night Drive');
    });

    it('renames a tag view through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    renameTagView: {
                        id: '1',
                        name: 'Bath'
                    }
                }
            }
        });

        await renameTagView({
            id: '1',
            name: 'Bath'
        });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '1',
            name: 'Bath',
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('renameTagView(id: $id, name: $name, originClientId: $originClientId)');
    });

    it('deletes a tag view through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    deleteTagView: {
                        id: '1'
                    }
                }
            }
        });

        await deleteTagView('1');

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '1',
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('deleteTagView(id: $id, originClientId: $originClientId)');
    });
});
