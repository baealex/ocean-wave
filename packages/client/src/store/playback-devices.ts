import {
    fetchPlaybackDeviceRegistry,
    renamePlaybackDevice,
    type PlaybackDeviceRegistrySnapshot
} from '~/api/playback-devices';
import { getPlaybackInstallationId } from '~/modules/playback-device';
import {
    PLAYBACK_ENDPOINTS_INVALIDATED,
    playbackEndpointRegistration,
    type PlaybackEndpointsInvalidatedNotification
} from '~/socket/playback-endpoint';
import {
    isOwnRealtimeNotification,
    socket
} from '~/socket/socket';

import { BaseStore } from './base-store';

interface PlaybackDevicesStoreState {
    registry: PlaybackDeviceRegistrySnapshot | null;
    loading: boolean;
    renamingDeviceId: string | null;
    error: string | null;
}

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
            error: null
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
                this.set({ error: playbackEndpointRegistration.error });
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

    async refresh() {
        const requestSequence = ++this.refreshSequence;
        this.set({ loading: true });
        const response = await fetchPlaybackDeviceRegistry();

        if (requestSequence !== this.refreshSequence) {
            return;
        }

        if (response.type === 'error') {
            this.set({
                loading: false,
                error: response.errors[0]?.message ?? 'Unable to read playback devices.'
            });
            return;
        }

        this.set({
            registry: response.playbackDeviceRegistry,
            loading: false,
            error: playbackEndpointRegistration.error
        });
    }

    async rename(deviceId: string, name: string) {
        this.set({ renamingDeviceId: deviceId, error: null });
        const response = await renamePlaybackDevice(deviceId, name);

        if (response.type === 'error') {
            this.set({
                renamingDeviceId: null,
                error: response.errors[0]?.message ?? 'Unable to rename playback device.'
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
            error: playbackEndpointRegistration.error
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
