import {
    getPlaybackEndpointId,
    getPlaybackEndpointInstanceId,
    getPlaybackEndpointSequence,
    getPlaybackInstallationId,
    rotatePlaybackEndpointId
} from '~/modules/playback-device';

import { socket } from './socket';

export const PLAYBACK_ENDPOINT_REGISTER = 'playback:endpoint-register';
export const PLAYBACK_ENDPOINT_HEARTBEAT = 'playback:endpoint-heartbeat';
export const PLAYBACK_ENDPOINT_LEASE_EXPIRED = 'playback:endpoint-lease-expired';
export const PLAYBACK_ENDPOINTS_INVALIDATED = 'playback:endpoints-invalidated';

export const PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS = 15_000;
const PLAYBACK_ENDPOINT_REGISTRATION_TIMEOUT_MS = 5_000;
export const PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS = 5_000;

const PLAYBACK_CAPABILITIES = [
    'play',
    'pause',
    'seek',
    'next',
    'previous',
    'handoff'
] as const;

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

export interface PlaybackEndpointsInvalidatedNotification {
    reason: 'registered' | 'offline' | 'renamed' | 'active-changed';
    deviceId: string | null;
    endpointId: string | null;
    originClientId?: string | null;
}

export interface PlaybackEndpointLeaseExpired {
    protocolVersion: 1;
    endpointId: string;
    registrationGeneration: number;
}

export interface PlaybackEndpointRegistrationState {
    endpointId: string;
    registrationGeneration: number;
    commandEpoch: string;
    registrationProof: string;
}

type RegistrationSubscriber = (
    state: PlaybackEndpointRegistrationState | null
) => void;

export const getWebPlaybackDeviceType = () => {
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
        ? 'mobile-web' as const
        : 'desktop-web' as const;
};

export const getDefaultPlaybackDeviceName = () => {
    const platform = typeof navigator === 'undefined'
        ? ''
        : navigator.platform?.trim();
    const name = platform
        ? `Ocean Wave on ${platform}`
        : getWebPlaybackDeviceType() === 'mobile-web'
            ? 'Ocean Wave Mobile Web'
            : 'Ocean Wave Desktop Web';

    return name.slice(0, 80);
};

export class PlaybackEndpointRegistrationManager {
    private connected = false;
    private registering = false;
    private registration: PlaybackEndpointRegistrationState | null = null;
    private registrationError: string | null = null;
    private registrationToken = 0;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly subscribers = new Set<RegistrationSubscriber>();

    connect() {
        if (this.connected) {
            return;
        }

        this.connected = true;
        socket.on('connect', this.handleConnect);
        socket.on('disconnect', this.handleDisconnect);
        socket.on(PLAYBACK_ENDPOINT_LEASE_EXPIRED, this.handleLeaseExpired);

        if (socket.connected) {
            this.handleConnect();
        }
    }

    disconnect() {
        if (!this.connected) {
            return;
        }

        this.connected = false;
        this.registrationToken += 1;
        socket.off('connect', this.handleConnect);
        socket.off('disconnect', this.handleDisconnect);
        socket.off(PLAYBACK_ENDPOINT_LEASE_EXPIRED, this.handleLeaseExpired);
        this.clearTimers();
        this.registering = false;
        this.setRegistration(null);
    }

    subscribe(subscriber: RegistrationSubscriber) {
        this.subscribers.add(subscriber);
        return () => {
            this.subscribers.delete(subscriber);
        };
    }

    get current() {
        return this.registration;
    }

    get error() {
        return this.registrationError;
    }

    private handleConnect = () => {
        this.registrationToken += 1;
        this.clearTimers();
        this.registering = false;
        this.setRegistration(null);
        this.register();
    };

    private handleDisconnect = () => {
        this.registrationToken += 1;
        this.clearTimers();
        this.registering = false;
        this.setRegistration(null);
    };

    private handleLeaseExpired = (lease: PlaybackEndpointLeaseExpired) => {
        const registration = this.registration;

        if (
            !this.connected
            || !socket.connected
            || !registration
            || lease?.protocolVersion !== 1
            || lease.endpointId !== registration.endpointId
            || lease.registrationGeneration !== registration.registrationGeneration
        ) {
            return;
        }

        this.expireRegistration(registration);
    };

    private register() {
        if (!this.connected || !socket.connected || this.registering) {
            return;
        }

        this.registering = true;
        this.registrationError = null;
        const registrationToken = ++this.registrationToken;
        const endpointId = getPlaybackEndpointId();
        const payload = {
            protocolVersion: 1 as const,
            deviceId: getPlaybackInstallationId(),
            endpointId,
            endpointInstanceId: getPlaybackEndpointInstanceId(),
            name: getDefaultPlaybackDeviceName(),
            type: getWebPlaybackDeviceType(),
            capabilities: [...PLAYBACK_CAPABILITIES],
            lastEndpointSequence: getPlaybackEndpointSequence()
        };

        socket.timeout(PLAYBACK_ENDPOINT_REGISTRATION_TIMEOUT_MS).emit(
            PLAYBACK_ENDPOINT_REGISTER,
            payload,
            (error: Error | null, acknowledgement?: PlaybackEndpointRegistrationAck) => {
                if (
                    registrationToken !== this.registrationToken
                    || !this.connected
                    || !socket.connected
                ) {
                    return;
                }

                this.registering = false;

                if (error || !acknowledgement) {
                    this.scheduleRetry(PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS);
                    return;
                }

                if (acknowledgement.status === 'registered') {
                    if (
                        acknowledgement.endpointId === endpointId
                        && Number.isSafeInteger(acknowledgement.registrationGeneration)
                        && acknowledgement.registrationGeneration > 0
                        && typeof acknowledgement.commandEpoch === 'string'
                        && acknowledgement.commandEpoch.length > 0
                        && acknowledgement.commandEpoch.length <= 128
                        && typeof acknowledgement.registrationProof === 'string'
                        && acknowledgement.registrationProof.length > 0
                        && acknowledgement.registrationProof.length <= 128
                    ) {
                        this.setRegistration({
                            endpointId: acknowledgement.endpointId,
                            registrationGeneration: acknowledgement.registrationGeneration,
                            commandEpoch: acknowledgement.commandEpoch,
                            registrationProof: acknowledgement.registrationProof
                        });
                        this.startHeartbeat();
                    } else {
                        this.scheduleRetry(PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS);
                    }
                    return;
                }

                if (acknowledgement.code === 'ENDPOINT_ID_CONFLICT') {
                    if (acknowledgement.resolution === 'rotate-endpoint') {
                        rotatePlaybackEndpointId();
                    }
                    this.scheduleRetry(acknowledgement.retryAfterMs);
                    return;
                }

                if (acknowledgement.code === 'ENDPOINT_REGISTRATION_FAILED') {
                    this.scheduleRetry(acknowledgement.retryAfterMs);
                    return;
                }

                if (acknowledgement.code === 'PLAYBACK_ENDPOINT_CAPACITY_REACHED') {
                    this.registrationError = 'Playback endpoint capacity is full. Close another playback tab and reload.';
                    this.setRegistration(null);
                }
            }
        );
    }

    private startHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        this.emitHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            this.emitHeartbeat();
        }, PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS);
    }

    private emitHeartbeat() {
        const registration = this.registration;

        if (!socket.connected || !registration) {
            return;
        }

        socket.volatile.emit(PLAYBACK_ENDPOINT_HEARTBEAT, {
            protocolVersion: 1,
            endpointId: registration.endpointId,
            registrationGeneration: registration.registrationGeneration,
            lastEndpointSequence: getPlaybackEndpointSequence()
        }, (acknowledgement?: PlaybackEndpointHeartbeatAck) => {
            if (
                acknowledgement?.protocolVersion !== 1
                || acknowledgement.status !== 'rejected'
                || acknowledgement.code !== 'PLAYBACK_ENDPOINT_LEASE_EXPIRED'
                || acknowledgement.resolution !== 'register-again'
                || acknowledgement.endpointId !== registration.endpointId
                || acknowledgement.registrationGeneration
                    !== registration.registrationGeneration
            ) {
                return;
            }

            this.expireRegistration(registration);
        });
    }

    private expireRegistration(expected: PlaybackEndpointRegistrationState) {
        if (
            !this.connected
            || !socket.connected
            || this.registration !== expected
        ) {
            return;
        }

        this.registrationToken += 1;
        this.clearTimers();
        this.registering = false;
        this.setRegistration(null);
        this.register();
    }

    private scheduleRetry(delayMs: number) {
        if (!this.connected || !socket.connected) {
            return;
        }

        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
        }

        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.register();
        }, Math.max(delayMs, 0));
    }

    private clearTimers() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    private setRegistration(state: PlaybackEndpointRegistrationState | null) {
        this.registration = state;
        for (const subscriber of this.subscribers) {
            subscriber(state);
        }
    }
}

export const playbackEndpointRegistration = new PlaybackEndpointRegistrationManager();
