import {
    fetchPlaybackDeviceRegistry,
    type PlaybackDeviceRegistrySnapshot,
    type PlaybackDeviceSnapshot,
    type PlaybackEndpointSnapshot,
    renamePlaybackDevice
} from '~/api/playback-devices';
import { PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS } from '~/modules/playback-controller';
import { getPlaybackInstallationId } from '~/modules/playback-device';
import {
    PLAYBACK_ENDPOINTS_INVALIDATED,
    type PlaybackEndpointsInvalidatedNotification,
    playbackEndpointRegistration
} from '~/socket/playback-endpoint';
import {
    isOwnRealtimeNotification,
    socket
} from '~/socket/socket';

import { BaseStore } from './base-store';

export interface ActivePlaybackTarget {
    device: PlaybackDeviceSnapshot;
    endpoint: PlaybackEndpointSnapshot;
}

export const resolveActivePlaybackTarget = (
    registry: PlaybackDeviceRegistrySnapshot | null
): ActivePlaybackTarget | null => {
    if (!registry?.activeEndpointId) {
        return null;
    }

    for (const device of registry.devices) {
        const endpoint = device.endpoints.find(
            candidate => candidate.id === registry.activeEndpointId
        );

        if (endpoint) {
            return { device, endpoint };
        }
    }

    return null;
};

interface PlaybackDevicesStoreState {
    registry: PlaybackDeviceRegistrySnapshot | null;
    loading: boolean;
    renamingDeviceId: string | null;
    error: string | null;
    errorRetryable: boolean;
}

export type PlaybackDevicesRefreshResult =
    | { type: 'success'; registry: PlaybackDeviceRegistrySnapshot }
    | { type: 'error' | 'superseded' };

export class PlaybackDevicesStore extends BaseStore<PlaybackDevicesStoreState> {
    private connected = false;
    private refreshSequence = 0;
    private unsubscribeRegistration: (() => void) | null = null;

    constructor() {
        super();
        this.state = {
            registry: null,
            loading: false,
            renamingDeviceId: null,
            error: null,
            errorRetryable: false
        };
    }

    get currentDeviceId() {
        return getPlaybackInstallationId();
    }

    connect() {
        if (this.connected) {
            return;
        }

        this.connected = true;
        socket.on(PLAYBACK_ENDPOINTS_INVALIDATED, this.handleRegistryInvalidated);
        this.unsubscribeRegistration = playbackEndpointRegistration.subscribe((registration) => {
            if (registration) {
                void this.refresh();
            } else if (playbackEndpointRegistration.error) {
                this.set({
                    error: playbackEndpointRegistration.error,
                    errorRetryable: false
                });
            }
        });
        playbackEndpointRegistration.connect();
        void this.refresh();
    }

    disconnect() {
        if (!this.connected) {
            return;
        }

        this.connected = false;
        socket.off(PLAYBACK_ENDPOINTS_INVALIDATED, this.handleRegistryInvalidated);
        this.unsubscribeRegistration?.();
        this.unsubscribeRegistration = null;
        playbackEndpointRegistration.disconnect();
    }

    async refresh(
        requestTimeoutMs = PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
    ): Promise<PlaybackDevicesRefreshResult> {
        const requestSequence = ++this.refreshSequence;
        this.set({ loading: true });
        const response = await fetchPlaybackDeviceRegistry(requestTimeoutMs);

        if (requestSequence !== this.refreshSequence) {
            return { type: 'superseded' };
        }

        if (response.type === 'error') {
            this.set({
                loading: false,
                error: response.errors[0]?.message ?? 'Unable to read playback devices.',
                errorRetryable: true
            });
            return { type: 'error' };
        }

        this.set({
            registry: response.playbackDeviceRegistry,
            loading: false,
            error: playbackEndpointRegistration.error,
            errorRetryable: false
        });
        return {
            type: 'success',
            registry: response.playbackDeviceRegistry
        };
    }

    async rename(deviceId: string, name: string) {
        this.set({
            renamingDeviceId: deviceId,
            error: null,
            errorRetryable: false
        });
        const response = await renamePlaybackDevice(deviceId, name);

        if (response.type === 'error') {
            this.set({
                renamingDeviceId: null,
                error: response.errors[0]?.message ?? 'Unable to rename playback device.',
                errorRetryable: false
            });
            return false;
        }

        this.set((state) => ({
            registry: state.registry
                ? {
                    ...state.registry,
                    devices: state.registry.devices.map((device) => (
                        device.id === response.renamePlaybackDevice.deviceId
                            ? {
                                ...device,
                                name: response.renamePlaybackDevice.name
                            }
                            : device
                    ))
            }
                : state.registry,
            renamingDeviceId: null,
            error: playbackEndpointRegistration.error,
            errorRetryable: false
        }));
        void this.refresh();
        return true;
    }

    private handleRegistryInvalidated = (
        notification: PlaybackEndpointsInvalidatedNotification
    ) => {
        if (notification.reason === 'active-changed') {
            if (this.state.registry?.activeEndpointId === notification.endpointId) {
                return;
            }

            this.set((state) => ({
                registry: state.registry
                    ? {
                        ...state.registry,
                        activeEndpointId: notification.endpointId,
                        devices: state.registry.devices.map((device) => {
                            const endpoints = device.endpoints.map((endpoint) => ({
                                ...endpoint,
                                active: endpoint.id === notification.endpointId
                            }));

                            return {
                                ...device,
                                active: endpoints.some((endpoint) => endpoint.active),
                                endpoints
                            };
                        })
                    }
                    : state.registry
            }));
            void this.refresh();
            return;
        }

        if (isOwnRealtimeNotification(notification)) {
            return;
        }

        void this.refresh();
    };
}

export const playbackDevicesStore = new PlaybackDevicesStore();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        playbackDevicesStore.disconnect();
    });
}
