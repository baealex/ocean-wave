import models from '~/models';

import {
    getPlaybackDeviceRegistrySnapshot,
    PLAYBACK_ENDPOINT_RETENTION_MS,
    PLAYBACK_DEVICE_MAX_ENDPOINTS,
    PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES,
    PLAYBACK_DEVICE_RETENTION_MS,
    registerPlaybackEndpoint,
    renamePlaybackDevice,
    touchPlaybackEndpoint
} from './playback-device';

const firstSeenAt = new Date('2026-07-20T00:00:00.000Z');
const laterSeenAt = new Date('2026-07-20T00:01:00.000Z');

const createRegistration = (
    overrides: Partial<Parameters<typeof registerPlaybackEndpoint>[0]> = {}
): Parameters<typeof registerPlaybackEndpoint>[0] => ({
    deviceId: 'browser-1',
    endpointId: 'tab-1',
    name: 'Studio Browser',
    type: 'desktop-web' as const,
    capabilities: ['play', 'pause', 'seek', 'next', 'previous'],
    lastSeenAt: firstSeenAt,
    ...overrides
});

describe('playback device service', () => {
    beforeEach(async () => {
        await models.playbackEndpoint.deleteMany();
        await models.playbackDevice.deleteMany();
        await models.playbackQueueItem.deleteMany();
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
    });

    afterEach(async () => {
        await models.playbackEndpoint.deleteMany();
        await models.playbackDevice.deleteMany();
        await models.playbackQueueItem.deleteMany();
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
    });

    it('persists one browser device with multiple tab endpoints', async () => {
        await registerPlaybackEndpoint(createRegistration());
        await registerPlaybackEndpoint(createRegistration({
            endpointId: 'tab-2',
            lastSeenAt: laterSeenAt
        }));

        const device = await models.playbackDevice.findUnique({
            where: { id: 'browser-1' },
            include: { Endpoint: true }
        });

        expect(device).toEqual(expect.objectContaining({
            id: 'browser-1',
            name: 'Studio Browser',
            type: 'desktop-web',
            lastSeenAt: laterSeenAt
        }));
        expect(device?.Endpoint.map((endpoint) => endpoint.id).sort()).toEqual([
            'tab-1',
            'tab-2'
        ]);
    });

    it('preserves a user rename when the browser registers again', async () => {
        await registerPlaybackEndpoint(createRegistration());
        await renamePlaybackDevice('browser-1', 'Listening Room');
        await registerPlaybackEndpoint(createRegistration({
            name: 'Default Browser Name',
            lastSeenAt: laterSeenAt
        }));

        await expect(models.playbackDevice.findUnique({
            where: { id: 'browser-1' },
            select: { name: true, lastSeenAt: true }
        })).resolves.toEqual({
            name: 'Listening Room',
            lastSeenAt: laterSeenAt
        });
    });

    it('does not reassign a persisted endpoint to another installation', async () => {
        await registerPlaybackEndpoint(createRegistration());

        await expect(registerPlaybackEndpoint(createRegistration({
            deviceId: 'browser-2'
        }))).rejects.toMatchObject({
            code: 'PLAYBACK_ENDPOINT_OWNERSHIP_CONFLICT'
        });
        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-1' },
            select: { deviceId: true }
        })).resolves.toEqual({ deviceId: 'browser-1' });
        await expect(models.playbackDevice.findUnique({
            where: { id: 'browser-2' }
        })).resolves.toBeNull();
    });

    it('recycles the oldest historical endpoint at device capacity', async () => {
        for (let index = 0; index < PLAYBACK_DEVICE_MAX_ENDPOINTS; index += 1) {
            await registerPlaybackEndpoint(createRegistration({
                endpointId: `tab-${index}`
            }));
        }

        await expect(registerPlaybackEndpoint(createRegistration({
            endpointId: 'tab-over-limit'
        }))).resolves.toEqual(expect.objectContaining({ id: 'browser-1' }));
        await expect(models.playbackEndpoint.count({
            where: { deviceId: 'browser-1' }
        })).resolves.toBe(PLAYBACK_DEVICE_MAX_ENDPOINTS);
        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-0' }
        })).resolves.toBeNull();
        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-over-limit' }
        })).resolves.toEqual(expect.objectContaining({ deviceId: 'browser-1' }));
    });

    it('returns capacity only when every endpoint slot is protected as live', async () => {
        const protectedEndpointIds = Array.from(
            { length: PLAYBACK_DEVICE_MAX_ENDPOINTS },
            (_, index) => `tab-${index}`
        );

        for (const endpointId of protectedEndpointIds) {
            await registerPlaybackEndpoint(createRegistration({ endpointId }));
        }

        await expect(registerPlaybackEndpoint(createRegistration({
            endpointId: 'tab-over-limit',
            protectedEndpointIds
        }))).rejects.toMatchObject({
            code: 'PLAYBACK_DEVICE_REGISTRY_LIMIT'
        });
    });

    it('does not recycle the offline endpoint that owns the active session', async () => {
        for (let index = 0; index < PLAYBACK_DEVICE_MAX_ENDPOINTS; index += 1) {
            await registerPlaybackEndpoint(createRegistration({
                endpointId: `tab-${index}`
            }));
        }
        await models.playbackSession.create({
            data: {
                scopeKey: 'local',
                activeDeviceId: 'tab-0',
                activeDeviceSequence: 1
            }
        });

        await registerPlaybackEndpoint(createRegistration({
            endpointId: 'tab-over-limit'
        }));

        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-0' }
        })).resolves.toEqual(expect.objectContaining({ deviceId: 'browser-1' }));
        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-1' }
        })).resolves.toBeNull();
    });

    it('does not prune a stale endpoint that owns the active session', async () => {
        await registerPlaybackEndpoint(createRegistration());
        await models.playbackSession.create({
            data: {
                scopeKey: 'local',
                activeDeviceId: 'tab-1',
                activeDeviceSequence: 1
            }
        });
        const afterEndpointRetention = new Date(
            firstSeenAt.getTime() + PLAYBACK_ENDPOINT_RETENTION_MS + 1
        );

        await registerPlaybackEndpoint(createRegistration({
            endpointId: 'tab-2',
            lastSeenAt: afterEndpointRetention
        }));

        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-1' }
        })).resolves.toEqual(expect.objectContaining({ deviceId: 'browser-1' }));
    });

    it('prunes stale registry rows before accepting a new installation', async () => {
        await registerPlaybackEndpoint(createRegistration());
        const afterRetention = new Date(
            firstSeenAt.getTime() + PLAYBACK_DEVICE_RETENTION_MS + 1
        );

        await registerPlaybackEndpoint(createRegistration({
            deviceId: 'browser-2',
            endpointId: 'tab-2',
            lastSeenAt: afterRetention
        }));

        await expect(models.playbackDevice.findUnique({
            where: { id: 'browser-1' }
        })).resolves.toBeNull();
        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-1' }
        })).resolves.toBeNull();
    });

    it('does not prune a stale timestamp that belongs to a protected live route', async () => {
        await registerPlaybackEndpoint(createRegistration());
        const afterRetention = new Date(
            firstSeenAt.getTime() + PLAYBACK_DEVICE_RETENTION_MS + 1
        );

        await registerPlaybackEndpoint(createRegistration({
            deviceId: 'browser-2',
            endpointId: 'tab-2',
            lastSeenAt: afterRetention,
            protectedDeviceIds: ['browser-1']
        }));

        await expect(models.playbackDevice.findUnique({
            where: { id: 'browser-1' }
        })).resolves.toEqual(expect.objectContaining({ id: 'browser-1' }));
        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-1' }
        })).resolves.toEqual(expect.objectContaining({ deviceId: 'browser-1' }));
    });

    it('returns a bounded registry recovery snapshot', async () => {
        const lastSeenAt = new Date('2026-07-20T00:00:00.000Z');

        await models.playbackDevice.createMany({
            data: Array.from(
                { length: PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES + 1 },
                (_, index) => ({
                    id: `browser-${index}`,
                    name: `Browser ${index}`,
                    type: 'desktop-web',
                    lastSeenAt
                })
            )
        });

        const snapshot = await getPlaybackDeviceRegistrySnapshot([], 'epoch-1');

        expect(snapshot.devices).toHaveLength(PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES);
    });

    it('recycles the oldest unprotected device at registry capacity', async () => {
        const deviceIds = Array.from(
            { length: PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES },
            (_, index) => `browser-${index.toString().padStart(3, '0')}`
        );
        await models.playbackDevice.createMany({
            data: deviceIds.map((id) => ({
                id,
                name: id,
                type: 'desktop-web',
                lastSeenAt: firstSeenAt
            }))
        });

        await registerPlaybackEndpoint(createRegistration({
            deviceId: 'browser-new',
            endpointId: 'tab-new'
        }));

        await expect(models.playbackDevice.count()).resolves.toBe(
            PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES
        );
        await expect(models.playbackDevice.findUnique({
            where: { id: 'browser-000' }
        })).resolves.toBeNull();
        await expect(models.playbackDevice.findUnique({
            where: { id: 'browser-new' }
        })).resolves.toEqual(expect.objectContaining({ id: 'browser-new' }));
    });

    it('returns device capacity only when every device slot is protected', async () => {
        const protectedDeviceIds = Array.from(
            { length: PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES },
            (_, index) => `browser-${index.toString().padStart(3, '0')}`
        );
        await models.playbackDevice.createMany({
            data: protectedDeviceIds.map((id) => ({
                id,
                name: id,
                type: 'desktop-web',
                lastSeenAt: firstSeenAt
            }))
        });

        await expect(registerPlaybackEndpoint(createRegistration({
            deviceId: 'browser-new',
            endpointId: 'tab-new',
            protectedDeviceIds
        }))).rejects.toMatchObject({
            code: 'PLAYBACK_DEVICE_REGISTRY_LIMIT'
        });
    });

    it('merges persisted devices with live endpoint and active-player state', async () => {
        await registerPlaybackEndpoint(createRegistration());
        await registerPlaybackEndpoint(createRegistration({
            endpointId: 'tab-2',
            lastSeenAt: laterSeenAt
        }));
        await models.playbackSession.create({
            data: {
                scopeKey: 'local',
                activeDeviceId: 'tab-2',
                activeDeviceSequence: 3
            }
        });

        const snapshot = await getPlaybackDeviceRegistrySnapshot([
            {
                deviceId: 'browser-1',
                endpointId: 'tab-1',
                registrationGeneration: 1,
                capabilities: ['play', 'pause'],
                lastSeenAt: new Date('2026-07-20T00:02:00.000Z')
            }
        ], 'epoch-1', new Date('2026-07-20T00:03:00.000Z'));

        expect(snapshot).toEqual({
            commandEpoch: 'epoch-1',
            activeEndpointId: 'tab-2',
            serverTime: '2026-07-20T00:03:00.000Z',
            devices: [{
                id: 'browser-1',
                name: 'Studio Browser',
                type: 'desktop-web',
                lastSeenAt: '2026-07-20T00:02:00.000Z',
                online: true,
                active: true,
                endpoints: [
                    {
                        id: 'tab-2',
                        capabilities: ['play', 'pause', 'seek', 'next', 'previous'],
                        lastSeenAt: laterSeenAt.toISOString(),
                        online: false,
                        active: true,
                        registrationGeneration: null
                    },
                    {
                        id: 'tab-1',
                        capabilities: ['play', 'pause'],
                        lastSeenAt: '2026-07-20T00:02:00.000Z',
                        online: true,
                        active: false,
                        registrationGeneration: 1
                    }
                ]
            }]
        });
    });

    it('returns one consistent active and online view across browser devices', async () => {
        await registerPlaybackEndpoint(createRegistration());
        await registerPlaybackEndpoint(createRegistration({
            deviceId: 'browser-2',
            endpointId: 'tab-2',
            name: 'Pocket Browser',
            type: 'mobile-web',
            lastSeenAt: laterSeenAt
        }));
        await models.playbackSession.create({
            data: {
                scopeKey: 'local',
                activeDeviceId: 'tab-1',
                activeDeviceSequence: 4
            }
        });

        const snapshot = await getPlaybackDeviceRegistrySnapshot([{
            deviceId: 'browser-1',
            endpointId: 'tab-1',
            registrationGeneration: 2,
            capabilities: ['play', 'pause'],
            lastSeenAt: laterSeenAt
        }], 'epoch-1');

        expect(snapshot.devices.map((device) => ({
            id: device.id,
            type: device.type,
            online: device.online,
            active: device.active
        }))).toEqual([
            {
                id: 'browser-1',
                type: 'desktop-web',
                online: true,
                active: true
            },
            {
                id: 'browser-2',
                type: 'mobile-web',
                online: false,
                active: false
            }
        ]);
    });

    it('persists the last heartbeat observation when an endpoint goes offline', async () => {
        await registerPlaybackEndpoint(createRegistration());

        await touchPlaybackEndpoint('tab-1', laterSeenAt);

        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-1' },
            select: { lastSeenAt: true }
        })).resolves.toEqual({ lastSeenAt: laterSeenAt });
        await expect(models.playbackDevice.findUnique({
            where: { id: 'browser-1' },
            select: { lastSeenAt: true }
        })).resolves.toEqual({ lastSeenAt: laterSeenAt });
    });

    it('does not regress last-seen timestamps from a fenced connection', async () => {
        await registerPlaybackEndpoint(createRegistration({
            lastSeenAt: laterSeenAt
        }));

        await touchPlaybackEndpoint('tab-1', firstSeenAt);

        await expect(models.playbackEndpoint.findUnique({
            where: { id: 'tab-1' },
            select: { lastSeenAt: true }
        })).resolves.toEqual({ lastSeenAt: laterSeenAt });
        await expect(models.playbackDevice.findUnique({
            where: { id: 'browser-1' },
            select: { lastSeenAt: true }
        })).resolves.toEqual({ lastSeenAt: laterSeenAt });
    });

    it('validates user-visible names', async () => {
        await registerPlaybackEndpoint(createRegistration());

        await expect(renamePlaybackDevice('browser-1', '   ')).rejects.toMatchObject({
            code: 'INVALID_PLAYBACK_DEVICE'
        });
        await expect(renamePlaybackDevice('missing-browser', 'Office')).rejects.toMatchObject({
            code: 'PLAYBACK_DEVICE_NOT_FOUND'
        });
    });
});
