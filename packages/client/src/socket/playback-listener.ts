import type { PlaybackSessionSnapshot } from '~/api/playback-session';

import type { Listener } from './listener';
import {
    isOwnRealtimeNotification,
    type OriginClientNotificationPayload,
    socket
} from './socket';

export const PLAYBACK_STATE_UPDATED = 'playback:state-updated';
export const PLAYBACK_QUEUE_INVALIDATED = 'playback:queue-invalidated';

export interface PlaybackQueueInvalidatedNotification extends OriginClientNotificationPayload {
    revision: number;
}

export type PlaybackStateUpdatedPayload = PlaybackSessionSnapshot & OriginClientNotificationPayload;

interface PlaybackListenerEventHandler {
    onStateUpdated: (payload: PlaybackStateUpdatedPayload) => void;
}

export class PlaybackListener implements Listener {
    private handler: PlaybackListenerEventHandler | null = null;
    private socketHandler: PlaybackListenerEventHandler | null = null;

    connect(handler: PlaybackListenerEventHandler) {
        if (this.handler !== null) {
            this.disconnect();
        }

        this.handler = handler;
        this.socketHandler = {
            onStateUpdated: (payload) => {
                if (!isOwnRealtimeNotification(payload)) {
                    handler.onStateUpdated(payload);
                }
            }
        };
        socket.on(PLAYBACK_STATE_UPDATED, this.socketHandler.onStateUpdated);
    }

    disconnect() {
        if (!this.handler || !this.socketHandler) {
            return;
        }

        socket.off(PLAYBACK_STATE_UPDATED, this.socketHandler.onStateUpdated);
        this.handler = null;
        this.socketHandler = null;
    }
}
