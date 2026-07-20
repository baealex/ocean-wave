import axios from 'axios';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

vi.mock('~/socket/socket', () => ({
    getOriginClientId: () => 'origin-client-1'
}));

import {
    fetchPlaybackDeviceRegistry,
    renamePlaybackDevice
} from './playback-devices';

describe('playback devices API', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('queries the complete registry recovery snapshot', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    playbackDeviceRegistry: {
                        commandEpoch: 'epoch-1',
                        activeEndpointId: null,
                        serverTime: '2026-07-20T00:00:00.000Z',
                        devices: []
                    }
                }
            }
        });

        await fetchPlaybackDeviceRegistry();

        const payload = post.mock.calls[0]?.[1] as {
            operationName: string;
            query: string;
        };
        expect(payload.operationName).toBe('PlaybackDeviceRegistry');
        expect(payload.query).toContain('commandEpoch');
        expect(payload.query).toContain('registrationGeneration');
    });

    it('renames through GraphQL variables with origin metadata', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({
            data: {
                data: {
                    renamePlaybackDevice: {
                        deviceId: 'browser-1',
                        name: 'Listening Room'
                    }
                }
            }
        });

        await renamePlaybackDevice('browser-1', 'Listening Room');

        const payload = post.mock.calls[0]?.[1] as {
            query: string;
            variables: Record<string, unknown>;
        };
        expect(payload.variables).toEqual({
            input: {
                deviceId: 'browser-1',
                name: 'Listening Room'
            },
            originClientId: 'origin-client-1'
        });
        expect(payload.query).toContain('input: $input');
        expect(payload.query).toContain('deviceId');
        expect(payload.query).toContain('name');
        expect(payload.query).not.toContain('browser-1');
        expect(payload.query).not.toContain('Listening Room');
    });
});
