import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    setMusicHated,
    setMusicLiked
} from './music';

interface GraphqlPayload {
    query: string;
    variables?: Record<string, unknown>;
}

describe('music API requests', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sets liked state through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    setMusicLiked: {
                        id: '7',
                        isLiked: true
                    }
                }
            }
        });

        await setMusicLiked({ id: '7', isLiked: true });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '7',
            isLiked: true
        });
        expect(payload.query).toContain('setMusicLiked(id: $id, isLiked: $isLiked)');
        expect(payload.query).not.toContain('id: "7"');
    });

    it('sets hated state through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    setMusicHated: {
                        id: '7',
                        isHated: true
                    }
                }
            }
        });

        await setMusicHated({ id: '7', isHated: true });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '7',
            isHated: true
        });
        expect(payload.query).toContain('setMusicHated(id: $id, isHated: $isHated)');
    });
});
