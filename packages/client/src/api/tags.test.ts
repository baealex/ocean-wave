import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    createAndAddTagToMusic,
    deleteTag,
    fetchTags,
    renameTag
} from './tags';

interface GraphqlPayload {
    operationName?: string;
    query: string;
    variables?: Record<string, unknown>;
}

describe('tag API requests', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches tags through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    allTags: {
                        totalCount: 0,
                        tags: []
                    }
                }
            }
        });

        await fetchTags({
            query: 'focus',
            limit: 20,
            offset: 10
        });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            searchFilter: { query: 'focus' },
            pagination: {
                limit: 20,
                offset: 10
            }
        });
        expect(payload.query).toContain('$searchFilter: SearchFilterInput');
        expect(payload.query).not.toContain('focus');
    });

    it('renames a tag through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    renameTag: {
                        id: '7',
                        name: 'Focus'
                    }
                }
            }
        });

        await renameTag({
            id: '7',
            name: 'Focus'
        });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '7',
            name: 'Focus'
        });
        expect(payload.query).toContain('renameTag(id: $id, name: $name)');
        expect(payload.query).not.toContain('Focus');
    });

    it('deletes a tag through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    deleteTag: {
                        id: '7',
                        affectedMusicIds: ['1'],
                        affectedSmartViewIds: []
                    }
                }
            }
        });

        await deleteTag('7');

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({ id: '7' });
        expect(payload.query).toContain('deleteTag(id: $id)');
    });

    it('adds a new tag to music through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    createAndAddTagToMusic: {
                        id: '1',
                        tags: []
                    }
                }
            }
        });

        await createAndAddTagToMusic({
            musicId: '1',
            name: 'Night Drive'
        });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            musicId: '1',
            name: 'Night Drive'
        });
        expect(payload.query).toContain('createAndAddTagToMusic(musicId: $musicId, name: $name)');
        expect(payload.query).not.toContain('Night Drive');
    });

});
