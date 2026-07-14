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
    recordPlayback,
    setMusicHated,
    setMusicLiked,
    updateMusicMetadata
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
            isLiked: true,
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('setMusicLiked(id: $id, isLiked: $isLiked, originClientId: $originClientId)');
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
            isHated: true,
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('setMusicHated(id: $id, isHated: $isHated, originClientId: $originClientId)');
    });

    it('records playback through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    recordPlayback: {
                        id: '7',
                        playCount: 1,
                        lastPlayedAt: '2026-04-10T10:00:15.000Z',
                        totalPlayedMs: 35_000,
                        countedAsPlay: true,
                        deduped: false
                    }
                }
            }
        });

        await recordPlayback({
            id: '7',
            playedMs: 35_000,
            completionRate: 0.5,
            startedAt: '2026-04-10T10:00:00.000Z',
            source: 'queue-track-change',
            clientSessionId: 'session-1'
        });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            input: {
                id: '7',
                playedMs: 35_000,
                completionRate: 0.5,
                startedAt: '2026-04-10T10:00:00.000Z',
                source: 'queue-track-change',
                clientSessionId: 'session-1'
            },
            originClientId: 'client-1'
        });
        expect(payload.query).toContain('recordPlayback(input: $input, originClientId: $originClientId)');
        expect(payload.query).not.toContain('session-1');
    });

    it('updates track metadata through a GraphQL input variable', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    updateMusicMetadata: {
                        id: '7',
                        name: 'Edited Track'
                    }
                }
            }
        });
        const input = {
            id: '7',
            title: 'Edited Track',
            artist: 'Edited Artist',
            album: 'Edited Album',
            albumArtist: 'Album Artist',
            publishedYear: '2026',
            trackNumber: 3,
            genres: ['Ambient', 'Electronic']
        };

        await updateMusicMetadata(input);

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            input,
            originClientId: 'client-1'
        });
        expect(payload.query).toContain(
            'updateMusicMetadata(input: $input, originClientId: $originClientId)'
        );
        expect(payload.query).not.toContain('Edited Track');
    });
});
