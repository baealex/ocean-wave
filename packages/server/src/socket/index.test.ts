import type { Socket } from 'socket.io';

import { connectors } from './connectors';
import {
    PLAYBACK_ENDPOINT_HEARTBEAT,
    PLAYBACK_ENDPOINT_REGISTER,
    playbackEndpointRegistry
} from './playback-endpoints';
import { SYNC_EVENT } from './sync';
import {
    PLAYBACK_COMMAND_REQUEST,
    PLAYBACK_COMMAND_RESULT,
    PLAYBACK_COMMAND_START
} from './playback-command-contract';
import { playbackCommandCoordinator } from './playback-command';
import { playbackHandoffCoordinator } from './playback-handoff';
import { PLAYBACK_HANDOFF_REQUEST } from './playback-handoff-contract';
import { socketManager } from './index';

describe('socket manager', () => {
    const allowedCommandEvents = [
        SYNC_EVENT,
        PLAYBACK_ENDPOINT_REGISTER,
        PLAYBACK_ENDPOINT_HEARTBEAT,
        PLAYBACK_COMMAND_REQUEST,
        PLAYBACK_COMMAND_START,
        PLAYBACK_COMMAND_RESULT,
        PLAYBACK_HANDOFF_REQUEST,
        'get-connectors',
        'remove-connector',
        'disconnect'
    ];

    beforeEach(() => {
        jest.restoreAllMocks();
        connectors.set([]);
        playbackEndpointRegistry.clear();
        playbackCommandCoordinator.clear();
        playbackHandoffCoordinator.clear();
    });

    afterEach(() => {
        connectors.set([]);
        playbackEndpointRegistry.clear();
        playbackCommandCoordinator.clear();
        playbackHandoffCoordinator.clear();
    });

    it('does not register ordinary data write events as Socket.IO commands', () => {
        const socket = {
            id: 'socket-1',
            data: {},
            handshake: {
                headers: {
                    'user-agent': 'test'
                }
            },
            emit: jest.fn(),
            on: jest.fn(),
            disconnect: jest.fn()
        } as unknown as Socket;

        socketManager(socket);

        const registeredEvents = (socket.on as jest.Mock).mock.calls.map(([event]) => event);

        expect(registeredEvents).toHaveLength(allowedCommandEvents.length);
        expect(new Set(registeredEvents)).toEqual(new Set(allowedCommandEvents));
    });
});
