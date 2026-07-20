import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    fetchPlaybackQueue,
    savePlaybackQueue
} from './playback-queue';

describe('playback queue API', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('queries the authoritative queue snapshot', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: { data: { playbackQueue: null } }
        });

        await fetchPlaybackQueue();

        expect(post).toHaveBeenCalledWith('/graphql', expect.objectContaining({
            operationName: 'PlaybackQueue'
        }));
    });

    it('bounds command recovery snapshot requests', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: { data: { playbackQueue: null } }
        });

        await fetchPlaybackQueue(5_000);

        expect(post).toHaveBeenCalledWith(
            '/graphql',
            expect.objectContaining({ operationName: 'PlaybackQueue' }),
            { timeout: 5_000 }
        );
    });

    it('sends the complete queue snapshot through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: { data: { savePlaybackQueue: {} } }
        });
        const input = {
            musicIds: ['42', '7'],
            sourceMusicIds: [],
            currentIndex: 1,
            shuffle: false,
            repeatMode: 'all' as const,
            expectedRevision: 3
        };

        await savePlaybackQueue(input);

        const payload = post.mock.calls[0]?.[1] as {
            query: string;
            variables: Record<string, unknown>;
        };

        expect(payload.variables).toEqual({ input });
        expect(payload.query).toContain('input: $input');
        expect(payload.query).not.toContain('42');
    });
});
