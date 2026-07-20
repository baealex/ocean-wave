import type { Socket } from 'socket.io';

import {
    PlaybackDeviceServiceError,
    PLAYBACK_DEVICE_MAX_ENDPOINTS,
    PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES
} from '~/features/playback/services/playback-device';
import models from '~/models';

import {
    PLAYBACK_ENDPOINT_COLLISION_GRACE_MS,
    PLAYBACK_ENDPOINT_COLLISION_RETENTION_MS,
    PLAYBACK_ENDPOINT_COLLISION_RETRY_MS,
    PLAYBACK_ENDPOINT_COARSE_PERSIST_INTERVAL_MS,
    PLAYBACK_ENDPOINT_DISCONNECT_GRACE_MS,
    PLAYBACK_ENDPOINT_HEARTBEAT,
    PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS,
    PLAYBACK_ENDPOINT_LEASE_EXPIRED,
    PLAYBACK_ENDPOINT_MAX_CONCURRENT_REGISTRATIONS,
    PLAYBACK_ENDPOINT_MAX_COALESCED_WAITERS,
    PLAYBACK_ENDPOINT_MAX_COLLISION_RECORDS,
    PLAYBACK_ENDPOINT_MAX_COLLISIONS_PER_ENDPOINT,
    PLAYBACK_ENDPOINT_MAX_PENDING_REGISTRATIONS,
    PLAYBACK_ENDPOINT_REGISTRATION_RATE_LIMIT,
    PLAYBACK_ENDPOINT_REGISTRATION_RATE_WINDOW_MS,
    PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS,
    PLAYBACK_ENDPOINT_REGISTER,
    PLAYBACK_ENDPOINTS_INVALIDATED,
    PLAYBACK_ENDPOINT_SWEEP_INTERVAL_MS,
    PLAYBACK_ENDPOINT_TTL_MS,
    PlaybackEndpointRegistry,
    type PlaybackEndpointRegistrationInput
} from './playback-endpoints';

const createSocket = (id: string) => ({
    id,
    connected: true,
    data: {},
    emit: jest.fn(),
    disconnect: jest.fn()
}) as unknown as Socket;

const createRegistration = (
    overrides: Partial<PlaybackEndpointRegistrationInput> = {}
): PlaybackEndpointRegistrationInput => ({
    protocolVersion: 1,
    deviceId: 'browser-1',
    endpointId: 'tab-1',
    endpointInstanceId: 'document-1',
    name: 'Studio Browser',
    type: 'desktop-web',
    capabilities: ['play', 'pause', 'seek', 'next', 'previous'],
    lastEndpointSequence: 4,
    ...overrides
});

const createPersistedDevice = () => ({
    id: 'browser-1',
    name: 'Studio Browser',
    type: 'desktop-web',
    lastSeenAt: new Date(0),
    createdAt: new Date(0),
    updatedAt: new Date(0)
});

describe('playback endpoint registry', () => {
    let now: number;
    let persistRegistration: jest.Mock;
    let persistLastSeen: jest.Mock;
    let onChanged: jest.Mock;
    let registry: PlaybackEndpointRegistry;

    beforeEach(() => {
        now = Date.parse('2026-07-20T00:00:00.000Z');
        persistRegistration = jest.fn().mockResolvedValue(createPersistedDevice());
        persistLastSeen = jest.fn().mockResolvedValue(undefined);
        onChanged = jest.fn();
        registry = new PlaybackEndpointRegistry({
            now: () => now,
            commandEpoch: 'epoch-1',
            persistRegistration,
            persistLastSeen,
            onChanged
        });
    });

    afterEach(() => {
        registry.clear();
    });

    it('keeps protocol event names and lease timing fixed', () => {
        expect({
            PLAYBACK_ENDPOINT_REGISTER,
            PLAYBACK_ENDPOINT_HEARTBEAT,
            PLAYBACK_ENDPOINT_LEASE_EXPIRED,
            PLAYBACK_ENDPOINT_MAX_CONCURRENT_REGISTRATIONS,
            PLAYBACK_ENDPOINT_MAX_COALESCED_WAITERS,
            PLAYBACK_ENDPOINT_MAX_COLLISION_RECORDS,
            PLAYBACK_ENDPOINT_MAX_COLLISIONS_PER_ENDPOINT,
            PLAYBACK_ENDPOINT_MAX_PENDING_REGISTRATIONS,
            PLAYBACK_ENDPOINT_REGISTRATION_RATE_LIMIT,
            PLAYBACK_ENDPOINT_REGISTRATION_RATE_WINDOW_MS,
            PLAYBACK_ENDPOINTS_INVALIDATED,
            PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS,
            PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS,
            PLAYBACK_ENDPOINT_TTL_MS,
            PLAYBACK_ENDPOINT_DISCONNECT_GRACE_MS,
            PLAYBACK_ENDPOINT_COLLISION_GRACE_MS,
            PLAYBACK_ENDPOINT_COLLISION_RETENTION_MS,
            PLAYBACK_ENDPOINT_COLLISION_RETRY_MS,
            PLAYBACK_ENDPOINT_COARSE_PERSIST_INTERVAL_MS,
            PLAYBACK_ENDPOINT_SWEEP_INTERVAL_MS
        }).toEqual({
            PLAYBACK_ENDPOINT_REGISTER: 'playback:endpoint-register',
            PLAYBACK_ENDPOINT_HEARTBEAT: 'playback:endpoint-heartbeat',
            PLAYBACK_ENDPOINT_LEASE_EXPIRED: 'playback:endpoint-lease-expired',
            PLAYBACK_ENDPOINT_MAX_CONCURRENT_REGISTRATIONS: 8,
            PLAYBACK_ENDPOINT_MAX_COALESCED_WAITERS: 4,
            PLAYBACK_ENDPOINT_MAX_COLLISION_RECORDS: 256,
            PLAYBACK_ENDPOINT_MAX_COLLISIONS_PER_ENDPOINT: 16,
            PLAYBACK_ENDPOINT_MAX_PENDING_REGISTRATIONS: 128,
            PLAYBACK_ENDPOINT_REGISTRATION_RATE_LIMIT: 70,
            PLAYBACK_ENDPOINT_REGISTRATION_RATE_WINDOW_MS: 60_000,
            PLAYBACK_ENDPOINTS_INVALIDATED: 'playback:endpoints-invalidated',
            PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS: 15_000,
            PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS: 5_000,
            PLAYBACK_ENDPOINT_TTL_MS: 45_000,
            PLAYBACK_ENDPOINT_DISCONNECT_GRACE_MS: 5_000,
            PLAYBACK_ENDPOINT_COLLISION_GRACE_MS: 50_000,
            PLAYBACK_ENDPOINT_COLLISION_RETENTION_MS: 100_000,
            PLAYBACK_ENDPOINT_COLLISION_RETRY_MS: 1_000,
            PLAYBACK_ENDPOINT_COARSE_PERSIST_INTERVAL_MS: 86_400_000,
            PLAYBACK_ENDPOINT_SWEEP_INTERVAL_MS: 5_000
        });
    });

    it('registers a browser endpoint and binds trusted socket data', async () => {
        const socket = createSocket('socket-1');

        const result = await registry.register(socket, createRegistration());

        expect(result).toEqual({
            protocolVersion: 1,
            status: 'registered',
            endpointId: 'tab-1',
            registrationGeneration: 1,
            commandEpoch: 'epoch-1',
            registrationProof: expect.any(String)
        });
        expect(socket.data).toEqual({
            playbackDeviceId: 'browser-1',
            playbackEndpointId: 'tab-1',
            playbackEndpointInstanceId: 'document-1',
            playbackRegistrationGeneration: 1,
            playbackRegistrationProof: expect.any(String)
        });
        expect(registry.getOnlineEndpoints()).toEqual([
            expect.objectContaining({
                deviceId: 'browser-1',
                endpointId: 'tab-1',
                registrationGeneration: 1
            })
        ]);
        expect(registry.getRoute('tab-1')).toEqual(expect.objectContaining({
            socket,
            socketId: 'socket-1',
            deviceId: 'browser-1',
            endpointId: 'tab-1',
            registrationGeneration: 1,
            lastEndpointSequence: 4
        }));
        expect(result.status).toBe('registered');
        if (result.status !== 'registered') {
            throw new Error('Expected endpoint registration to succeed.');
        }
        expect(registry.isReportAuthorized({
            endpointId: result.endpointId,
            registrationGeneration: result.registrationGeneration,
            registrationProof: result.registrationProof
        })).toBe(true);
        expect(registry.isReportAuthorized({
            endpointId: result.endpointId,
            registrationGeneration: result.registrationGeneration,
            registrationProof: 'wrong-proof'
        })).toBe(false);
        expect(onChanged).toHaveBeenCalledWith({
            reason: 'registered',
            deviceId: 'browser-1',
            endpointId: 'tab-1'
        });
    });

    it('holds registration authority through an accepted report commit', async () => {
        const socket = createSocket('socket-1');
        const registration = await registry.register(socket, createRegistration());
        expect(registration.status).toBe('registered');
        if (registration.status !== 'registered') {
            throw new Error('Expected endpoint registration to succeed.');
        }

        let commitReport: ((value: string) => void) | undefined;
        const report = registry.runAuthorizedReport({
            endpointId: registration.endpointId,
            registrationGeneration: registration.registrationGeneration,
            registrationProof: registration.registrationProof
        }, () => new Promise<string>((resolve) => {
            commitReport = resolve;
        }));
        const unregister = registry.unregisterSocket(socket.id);
        let unregisterCompleted = false;
        void unregister.then(() => {
            unregisterCompleted = true;
        });

        await Promise.resolve();
        expect(unregisterCompleted).toBe(false);
        expect(registry.getRoute('tab-1')).not.toBeNull();
        await expect(registry.runAuthorizedReport({
            endpointId: registration.endpointId,
            registrationGeneration: registration.registrationGeneration,
            registrationProof: registration.registrationProof
        }, async () => 'late')).resolves.toEqual({ authorized: false });

        commitReport?.('committed');
        await expect(report).resolves.toEqual({
            authorized: true,
            result: 'committed'
        });
        await expect(unregister).resolves.toBe(true);
        expect(registry.getRoute('tab-1')).toBeNull();
    });

    it('does not rotate a socket endpoint while its authorized report is committing', async () => {
        const socket = createSocket('socket-1');
        const registration = await registry.register(socket, createRegistration());
        expect(registration.status).toBe('registered');
        if (registration.status !== 'registered') {
            throw new Error('Expected endpoint registration to succeed.');
        }

        let commitReport: (() => void) | undefined;
        const report = registry.runAuthorizedReport({
            endpointId: registration.endpointId,
            registrationGeneration: registration.registrationGeneration,
            registrationProof: registration.registrationProof
        }, () => new Promise<void>((resolve) => {
            commitReport = resolve;
        }));

        await expect(registry.register(socket, createRegistration({
            endpointId: 'tab-2',
            endpointInstanceId: 'document-2'
        }))).resolves.toMatchObject({
            status: 'rejected',
            code: 'ENDPOINT_REGISTRATION_FAILED'
        });
        expect(registry.getRoute('tab-1')).not.toBeNull();
        expect(registry.getRoute('tab-2')).toBeNull();

        commitReport?.();
        await expect(report).resolves.toEqual({
            authorized: true,
            result: undefined
        });
    });

    it('keeps registration successful when the notification channel fails', async () => {
        const error = new Error('notification failed');
        const consoleError = jest.spyOn(console, 'error').mockImplementation();
        onChanged.mockImplementation(() => {
            throw error;
        });

        await expect(registry.register(
            createSocket('socket-1'),
            createRegistration()
        )).resolves.toEqual(expect.objectContaining({
            status: 'registered',
            endpointId: 'tab-1'
        }));
        expect(registry.getOnlineEndpoints()).toHaveLength(1);
        expect(consoleError).toHaveBeenCalledWith(error);
    });

    it('keeps multiple tabs under one browser device', async () => {
        await registry.register(createSocket('socket-1'), createRegistration());
        await registry.register(createSocket('socket-2'), createRegistration({
            endpointId: 'tab-2',
            endpointInstanceId: 'document-2'
        }));

        expect(registry.getOnlineEndpoints()).toEqual([
            expect.objectContaining({ deviceId: 'browser-1', endpointId: 'tab-1' }),
            expect.objectContaining({ deviceId: 'browser-1', endpointId: 'tab-2' })
        ]);
        expect(persistRegistration).toHaveBeenLastCalledWith(expect.objectContaining({
            endpointId: 'tab-2',
            protectedDeviceIds: ['browser-1'],
            protectedEndpointIds: ['tab-1']
        }));
    });

    it('atomically rebinds a reconnect from the same document instance', async () => {
        const previousSocket = createSocket('socket-1');
        const nextSocket = createSocket('socket-2');

        await registry.register(previousSocket, createRegistration());
        const result = await registry.register(nextSocket, createRegistration());

        expect(result).toEqual(expect.objectContaining({
            status: 'registered',
            registrationGeneration: 2
        }));
        expect(previousSocket.disconnect).toHaveBeenCalledWith(true);
        expect(previousSocket.data).toEqual({});
        expect(registry.getOnlineEndpoints()).toEqual([
            expect.objectContaining({
                endpointId: 'tab-1',
                registrationGeneration: 2
            })
        ]);
        await expect(registry.unregisterSocket('socket-1')).resolves.toBe(false);
        expect(registry.getOnlineEndpoints()).toHaveLength(1);
    });

    it('lets a normal reload reclaim its endpoint after the old socket closes', async () => {
        const previousSocket = createSocket('socket-1');
        const nextSocket = createSocket('socket-2');

        await registry.register(previousSocket, createRegistration());
        const conflict = await registry.register(nextSocket, createRegistration({
            endpointInstanceId: 'document-2'
        }));

        expect(conflict).toEqual(expect.objectContaining({
            status: 'rejected',
            code: 'ENDPOINT_ID_CONFLICT',
            resolution: 'retry-same-endpoint'
        }));

        await registry.unregisterSocket(previousSocket.id);
        const rebound = await registry.register(nextSocket, createRegistration({
            endpointInstanceId: 'document-2'
        }));

        expect(rebound).toEqual(expect.objectContaining({
            status: 'registered',
            endpointId: 'tab-1',
            registrationGeneration: 2
        }));
    });

    it('reclaims an endpoint when Socket.IO is already disconnected', async () => {
        const previousSocket = createSocket('socket-1');
        const nextSocket = createSocket('socket-2');

        await registry.register(previousSocket, createRegistration());
        previousSocket.connected = false;
        const rebound = await registry.register(nextSocket, createRegistration({
            endpointInstanceId: 'document-2'
        }));

        expect(rebound).toEqual(expect.objectContaining({
            status: 'registered',
            endpointId: 'tab-1',
            registrationGeneration: 2
        }));
        expect(registry.getOnlineEndpoints()).toEqual([
            expect.objectContaining({
                endpointId: 'tab-1',
                registrationGeneration: 2
            })
        ]);
    });

    it('rotates only after a different live document survives the full collision grace', async () => {
        const incumbent = createSocket('socket-1');
        const challenger = createSocket('socket-2');

        await registry.register(incumbent, createRegistration());
        const firstConflict = await registry.register(challenger, createRegistration({
            endpointInstanceId: 'document-2'
        }));

        now += PLAYBACK_ENDPOINT_TTL_MS - 1_000;
        expect(registry.heartbeat(incumbent.id, {
            protocolVersion: 1,
            endpointId: 'tab-1',
            registrationGeneration: 1,
            lastEndpointSequence: 5
        })).toEqual({
            protocolVersion: 1,
            status: 'accepted',
            endpointId: 'tab-1',
            registrationGeneration: 1
        });
        now = Date.parse('2026-07-20T00:00:00.000Z')
            + PLAYBACK_ENDPOINT_COLLISION_GRACE_MS;
        const finalConflict = await registry.register(challenger, createRegistration({
            endpointInstanceId: 'document-2'
        }));

        expect(firstConflict).toEqual(expect.objectContaining({
            resolution: 'retry-same-endpoint'
        }));
        expect(finalConflict).toEqual(expect.objectContaining({
            resolution: 'rotate-endpoint'
        }));
        await expect(registry.register(challenger, createRegistration({
            endpointInstanceId: 'document-2'
        }))).resolves.toEqual(expect.objectContaining({
            resolution: 'retry-same-endpoint'
        }));
        expect(registry.getOnlineEndpoints()).toEqual([
            expect.objectContaining({ endpointId: 'tab-1' })
        ]);
    });

    it('rotates immediately when a live endpoint belongs to another installation', async () => {
        const incumbent = createSocket('socket-1');
        const challenger = createSocket('socket-2');

        await registry.register(incumbent, createRegistration());

        await expect(registry.register(challenger, createRegistration({
            deviceId: 'browser-2',
            endpointInstanceId: 'document-2'
        }))).resolves.toEqual({
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'ENDPOINT_ID_CONFLICT',
            resolution: 'rotate-endpoint',
            retryAfterMs: PLAYBACK_ENDPOINT_COLLISION_RETRY_MS
        });
        expect(persistRegistration).toHaveBeenCalledTimes(1);
    });

    it('bounds and expires abandoned collision records', async () => {
        const incumbent = createSocket('socket-incumbent');
        await registry.register(incumbent, createRegistration());

        for (
            let index = 0;
            index < PLAYBACK_ENDPOINT_MAX_COLLISIONS_PER_ENDPOINT;
            index += 1
        ) {
            await expect(registry.register(
                createSocket(`socket-${index}`),
                createRegistration({ endpointInstanceId: `document-${index + 2}` })
            )).resolves.toEqual(expect.objectContaining({
                resolution: 'retry-same-endpoint'
            }));
        }

        await expect(registry.register(
            createSocket('socket-over-cap'),
            createRegistration({ endpointInstanceId: 'document-over-cap' })
        )).resolves.toEqual(expect.objectContaining({
            code: 'ENDPOINT_REGISTRATION_FAILED',
            resolution: 'retry-same-endpoint'
        }));
        const collisionMap = (registry as unknown as {
            collisions: Map<string, unknown>;
        }).collisions;
        expect(collisionMap.size).toBe(PLAYBACK_ENDPOINT_MAX_COLLISIONS_PER_ENDPOINT);
        expect(collisionMap.size).toBeLessThanOrEqual(PLAYBACK_ENDPOINT_MAX_COLLISION_RECORDS);

        const expiresAt = now + PLAYBACK_ENDPOINT_COLLISION_RETENTION_MS + 1;
        while (now < expiresAt) {
            now += Math.min(PLAYBACK_ENDPOINT_TTL_MS - 1, expiresAt - now);
            expect(registry.heartbeat(incumbent.id, {
                protocolVersion: 1,
                endpointId: 'tab-1',
                registrationGeneration: 1,
                lastEndpointSequence: 5
            })).toEqual(expect.objectContaining({ status: 'accepted' }));
        }

        await expect(registry.register(
            createSocket('socket-after-expiry'),
            createRegistration({ endpointInstanceId: 'document-after-expiry' })
        )).resolves.toEqual(expect.objectContaining({
            resolution: 'retry-same-endpoint'
        }));
        expect(collisionMap.size).toBe(1);
    });

    it('coalesces duplicate in-flight registrations from one socket', async () => {
        let completePersistence: ((value: ReturnType<typeof createPersistedDevice>) => void)
            | undefined;
        persistRegistration.mockReturnValue(new Promise((resolve) => {
            completePersistence = resolve;
        }));
        const socket = createSocket('socket-1');
        const input = createRegistration();
        const first = registry.register(socket, input);
        const duplicate = registry.register(socket, input);

        expect(duplicate).not.toBe(first);
        await new Promise(setImmediate);
        expect(persistRegistration).toHaveBeenCalledTimes(1);
        completePersistence?.(createPersistedDevice());
        await expect(Promise.all([first, duplicate])).resolves.toEqual([
            expect.objectContaining({ status: 'registered' }),
            expect.objectContaining({ status: 'registered' })
        ]);
    });

    it('bounds duplicate acknowledgement waiters while persistence is stalled', async () => {
        let completePersistence: ((value: ReturnType<typeof createPersistedDevice>) => void)
            | undefined;
        persistRegistration.mockReturnValue(new Promise((resolve) => {
            completePersistence = resolve;
        }));
        const socket = createSocket('socket-1');
        const input = createRegistration();
        const admitted = Array.from(
            { length: PLAYBACK_ENDPOINT_MAX_COALESCED_WAITERS },
            () => registry.register(socket, input)
        );

        await expect(registry.register(socket, input)).resolves.toEqual(expect.objectContaining({
            status: 'rejected',
            code: 'ENDPOINT_REGISTRATION_FAILED'
        }));
        await new Promise(setImmediate);
        expect(persistRegistration).toHaveBeenCalledTimes(1);
        completePersistence?.(createPersistedDevice());
        await expect(Promise.all(admitted)).resolves.toEqual(
            expect.arrayContaining(Array.from(
                { length: PLAYBACK_ENDPOINT_MAX_COALESCED_WAITERS },
                () => expect.objectContaining({ status: 'registered' })
            ))
        );
    });

    it('does not let one stalled endpoint block another endpoint registration', async () => {
        let completeFirst: ((value: ReturnType<typeof createPersistedDevice>) => void)
            | undefined;
        persistRegistration.mockImplementation((registration) => {
            if (registration.endpointId === 'tab-1') {
                return new Promise((resolve) => {
                    completeFirst = resolve;
                });
            }

            return Promise.resolve(createPersistedDevice());
        });
        const first = registry.register(createSocket('socket-1'), createRegistration());
        const second = registry.register(createSocket('socket-2'), createRegistration({
            endpointId: 'tab-2',
            endpointInstanceId: 'document-2'
        }));

        await expect(second).resolves.toEqual(expect.objectContaining({
            status: 'registered',
            endpointId: 'tab-2'
        }));
        completeFirst?.(createPersistedDevice());
        await expect(first).resolves.toEqual(expect.objectContaining({
            status: 'registered',
            endpointId: 'tab-1'
        }));
    });

    it('reserves the last endpoint slot across concurrent registrations', async () => {
        for (let index = 0; index < PLAYBACK_DEVICE_MAX_ENDPOINTS - 1; index += 1) {
            await registry.register(
                createSocket(`socket-${index}`),
                createRegistration({
                    endpointId: `tab-${index}`,
                    endpointInstanceId: `document-${index}`
                })
            );
        }

        let completePersistence: ((value: ReturnType<typeof createPersistedDevice>) => void)
            | undefined;
        persistRegistration.mockImplementation((registration) => {
            if (registration.endpointId === 'tab-a') {
                return new Promise((resolve) => {
                    completePersistence = resolve;
                });
            }

            return Promise.resolve(createPersistedDevice());
        });
        const first = registry.register(createSocket('socket-a'), createRegistration({
            endpointId: 'tab-a',
            endpointInstanceId: 'document-a'
        }));
        await new Promise(setImmediate);
        const contender = registry.register(createSocket('socket-b'), createRegistration({
            endpointId: 'tab-b',
            endpointInstanceId: 'document-b'
        }));

        await expect(contender).resolves.toEqual(expect.objectContaining({
            status: 'rejected',
            code: 'ENDPOINT_REGISTRATION_FAILED',
            resolution: 'retry-same-endpoint'
        }));
        completePersistence?.(createPersistedDevice());
        await expect(first).resolves.toEqual(expect.objectContaining({
            status: 'registered',
            endpointId: 'tab-a'
        }));
        expect(registry.getOnlineEndpoints()).toHaveLength(
            PLAYBACK_DEVICE_MAX_ENDPOINTS
        );

        await expect(registry.register(
            createSocket('socket-b-retry'),
            createRegistration({
                endpointId: 'tab-b',
                endpointInstanceId: 'document-b'
            })
        )).resolves.toEqual(expect.objectContaining({
            status: 'rejected',
            code: 'PLAYBACK_ENDPOINT_CAPACITY_REACHED',
            resolution: 'none'
        }));
    });

    it('keeps every acknowledged near-capacity route in persistent recovery', async () => {
        const integratedRegistry = new PlaybackEndpointRegistry({
            now: () => now,
            commandEpoch: 'epoch-integration'
        });
        await models.playbackSession.deleteMany();
        await models.playbackEndpoint.deleteMany();
        await models.playbackDevice.deleteMany();

        try {
            for (let index = 0; index < PLAYBACK_DEVICE_MAX_ENDPOINTS - 1; index += 1) {
                await integratedRegistry.register(
                    createSocket(`integrated-socket-${index}`),
                    createRegistration({
                        endpointId: `integrated-tab-${index}`,
                        endpointInstanceId: `integrated-document-${index}`
                    })
                );
            }

            const results = await Promise.all([
                integratedRegistry.register(
                    createSocket('integrated-socket-a'),
                    createRegistration({
                        endpointId: 'integrated-tab-a',
                        endpointInstanceId: 'integrated-document-a'
                    })
                ),
                integratedRegistry.register(
                    createSocket('integrated-socket-b'),
                    createRegistration({
                        endpointId: 'integrated-tab-b',
                        endpointInstanceId: 'integrated-document-b'
                    })
                )
            ]);
            const registered = results.filter((result) => result.status === 'registered');
            const onlineEndpointIds = integratedRegistry.getOnlineEndpoints()
                .map((endpoint) => endpoint.endpointId);
            const persistedEndpointIds = new Set(
                (await models.playbackEndpoint.findMany({ select: { id: true } }))
                    .map((endpoint) => endpoint.id)
            );

            expect(registered).toHaveLength(1);
            expect(onlineEndpointIds).toHaveLength(PLAYBACK_DEVICE_MAX_ENDPOINTS);
            expect(persistedEndpointIds.size).toBe(PLAYBACK_DEVICE_MAX_ENDPOINTS);
            expect(onlineEndpointIds.every((endpointId) => (
                persistedEndpointIds.has(endpointId)
            ))).toBe(true);
        } finally {
            integratedRegistry.clear();
            await models.playbackSession.deleteMany();
            await models.playbackEndpoint.deleteMany();
            await models.playbackDevice.deleteMany();
        }
    });

    it('reserves the last device slot across concurrent registrations', async () => {
        for (
            let index = 0;
            index < PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES - 1;
            index += 1
        ) {
            await registry.register(
                createSocket(`socket-${index}`),
                createRegistration({
                    deviceId: `browser-${index}`,
                    endpointId: `tab-${index}`,
                    endpointInstanceId: `document-${index}`
                })
            );
        }

        let completePersistence: ((value: ReturnType<typeof createPersistedDevice>) => void)
            | undefined;
        persistRegistration.mockImplementation((registration) => {
            if (registration.endpointId === 'tab-a') {
                return new Promise((resolve) => {
                    completePersistence = resolve;
                });
            }

            return Promise.resolve(createPersistedDevice());
        });
        const first = registry.register(createSocket('socket-a'), createRegistration({
            deviceId: 'browser-a',
            endpointId: 'tab-a',
            endpointInstanceId: 'document-a'
        }));
        await new Promise(setImmediate);
        const contender = registry.register(createSocket('socket-b'), createRegistration({
            deviceId: 'browser-b',
            endpointId: 'tab-b',
            endpointInstanceId: 'document-b'
        }));

        await expect(contender).resolves.toEqual(expect.objectContaining({
            status: 'rejected',
            code: 'ENDPOINT_REGISTRATION_FAILED',
            resolution: 'retry-same-endpoint'
        }));
        completePersistence?.(createPersistedDevice());
        await expect(first).resolves.toEqual(expect.objectContaining({
            status: 'registered',
            endpointId: 'tab-a'
        }));
        expect(new Set(
            registry.getOnlineEndpoints().map((endpoint) => endpoint.deviceId)
        ).size).toBe(PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES);

        await expect(registry.register(
            createSocket('socket-b-retry'),
            createRegistration({
                deviceId: 'browser-b',
                endpointId: 'tab-b',
                endpointInstanceId: 'document-b'
            })
        )).resolves.toEqual(expect.objectContaining({
            status: 'rejected',
            code: 'PLAYBACK_ENDPOINT_CAPACITY_REACHED',
            resolution: 'none'
        }));
    });

    it('uses constant-space generations during endpoint identity churn', async () => {
        const socket = createSocket('socket-churn');
        const generations: number[] = [];

        for (let index = 0; index <= PLAYBACK_DEVICE_MAX_ENDPOINTS; index += 1) {
            const result = await registry.register(socket, createRegistration({
                endpointId: `tab-churn-${index}`,
                endpointInstanceId: `document-churn-${index}`
            }));

            expect(result.status).toBe('registered');
            if (result.status === 'registered') {
                generations.push(result.registrationGeneration);
            }
        }

        const internal = registry as unknown as {
            bindingsByEndpointId: Map<string, unknown>;
            lastRegistrationGeneration: number;
            pendingRegistrationsByEndpointId: Map<string, unknown>;
        };
        expect(generations).toEqual(Array.from(
            { length: PLAYBACK_DEVICE_MAX_ENDPOINTS + 1 },
            (_, index) => index + 1
        ));
        expect(internal.bindingsByEndpointId.size).toBe(1);
        expect(internal.pendingRegistrationsByEndpointId.size).toBe(0);
        expect(internal.lastRegistrationGeneration).toBe(
            PLAYBACK_DEVICE_MAX_ENDPOINTS + 1
        );

        internal.lastRegistrationGeneration = 2_147_483_647;
        await expect(registry.register(socket, createRegistration({
            endpointId: 'tab-churn-wrapped',
            endpointInstanceId: 'document-churn-wrapped'
        }))).resolves.toEqual(expect.objectContaining({
            status: 'registered',
            registrationGeneration: 1
        }));
        expect(internal.bindingsByEndpointId.size).toBe(1);
    });

    it('rate-limits repeated registration persistence from one socket', async () => {
        const socket = createSocket('socket-1');

        for (let attempt = 0; attempt < PLAYBACK_ENDPOINT_REGISTRATION_RATE_LIMIT; attempt += 1) {
            await expect(registry.register(
                socket,
                createRegistration()
            )).resolves.toEqual(expect.objectContaining({ status: 'registered' }));
        }

        await expect(registry.register(socket, createRegistration())).resolves.toEqual({
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'ENDPOINT_REGISTRATION_FAILED',
            resolution: 'retry-same-endpoint',
            retryAfterMs: PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS
        });
        expect(persistRegistration).toHaveBeenCalledTimes(
            PLAYBACK_ENDPOINT_REGISTRATION_RATE_LIMIT
        );
    });

    it('counts malformed registration events toward the socket rate limit', async () => {
        const socket = createSocket('socket-1');

        for (let attempt = 0; attempt < PLAYBACK_ENDPOINT_REGISTRATION_RATE_LIMIT; attempt += 1) {
            await expect(registry.register(socket, {
                protocolVersion: 1,
                endpointId: 'tab-1'
            })).resolves.toEqual(expect.objectContaining({
                code: 'INVALID_ENDPOINT_REGISTRATION'
            }));
        }

        await expect(registry.register(socket, createRegistration())).resolves.toEqual(
            expect.objectContaining({
                code: 'ENDPOINT_REGISTRATION_FAILED'
            })
        );
        expect(persistRegistration).not.toHaveBeenCalled();
    });

    it('marks an endpoint offline after heartbeat TTL even without disconnect', async () => {
        const socket = createSocket('socket-1');

        await registry.register(socket, createRegistration());
        now += PLAYBACK_ENDPOINT_TTL_MS + 1;

        await expect(registry.sweep()).resolves.toBe(1);
        expect(socket.emit).toHaveBeenCalledWith(
            PLAYBACK_ENDPOINT_LEASE_EXPIRED,
            {
                protocolVersion: 1,
                endpointId: 'tab-1',
                registrationGeneration: 1
            }
        );
        expect(socket.disconnect).not.toHaveBeenCalled();
        expect(socket.data).toEqual({});
        expect(persistLastSeen).toHaveBeenCalledWith(
            'tab-1',
            new Date('2026-07-20T00:00:00.000Z')
        );
        expect(registry.getOnlineEndpoints()).toEqual([]);
        expect(registry.isReportAuthorized({
            endpointId: 'tab-1',
            registrationGeneration: 1,
            registrationProof: 'stale-proof'
        })).toBe(false);
        expect(onChanged).toHaveBeenLastCalledWith({
            reason: 'offline',
            deviceId: 'browser-1',
            endpointId: 'tab-1'
        });
    });

    it('extends the endpoint lease only for the current socket generation', async () => {
        const socket = createSocket('socket-1');

        await registry.register(socket, createRegistration());
        now += PLAYBACK_ENDPOINT_TTL_MS - 1;

        expect(registry.heartbeat(socket.id, {
            protocolVersion: 1,
            endpointId: 'tab-1',
            registrationGeneration: 1,
            lastEndpointSequence: 8
        })).toEqual(expect.objectContaining({ status: 'accepted' }));
        expect(registry.heartbeat(socket.id, {
            protocolVersion: 1,
            endpointId: 'tab-1',
            registrationGeneration: 2,
            lastEndpointSequence: 9
        })).toEqual({
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            registrationGeneration: 2,
            code: 'PLAYBACK_ENDPOINT_LEASE_EXPIRED',
            resolution: 'register-again'
        });

        now += PLAYBACK_ENDPOINT_TTL_MS - 1;
        await expect(registry.sweep()).resolves.toBe(0);
        now += 2;
        await expect(registry.sweep()).resolves.toBe(1);
    });

    it('coarsely persists a continuously live route before retention can prune it', async () => {
        const socket = createSocket('socket-1');
        const registeredAt = now;
        await registry.register(socket, createRegistration());

        while (now - registeredAt < PLAYBACK_ENDPOINT_COARSE_PERSIST_INTERVAL_MS) {
            now += Math.min(
                PLAYBACK_ENDPOINT_TTL_MS - 1,
                PLAYBACK_ENDPOINT_COARSE_PERSIST_INTERVAL_MS - (now - registeredAt)
            );
            expect(registry.heartbeat(socket.id, {
                protocolVersion: 1,
                endpointId: 'tab-1',
                registrationGeneration: 1,
                lastEndpointSequence: 5
            })).toEqual(expect.objectContaining({ status: 'accepted' }));
        }

        expect(persistLastSeen).toHaveBeenCalledWith('tab-1', new Date(now));
        expect(registry.getRoute('tab-1')).not.toBeNull();
    });

    it('does not resurrect an already expired lease with a late heartbeat', async () => {
        const socket = createSocket('socket-1');

        await registry.register(socket, createRegistration());
        now += PLAYBACK_ENDPOINT_TTL_MS;

        expect(registry.heartbeat(socket.id, {
            protocolVersion: 1,
            endpointId: 'tab-1',
            registrationGeneration: 1,
            lastEndpointSequence: 5
        })).toEqual(expect.objectContaining({
            status: 'rejected',
            code: 'PLAYBACK_ENDPOINT_LEASE_EXPIRED',
            resolution: 'register-again'
        }));
        expect(registry.getOnlineEndpoints()).toEqual([]);
        expect(registry.getRoute('tab-1')).toBeNull();
        await expect(registry.sweep()).resolves.toBe(1);
    });

    it('rejects malformed registration payloads without reserving an endpoint', async () => {
        const result = await registry.register(createSocket('socket-1'), {
            protocolVersion: 1,
            endpointId: 'tab-1'
        });

        expect(result).toEqual({
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'INVALID_ENDPOINT_REGISTRATION',
            resolution: 'none',
            retryAfterMs: null
        });
        expect(persistRegistration).not.toHaveBeenCalled();
        expect(registry.getOnlineEndpoints()).toEqual([]);
    });

    it('does not publish a route when the socket closes during persistence', async () => {
        let completePersistence: ((value: ReturnType<typeof createPersistedDevice>) => void) | undefined;
        persistRegistration.mockReturnValue(new Promise((resolve) => {
            completePersistence = resolve;
        }));
        const socket = createSocket('socket-1');
        const registration = registry.register(socket, createRegistration());

        await new Promise(setImmediate);
        expect(persistRegistration).toHaveBeenCalledTimes(1);
        socket.connected = false;
        await expect(registry.unregisterSocket(socket.id)).resolves.toBe(false);
        completePersistence?.(createPersistedDevice());

        await expect(registration).resolves.toEqual(expect.objectContaining({
            status: 'rejected',
            code: 'ENDPOINT_REGISTRATION_FAILED'
        }));
        expect(registry.getOnlineEndpoints()).toEqual([]);
        expect(onChanged).not.toHaveBeenCalled();
    });

    it('rotates an endpoint that is persisted under another installation', async () => {
        persistRegistration.mockRejectedValue(new PlaybackDeviceServiceError(
            'PLAYBACK_ENDPOINT_OWNERSHIP_CONFLICT',
            'Playback endpoint belongs to a different browser installation.'
        ));

        await expect(registry.register(
            createSocket('socket-1'),
            createRegistration({ deviceId: 'browser-2' })
        )).resolves.toEqual({
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'ENDPOINT_ID_CONFLICT',
            resolution: 'rotate-endpoint',
            retryAfterMs: 1_000
        });
        expect(registry.getOnlineEndpoints()).toEqual([]);
    });

    it('returns a bounded retry contract when registration persistence fails', async () => {
        const error = new Error('database unavailable');
        const consoleError = jest.spyOn(console, 'error').mockImplementation();
        persistRegistration.mockRejectedValue(error);

        await expect(registry.register(
            createSocket('socket-1'),
            createRegistration()
        )).resolves.toEqual({
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'ENDPOINT_REGISTRATION_FAILED',
            resolution: 'retry-same-endpoint',
            retryAfterMs: 5_000
        });
        expect(consoleError).toHaveBeenCalledWith(error);
        expect(registry.getOnlineEndpoints()).toEqual([]);
    });

    it('returns a terminal response when persistent registry capacity is full', async () => {
        persistRegistration.mockRejectedValue(new PlaybackDeviceServiceError(
            'PLAYBACK_DEVICE_REGISTRY_LIMIT',
            'Playback endpoint capacity has been reached for this device.'
        ));

        await expect(registry.register(
            createSocket('socket-1'),
            createRegistration()
        )).resolves.toEqual({
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'PLAYBACK_ENDPOINT_CAPACITY_REACHED',
            resolution: 'none',
            retryAfterMs: null
        });
    });

    it('does not bind a replacement endpoint after its socket closes', async () => {
        const socket = createSocket('socket-1');
        await registry.register(socket, createRegistration());
        onChanged.mockClear();
        let completeLastSeen: (() => void) | undefined;
        persistLastSeen.mockReturnValue(new Promise<void>((resolve) => {
            completeLastSeen = resolve;
        }));

        const replacement = registry.register(socket, createRegistration({
            endpointId: 'tab-2'
        }));
        await new Promise(setImmediate);
        expect(persistLastSeen).toHaveBeenCalledWith(
            'tab-1',
            new Date('2026-07-20T00:00:00.000Z')
        );
        socket.connected = false;
        completeLastSeen?.();

        await expect(replacement).resolves.toEqual(expect.objectContaining({
            status: 'rejected',
            code: 'ENDPOINT_REGISTRATION_FAILED'
        }));
        expect(registry.getOnlineEndpoints()).toEqual([]);
        expect(onChanged).toHaveBeenCalledWith({
            reason: 'offline',
            deviceId: 'browser-1',
            endpointId: 'tab-1'
        });
        expect(onChanged).not.toHaveBeenCalledWith(expect.objectContaining({
            reason: 'registered',
            endpointId: 'tab-2'
        }));
    });
});
