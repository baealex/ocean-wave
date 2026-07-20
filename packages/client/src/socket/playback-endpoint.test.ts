import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    endpointId: 'tab-1',
    endpointSequence: 4,
    socketConnected: true,
    socketOn: vi.fn(),
    socketOff: vi.fn(),
    socketTimeout: vi.fn(),
    registrationEmit: vi.fn(),
    heartbeatEmit: vi.fn(),
    rotateEndpointId: vi.fn()
}));

vi.mock('~/modules/playback-device', () => ({
    getPlaybackEndpointId: () => mocks.endpointId,
    getPlaybackEndpointInstanceId: () => 'document-1',
    getPlaybackEndpointSequence: () => mocks.endpointSequence,
    getPlaybackInstallationId: () => 'browser-1',
    rotatePlaybackEndpointId: () => {
        mocks.endpointId = 'tab-2';
        mocks.endpointSequence = 0;
        mocks.rotateEndpointId();
        return mocks.endpointId;
    }
}));

vi.mock('./socket', () => ({
    socket: {
        get connected() {
            return mocks.socketConnected;
        },
        on: mocks.socketOn,
        off: mocks.socketOff,
        timeout: mocks.socketTimeout,
        volatile: { emit: mocks.heartbeatEmit }
    }
}));

import {
    PLAYBACK_ENDPOINT_HEARTBEAT,
    PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS,
    PLAYBACK_ENDPOINT_LEASE_EXPIRED,
    PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS,
    PLAYBACK_ENDPOINT_REGISTER,
    PLAYBACK_ENDPOINTS_INVALIDATED,
    PlaybackEndpointRegistrationManager,
    type PlaybackEndpointRegistrationAck
} from './playback-endpoint';

type RegistrationCallback = (
    error: Error | null,
    acknowledgement?: PlaybackEndpointRegistrationAck
) => void;

type HeartbeatCallback = (
    acknowledgement?: import('./playback-endpoint').PlaybackEndpointHeartbeatAck
) => void;

const getRegistration = (index = 0) => {
    const call = mocks.registrationEmit.mock.calls[index];

    return {
        event: call?.[0] as string,
        payload: call?.[1] as Record<string, unknown>,
        acknowledge: call?.[2] as RegistrationCallback
    };
};

const getHeartbeat = (index = 0) => {
    const call = mocks.heartbeatEmit.mock.calls[index];

    return {
        event: call?.[0] as string,
        payload: call?.[1] as Record<string, unknown>,
        acknowledge: call?.[2] as HeartbeatCallback
    };
};

describe('PlaybackEndpointRegistrationManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('navigator', {
            userAgent: '',
            platform: ''
        });
        mocks.endpointId = 'tab-1';
        mocks.endpointSequence = 4;
        mocks.socketConnected = true;
        mocks.socketOn.mockReset();
        mocks.socketOff.mockReset();
        mocks.socketTimeout.mockReset();
        mocks.registrationEmit.mockReset();
        mocks.heartbeatEmit.mockReset();
        mocks.rotateEndpointId.mockReset();
        mocks.socketTimeout.mockReturnValue({ emit: mocks.registrationEmit });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('mirrors the server event names and heartbeat interval', () => {
        expect({
            PLAYBACK_ENDPOINT_REGISTER,
            PLAYBACK_ENDPOINT_HEARTBEAT,
            PLAYBACK_ENDPOINT_LEASE_EXPIRED,
            PLAYBACK_ENDPOINTS_INVALIDATED,
            PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS,
            PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS
        }).toEqual({
            PLAYBACK_ENDPOINT_REGISTER: 'playback:endpoint-register',
            PLAYBACK_ENDPOINT_HEARTBEAT: 'playback:endpoint-heartbeat',
            PLAYBACK_ENDPOINT_LEASE_EXPIRED: 'playback:endpoint-lease-expired',
            PLAYBACK_ENDPOINTS_INVALIDATED: 'playback:endpoints-invalidated',
            PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS: 15_000,
            PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS: 5_000
        });
    });

    it('registers the document and renews its generation-fenced lease', () => {
        const manager = new PlaybackEndpointRegistrationManager();
        const subscriber = vi.fn();

        manager.subscribe(subscriber);
        manager.connect();

        expect(mocks.socketOn).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(mocks.socketOn).toHaveBeenCalledWith('disconnect', expect.any(Function));
        expect(mocks.socketOn).toHaveBeenCalledWith(
            PLAYBACK_ENDPOINT_LEASE_EXPIRED,
            expect.any(Function)
        );
        const registration = getRegistration();
        expect(registration.event).toBe(PLAYBACK_ENDPOINT_REGISTER);
        expect(registration.payload).toEqual({
            protocolVersion: 1,
            deviceId: 'browser-1',
            endpointId: 'tab-1',
            endpointInstanceId: 'document-1',
            name: 'Ocean Wave Desktop Web',
            type: 'desktop-web',
            capabilities: ['play', 'pause', 'seek', 'next', 'previous'],
            lastEndpointSequence: 4
        });

        registration.acknowledge(null, {
            protocolVersion: 1,
            status: 'registered',
            endpointId: 'tab-1',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-3'
        });

        expect(manager.current).toEqual({
            endpointId: 'tab-1',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-3'
        });
        expect(subscriber).toHaveBeenLastCalledWith(manager.current);
        expect(mocks.heartbeatEmit).toHaveBeenCalledWith(
            PLAYBACK_ENDPOINT_HEARTBEAT,
            {
                protocolVersion: 1,
                endpointId: 'tab-1',
                registrationGeneration: 3,
                lastEndpointSequence: 4
            },
            expect.any(Function)
        );

        mocks.endpointSequence = 5;
        vi.advanceTimersByTime(PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS);
        expect(mocks.heartbeatEmit).toHaveBeenLastCalledWith(
            PLAYBACK_ENDPOINT_HEARTBEAT,
            expect.objectContaining({ lastEndpointSequence: 5 }),
            expect.any(Function)
        );

        manager.disconnect();
        expect(manager.current).toBeNull();
        expect(mocks.socketOff).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(mocks.socketOff).toHaveBeenCalledWith('disconnect', expect.any(Function));
        expect(mocks.socketOff).toHaveBeenCalledWith(
            PLAYBACK_ENDPOINT_LEASE_EXPIRED,
            expect.any(Function)
        );
    });

    it('retries a collision before rotating only when instructed by the server', () => {
        const manager = new PlaybackEndpointRegistrationManager();

        manager.connect();
        getRegistration(0).acknowledge(null, {
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'ENDPOINT_ID_CONFLICT',
            resolution: 'retry-same-endpoint',
            retryAfterMs: 1_000
        });

        vi.advanceTimersByTime(999);
        expect(mocks.registrationEmit).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(getRegistration(1).payload.endpointId).toBe('tab-1');
        expect(mocks.rotateEndpointId).not.toHaveBeenCalled();

        getRegistration(1).acknowledge(null, {
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'ENDPOINT_ID_CONFLICT',
            resolution: 'rotate-endpoint',
            retryAfterMs: 1
        });
        vi.advanceTimersByTime(1);

        expect(mocks.rotateEndpointId).toHaveBeenCalledOnce();
        expect(getRegistration(2).payload).toEqual(expect.objectContaining({
            endpointId: 'tab-2',
            lastEndpointSequence: 0
        }));
        manager.disconnect();
    });

    it('ignores a registration acknowledgement after lifecycle disconnect', () => {
        const manager = new PlaybackEndpointRegistrationManager();

        manager.connect();
        const registration = getRegistration();
        manager.disconnect();
        registration.acknowledge(null, {
            protocolVersion: 1,
            status: 'registered',
            endpointId: 'tab-1',
            registrationGeneration: 1,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-1'
        });

        expect(manager.current).toBeNull();
        expect(mocks.heartbeatEmit).not.toHaveBeenCalled();
        vi.advanceTimersByTime(PLAYBACK_ENDPOINT_HEARTBEAT_INTERVAL_MS);
        expect(mocks.heartbeatEmit).not.toHaveBeenCalled();
    });

    it('uses the server retry delay after a persistence failure', () => {
        const manager = new PlaybackEndpointRegistrationManager();

        manager.connect();
        getRegistration().acknowledge(null, {
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'ENDPOINT_REGISTRATION_FAILED',
            resolution: 'retry-same-endpoint',
            retryAfterMs: 2_500
        });

        vi.advanceTimersByTime(2_499);
        expect(mocks.registrationEmit).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(mocks.registrationEmit).toHaveBeenCalledTimes(2);
        manager.disconnect();
    });

    it('surfaces terminal endpoint capacity without retrying forever', () => {
        const manager = new PlaybackEndpointRegistrationManager();

        manager.connect();
        getRegistration().acknowledge(null, {
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            code: 'PLAYBACK_ENDPOINT_CAPACITY_REACHED',
            resolution: 'none',
            retryAfterMs: null
        });

        expect(manager.current).toBeNull();
        expect(manager.error).toContain('capacity is full');
        vi.advanceTimersByTime(PLAYBACK_ENDPOINT_REGISTRATION_RETRY_MS * 10);
        expect(mocks.registrationEmit).toHaveBeenCalledOnce();
        manager.disconnect();
    });

    it('registers again after the server expires its endpoint lease', () => {
        const manager = new PlaybackEndpointRegistrationManager();

        manager.connect();
        getRegistration().acknowledge(null, {
            protocolVersion: 1,
            status: 'registered',
            endpointId: 'tab-1',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-3'
        });
        const leaseExpiredHandler = mocks.socketOn.mock.calls.find(
            ([event]) => event === PLAYBACK_ENDPOINT_LEASE_EXPIRED
        )?.[1] as ((lease: {
            protocolVersion: 1;
            endpointId: string;
            registrationGeneration: number;
        }) => void) | undefined;

        leaseExpiredHandler?.({
            protocolVersion: 1,
            endpointId: 'tab-1',
            registrationGeneration: 3
        });
        expect(manager.current).toBeNull();
        expect(mocks.registrationEmit).toHaveBeenCalledTimes(2);

        leaseExpiredHandler?.({
            protocolVersion: 1,
            endpointId: 'tab-1',
            registrationGeneration: 3
        });
        expect(mocks.registrationEmit).toHaveBeenCalledTimes(2);
        manager.disconnect();
    });

    it('recovers from a stale heartbeat when the lease-expired event is lost', () => {
        const manager = new PlaybackEndpointRegistrationManager();

        manager.connect();
        getRegistration().acknowledge(null, {
            protocolVersion: 1,
            status: 'registered',
            endpointId: 'tab-1',
            registrationGeneration: 3,
            commandEpoch: 'epoch-1',
            registrationProof: 'proof-3'
        });

        getHeartbeat().acknowledge({
            protocolVersion: 1,
            status: 'rejected',
            endpointId: 'tab-1',
            registrationGeneration: 3,
            code: 'PLAYBACK_ENDPOINT_LEASE_EXPIRED',
            resolution: 'register-again'
        });

        expect(manager.current).toBeNull();
        expect(mocks.registrationEmit).toHaveBeenCalledTimes(2);
        manager.disconnect();
    });
});
