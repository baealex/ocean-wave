import { socket } from './socket';
import type { Listener } from './listener';

import type { Music, Playlist } from '../models/type';

export const PLAYLIST_CREATE = 'playlist-create';
export const PLAYLIST_DELETE = 'playlist-delete';
export const PLAYLIST_UPDATE = 'playlist-update';
export const PLAYLIST_CHANGE_ORDER = 'playlist-change-order';
export const PLAYLIST_ADD_MUSIC = 'playlist-add-music';
export const PLAYLIST_MOVE_MUSIC = 'playlist-move-music';
export const PLAYLIST_REMOVE_MUSIC = 'playlist-remove-music';
export const PLAYLIST_CHANGE_MUSIC_ORDER = 'playlist-change-music-order';

interface OnUpdateData {
    id: string;
    name: string;
}

interface OnAddMusicData {
    id: string;
    musicIds: string[];
    musicCount: number;
    headerMusics: Pick<Music, 'id'>[];
}

interface OnMoveMusicData {
    fromId: string;
    formHeaderMusics: Pick<Music, 'id'>[];
    toId: string;
    toMusicCount: number;
    toHeaderMusics: Pick<Music, 'id'>[];
    musicIds: string[];
}

interface OnRemoveMusicData {
    id: string;
    musicIds: string[];
    headerMusics: Pick<Music, 'id'>[];
}

interface OnChangeMusicOrderData {
    id: string;
    musicIds: string[];
    headerMusics: Pick<Music, 'id'>[];
}

interface PlaylistListenerEventHandler {
    onCreate: (playlist: Playlist) => void;
    onDelete: (id: string) => void;
    onUpdate: (data: OnUpdateData) => void;
    onChangeOrder: (ids: string[]) => void;
    onAddMusic: (data: OnAddMusicData) => void;
    onMoveMusic: (data: OnMoveMusicData) => void;
    onRemoveMusic: (data: OnRemoveMusicData) => void;
    onChangeMusicOrder: ({ id, musicIds }: OnChangeMusicOrderData) => void;
}

export class PlaylistListener implements Listener {
    handler: PlaylistListenerEventHandler | null;

    constructor() {
        this.handler = null;
    }

    connect(handler: PlaylistListenerEventHandler) {
        if (this.handler !== null) {
            this.disconnect();
        }
        this.handler = handler;

        socket.on(PLAYLIST_CREATE, this.handler.onCreate);
        socket.on(PLAYLIST_DELETE, this.handler.onDelete);
        socket.on(PLAYLIST_UPDATE, this.handler.onUpdate);
        socket.on(PLAYLIST_CHANGE_ORDER, this.handler.onChangeOrder);
        socket.on(PLAYLIST_ADD_MUSIC, this.handler.onAddMusic);
        socket.on(PLAYLIST_MOVE_MUSIC, this.handler.onMoveMusic);
        socket.on(PLAYLIST_REMOVE_MUSIC, this.handler.onRemoveMusic);
        socket.on(PLAYLIST_CHANGE_MUSIC_ORDER, this.handler.onChangeMusicOrder);
    }

    static create(name: string, musics?: string[]) {
        socket.emit(PLAYLIST_CREATE, { name, musics });
    }

    static update(id: string, name: string) {
        socket.emit(PLAYLIST_UPDATE, {
            id,
            name
        });
    }

    static delete(id: string) {
        socket.emit(PLAYLIST_DELETE, { id });
    }

    static changeOrder(ids: string[]) {
        socket.emit(PLAYLIST_CHANGE_ORDER, { ids });
    }

    static addMusic(id: string, musicIds: string[]) {
        socket.emit(PLAYLIST_ADD_MUSIC, {
            id,
            musicIds
        });
    }

    static moveMusic(fromId: string, toId: string, musicIds: string[]) {
        socket.emit(PLAYLIST_MOVE_MUSIC, {
            fromId,
            toId,
            musicIds
        });
    }

    static removeMusic(id: string, musicIds: string[]) {
        socket.emit(PLAYLIST_REMOVE_MUSIC, {
            id,
            musicIds
        });
    }

    static changeMusicOrder(id: string, musicIds: string[]) {
        socket.emit(PLAYLIST_CHANGE_MUSIC_ORDER, {
            id,
            musicIds
        });
    }

    disconnect() {
        if (this.handler === null) return;

        socket.off(PLAYLIST_CREATE, this.handler.onCreate);
        socket.off(PLAYLIST_DELETE, this.handler.onDelete);
        socket.off(PLAYLIST_UPDATE, this.handler.onUpdate);
        socket.off(PLAYLIST_CHANGE_ORDER, this.handler.onChangeOrder);
        socket.off(PLAYLIST_ADD_MUSIC, this.handler.onAddMusic);
        socket.off(PLAYLIST_MOVE_MUSIC, this.handler.onMoveMusic);
        socket.off(PLAYLIST_REMOVE_MUSIC, this.handler.onRemoveMusic);
        socket.off(PLAYLIST_CHANGE_MUSIC_ORDER, this.handler.onChangeMusicOrder);

        this.handler = null;
    }
}
