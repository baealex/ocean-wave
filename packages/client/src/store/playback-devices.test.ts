import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchRegistry: vi.fn(),
    renameDevice: vi.fn(),
    socketOn: vi.fn(),
    socketOff: vi.fn(),
    registrationConnect: vi.fn(),
    registrationDisconnect: vi.fn(),
    registrationUnsubscribe: vi.fn(),
    registrationError: null as string | null,
    registrationSubscriber: null as null | ((registration: unknown) => void)
}));

vi.mock('~/api/playback-devices', () => ({
    fetchPlaybackDeviceRegistry: mocks.fetchRegistry,
    renamePlaybackDevice: mocks.renameDevice
}));

vi.mock('~/modules/playback-device', () => ({
    getPlaybackInstallationId: () => 'browser-local'
}));

vi.mock('~/socket/playback-endpoint', () => ({
    PLAYBACK_ENDPOINTS_INVALIDATED: 'playback:endpoints-invalidated',
    playbackEndpointRegistration: {
        get error() {
            return mocks.registrationError;
        },
        connect: mocks.registrationConnect,
        disconnect: mocks.registrationDisconnect,
        subscribe: (subscriber: (registration: unknown) => void) => {
            mocks.registrationSubscriber = subscriber;
            return mocks.registrationUnsubscribe;
        }
    }
}));

vi.mock('~/socket/socket', () => ({
    isOwnRealtimeNotification: (notification: { originClientId?: string | null }) => (
        notification.originClientId === 'origin-local'
    ),
    socket: {
        on: mocks.socketOn,
        off: mocks.socketOff
    }
}));

import type {
    PlaybackDeviceRegistrySnapshot,
    PlaybackDeviceSnapshot
} from '~/api/playback-devices';
import { PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS } from '~/modules/playback-controller';
import {
    PlaybackDevicesStore,
    resolveActivePlaybackTarget
} from './playback-devices';

const createDevice = (
    overrides: Partial<PlaybackDeviceSnapshot> = {}
): PlaybackDeviceSnapshot => ({
    id: 'browser-local',
    name: 'Studio Browser',
    type: 'desktop-web',
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    online: true,
    active: true,
    endpoints: [{
        id: 'tab-1',
        capabilities: ['play', 'pause', 'seek', 'next', 'previous'],
        lastSeenAt: '2026-07-20T00:00:00.000Z',
        online: true,
        active: true,
        registrationGeneration: 1
    }],
    ...overrides
});

const createRegistry = (
    overrides: Partial<PlaybackDeviceRegistrySnapshot> = {}
): PlaybackDeviceRegistrySnapshot => ({
    commandEpoch: 'epoch-1',
    activeEndpointId: 'tab-1',
    serverTime: '2026-07-20T00:00:00.000Z',
    devices: [createDevice()],
    ...overrides
});

describe('resolveActivePlaybackTarget', () => {
    it('returns the device and endpoint selected by the registry', () => {
        const inactive = createDevice({
            id: 'browser-inactive',
            active: false,
            endpoints: [{
                ...createDevice().endpoints[0]!,
                id: 'tab-inactive',
                active: false
            }]
        });
        const active = createDevice({
            id: 'browser-active',
            name: 'Living Room Browser',
            endpoints: [{
                ...createDevice().endpoints[0]!,
                id: 'tab-active'
            }]
        });

        expect(resolveActivePlaybackTarget(createRegistry({
            activeEndpointId: 'tab-active',
            devices: [inactive, active]
        }))).toEqual({
            device: active,
            endpoint: active.endpoints[0]
        });
    });

    it('returns null when the registry has no resolvable active endpoint', () => {
        expect(resolveActivePlaybackTarget(null)).toBeNull();
        expect(resolveActivePlaybackTarget(createRegistry({
            activeEndpointId: 'missing-tab'
        }))).toBeNull();
    });
});

describe('PlaybackDevicesStore', () => {
    beforeEach(() => {
        mocks.fetchRegistry.mockReset();
        mocks.renameDevice.mockReset();
        mocks.socketOn.mockReset();
        mocks.socketOff.mockReset();
        mocks.registrationConnect.mockReset();
        mocks.registrationDisconnect.mockReset();
        mocks.registrationUnsubscribe.mockReset();
        mocks.registrationError = null;
        mocks.registrationSubscriber = null;
    });

    it('loads devices and refreshes for remote presence changes', async () => {
        const first = createRegistry();
        const second = createRegistry({
            devices: [createDevice({ online: false, active: false })]
        });
        mocks.fetchRegistry
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: first
            })
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: second
            });
        const store = new PlaybackDevicesStore();

        store.connect();
        await vi.waitFor(() => expect(store.state.registry).toEqual(first));
        expect(mocks.fetchRegistry).toHaveBeenCalledWith(
            PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
        );

        expect(store.currentDeviceId).toBe('browser-local');
        expect(mocks.registrationConnect).toHaveBeenCalledOnce();
        const notificationHandler = mocks.socketOn.mock.calls.find(
            ([event]) => event === 'playback:endpoints-invalidated'
        )?.[1] as ((notification: { originClientId?: string }) => void) | undefined;

        notificationHandler?.({ originClientId: 'origin-local' });
        expect(mocks.fetchRegistry).toHaveBeenCalledOnce();
        notificationHandler?.({ originClientId: 'origin-remote' });
        await vi.waitFor(() => expect(store.state.registry).toEqual(second));

        store.disconnect();
        expect(mocks.socketOff).toHaveBeenCalledWith(
            'playback:endpoints-invalidated',
            expect.any(Function)
        );
        expect(mocks.registrationUnsubscribe).toHaveBeenCalledOnce();
        expect(mocks.registrationDisconnect).toHaveBeenCalledOnce();
    });

    it('updates active flags for origin and remote ownership claims only once per change', async () => {
        const local = createDevice();
        const remote = createDevice({
            id: 'browser-remote',
            name: 'Pocket Browser',
            active: false,
            endpoints: [{
                id: 'tab-2',
                capabilities: ['play', 'pause'],
                lastSeenAt: '2026-07-20T00:00:00.000Z',
                online: true,
                active: false,
                registrationGeneration: 1
            }]
        });
        const initial = createRegistry({ devices: [local, remote] });
        const claimedRemote = createRegistry({
            activeEndpointId: 'tab-2',
            devices: [
                createDevice({
                    active: false,
                    endpoints: [{ ...local.endpoints[0]!, active: false }]
                }),
                {
                    ...remote,
                    active: true,
                    endpoints: [{ ...remote.endpoints[0]!, active: true }]
                }
            ]
        });
        mocks.fetchRegistry
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: initial
            })
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: claimedRemote
            })
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: initial
            });
        const store = new PlaybackDevicesStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.registry).toEqual(initial));
        const notificationHandler = mocks.socketOn.mock.calls.find(
            ([event]) => event === 'playback:endpoints-invalidated'
        )?.[1] as ((notification: {
            reason: 'active-changed';
            deviceId: null;
            endpointId: string;
            originClientId?: string;
        }) => void) | undefined;

        notificationHandler?.({
            reason: 'active-changed',
            deviceId: null,
            endpointId: 'tab-2',
            originClientId: 'origin-local'
        });
        expect(store.state.registry).toMatchObject({
            activeEndpointId: 'tab-2',
            devices: [
                { active: false, endpoints: [{ active: false }] },
                { active: true, endpoints: [{ active: true }] }
            ]
        });
        await vi.waitFor(() => expect(store.state.registry).toEqual(claimedRemote));

        notificationHandler?.({
            reason: 'active-changed',
            deviceId: null,
            endpointId: 'tab-1',
            originClientId: 'origin-remote'
        });
        expect(store.state.registry).toMatchObject({
            activeEndpointId: 'tab-1',
            devices: [
                { active: true, endpoints: [{ active: true }] },
                { active: false, endpoints: [{ active: false }] }
            ]
        });
        await vi.waitFor(() => expect(store.state.registry).toEqual(initial));

        notificationHandler?.({
            reason: 'active-changed',
            deviceId: null,
            endpointId: 'tab-1',
            originClientId: 'origin-remote'
        });
        expect(mocks.fetchRegistry).toHaveBeenCalledTimes(3);
        store.disconnect();
    });

    it('refreshes after registration and applies the complete renamed device', async () => {
        const initial = createRegistry();
        const renamed = createDevice({ name: 'Listening Room' });
        mocks.fetchRegistry
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: initial
            })
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: initial
            })
            .mockResolvedValue({
                type: 'success',
                playbackDeviceRegistry: createRegistry({ devices: [renamed] })
            });
        mocks.renameDevice.mockResolvedValue({
            type: 'success',
            renamePlaybackDevice: {
                deviceId: renamed.id,
                name: renamed.name
            }
        });
        const store = new PlaybackDevicesStore();

        store.connect();
        await vi.waitFor(() => expect(store.state.registry).toEqual(initial));
        mocks.registrationSubscriber?.({ endpointId: 'tab-1' });
        await vi.waitFor(() => expect(mocks.fetchRegistry).toHaveBeenCalledTimes(2));

        await expect(store.rename('browser-local', 'Listening Room')).resolves.toBe(true);
        expect(mocks.renameDevice).toHaveBeenCalledWith('browser-local', 'Listening Room');
        expect(store.state.registry?.devices).toEqual([renamed]);
        expect(store.state.renamingDeviceId).toBeNull();
        await vi.waitFor(() => expect(store.state.loading).toBe(false));
        store.disconnect();
    });

    it('prevents an older refresh from overwriting a committed rename patch', async () => {
        const initial = createRegistry();
        const renamed = createDevice({ name: 'Listening Room' });
        let resolveStaleRefresh: ((value: unknown) => void) | undefined;
        const staleRefreshResponse = new Promise((resolve) => {
            resolveStaleRefresh = resolve;
        });
        mocks.fetchRegistry
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: initial
            })
            .mockReturnValueOnce(staleRefreshResponse)
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: createRegistry({ devices: [renamed] })
            });
        mocks.renameDevice.mockResolvedValue({
            type: 'success',
            renamePlaybackDevice: {
                deviceId: renamed.id,
                name: renamed.name
            }
        });
        const store = new PlaybackDevicesStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.registry).toEqual(initial));

        const staleRefresh = store.refresh();
        await expect(store.rename('browser-local', 'Listening Room')).resolves.toBe(true);
        expect(store.state.registry?.devices[0]?.name).toBe('Listening Room');

        resolveStaleRefresh?.({
            type: 'success',
            playbackDeviceRegistry: initial
        });
        await staleRefresh;
        await vi.waitFor(() => expect(store.state.loading).toBe(false));
        expect(store.state.registry?.devices[0]?.name).toBe('Listening Room');
        store.disconnect();
    });

    it('preserves the committed rename patch when recovery fails', async () => {
        const initial = createRegistry();
        mocks.fetchRegistry
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: initial
            })
            .mockResolvedValueOnce({
                type: 'error',
                category: 'network',
                errors: [{ code: 'NETWORK_ERROR', message: 'Recovery failed.' }]
            });
        mocks.renameDevice.mockResolvedValue({
            type: 'success',
            renamePlaybackDevice: {
                deviceId: 'browser-local',
                name: 'Listening Room'
            }
        });
        const store = new PlaybackDevicesStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.registry).toEqual(initial));

        await expect(store.rename('browser-local', 'Listening Room')).resolves.toBe(true);
        await vi.waitFor(() => expect(store.state.loading).toBe(false));

        expect(store.state.registry?.devices[0]?.name).toBe('Listening Room');
        expect(store.state.error).toBe('Recovery failed.');
        store.disconnect();
    });

    it('keeps the newest response when refresh requests finish out of order', async () => {
        let resolveFirst: ((value: unknown) => void) | undefined;
        const firstRequest = new Promise((resolve) => {
            resolveFirst = resolve;
        });
        const newest = createRegistry({ commandEpoch: 'epoch-2' });
        mocks.fetchRegistry
            .mockReturnValueOnce(firstRequest)
            .mockResolvedValueOnce({
                type: 'success',
                playbackDeviceRegistry: newest
            });
        const store = new PlaybackDevicesStore();

        const firstRefresh = store.refresh();
        await expect(store.refresh()).resolves.toEqual({
            type: 'success',
            registry: newest
        });
        resolveFirst?.({
            type: 'success',
            playbackDeviceRegistry: createRegistry({ commandEpoch: 'epoch-old' })
        });
        await expect(firstRefresh).resolves.toEqual({ type: 'superseded' });

        expect(store.state.registry).toEqual(newest);
        expect(store.state.loading).toBe(false);
    });

    it('exposes normalized read and rename errors for recovery UI', async () => {
        mocks.fetchRegistry.mockResolvedValue({
            type: 'error',
            category: 'network',
            errors: [{ code: 'NETWORK_ERROR', message: 'Registry is unavailable.' }]
        });
        mocks.renameDevice.mockResolvedValue({
            type: 'error',
            category: 'graphql',
            errors: [{ code: 'INVALID_PLAYBACK_DEVICE', message: 'Name is invalid.' }]
        });
        const store = new PlaybackDevicesStore();

        await expect(store.refresh()).resolves.toEqual({ type: 'error' });
        expect(store.state).toMatchObject({
            loading: false,
            error: 'Registry is unavailable.',
            errorRetryable: true
        });
        await expect(store.rename('browser-local', '')).resolves.toBe(false);
        expect(store.state).toMatchObject({
            renamingDeviceId: null,
            error: 'Name is invalid.',
            errorRetryable: false
        });
    });

    it('surfaces a terminal playback endpoint capacity error', async () => {
        mocks.fetchRegistry.mockResolvedValue({
            type: 'success',
            playbackDeviceRegistry: createRegistry()
        });
        const store = new PlaybackDevicesStore();
        store.connect();
        await vi.waitFor(() => expect(store.state.loading).toBe(false));

        mocks.registrationError = 'Playback endpoint capacity is full.';
        mocks.registrationSubscriber?.(null);

        expect(store.state).toMatchObject({
            error: 'Playback endpoint capacity is full.',
            errorRetryable: false
        });

        await expect(store.refresh()).resolves.toEqual({
            type: 'success',
            registry: createRegistry()
        });
        expect(store.state).toMatchObject({
            error: 'Playback endpoint capacity is full.',
            errorRetryable: false
        });
        store.disconnect();
    });
});
