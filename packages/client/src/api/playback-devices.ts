import { graphQuery } from './graphql';
import {
    type OriginClientVariables,
    withOriginClientId
} from './origin-client';

export type PlaybackDeviceType = 'desktop-web' | 'mobile-web';
export type PlaybackCapability =
    | 'play'
    | 'pause'
    | 'seek'
    | 'next'
    | 'previous'
    | 'handoff';

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

export interface PlaybackDeviceRenameResult {
    deviceId: string;
    name: string;
}

const PLAYBACK_DEVICE_FIELDS = `
    id
    name
    type
    lastSeenAt
    online
    active
    endpoints {
        id
        capabilities
        lastSeenAt
        online
        active
        registrationGeneration
    }
`;

export const fetchPlaybackDeviceRegistry = (requestTimeoutMs?: number) => {
    return graphQuery<{
        playbackDeviceRegistry: PlaybackDeviceRegistrySnapshot;
    }>({
        operationName: 'PlaybackDeviceRegistry',
        requestTimeoutMs,
        query: `query PlaybackDeviceRegistry {
            playbackDeviceRegistry {
                commandEpoch
                activeEndpointId
                serverTime
                devices {
                    ${PLAYBACK_DEVICE_FIELDS}
                }
            }
        }`
    });
};

export const renamePlaybackDevice = (deviceId: string, name: string) => {
    return graphQuery<{
        renamePlaybackDevice: PlaybackDeviceRenameResult;
    }, {
        input: { deviceId: string; name: string };
    } & OriginClientVariables>({
        operationName: 'RenamePlaybackDevice',
        query: `mutation RenamePlaybackDevice(
            $input: RenamePlaybackDeviceInput!
            $originClientId: String
        ) {
            renamePlaybackDevice(
                input: $input
                originClientId: $originClientId
            ) {
                deviceId
                name
            }
        }`,
        variables: withOriginClientId({
            input: { deviceId, name }
        })
    });
};
