import type { Tag } from '~/models/type';
import type { Listener } from './listener';
import {
    isOwnRealtimeNotification,
    type OriginClientNotificationPayload,
    socket
} from './socket';

export const TAG_CREATED = 'tag:created';
export const TAG_RENAMED = 'tag:renamed';
export const TAG_LIST_INVALIDATED = 'tag:list-invalidated';

type TagNotificationPayload = Tag & OriginClientNotificationPayload;

export interface TagListInvalidatedPayload extends OriginClientNotificationPayload {
    reason: 'tag-deleted' | 'music-tags-changed' | 'smart-views-changed';
    affectedTagIds?: string[];
    affectedMusicIds?: string[];
    affectedSmartViewIds?: string[];
}

interface TagListenerEventHandler {
    onCreated: (tag: TagNotificationPayload) => void;
    onRenamed: (tag: TagNotificationPayload) => void;
    onListInvalidated: (payload: TagListInvalidatedPayload) => void;
}

export class TagListener implements Listener {
    handler: TagListenerEventHandler | null;
    private socketHandler: TagListenerEventHandler | null;

    constructor() {
        this.handler = null;
        this.socketHandler = null;
    }

    connect(handler: TagListenerEventHandler) {
        if (this.handler !== null) {
            this.disconnect();
        }

        this.handler = handler;
        this.socketHandler = this.createSocketHandler(handler);

        socket.on(TAG_CREATED, this.socketHandler.onCreated);
        socket.on(TAG_RENAMED, this.socketHandler.onRenamed);
        socket.on(TAG_LIST_INVALIDATED, this.socketHandler.onListInvalidated);
    }

    disconnect() {
        if (this.handler === null || this.socketHandler === null) return;

        socket.off(TAG_CREATED, this.socketHandler.onCreated);
        socket.off(TAG_RENAMED, this.socketHandler.onRenamed);
        socket.off(TAG_LIST_INVALIDATED, this.socketHandler.onListInvalidated);

        this.handler = null;
        this.socketHandler = null;
    }

    private createSocketHandler(handler: TagListenerEventHandler): TagListenerEventHandler {
        return {
            onCreated: (tag) => {
                if (!isOwnRealtimeNotification(tag)) {
                    handler.onCreated(tag);
                }
            },
            onRenamed: (tag) => {
                if (!isOwnRealtimeNotification(tag)) {
                    handler.onRenamed(tag);
                }
            },
            onListInvalidated: (payload) => {
                if (!isOwnRealtimeNotification(payload)) {
                    handler.onListInvalidated(payload);
                }
            }
        };
    }
}
