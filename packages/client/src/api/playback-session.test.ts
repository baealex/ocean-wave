import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

vi.mock('~/socket/socket', () => ({
    getOriginClientId: () => 'origin-client-1'
}));

import {
    fetchPlaybackSession,
    reportPlaybackState
} from './playback-session';

describe('playback session API', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('queries the authoritative playback snapshot', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: { data: { playbackSession: null } }
        });

        await fetchPlaybackSession();

        expect(post).toHaveBeenCalledWith('/graphql', expect.objectContaining({
            operationName: 'PlaybackSession'
        }));
    });

    it('reports runtime values only through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    reportPlaybackState: {
                        type: 'accepted',
                        session: {},
                        conflict: null
                    }
                }
            }
        });
        const input = {
            deviceId: 'web-tab-7',
            registrationGeneration: 3,
            registrationProof: 'proof-3',
            sequence: 3,
            claimActive: true,
            state: 'playing' as const,
            currentMusicId: '42',
            positionMs: 12_000,
            observedAt: '2026-07-14T00:00:00.000Z'
        };

        await reportPlaybackState(input);

        const payload = post.mock.calls[0]?.[1] as {
            query: string;
            variables: Record<string, unknown>;
        };

        expect(payload.variables).toEqual({
            input,
            originClientId: 'origin-client-1'
        });
        expect(payload.query).toContain('input: $input');
        expect(payload.query).not.toContain('web-tab-7');
        expect(payload.query).not.toContain('42');
    });
});
