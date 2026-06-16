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
    createSmartView,
    deleteSmartView,
    fetchSmartViews,
    renameSmartView
} from './smart-views';

interface GraphqlPayload {
    operationName?: string;
    query: string;
    variables?: Record<string, unknown>;
}

describe('smart view API requests', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches smart views through GraphQL', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    smartViews: {
                        totalCount: 0,
                        views: []
                    }
                }
            }
        });

        await fetchSmartViews();

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.query).toContain('query FetchSmartViews');
        expect(payload.query).toContain('smartViews');
    });

    it('creates a smart view through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    createSmartView: {
                        id: '1',
                        name: 'Night Drive'
                    }
                }
            }
        });

        await createSmartView({
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
        expect(payload.query).toContain('createSmartView(');
        expect(payload.query).not.toContain('Night Drive');
    });

    it('renames a smart view through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    renameSmartView: {
                        id: '1',
                        name: 'Bath'
                    }
                }
            }
        });

        await renameSmartView({
            id: '1',
            name: 'Bath'
        });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '1',
            name: 'Bath',
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('renameSmartView(id: $id, name: $name, originClientId: $originClientId)');
    });

    it('deletes a smart view through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    deleteSmartView: {
                        id: '1'
                    }
                }
            }
        });

        await deleteSmartView('1');

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '1',
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('deleteSmartView(id: $id, originClientId: $originClientId)');
    });
});
