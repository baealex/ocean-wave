import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const {
    connectedHandlers,
    getPlaylistsMock
} = vi.hoisted(() => ({
    connectedHandlers: [] as Array<Record<string, (payload: unknown) => void>>,
    getPlaylistsMock: vi.fn()
}));

vi.mock('~/api/library', () => ({
    getPlaylists: getPlaylistsMock
}));

vi.mock('~/socket', () => ({
    PlaylistListener: class PlaylistListenerMock {
        connect(handler: Record<string, (payload: unknown) => void>) {
            connectedHandlers.push(handler);
        }
    }
}));

import { playlistStore } from './playlist';

const createPlaylist = (id: string, musicCount: number) => ({
    id,
    name: `Playlist ${id}`,
    musics: [],
    musicCount,
    headerMusics: [],
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z'
});

describe('playlistStore realtime handlers', () => {
    beforeEach(() => {
        getPlaylistsMock.mockReset();
        getPlaylistsMock.mockResolvedValue({ data: { allPlaylist: [] } });
        playlistStore.init = true;
        playlistStore.state = {
            loaded: true,
            playlists: []
        };
    });

    it('keeps playlist creation notifications idempotent when origin metadata is missing', () => {
        const handler = connectedHandlers[0];
        const playlist = createPlaylist('playlist-1', 1);

        handler.onCreate(playlist);
        handler.onCreate(playlist);

        expect(playlistStore.state.playlists).toEqual([playlist]);
    });

    it('applies move and remove notifications as final count snapshots', () => {
        const handler = connectedHandlers[0];
        playlistStore.state = {
            loaded: true,
            playlists: [createPlaylist('playlist-1', 4), createPlaylist('playlist-2', 2)]
        };

        const movePayload = {
            fromId: 'playlist-1',
            formHeaderMusics: [],
            fromMusicCount: 3,
            toId: 'playlist-2',
            toMusicCount: 3,
            toHeaderMusics: [],
            musicIds: ['track-1']
        };
        const removePayload = {
            id: 'playlist-1',
            musicIds: ['track-2'],
            musicCount: 2,
            headerMusics: []
        };

        handler.onMoveMusic(movePayload);
        handler.onMoveMusic(movePayload);
        handler.onRemoveMusic(removePayload);
        handler.onRemoveMusic(removePayload);

        expect(playlistStore.state.playlists.map(({ id, musicCount }) => ({ id, musicCount }))).toEqual([
            { id: 'playlist-1', musicCount: 2 },
            { id: 'playlist-2', musicCount: 3 }
        ]);
    });
});
