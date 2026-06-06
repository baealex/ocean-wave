import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const {
    addMusicToPlaylistMock,
    createPlaylistMock,
    deletePlaylistMock,
    moveMusicToPlaylistMock,
    offMock,
    onMock,
    removeMusicFromPlaylistMock,
    renamePlaylistMock,
    reorderPlaylistMusicsMock,
    reorderPlaylistsMock,
    socketMock,
    toastErrorMock
} = vi.hoisted(() => {
    const socketMock = {
        id: 'client-1',
        on: vi.fn(),
        off: vi.fn()
    };

    return {
        addMusicToPlaylistMock: vi.fn(),
        createPlaylistMock: vi.fn(),
        deletePlaylistMock: vi.fn(),
        moveMusicToPlaylistMock: vi.fn(),
        offMock: socketMock.off,
        onMock: socketMock.on,
        removeMusicFromPlaylistMock: vi.fn(),
        renamePlaylistMock: vi.fn(),
        reorderPlaylistMusicsMock: vi.fn(),
        reorderPlaylistsMock: vi.fn(),
        socketMock,
        toastErrorMock: vi.fn()
    };
});

vi.mock('~/api/playlists', () => ({
    addMusicToPlaylist: addMusicToPlaylistMock,
    createPlaylist: createPlaylistMock,
    deletePlaylist: deletePlaylistMock,
    moveMusicToPlaylist: moveMusicToPlaylistMock,
    removeMusicFromPlaylist: removeMusicFromPlaylistMock,
    renamePlaylist: renamePlaylistMock,
    reorderPlaylistMusics: reorderPlaylistMusicsMock,
    reorderPlaylists: reorderPlaylistsMock
}));

vi.mock('~/modules/toast', () => ({
    toast: {
        error: toastErrorMock
    }
}));

vi.mock('./socket', () => ({
    socket: socketMock,
    isOwnRealtimeNotification: (payload?: { originClientId?: string | null }) => {
        return Boolean(payload?.originClientId && payload.originClientId === socketMock.id);
    }
}));

import {
    PLAYLIST_CREATE,
    PLAYLIST_DELETE,
    PlaylistListener
} from './playlist-listener';

const createHandler = () => ({
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onUpdate: vi.fn(),
    onChangeOrder: vi.fn(),
    onAddMusic: vi.fn(),
    onMoveMusic: vi.fn(),
    onRemoveMusic: vi.fn(),
    onChangeMusicOrder: vi.fn()
});

const playlist = {
    id: 'playlist-1',
    name: 'Road',
    musics: [],
    musicCount: 0,
    headerMusics: [],
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z'
};

describe('PlaylistListener', () => {
    beforeEach(() => {
        socketMock.id = 'client-1';
        onMock.mockReset();
        offMock.mockReset();
        addMusicToPlaylistMock.mockReset();
        createPlaylistMock.mockReset();
        deletePlaylistMock.mockReset();
        moveMusicToPlaylistMock.mockReset();
        removeMusicFromPlaylistMock.mockReset();
        renamePlaylistMock.mockReset();
        reorderPlaylistMusicsMock.mockReset();
        reorderPlaylistsMock.mockReset();
        toastErrorMock.mockReset();
    });

    it('applies create mutation responses to connected handlers', async () => {
        const handler = createHandler();
        const listener = new PlaylistListener();
        createPlaylistMock.mockResolvedValue({
            type: 'success',
            createPlaylist: playlist
        });

        listener.connect(handler);

        PlaylistListener.create('Road', ['track-1']);

        await vi.waitFor(() => {
            expect(handler.onCreate).toHaveBeenCalledWith(playlist);
        });
        expect(createPlaylistMock).toHaveBeenCalledWith({
            name: 'Road',
            musicIds: ['track-1']
        });
        listener.disconnect();
    });

    it('ignores realtime playlist notifications from the same socket client', () => {
        const handler = createHandler();
        const listener = new PlaylistListener();

        listener.connect(handler);

        const deleteHandler = onMock.mock.calls.find(([event]) => event === PLAYLIST_DELETE)?.[1] as (
            payload: { id: string; originClientId?: string }
        ) => void;

        deleteHandler({
            id: 'playlist-1',
            originClientId: 'client-1'
        });
        deleteHandler({
            id: 'playlist-1',
            originClientId: 'client-2'
        });

        expect(handler.onDelete).toHaveBeenCalledTimes(1);
        expect(handler.onDelete).toHaveBeenCalledWith({
            id: 'playlist-1',
            originClientId: 'client-2'
        });
        listener.disconnect();
    });

    it('unsubscribes with the wrapped realtime handlers', () => {
        const handler = createHandler();
        const listener = new PlaylistListener();

        listener.connect(handler);

        const createSocketHandler = onMock.mock.calls.find(([event]) => event === PLAYLIST_CREATE)?.[1];
        const deleteSocketHandler = onMock.mock.calls.find(([event]) => event === PLAYLIST_DELETE)?.[1];

        listener.disconnect();

        expect(offMock).toHaveBeenCalledWith(PLAYLIST_CREATE, createSocketHandler);
        expect(offMock).toHaveBeenCalledWith(PLAYLIST_DELETE, deleteSocketHandler);
    });

    it('shows mutation errors without applying playlist state', async () => {
        const handler = createHandler();
        const listener = new PlaylistListener();
        createPlaylistMock.mockResolvedValue({
            type: 'error',
            category: 'graphql',
            errors: [{
                code: 'PLAYLIST_DUPLICATE_NAME',
                message: 'Playlist name already exists.'
            }]
        });

        listener.connect(handler);

        PlaylistListener.create('Road');

        await vi.waitFor(() => {
            expect(toastErrorMock).toHaveBeenCalledWith('Playlist name already exists.');
        });
        expect(handler.onCreate).not.toHaveBeenCalled();
        listener.disconnect();
    });
});
