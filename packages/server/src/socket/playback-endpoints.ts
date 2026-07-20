import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';

import {
    isPlaybackDeviceServiceError,
    normalizePlaybackEndpointRegistration,
    PLAYBACK_DEVICE_MAX_ENDPOINTS,
    PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES,
    type OnlinePlaybackEndpoint,
    type PlaybackCapability,
    type PlaybackEndpointRegistrationRecord,
    registerPlaybackEndpoint,
    touchPlaybackEndpoint
} from '~/features/playback/services/playback-device';

import { connectors } from './connectors';

export const PLAYBACK_ENDPOINT_REGISTER = 'playback:endpoint-register';
export const PLAYBACK_ENDPOINT_HEARTBEAT = 'playback:endpoint-heartbeat';
export const PLAYBACK_ENDPOINT_LEASE_EXPIRED = 'playback:endpoint-lease-expired';
export const PLAYBACK_ENDPOINTS_INVALIDATED = 'playback:endpoints-invalidated';

export const PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS = 15_000;
export const PLAYBACK_ENDPOINT_TTL_MS = 45_000;
export const PLAYBACK_ENDPOINT_DISCONNECT_GRACE_MS = 5_000;
export const PLAYBACK_ENDPOINT_COLLISION_GRACE_MS =
    PLAYBACK_ENDPOINT_TTL_MS + PLAYBACK_ENDPOINT_DISCONNECT_GRACE_MS;
export const PLAYBACK_ENDPOINT_COLLISION_RETRY_MS = 1_000;
export const PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS = 5_000;
export const PLAYBACK_ENDPOINT_SWEEP_INTERVAL_MS = 5_000;
export const PLAYBACK_ENDPOINT_MAX_CONCURRENT_REGISTRATIONS = 8;
export const PLAYBACK_ENDPOINT_MAX_PENDING_REGISTRATIONS = 128;
export const PLAYBACK_ENDPOINT_REGISTRATION_RATE_WINDOW_MS = 60_000;
export const PLAYBACK_ENDPOINT_REGISTRATION_RATE_LIMIT = 70;
export const PLAYBACK_ENDPOINT_MAX_COALESCED_WAITERS = 4;
export const PLAYBACK_ENDPOINT_MAX_COLLISION_RECORDS = 256;
export const PLAYBACK_ENDPOINT_MAX_COLLISIONS_PER_ENDPOINT = 16;
export const PLAYBACK_ENDPOINT_COLLISION_RETENTION_MS =
    PLAYBACK_ENDPOINT_COLLISION_GRACE_MS * 2;
export const PLAYBACK_ENDPOINT_COARSE_PERSIST_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const PLAYBACK_ENDPOINT_MAX_REGISTRATION_GENERATION = 2_147_483_647;

export interface PlaybackEndpointRegistrationInput {
    protocolVersion: 1;
    deviceId: string;
    endpointId: string;
    endpointInstanceId: string;
    name: string;
    type: string;
    capabilities: string[];
    lastEndpointSequence: number;
}

export type PlaybackEndpointRegistrationAck =
    | {
        protocolVersion: 1;
        status: 'registered';
        endpointId: string;
        registrationGeneration: number;
        commandEpoch: string;
        registrationProof: string;
      }
    | {
        protocolVersion: 1;
        status: 'rejected';
        endpointId: string;
        code: 'ENDPOINT_ID_CONFLICT';
        resolution: 'retry-same-endpoint' | 'rotate-endpoint';
        retryAfterMs: number;
      }
    | {
        protocolVersion: 1;
        status: 'rejected';
        endpointId: string | null;
        code: 'INVALID_ENDPOINT_REGISTRATION';
        resolution: 'none';
        retryAfterMs: null;
      }
    | {
        protocolVersion: 1;
        status: 'rejected';
        endpointId: string | null;
        code: 'ENDPOINT_REGISTRATION_FAILED';
        resolution: 'retry-same-endpoint';
        retryAfterMs: number;
      }
    | {
        protocolVersion: 1;
        status: 'rejected';
        endpointId: string | null;
        code: 'PLAYBACK_ENDPOINT_CAPACITY_REACHED';
        resolution: 'none';
        retryAfterMs: null;
      };

export interface PlaybackEndpointHeartbeat {
    protocolVersion: 1;
    endpointId: string;
    registrationGeneration: number;
    lastEndpointSequence: number;
}

export type PlaybackEndpointHeartbeatAck =
    | {
        protocolVersion: 1;
        status: 'accepted';
        endpointId: string;
        registrationGeneration: number;
      }
    | {
        protocolVersion: 1;
        status: 'rejected';
        endpointId: string | null;
        registrationGeneration: number | null;
        code: 'INVALID_ENDPOINT_HEARTBEAT' | 'PLAYBACK_ENDPOINT_LEASE_EXPIRED';
        resolution: 'none' | 'register-again';
      };

export interface PlaybackEndpointLeaseExpired {
    protocolVersion: 1;
    endpointId: string;
    registrationGeneration: number;
}

export interface PlaybackEndpointsInvalidatedNotification {
    reason: 'registered' | 'offline' | 'renamed' | 'active-changed';
    deviceId: string | null;
    endpointId: string | null;
    originClientId?: string | null;
}

interface PlaybackEndpointBinding {
    socket: Socket;
    socketId: string;
    deviceId: string;
    endpointId: string;
    endpointInstanceId: string;
    registrationGeneration: number;
    registrationProof: string;
    capabilities: PlaybackCapability[];
    lastEndpointSequence: number;
    registeredAtMs: number;
    lastSeenAtMs: number;
    lastPersistedAtMs: number;
    leaseExpiresAtMs: number;
}

export interface PlaybackEndpointRoute {
    readonly socket: Socket;
    readonly socketId: string;
    readonly deviceId: string;
    readonly endpointId: string;
    readonly registrationGeneration: number;
    readonly capabilities: readonly PlaybackCapability[];
    readonly lastEndpointSequence: number;
}

export interface PlaybackEndpointReportAuthorization {
    endpointId: string;
    registrationGeneration: number;
    registrationProof: string;
}

interface PlaybackEndpointCollision {
    endpointId: string;
    endpointInstanceId: string;
    incumbentGeneration: number;
    firstSeenAtMs: number;
    lastSeenAtMs: number;
}

interface PlaybackEndpointRegistryDependencies {
    now?: () => number;
    commandEpoch?: string;
    persistRegistration?: typeof registerPlaybackEndpoint;
    persistLastSeen?: typeof touchPlaybackEndpoint;
    onChanged?: (notification: PlaybackEndpointsInvalidatedNotification) => void;
}

interface PlaybackRegistrationRateWindow {
    startedAtMs: number;
    attempts: number;
}

interface PlaybackPendingRegistration {
    token: symbol;
    deviceId: string;
    endpointId: string;
}

const normalizeOpaqueId = (value: unknown) => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized && normalized.length <= 128 ? normalized : null;
};

const normalizeLastEndpointSequence = (value: unknown) => {
    return Number.isSafeInteger(value) && Number(value) >= 0
        ? Number(value)
        : null;
};

const isRegistrationInput = (
    input: unknown
): input is PlaybackEndpointRegistrationInput => {
    if (!input || typeof input !== 'object') {
        return false;
    }

    const candidate = input as Partial<PlaybackEndpointRegistrationInput>;
    return candidate.protocolVersion === 1
        && Boolean(normalizeOpaqueId(candidate.deviceId))
        && Boolean(normalizeOpaqueId(candidate.endpointId))
        && Boolean(normalizeOpaqueId(candidate.endpointInstanceId))
        && typeof candidate.name === 'string'
        && candidate.name.length <= 80
        && typeof candidate.type === 'string'
        && candidate.type.length <= 32
        && Array.isArray(candidate.capabilities)
        && candidate.capabilities.length <= 6
        && candidate.capabilities.every((value) => (
            typeof value === 'string' && value.length <= 32
        ))
        && normalizeLastEndpointSequence(candidate.lastEndpointSequence) !== null;
};

const registrationFingerprint = (input: PlaybackEndpointRegistrationInput) => {
    return JSON.stringify([
        input.protocolVersion,
        input.deviceId,
        input.endpointId,
        input.endpointInstanceId,
        input.name,
        input.type,
        input.capabilities,
        input.lastEndpointSequence
    ]);
};

const collisionKey = (endpointId: string, endpointInstanceId: string) => {
    return `${endpointId}\u0000${endpointInstanceId}`;
};

export class PlaybackEndpointRegistry {
    readonly commandEpoch: string;

    private readonly now: () => number;
    private readonly persistRegistration: typeof registerPlaybackEndpoint;
    private readonly persistLastSeen: typeof touchPlaybackEndpoint;
    private readonly onChanged: (notification: PlaybackEndpointsInvalidatedNotification) => void;
    private readonly bindingsByEndpointId = new Map<string, PlaybackEndpointBinding>();
    private readonly endpointIdBySocketId = new Map<string, string>();
    private readonly pendingRegistrationsByEndpointId = new Map<
        string,
        PlaybackPendingRegistration
    >();
    private readonly collisions = new Map<string, PlaybackEndpointCollision>();
    private readonly registrationsBySocketId = new Map<string, {
        fingerprint: string;
        promise: Promise<PlaybackEndpointRegistrationAck>;
        waiterCount: number;
    }>();
    private readonly registrationQueuesByEndpointId = new Map<string, Promise<void>>();
    private readonly registrationRateBySocketId = new Map<string, PlaybackRegistrationRateWindow>();
    private readonly registrationSlotWaiters: Array<() => void> = [];
    private activeRegistrationSlots = 0;
    private pendingRegistrationCount = 0;
    private lastRegistrationGeneration = 0;
    private sweepTimer: ReturnType<typeof setInterval> | null = null;

    constructor(dependencies: PlaybackEndpointRegistryDependencies = {}) {
        this.now = dependencies.now ?? Date.now;
        this.commandEpoch = dependencies.commandEpoch ?? randomUUID();
        this.persistRegistration = dependencies.persistRegistration ?? registerPlaybackEndpoint;
        this.persistLastSeen = dependencies.persistLastSeen ?? touchPlaybackEndpoint;
        this.onChanged = dependencies.onChanged ?? (() => undefined);
    }

    start() {
        if (this.sweepTimer) {
            return;
        }

        this.sweepTimer = setInterval(() => {
            void this.sweep();
        }, PLAYBACK_ENDPOINT_SWEEP_INTERVAL_MS);
        this.sweepTimer.unref?.();
    }

    stop() {
        if (!this.sweepTimer) {
            return;
        }

        clearInterval(this.sweepTimer);
        this.sweepTimer = null;
    }

    register(
        socket: Socket,
        input: unknown
    ): Promise<PlaybackEndpointRegistrationAck> {
        if (!this.acceptRegistrationAttempt(socket.id)) {
            return Promise.resolve(this.registrationFailedAck(input));
        }

        if (!isRegistrationInput(input)) {
            return Promise.resolve(this.invalidRegistrationAck(input));
        }

        const fingerprint = registrationFingerprint(input);
        const inFlight = this.registrationsBySocketId.get(socket.id);

        if (inFlight) {
            if (
                inFlight.fingerprint !== fingerprint
                || inFlight.waiterCount >= PLAYBACK_ENDPOINT_MAX_COALESCED_WAITERS
            ) {
                return Promise.resolve(this.registrationFailedAck(input));
            }

            inFlight.waiterCount += 1;
            return inFlight.promise.finally(() => {
                inFlight.waiterCount = Math.max(inFlight.waiterCount - 1, 1);
            });
        }

        if (this.pendingRegistrationCount >= PLAYBACK_ENDPOINT_MAX_PENDING_REGISTRATIONS) {
            return Promise.resolve(this.registrationFailedAck(input));
        }

        const endpointId = input.endpointId.trim();
        if (this.registrationQueuesByEndpointId.has(endpointId)) {
            return Promise.resolve(this.registrationFailedAck(input));
        }

        const capacityAck = this.registrationCapacityAck(input);

        if (capacityAck) {
            return Promise.resolve(capacityAck);
        }

        const reservation: PlaybackPendingRegistration = {
            token: Symbol('playback-endpoint-registration'),
            deviceId: input.deviceId.trim(),
            endpointId
        };
        this.pendingRegistrationsByEndpointId.set(endpointId, reservation);
        const operation = Promise.resolve().then(async () => {
            await this.acquireRegistrationSlot();
            try {
                return await this.registerSerial(socket, input);
            } finally {
                this.releaseRegistrationSlot();
            }
        }).catch((error): PlaybackEndpointRegistrationAck => {
            console.error(error);
            return this.registrationFailedAck(input);
        });
        const endpointQueue = operation.then(() => undefined);

        this.pendingRegistrationCount += 1;
        this.registrationQueuesByEndpointId.set(endpointId, endpointQueue);
        const settled = operation.finally(() => {
            this.pendingRegistrationCount -= 1;
            const current = this.registrationsBySocketId.get(socket.id);

            if (current?.promise === settled) {
                this.registrationsBySocketId.delete(socket.id);
            }
            if (this.registrationQueuesByEndpointId.get(endpointId) === endpointQueue) {
                this.registrationQueuesByEndpointId.delete(endpointId);
            }
            if (
                this.pendingRegistrationsByEndpointId.get(endpointId)?.token
                === reservation.token
            ) {
                this.pendingRegistrationsByEndpointId.delete(endpointId);
            }
        });

        this.registrationsBySocketId.set(socket.id, {
            fingerprint,
            promise: settled,
            waiterCount: 1
        });
        return settled;
    }

    heartbeat(socketId: string, input: unknown): PlaybackEndpointHeartbeatAck {
        if (!input || typeof input !== 'object') {
            return this.invalidHeartbeatAck(input);
        }

        const heartbeat = input as Partial<PlaybackEndpointHeartbeat>;
        const endpointId = normalizeOpaqueId(heartbeat.endpointId);
        const sequence = normalizeLastEndpointSequence(heartbeat.lastEndpointSequence);
        const registeredEndpointId = this.endpointIdBySocketId.get(socketId);

        if (
            heartbeat.protocolVersion !== 1
            || !endpointId
            || sequence === null
            || !Number.isSafeInteger(heartbeat.registrationGeneration)
            || heartbeat.registrationGeneration === undefined
            || heartbeat.registrationGeneration < 1
            || registeredEndpointId !== endpointId
        ) {
            return heartbeat.protocolVersion === 1
                && endpointId
                && Number.isSafeInteger(heartbeat.registrationGeneration)
                && Number(heartbeat.registrationGeneration) >= 1
                ? this.expiredHeartbeatAck(
                    endpointId,
                    Number(heartbeat.registrationGeneration)
                )
                : this.invalidHeartbeatAck(input);
        }

        const binding = this.bindingsByEndpointId.get(endpointId);

        if (
            !binding
            || binding.socketId !== socketId
            || binding.registrationGeneration !== heartbeat.registrationGeneration
        ) {
            return this.expiredHeartbeatAck(
                endpointId,
                Number(heartbeat.registrationGeneration)
            );
        }

        const now = this.now();

        if (binding.leaseExpiresAtMs <= now) {
            return this.expiredHeartbeatAck(
                binding.endpointId,
                binding.registrationGeneration
            );
        }

        binding.lastSeenAtMs = now;
        binding.leaseExpiresAtMs = now + PLAYBACK_ENDPOINT_TTL_MS;
        binding.lastEndpointSequence = Math.max(binding.lastEndpointSequence, sequence);
        if (
            now - binding.lastPersistedAtMs
            >= PLAYBACK_ENDPOINT_COARSE_PERSIST_INTERVAL_MS
        ) {
            binding.lastPersistedAtMs = now;
            void this.persistLastSeenSafely(binding);
        }
        return {
            protocolVersion: 1,
            status: 'accepted',
            endpointId: binding.endpointId,
            registrationGeneration: binding.registrationGeneration
        };
    }

    async unregisterSocket(socketId: string) {
        this.registrationRateBySocketId.delete(socketId);
        const endpointId = this.endpointIdBySocketId.get(socketId);

        if (!endpointId) {
            return false;
        }

        const binding = this.bindingsByEndpointId.get(endpointId);

        if (!binding || binding.socketId !== socketId) {
            this.endpointIdBySocketId.delete(socketId);
            return false;
        }

        this.removeBinding(binding);
        await this.persistLastSeenSafely(binding);
        this.notifyChanged({
            reason: 'offline',
            deviceId: binding.deviceId,
            endpointId: binding.endpointId
        });
        return true;
    }

    async sweep(now = this.now()) {
        const expired = [...this.bindingsByEndpointId.values()].filter((binding) => (
            binding.leaseExpiresAtMs <= now
        ));

        for (const binding of expired) {
            this.removeBinding(binding);
            this.notifyLeaseExpired(binding);
            await this.persistLastSeenSafely(binding);
            this.notifyChanged({
                reason: 'offline',
                deviceId: binding.deviceId,
                endpointId: binding.endpointId
            });
        }

        return expired.length;
    }

    getOnlineEndpoints(): OnlinePlaybackEndpoint[] {
        const now = this.now();

        return [...this.bindingsByEndpointId.values()]
            .filter((binding) => (
                binding.socket.connected
                && binding.leaseExpiresAtMs > now
            ))
            .map((binding) => ({
                deviceId: binding.deviceId,
                endpointId: binding.endpointId,
                registrationGeneration: binding.registrationGeneration,
                capabilities: [...binding.capabilities],
                lastSeenAt: new Date(binding.lastSeenAtMs)
            }));
    }

    getRoute(endpointId: string): PlaybackEndpointRoute | null {
        const binding = this.bindingsByEndpointId.get(endpointId);

        if (
            !binding?.socket.connected
            || binding.leaseExpiresAtMs <= this.now()
        ) {
            return null;
        }

        return {
            socket: binding.socket,
            socketId: binding.socketId,
            deviceId: binding.deviceId,
            endpointId: binding.endpointId,
            registrationGeneration: binding.registrationGeneration,
            capabilities: [...binding.capabilities],
            lastEndpointSequence: binding.lastEndpointSequence
        };
    }

    isReportAuthorized(authorization: PlaybackEndpointReportAuthorization) {
        const binding = this.bindingsByEndpointId.get(authorization.endpointId);

        return Boolean(
            binding?.socket.connected
            && binding.leaseExpiresAtMs > this.now()
            && binding.registrationGeneration === authorization.registrationGeneration
            && binding.registrationProof === authorization.registrationProof
        );
    }

    clear() {
        this.stop();
        for (const binding of this.bindingsByEndpointId.values()) {
            this.clearSocketRegistration(binding);
        }
        this.bindingsByEndpointId.clear();
        this.endpointIdBySocketId.clear();
        this.pendingRegistrationsByEndpointId.clear();
        this.collisions.clear();
        this.registrationsBySocketId.clear();
        this.registrationQueuesByEndpointId.clear();
        this.registrationRateBySocketId.clear();
        this.lastRegistrationGeneration = 0;
    }

    private acceptRegistrationAttempt(socketId: string) {
        const now = this.now();
        const current = this.registrationRateBySocketId.get(socketId);

        if (
            !current
            || now - current.startedAtMs >= PLAYBACK_ENDPOINT_REGISTRATION_RATE_WINDOW_MS
        ) {
            this.registrationRateBySocketId.set(socketId, {
                startedAtMs: now,
                attempts: 1
            });
            return true;
        }

        if (current.attempts >= PLAYBACK_ENDPOINT_REGISTRATION_RATE_LIMIT) {
            return false;
        }

        current.attempts += 1;
        return true;
    }

    private acquireRegistrationSlot() {
        if (
            this.activeRegistrationSlots
            < PLAYBACK_ENDPOINT_MAX_CONCURRENT_REGISTRATIONS
        ) {
            this.activeRegistrationSlots += 1;
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            this.registrationSlotWaiters.push(() => {
                this.activeRegistrationSlots += 1;
                resolve();
            });
        });
    }

    private releaseRegistrationSlot() {
        this.activeRegistrationSlots = Math.max(this.activeRegistrationSlots - 1, 0);
        this.registrationSlotWaiters.shift()?.();
    }

    private async registerSerial(
        socket: Socket,
        input: unknown
    ): Promise<PlaybackEndpointRegistrationAck> {
        if (!isRegistrationInput(input)) {
            return this.invalidRegistrationAck(input);
        }

        const endpointInstanceId = normalizeOpaqueId(input.endpointInstanceId);
        const lastEndpointSequence = normalizeLastEndpointSequence(input.lastEndpointSequence);
        let registration;

        try {
            if (!endpointInstanceId || lastEndpointSequence === null) {
                throw new Error('Endpoint registration identity is invalid.');
            }

            registration = normalizePlaybackEndpointRegistration({
                deviceId: input.deviceId,
                endpointId: input.endpointId,
                name: input.name,
                type: input.type,
                capabilities: input.capabilities,
                lastSeenAt: new Date(this.now())
            });
        } catch (error) {
            if (!isPlaybackDeviceServiceError(error)) {
                console.error(error);
            }
            return this.invalidRegistrationAck(input);
        }

        const now = registration.lastSeenAt.getTime();

        if (!socket.connected) {
            return this.registrationFailedAck(input);
        }

        let incumbent = this.bindingsByEndpointId.get(registration.endpointId);

        if (
            incumbent
            && (
                !incumbent.socket.connected
                || incumbent.leaseExpiresAtMs <= now
            )
        ) {
            this.removeBinding(incumbent);
            this.notifyLeaseExpired(incumbent);
            await this.persistLastSeenSafely(incumbent);
            this.notifyChanged({
                reason: 'offline',
                deviceId: incumbent.deviceId,
                endpointId: incumbent.endpointId
            });
            incumbent = undefined;
        }

        if (
            incumbent
            && incumbent.socketId !== socket.id
            && incumbent.endpointInstanceId !== endpointInstanceId
        ) {
            if (incumbent.deviceId !== registration.deviceId) {
                return this.endpointOwnershipConflictAck(registration.endpointId);
            }

            return this.resolveCollision(incumbent, endpointInstanceId, now);
        }

        if (
            incumbent
            && incumbent.socketId === socket.id
            && incumbent.endpointInstanceId === endpointInstanceId
        ) {
            try {
                await this.persistRegistration(
                    this.withProtectedEndpoints(registration, now)
                );
            } catch (error) {
                return this.persistRegistrationFailureAck(input, error);
            }

            if (
                !socket.connected
                || this.bindingsByEndpointId.get(registration.endpointId) !== incumbent
            ) {
                return this.registrationFailedAck(input);
            }

            incumbent.lastSeenAtMs = now;
            incumbent.lastPersistedAtMs = now;
            incumbent.leaseExpiresAtMs = now + PLAYBACK_ENDPOINT_TTL_MS;
            incumbent.lastEndpointSequence = Math.max(
                incumbent.lastEndpointSequence,
                lastEndpointSequence
            );
            incumbent.capabilities = registration.capabilities;
            Object.assign(socket.data, {
                playbackDeviceId: incumbent.deviceId,
                playbackEndpointId: incumbent.endpointId,
                playbackEndpointInstanceId: incumbent.endpointInstanceId,
                playbackRegistrationGeneration: incumbent.registrationGeneration,
                playbackRegistrationProof: incumbent.registrationProof
            });
            return this.registeredAck(incumbent);
        }

        try {
            await this.persistRegistration(
                this.withProtectedEndpoints(registration, now)
            );
        } catch (error) {
            return this.persistRegistrationFailureAck(input, error);
        }

        if (!socket.connected) {
            return this.registrationFailedAck(input);
        }

        const previousEndpointId = this.endpointIdBySocketId.get(socket.id);
        const previousSocketBinding = previousEndpointId
            ? this.bindingsByEndpointId.get(previousEndpointId)
            : undefined;

        if (previousSocketBinding && previousSocketBinding.socketId === socket.id) {
            this.removeBinding(previousSocketBinding);
            await this.persistLastSeenSafely(previousSocketBinding);
            this.notifyChanged({
                reason: 'offline',
                deviceId: previousSocketBinding.deviceId,
                endpointId: previousSocketBinding.endpointId
            });

            if (!socket.connected) {
                return this.registrationFailedAck(input);
            }
        }

        const generation = this.allocateRegistrationGeneration();
        const binding: PlaybackEndpointBinding = {
            socket,
            socketId: socket.id,
            deviceId: registration.deviceId,
            endpointId: registration.endpointId,
            endpointInstanceId,
            registrationGeneration: generation,
            registrationProof: randomUUID(),
            capabilities: registration.capabilities,
            lastEndpointSequence,
            registeredAtMs: now,
            lastSeenAtMs: now,
            lastPersistedAtMs: now,
            leaseExpiresAtMs: now + PLAYBACK_ENDPOINT_TTL_MS
        };

        this.bindingsByEndpointId.set(binding.endpointId, binding);
        this.endpointIdBySocketId.set(binding.socketId, binding.endpointId);
        this.clearEndpointCollisions(binding.endpointId);
        Object.assign(socket.data, {
            playbackDeviceId: binding.deviceId,
            playbackEndpointId: binding.endpointId,
            playbackEndpointInstanceId: binding.endpointInstanceId,
            playbackRegistrationGeneration: generation,
            playbackRegistrationProof: binding.registrationProof
        });

        if (incumbent && incumbent.socketId !== socket.id) {
            this.endpointIdBySocketId.delete(incumbent.socketId);
            this.clearSocketRegistration(incumbent);
            try {
                incumbent.socket.disconnect(true);
            } catch (error) {
                console.error(error);
            }
        }

        this.notifyChanged({
            reason: 'registered',
            deviceId: binding.deviceId,
            endpointId: binding.endpointId
        });
        return this.registeredAck(binding);
    }

    private withProtectedEndpoints(
        registration: PlaybackEndpointRegistrationRecord,
        now: number
    ): PlaybackEndpointRegistrationRecord {
        const protectedEndpointOwners = this.getProtectedEndpointOwners(now);
        const protectedDeviceIds = [...new Set(
            protectedEndpointOwners.values()
        )];
        const protectedEndpointIds = [...protectedEndpointOwners]
            .filter(([endpointId, deviceId]) => (
                endpointId !== registration.endpointId
                && deviceId === registration.deviceId
            ))
            .map(([endpointId]) => endpointId);

        return {
            ...registration,
            protectedDeviceIds,
            protectedEndpointIds
        };
    }

    private getProtectedEndpointOwners(now: number) {
        const owners = new Map<string, string>();

        for (const binding of this.bindingsByEndpointId.values()) {
            if (
                binding.socket.connected
                && binding.leaseExpiresAtMs > now
            ) {
                owners.set(binding.endpointId, binding.deviceId);
            }
        }
        for (const pending of this.pendingRegistrationsByEndpointId.values()) {
            if (!owners.has(pending.endpointId)) {
                owners.set(pending.endpointId, pending.deviceId);
            }
        }

        return owners;
    }

    private registrationCapacityAck(
        input: PlaybackEndpointRegistrationInput
    ): PlaybackEndpointRegistrationAck | null {
        const endpointId = input.endpointId.trim();
        const deviceId = input.deviceId.trim();
        const now = this.now();
        const owners = this.getProtectedEndpointOwners(now);

        if (owners.has(endpointId)) {
            return null;
        }

        const liveEndpointIds = new Set(
            [...this.bindingsByEndpointId.values()]
                .filter((binding) => (
                    binding.socket.connected
                    && binding.leaseExpiresAtMs > now
                ))
                .map((binding) => binding.endpointId)
        );
        const deviceEndpointIds = [...owners]
            .filter(([, ownerDeviceId]) => ownerDeviceId === deviceId)
            .map(([ownerEndpointId]) => ownerEndpointId);
        const hasPendingEndpointForDevice = deviceEndpointIds.some((ownerEndpointId) => (
            !liveEndpointIds.has(ownerEndpointId)
        ));

        if (
            hasPendingEndpointForDevice
            && deviceEndpointIds.length >= PLAYBACK_DEVICE_MAX_ENDPOINTS - 1
        ) {
            return this.registrationFailedAck(input);
        }

        if (deviceEndpointIds.length >= PLAYBACK_DEVICE_MAX_ENDPOINTS) {
            return hasPendingEndpointForDevice
                ? this.registrationFailedAck(input)
                : this.capacityReachedAck(input);
        }

        const deviceIds = new Set(owners.values());
        const liveDeviceIds = new Set(
            [...this.bindingsByEndpointId.values()]
                .filter((binding) => (
                    binding.socket.connected
                    && binding.leaseExpiresAtMs > now
                ))
                .map((binding) => binding.deviceId)
        );

        if (
            !deviceIds.has(deviceId)
            && deviceIds.size >= PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES
        ) {
            return [...deviceIds].some((ownerDeviceId) => (
                !liveDeviceIds.has(ownerDeviceId)
            ))
                ? this.registrationFailedAck(input)
                : this.capacityReachedAck(input);
        }

        if (!deviceIds.has(deviceId)) {
            const hasPendingDevice = [...deviceIds].some((ownerDeviceId) => (
                !liveDeviceIds.has(ownerDeviceId)
            ));

            if (
                hasPendingDevice
                && deviceIds.size >= PLAYBACK_DEVICE_REGISTRY_MAX_DEVICES - 1
            ) {
                return this.registrationFailedAck(input);
            }
        }

        return null;
    }

    private allocateRegistrationGeneration() {
        this.lastRegistrationGeneration = this.lastRegistrationGeneration
            >= PLAYBACK_ENDPOINT_MAX_REGISTRATION_GENERATION
            ? 1
            : this.lastRegistrationGeneration + 1;
        return this.lastRegistrationGeneration;
    }

    private resolveCollision(
        incumbent: PlaybackEndpointBinding,
        endpointInstanceId: string,
        now: number
    ): PlaybackEndpointRegistrationAck {
        this.pruneCollisionRecords(now);
        const key = collisionKey(incumbent.endpointId, endpointInstanceId);
        const previous = this.collisions.get(key);
        const collision = previous?.incumbentGeneration === incumbent.registrationGeneration
            ? previous
            : null;

        if (collision) {
            collision.lastSeenAtMs = now;

            if (now - collision.firstSeenAtMs >= PLAYBACK_ENDPOINT_COLLISION_GRACE_MS) {
                this.collisions.delete(key);
                return this.collisionAck(incumbent.endpointId, 'rotate-endpoint');
            }

            return this.collisionAck(incumbent.endpointId, 'retry-same-endpoint');
        }

        const endpointCollisionCount = [...this.collisions.values()].filter((candidate) => (
            candidate.endpointId === incumbent.endpointId
        )).length;

        if (
            this.collisions.size >= PLAYBACK_ENDPOINT_MAX_COLLISION_RECORDS
            || endpointCollisionCount >= PLAYBACK_ENDPOINT_MAX_COLLISIONS_PER_ENDPOINT
        ) {
            return this.registrationFailedAck({ endpointId: incumbent.endpointId });
        }

        this.collisions.set(key, {
            endpointId: incumbent.endpointId,
            endpointInstanceId,
            incumbentGeneration: incumbent.registrationGeneration,
            firstSeenAtMs: now,
            lastSeenAtMs: now
        });

        return this.collisionAck(incumbent.endpointId, 'retry-same-endpoint');
    }

    private collisionAck(
        endpointId: string,
        resolution: 'retry-same-endpoint' | 'rotate-endpoint'
    ): PlaybackEndpointRegistrationAck {
        return {
            protocolVersion: 1,
            status: 'rejected',
            endpointId,
            code: 'ENDPOINT_ID_CONFLICT',
            resolution,
            retryAfterMs: PLAYBACK_ENDPOINT_COLLISION_RETRY_MS
        };
    }

    private pruneCollisionRecords(now: number) {
        for (const [key, collision] of this.collisions) {
            if (now - collision.lastSeenAtMs >= PLAYBACK_ENDPOINT_COLLISION_RETENTION_MS) {
                this.collisions.delete(key);
            }
        }
    }

    private registeredAck(
        binding: PlaybackEndpointBinding
    ): PlaybackEndpointRegistrationAck {
        return {
            protocolVersion: 1,
            status: 'registered',
            endpointId: binding.endpointId,
            registrationGeneration: binding.registrationGeneration,
            commandEpoch: this.commandEpoch,
            registrationProof: binding.registrationProof
        };
    }

    private endpointOwnershipConflictAck(
        endpointId: string
    ): PlaybackEndpointRegistrationAck {
        return {
            protocolVersion: 1,
            status: 'rejected',
            endpointId,
            code: 'ENDPOINT_ID_CONFLICT',
            resolution: 'rotate-endpoint',
            retryAfterMs: PLAYBACK_ENDPOINT_COLLISION_RETRY_MS
        };
    }

    private invalidRegistrationAck(input: unknown): PlaybackEndpointRegistrationAck {
        const endpointId = input && typeof input === 'object'
            ? normalizeOpaqueId((input as { endpointId?: unknown }).endpointId)
            : null;

        return {
            protocolVersion: 1,
            status: 'rejected',
            endpointId,
            code: 'INVALID_ENDPOINT_REGISTRATION',
            resolution: 'none',
            retryAfterMs: null
        };
    }

    private registrationFailedAck(input: unknown): PlaybackEndpointRegistrationAck {
        const endpointId = input && typeof input === 'object'
            ? normalizeOpaqueId((input as { endpointId?: unknown }).endpointId)
            : null;

        return {
            protocolVersion: 1,
            status: 'rejected',
            endpointId,
            code: 'ENDPOINT_REGISTRATION_FAILED',
            resolution: 'retry-same-endpoint',
            retryAfterMs: PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS
        };
    }

    private capacityReachedAck(input: unknown): PlaybackEndpointRegistrationAck {
        const endpointId = input && typeof input === 'object'
            ? normalizeOpaqueId((input as { endpointId?: unknown }).endpointId)
            : null;

        return {
            protocolVersion: 1,
            status: 'rejected',
            endpointId,
            code: 'PLAYBACK_ENDPOINT_CAPACITY_REACHED',
            resolution: 'none',
            retryAfterMs: null
        };
    }

    private invalidHeartbeatAck(input: unknown): PlaybackEndpointHeartbeatAck {
        const candidate = input && typeof input === 'object'
            ? input as Partial<PlaybackEndpointHeartbeat>
            : null;

        return {
            protocolVersion: 1,
            status: 'rejected',
            endpointId: normalizeOpaqueId(candidate?.endpointId),
            registrationGeneration: Number.isSafeInteger(candidate?.registrationGeneration)
                && Number(candidate?.registrationGeneration) >= 1
                ? Number(candidate?.registrationGeneration)
                : null,
            code: 'INVALID_ENDPOINT_HEARTBEAT',
            resolution: 'none'
        };
    }

    private expiredHeartbeatAck(
        endpointId: string,
        registrationGeneration: number
    ): PlaybackEndpointHeartbeatAck {
        return {
            protocolVersion: 1,
            status: 'rejected',
            endpointId,
            registrationGeneration,
            code: 'PLAYBACK_ENDPOINT_LEASE_EXPIRED',
            resolution: 'register-again'
        };
    }

    private persistRegistrationFailureAck(
        input: PlaybackEndpointRegistrationInput,
        error: unknown
    ): PlaybackEndpointRegistrationAck {
        if (
            isPlaybackDeviceServiceError(error)
            && error.code === 'PLAYBACK_ENDPOINT_OWNERSHIP_CONFLICT'
        ) {
            return this.endpointOwnershipConflictAck(input.endpointId);
        }

        if (
            isPlaybackDeviceServiceError(error)
            && error.code === 'PLAYBACK_DEVICE_REGISTRY_LIMIT'
        ) {
            return this.capacityReachedAck(input);
        }

        console.error(error);
        return this.registrationFailedAck(input);
    }

    private notifyChanged(notification: PlaybackEndpointsInvalidatedNotification) {
        try {
            this.onChanged(notification);
        } catch (error) {
            console.error(error);
        }
    }

    private notifyLeaseExpired(binding: PlaybackEndpointBinding) {
        try {
            binding.socket.emit(PLAYBACK_ENDPOINT_LEASE_EXPIRED, {
                protocolVersion: 1,
                endpointId: binding.endpointId,
                registrationGeneration: binding.registrationGeneration
            } satisfies PlaybackEndpointLeaseExpired);
        } catch (error) {
            console.error(error);
        }
    }

    private removeBinding(binding: PlaybackEndpointBinding) {
        const current = this.bindingsByEndpointId.get(binding.endpointId);
        const isCurrentBinding = current?.socketId === binding.socketId
            && current.registrationGeneration === binding.registrationGeneration;

        if (isCurrentBinding) {
            this.bindingsByEndpointId.delete(binding.endpointId);
        }
        if (
            isCurrentBinding
            && this.endpointIdBySocketId.get(binding.socketId) === binding.endpointId
        ) {
            this.endpointIdBySocketId.delete(binding.socketId);
        }
        this.clearEndpointCollisions(binding.endpointId);
        this.clearSocketRegistration(binding);
    }

    private clearSocketRegistration(binding: PlaybackEndpointBinding) {
        const data = binding.socket.data;

        if (
            data.playbackEndpointId !== binding.endpointId
            || data.playbackRegistrationGeneration !== binding.registrationGeneration
        ) {
            return;
        }

        delete data.playbackDeviceId;
        delete data.playbackEndpointId;
        delete data.playbackEndpointInstanceId;
        delete data.playbackRegistrationGeneration;
        delete data.playbackRegistrationProof;
    }

    private clearEndpointCollisions(endpointId: string) {
        for (const [key, collision] of this.collisions) {
            if (collision.endpointId === endpointId) {
                this.collisions.delete(key);
            }
        }
    }

    private async persistLastSeenSafely(binding: PlaybackEndpointBinding) {
        try {
            await this.persistLastSeen(
                binding.endpointId,
                new Date(binding.lastSeenAtMs)
            );
        } catch (error) {
            console.error(error);
        }
    }
}

export const playbackEndpointRegistry = new PlaybackEndpointRegistry({
    onChanged: (notification) => {
        connectors.notify(PLAYBACK_ENDPOINTS_INVALIDATED, notification);
    }
});

export const playbackEndpointListener = (
    socket: Socket,
    registry = playbackEndpointRegistry
) => {
    registry.start();

    socket.on(PLAYBACK_ENDPOINT_REGISTER, (input, acknowledge) => {
        void registry.register(socket, input).then((result) => {
            if (typeof acknowledge === 'function') {
                acknowledge(result);
            }
        });
    });

    socket.on(PLAYBACK_ENDPOINT_HEARTBEAT, (heartbeat, acknowledge) => {
        const result = registry.heartbeat(socket.id, heartbeat);

        if (typeof acknowledge === 'function') {
            acknowledge(result);
        }
    });
};
