import type { GraphQueryErrorResponse } from '~/api/graphql';
import {
    addMusicToPlaylist,
    createPlaylist,
    deletePlaylist,
    moveMusicToPlaylist,
    removeMusicFromPlaylist,
    renamePlaylist,
    reorderPlaylistMusics,
    reorderPlaylists
} from '~/api/playlists';
import { toast } from '~/modules/toast';
import type { Music, Playlist } from '../models/type';
import type { Listener } from './listener';
import {
    isOwnRealtimeNotification,
    type OriginClientNotificationPayload,
    socket
} from './socket';

export const PLAYLIST_CREATE = 'playlist:created';
export const PLAYLIST_DELETE = 'playlist:deleted';
export const PLAYLIST_UPDATE = 'playlist:renamed';
export const PLAYLIST_CHANGE_ORDER = 'playlist:order-updated';
export const PLAYLIST_ADD_MUSIC = 'playlist:music-added';
export const PLAYLIST_MOVE_MUSIC = 'playlist:music-moved';
export const PLAYLIST_REMOVE_MUSIC = 'playlist:music-removed';
export const PLAYLIST_CHANGE_MUSIC_ORDER = 'playlist:music-order-updated';

const getGraphQueryErrorMessage = (response: GraphQueryErrorResponse) => {
    return response.errors[0]?.message ?? 'Playlist update failed';
};

type OnCreateData = Playlist & OriginClientNotificationPayload;

interface OnDeleteData extends OriginClientNotificationPayload {
    id: string;
}

interface OnUpdateData extends OriginClientNotificationPayload {
    id: string;
    name: string;
}

interface OnChangeOrderData extends OriginClientNotificationPayload {
    ids: string[];
}

interface OnAddMusicData extends OriginClientNotificationPayload {
    id: string;
    musicIds: string[];
    musicCount: number;
    headerMusics: Pick<Music, 'id'>[];
}

interface OnMoveMusicData extends OriginClientNotificationPayload {
    fromId: string;
    formHeaderMusics: Pick<Music, 'id'>[];
    fromMusicCount: number;
    toId: string;
    toMusicCount: number;
    toHeaderMusics: Pick<Music, 'id'>[];
    musicIds: string[];
}

interface OnRemoveMusicData extends OriginClientNotificationPayload {
    id: string;
    musicIds: string[];
    musicCount: number;
    headerMusics: Pick<Music, 'id'>[];
}

interface OnChangeMusicOrderData extends OriginClientNotificationPayload {
    id: string;
    musicIds: string[];
    headerMusics: Pick<Music, 'id'>[];
}

interface PlaylistListenerEventHandler {
    onCreate: (playlist: OnCreateData) => void;
    onDelete: (data: OnDeleteData) => void;
    onUpdate: (data: OnUpdateData) => void;
    onChangeOrder: (data: OnChangeOrderData) => void;
    onAddMusic: (data: OnAddMusicData) => void;
    onMoveMusic: (data: OnMoveMusicData) => void;
    onRemoveMusic: (data: OnRemoveMusicData) => void;
    onChangeMusicOrder: ({ id, musicIds }: OnChangeMusicOrderData) => void;
}

export class PlaylistListener implements Listener {
    private static handlers = new Set<PlaylistListenerEventHandler>();

    handler: PlaylistListenerEventHandler | null;
    private socketHandler: PlaylistListenerEventHandler | null;

    constructor() {
        this.handler = null;
        this.socketHandler = null;
    }

    connect(handler: PlaylistListenerEventHandler) {
        if (this.handler !== null) {
            this.disconnect();
        }
        this.handler = handler;
        this.socketHandler = this.createSocketHandler(handler);
        PlaylistListener.handlers.add(handler);

        socket.on(PLAYLIST_CREATE, this.socketHandler.onCreate);
        socket.on(PLAYLIST_DELETE, this.socketHandler.onDelete);
        socket.on(PLAYLIST_UPDATE, this.socketHandler.onUpdate);
        socket.on(PLAYLIST_CHANGE_ORDER, this.socketHandler.onChangeOrder);
        socket.on(PLAYLIST_ADD_MUSIC, this.socketHandler.onAddMusic);
        socket.on(PLAYLIST_MOVE_MUSIC, this.socketHandler.onMoveMusic);
        socket.on(PLAYLIST_REMOVE_MUSIC, this.socketHandler.onRemoveMusic);
        socket.on(PLAYLIST_CHANGE_MUSIC_ORDER, this.socketHandler.onChangeMusicOrder);
    }

    static create(name: string, musics?: string[]) {
        void this.commitCreate(name, musics ?? []);
    }

    static update(id: string, name: string) {
        void this.commitUpdate(id, name);
    }

    static delete(id: string) {
        void this.commitDelete(id);
    }

    static changeOrder(ids: string[]) {
        void this.commitChangeOrder(ids);
    }

    static addMusic(id: string, musicIds: string[]) {
        void this.commitAddMusic(id, musicIds);
    }

    static moveMusic(fromId: string, toId: string, musicIds: string[]) {
        void this.commitMoveMusic(fromId, toId, musicIds);
    }

    static removeMusic(id: string, musicIds: string[]) {
        void this.commitRemoveMusic(id, musicIds);
    }

    static changeMusicOrder(id: string, musicIds: string[]) {
        void this.commitChangeMusicOrder(id, musicIds);
    }

    disconnect() {
        if (this.handler === null || this.socketHandler === null) return;

        socket.off(PLAYLIST_CREATE, this.socketHandler.onCreate);
        socket.off(PLAYLIST_DELETE, this.socketHandler.onDelete);
        socket.off(PLAYLIST_UPDATE, this.socketHandler.onUpdate);
        socket.off(PLAYLIST_CHANGE_ORDER, this.socketHandler.onChangeOrder);
        socket.off(PLAYLIST_ADD_MUSIC, this.socketHandler.onAddMusic);
        socket.off(PLAYLIST_MOVE_MUSIC, this.socketHandler.onMoveMusic);
        socket.off(PLAYLIST_REMOVE_MUSIC, this.socketHandler.onRemoveMusic);
        socket.off(PLAYLIST_CHANGE_MUSIC_ORDER, this.socketHandler.onChangeMusicOrder);
        PlaylistListener.handlers.delete(this.handler);

        this.handler = null;
        this.socketHandler = null;
    }

    private createSocketHandler(handler: PlaylistListenerEventHandler): PlaylistListenerEventHandler {
        return {
            onCreate: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onCreate(data);
                }
            },
            onDelete: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onDelete(data);
                }
            },
            onUpdate: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onUpdate(data);
                }
            },
            onChangeOrder: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onChangeOrder(data);
                }
            },
            onAddMusic: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onAddMusic(data);
                }
            },
            onMoveMusic: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onMoveMusic(data);
                }
            },
            onRemoveMusic: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onRemoveMusic(data);
                }
            },
            onChangeMusicOrder: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onChangeMusicOrder(data);
                }
            }
        };
    }

    private static handleMutationError(response: GraphQueryErrorResponse) {
        toast.error(getGraphQueryErrorMessage(response));
        return false;
    }

    private static async commitCreate(name: string, musicIds: string[]) {
        const response = await createPlaylist({ name, musicIds });

        if (response.type === 'error') {
            return this.handleMutationError(response);
        }

        this.notifyCreate(response.createPlaylist);
        return true;
    }

    private static async commitUpdate(id: string, name: string) {
        const response = await renamePlaylist({ id, name });

        if (response.type === 'error') {
            return this.handleMutationError(response);
        }

        this.notifyUpdate(response.renamePlaylist);
        return true;
    }

    private static async commitDelete(id: string) {
        const response = await deletePlaylist(id);

        if (response.type === 'error') {
            return this.handleMutationError(response);
        }

        this.notifyDelete(response.deletePlaylist);
        return true;
    }

    private static async commitChangeOrder(ids: string[]) {
        const response = await reorderPlaylists(ids);

        if (response.type === 'error') {
            return this.handleMutationError(response);
        }

        this.notifyChangeOrder(response.reorderPlaylists);
        return true;
    }

    private static async commitAddMusic(id: string, musicIds: string[]) {
        const response = await addMusicToPlaylist({ id, musicIds });

        if (response.type === 'error') {
            return this.handleMutationError(response);
        }

        this.notifyAddMusic(response.addMusicToPlaylist);
        return true;
    }

    private static async commitMoveMusic(fromId: string, toId: string, musicIds: string[]) {
        const response = await moveMusicToPlaylist({ fromId, toId, musicIds });

        if (response.type === 'error') {
            return this.handleMutationError(response);
        }

        this.notifyMoveMusic(response.moveMusicToPlaylist);
        return true;
    }

    private static async commitRemoveMusic(id: string, musicIds: string[]) {
        const response = await removeMusicFromPlaylist({ id, musicIds });

        if (response.type === 'error') {
            return this.handleMutationError(response);
        }

        this.notifyRemoveMusic(response.removeMusicFromPlaylist);
        return true;
    }

    private static async commitChangeMusicOrder(id: string, musicIds: string[]) {
        const response = await reorderPlaylistMusics({ id, musicIds });

        if (response.type === 'error') {
            return this.handleMutationError(response);
        }

        this.notifyChangeMusicOrder(response.reorderPlaylistMusics);
        return true;
    }

    private static notifyCreate(data: OnCreateData) {
        for (const handler of this.handlers) {
            handler.onCreate(data);
        }
    }

    private static notifyDelete(data: OnDeleteData) {
        for (const handler of this.handlers) {
            handler.onDelete(data);
        }
    }

    private static notifyUpdate(data: OnUpdateData) {
        for (const handler of this.handlers) {
            handler.onUpdate(data);
        }
    }

    private static notifyChangeOrder(data: OnChangeOrderData) {
        for (const handler of this.handlers) {
            handler.onChangeOrder(data);
        }
    }

    private static notifyAddMusic(data: OnAddMusicData) {
        for (const handler of this.handlers) {
            handler.onAddMusic(data);
        }
    }

    private static notifyMoveMusic(data: OnMoveMusicData) {
        for (const handler of this.handlers) {
            handler.onMoveMusic(data);
        }
    }

    private static notifyRemoveMusic(data: OnRemoveMusicData) {
        for (const handler of this.handlers) {
            handler.onRemoveMusic(data);
        }
    }

    private static notifyChangeMusicOrder(data: OnChangeMusicOrderData) {
        for (const handler of this.handlers) {
            handler.onChangeMusicOrder(data);
        }
    }
}
