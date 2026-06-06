import type { Tag } from '~/models/type';

import { socket } from './socket';
import type { Listener } from './listener';

export const TAG_CREATED = 'tag:created';
export const TAG_RENAMED = 'tag:renamed';
export const TAG_LIST_INVALIDATED = 'tag:list-invalidated';

export interface TagListInvalidatedPayload {
    reason: 'tag-deleted' | 'music-tags-changed';
    affectedTagIds?: string[];
    affectedMusicIds?: string[];
    affectedSmartViewIds?: string[];
}

interface TagListenerEventHandler {
    onCreated: (tag: Tag) => void;
    onRenamed: (tag: Tag) => void;
    onListInvalidated: (payload: TagListInvalidatedPayload) => void;
}

export class TagListener implements Listener {
    handler: TagListenerEventHandler | null;

    constructor() {
        this.handler = null;
    }

    connect(handler: TagListenerEventHandler) {
        if (this.handler !== null) {
            this.disconnect();
        }

        this.handler = handler;

        socket.on(TAG_CREATED, this.handler.onCreated);
        socket.on(TAG_RENAMED, this.handler.onRenamed);
        socket.on(TAG_LIST_INVALIDATED, this.handler.onListInvalidated);
    }

    disconnect() {
        if (this.handler === null) return;

        socket.off(TAG_CREATED, this.handler.onCreated);
        socket.off(TAG_RENAMED, this.handler.onRenamed);
        socket.off(TAG_LIST_INVALIDATED, this.handler.onListInvalidated);

        this.handler = null;
    }
}
