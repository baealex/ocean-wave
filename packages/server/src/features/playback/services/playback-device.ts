import models from '~/models';

export const PLAYBACK_CAPABILITIES = [
    'play',
    'pause',
    'seek',
    'next',
    'previous',
    'handoff'
] as const;

export const PLAYBACK_DEVICE_TYPES = [
    'desktop-web',
    'mobile-web'
] as const;

export const PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES = 128;
export const PLAYBACK_DEVICE_MAX_ENDPOINTS = 32;
export const PLAYBACK_DEVICE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const PLAYBACK_ENDPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type PlaybackCapability = typeof PLAYBACK_CAPABILITIES[number];
export type PlaybackDeviceType = typeof PLAYBACK_DEVICE_TYPES[number];

export interface PlaybackEndpointRegistrationRecord {
    deviceId: string;
    endpointId: string;
    name: string;
    type: PlaybackDeviceType;
    capabilities: PlaybackCapability[];
    lastSeenAt: Date;
    protectedDeviceIds?: readonly string[];
    protectedEndpointIds?: readonly string[];
}

export interface OnlinePlaybackEndpoint {
    deviceId: string;
    endpointId: string;
    registrationGeneration: number;
    capabilities: PlaybackCapability[];
    lastSeenAt: Date;
}

export interface PlaybackEndpointSnapshot {
    id: string;
    capabilities: PlaybackCapability[];
    lastSeenAt: string;
    online: boolean;
    active: boolean;
    registrationGeneration: number | null;
}

export interface PlaybackDeviceSnapshot {
    id: string;
    name: string;
    type: PlaybackDeviceType;
    lastSeenAt: string;
    online: boolean;
    active: boolean;
    endpoints: PlaybackEndpointSnapshot[];
}

export interface PlaybackDeviceRegistrySnapshot {
    commandEpoch: string;
    activeEndpointId: string | null;
    serverTime: string;
    devices: PlaybackDeviceSnapshot[];
}

export type PlaybackDeviceServiceErrorCode =
    | 'INVALID_PLAYBACK_DEVICE'
    | 'PLAYBACK_ENDPOINT_OWNERSHIP_CONFLICT'
    | 'PLAYBACK_DEVICE_REGISTRY_LIMIT'
    | 'PLAYBACK_DEVICE_NOT_FOUND';

export class PlaybackDeviceServiceError extends Error {
    code: PlaybackDeviceServiceErrorCode;

    constructor(code: PlaybackDeviceServiceErrorCode, message: string) {
        super(message);
        this.name = 'PlaybackDeviceServiceError';
        this.code = code;
    }
}

export const isPlaybackDeviceServiceError = (
    error: unknown
): error is PlaybackDeviceServiceError => {
    return error instanceof PlaybackDeviceServiceError;
};

const normalizeId = (value: string, field: string) => {
    const normalized = value.trim();

    if (!normalized || normalized.length > 128) {
        throw new PlaybackDeviceServiceError(
            'INVALID_PLAYBACK_DEVICE',
            `${field} must contain between 1 and 128 characters.`
        );
    }

    return normalized;
};

const normalizeName = (value: string) => {
    const normalized = value.trim();

    if (!normalized || normalized.length > 80) {
        throw new PlaybackDeviceServiceError(
            'INVALID_PLAYBACK_DEVICE',
            'Device name must contain between 1 and 80 characters.'
        );
    }

    return normalized;
};

const normalizeType = (value: string): PlaybackDeviceType => {
    if (PLAYBACK_DEVICE_TYPES.includes(value as PlaybackDeviceType)) {
        return value as PlaybackDeviceType;
    }

    throw new PlaybackDeviceServiceError(
        'INVALID_PLAYBACK_DEVICE',
        'Playback device type is not supported.'
    );
};

const normalizeCapabilities = (values: readonly string[]) => {
    const unique = [...new Set(values)];

    if (unique.length !== values.length || unique.some((value) => (
        !PLAYBACK_CAPABILITIES.includes(value as PlaybackCapability)
    ))) {
        throw new PlaybackDeviceServiceError(
            'INVALID_PLAYBACK_DEVICE',
            'Playback endpoint capabilities are invalid.'
        );
    }

    return PLAYBACK_CAPABILITIES.filter((capability) => unique.includes(capability));
};

const parseCapabilities = (value: string): PlaybackCapability[] => {
    try {
        const parsed = JSON.parse(value);

        if (!Array.isArray(parsed)) {
            return [];
        }

        return PLAYBACK_CAPABILITIES.filter((capability) => parsed.includes(capability));
    } catch {
        return [];
    }
};

export const normalizePlaybackEndpointRegistration = (input: {
    deviceId: string;
    endpointId: string;
    name: string;
    type: string;
    capabilities: readonly string[];
    lastSeenAt: Date;
}): PlaybackEndpointRegistrationRecord => {
    return {
        deviceId: normalizeId(input.deviceId, 'deviceId'),
        endpointId: normalizeId(input.endpointId, 'endpointId'),
        name: normalizeName(input.name),
        type: normalizeType(input.type),
        capabilities: normalizeCapabilities(input.capabilities),
        lastSeenAt: input.lastSeenAt
    };
};

export const registerPlaybackEndpoint = async (
    input: PlaybackEndpointRegistrationRecord
) => {
    const normalized = normalizePlaybackEndpointRegistration(input);
    const capabilities = JSON.stringify(normalized.capabilities);
    const protectedEndpointIds = [...new Set(
        (input.protectedEndpointIds ?? []).map((endpointId) => (
            normalizeId(endpointId, 'protectedEndpointId')
        ))
    )];
    const protectedDeviceIds = [...new Set(
        (input.protectedDeviceIds ?? []).map((deviceId) => (
            normalizeId(deviceId, 'protectedDeviceId')
        ))
    )];

    if (protectedEndpointIds.length > PLAYBACK_DEVICE_MAX_ENDPOINTS) {
        throw new PlaybackDeviceServiceError(
            'INVALID_PLAYBACK_DEVICE',
            'Protected playback endpoints exceed the device capacity.'
        );
    }
    if (protectedDeviceIds.length > PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES) {
        throw new PlaybackDeviceServiceError(
            'INVALID_PLAYBACK_DEVICE',
            'Protected playback devices exceed the registry capacity.'
        );
    }

    return models.$transaction(async (transaction) => {
        const retentionCutoff = new Date(
            normalized.lastSeenAt.getTime() - PLAYBACK_DEVICE_RETENTION_MS
        );

        const activeSession = await transaction.playbackSession.findUnique({
            where: { scopeKey: 'local' },
            select: { activeDeviceId: true }
        });
        const activeEndpoint = activeSession?.activeDeviceId
            ? await transaction.playbackEndpoint.findUnique({
                where: { id: activeSession.activeDeviceId },
                select: { deviceId: true }
            })
            : null;

        const retainedDeviceIds = [...new Set([
            ...protectedDeviceIds,
            ...(activeEndpoint ? [activeEndpoint.deviceId] : [])
        ])];

        await transaction.playbackDevice.deleteMany({
            where: {
                lastSeenAt: { lt: retentionCutoff },
                ...(retainedDeviceIds.length > 0
                    ? { id: { notIn: retainedDeviceIds } }
                    : {})
            }
        });

        const existingEndpoint = await transaction.playbackEndpoint.findUnique({
            where: { id: normalized.endpointId },
            select: { deviceId: true }
        });

        if (
            existingEndpoint
            && existingEndpoint.deviceId !== normalized.deviceId
        ) {
            throw new PlaybackDeviceServiceError(
                'PLAYBACK_ENDPOINT_OWNERSHIP_CONFLICT',
                'Playback endpoint belongs to a different browser installation.'
            );
        }

        const retainedEndpointIds = [...new Set([
            normalized.endpointId,
            ...protectedEndpointIds,
            ...(activeEndpoint?.deviceId === normalized.deviceId
                && activeSession?.activeDeviceId
                ? [activeSession.activeDeviceId]
                : [])
        ])];
        const endpointRetentionCutoff = new Date(
            normalized.lastSeenAt.getTime() - PLAYBACK_ENDPOINT_RETENTION_MS
        );

        await transaction.playbackEndpoint.deleteMany({
            where: {
                deviceId: normalized.deviceId,
                lastSeenAt: { lt: endpointRetentionCutoff },
                id: { notIn: retainedEndpointIds }
            }
        });

        const existingDevice = await transaction.playbackDevice.findUnique({
            where: { id: normalized.deviceId },
            select: { id: true }
        });

        if (!existingDevice) {
            let deviceCount = await transaction.playbackDevice.count();

            if (deviceCount >= PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES) {
                const recyclableDevice = await transaction.playbackDevice.findFirst({
                    where: retainedDeviceIds.length > 0
                        ? { id: { notIn: retainedDeviceIds } }
                        : undefined,
                    orderBy: [
                        { lastSeenAt: 'asc' },
                        { createdAt: 'asc' },
                        { id: 'asc' }
                    ],
                    select: { id: true }
                });

                if (!recyclableDevice) {
                    throw new PlaybackDeviceServiceError(
                        'PLAYBACK_DEVICE_REGISTRY_LIMIT',
                        'Playback device registry capacity has been reached.'
                    );
                }

                await transaction.playbackDevice.delete({
                    where: { id: recyclableDevice.id }
                });
                deviceCount -= 1;
            }

            if (deviceCount >= PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES) {
                throw new PlaybackDeviceServiceError(
                    'PLAYBACK_DEVICE_REGISTRY_LIMIT',
                    'Playback device registry capacity has been reached.'
                );
            }
        }

        if (!existingEndpoint) {
            let endpointCount = await transaction.playbackEndpoint.count({
                where: { deviceId: normalized.deviceId }
            });

            if (endpointCount >= PLAYBACK_DEVICE_MAX_ENDPOINTS) {
                const recyclableEndpoint = await transaction.playbackEndpoint.findFirst({
                    where: {
                        deviceId: normalized.deviceId,
                        id: { notIn: retainedEndpointIds }
                    },
                    orderBy: [
                        { lastSeenAt: 'asc' },
                        { createdAt: 'asc' },
                        { id: 'asc' }
                    ],
                    select: { id: true }
                });

                if (!recyclableEndpoint) {
                    throw new PlaybackDeviceServiceError(
                        'PLAYBACK_DEVICE_REGISTRY_LIMIT',
                        'Playback endpoint capacity has been reached for this device.'
                    );
                }

                await transaction.playbackEndpoint.delete({
                    where: { id: recyclableEndpoint.id }
                });
                endpointCount -= 1;
            }

            if (endpointCount >= PLAYBACK_DEVICE_MAX_ENDPOINTS) {
                throw new PlaybackDeviceServiceError(
                    'PLAYBACK_DEVICE_REGISTRY_LIMIT',
                    'Playback endpoint capacity has been reached for this device.'
                );
            }
        }

        const device = await transaction.playbackDevice.upsert({
            where: { id: normalized.deviceId },
            create: {
                id: normalized.deviceId,
                name: normalized.name,
                type: normalized.type,
                lastSeenAt: normalized.lastSeenAt
            },
            update: {
                type: normalized.type,
                lastSeenAt: normalized.lastSeenAt
            }
        });

        await transaction.playbackEndpoint.upsert({
            where: { id: normalized.endpointId },
            create: {
                id: normalized.endpointId,
                deviceId: normalized.deviceId,
                capabilities,
                lastSeenAt: normalized.lastSeenAt
            },
            update: {
                capabilities,
                lastSeenAt: normalized.lastSeenAt
            }
        });

        return device;
    });
};

export const touchPlaybackEndpoint = async (
    endpointId: string,
    lastSeenAt: Date
) => {
    const normalizedEndpointId = normalizeId(endpointId, 'endpointId');

    await models.$transaction(async (transaction) => {
        const endpoint = await transaction.playbackEndpoint.findUnique({
            where: { id: normalizedEndpointId },
            select: {
                lastSeenAt: true,
                Device: {
                    select: { id: true, lastSeenAt: true }
                }
            }
        });

        if (!endpoint) {
            return;
        }

        if (endpoint.lastSeenAt < lastSeenAt) {
            await transaction.playbackEndpoint.update({
                where: { id: normalizedEndpointId },
                data: { lastSeenAt }
            });
        }
        if (endpoint.Device.lastSeenAt < lastSeenAt) {
            await transaction.playbackDevice.update({
                where: { id: endpoint.Device.id },
                data: { lastSeenAt }
            });
        }
    });
};

export const renamePlaybackDevice = async (
    deviceId: string,
    name: string
) => {
    const normalizedDeviceId = normalizeId(deviceId, 'deviceId');
    const normalizedName = normalizeName(name);
    const existing = await models.playbackDevice.findUnique({
        where: { id: normalizedDeviceId },
        select: { id: true }
    });

    if (!existing) {
        throw new PlaybackDeviceServiceError(
            'PLAYBACK_DEVICE_NOT_FOUND',
            'Playback device was not found.'
        );
    }

    return models.playbackDevice.update({
        where: { id: normalizedDeviceId },
        data: { name: normalizedName }
    });
};

const maxDate = (dates: Date[]) => {
    return new Date(Math.max(...dates.map((date) => date.getTime())));
};

export const getPlaybackDeviceRegistrySnapshot = async (
    onlineEndpoints: OnlinePlaybackEndpoint[],
    commandEpoch: string,
    now = new Date()
): Promise<PlaybackDeviceRegistrySnapshot> => {
    const [devices, session] = await Promise.all([
        models.playbackDevice.findMany({
            orderBy: { lastSeenAt: 'desc' },
            take: PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES,
            include: {
                Endpoint: {
                    orderBy: { lastSeenAt: 'desc' },
                    take: PLAYBACK_DEVICE_MAX_ENDPOINTS
                }
            }
        }),
        models.playbackSession.findUnique({
            where: { scopeKey: 'local' },
            select: { activeDeviceId: true }
        })
    ]);
    const activeEndpointId = session?.activeDeviceId ?? null;
    const onlineByEndpointId = new Map(
        onlineEndpoints.map((endpoint) => [endpoint.endpointId, endpoint])
    );
    const snapshots = devices.map<PlaybackDeviceSnapshot>((device) => {
        const endpoints = device.Endpoint.map<PlaybackEndpointSnapshot>((endpoint) => {
            const online = onlineByEndpointId.get(endpoint.id);
            const lastSeenAt = online?.lastSeenAt ?? endpoint.lastSeenAt;

            return {
                id: endpoint.id,
                capabilities: online?.capabilities ?? parseCapabilities(endpoint.capabilities),
                lastSeenAt: lastSeenAt.toISOString(),
                online: Boolean(online),
                active: endpoint.id === activeEndpointId,
                registrationGeneration: online?.registrationGeneration ?? null
            };
        }).sort((left, right) => {
            if (left.active !== right.active) return left.active ? -1 : 1;
            if (left.online !== right.online) return left.online ? -1 : 1;
            return right.lastSeenAt.localeCompare(left.lastSeenAt);
        });
        const lastSeenAt = maxDate([
            device.lastSeenAt,
            ...endpoints.map((endpoint) => new Date(endpoint.lastSeenAt))
        ]);

        return {
            id: device.id,
            name: device.name,
            type: normalizeType(device.type),
            lastSeenAt: lastSeenAt.toISOString(),
            online: endpoints.some((endpoint) => endpoint.online),
            active: endpoints.some((endpoint) => endpoint.active),
            endpoints
        };
    }).sort((left, right) => {
        if (left.active !== right.active) return left.active ? -1 : 1;
        if (left.online !== right.online) return left.online ? -1 : 1;
        const nameOrder = left.name.localeCompare(right.name);
        return nameOrder || left.id.localeCompare(right.id);
    });

    return {
        commandEpoch,
        activeEndpointId,
        serverTime: now.toISOString(),
        devices: snapshots
    };
};
