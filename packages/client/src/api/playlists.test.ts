import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    addMusicToPlaylist,
    createPlaylist,
    moveMusicToPlaylist,
    reorderPlaylistMusics,
    reorderPlaylists
} from './playlists';

interface GraphqlPayload {
    query: string;
    variables?: Record<string, unknown>;
}

describe('playlist API requests', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('creates a playlist through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    createPlaylist: {
                        id: '1',
                        name: 'Road',
                        musicCount: 1,
                        headerMusics: [{ id: '7' }],
                        createdAt: '',
                        updatedAt: ''
                    }
                }
            }
        });

        await createPlaylist({ name: 'Road', musicIds: ['7'] });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            name: 'Road',
            musicIds: ['7']
        });
        expect(payload.query).toContain('createPlaylist(name: $name, musicIds: $musicIds)');
        expect(payload.query).not.toContain('Road');
    });

    it('adds music to a playlist through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    addMusicToPlaylist: {
                        id: '1',
                        musicIds: ['7'],
                        musicCount: 1,
                        headerMusics: [{ id: '7' }]
                    }
                }
            }
        });

        await addMusicToPlaylist({ id: '1', musicIds: ['7'] });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            id: '1',
            musicIds: ['7']
        });
        expect(payload.query).toContain('addMusicToPlaylist(id: $id, musicIds: $musicIds)');
    });

    it('moves music between playlists through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    moveMusicToPlaylist: {
                        fromId: '1',
                        formHeaderMusics: [],
                        toId: '2',
                        toMusicCount: 1,
                        toHeaderMusics: [{ id: '7' }],
                        musicIds: ['7']
                    }
                }
            }
        });

        await moveMusicToPlaylist({ fromId: '1', toId: '2', musicIds: ['7'] });

        const payload = post.mock.calls[0]?.[1] as GraphqlPayload;

        expect(payload.variables).toEqual({
            fromId: '1',
            toId: '2',
            musicIds: ['7']
        });
        expect(payload.query).toContain('moveMusicToPlaylist(fromId: $fromId, toId: $toId, musicIds: $musicIds)');
    });

    it('reorders playlists and playlist music through GraphQL variables', async () => {
        const post = vi.spyOn(axios, 'post')
            .mockResolvedValueOnce({
                data: {
                    data: {
                        reorderPlaylists: { ids: ['2', '1'] }
                    }
                }
            })
            .mockResolvedValueOnce({
                data: {
                    data: {
                        reorderPlaylistMusics: {
                            id: '1',
                            musicIds: ['8', '7'],
                            headerMusics: [{ id: '8' }]
                        }
                    }
                }
            });

        await reorderPlaylists(['2', '1']);
        await reorderPlaylistMusics({ id: '1', musicIds: ['8', '7'] });

        expect((post.mock.calls[0]?.[1] as GraphqlPayload).variables).toEqual({ ids: ['2', '1'] });
        expect((post.mock.calls[1]?.[1] as GraphqlPayload).variables).toEqual({
            id: '1',
            musicIds: ['8', '7']
        });
    });
});
