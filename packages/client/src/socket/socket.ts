import { default as socketClient } from 'socket.io-client';

export const socket = socketClient('/', { autoConnect: false });

export interface OriginClientNotificationPayload {
    originClientId?: string | null;
}

const createOriginClientId = () => {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const originClientId = createOriginClientId();

export const getOriginClientId = () => originClientId;

export const isOwnRealtimeNotification = (payload?: OriginClientNotificationPayload | null) => {
    return Boolean(payload?.originClientId && payload.originClientId === getOriginClientId());
};
