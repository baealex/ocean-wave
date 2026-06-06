import type { Socket } from 'socket.io';

import { connectors } from './connectors';
import { SYNC_EVENT } from './sync';
import { socketManager } from './index';

describe('socket manager', () => {
    const allowedCommandEvents = [
        SYNC_EVENT,
        'get-connectors',
        'remove-connector',
        'disconnect'
    ];

    beforeEach(() => {
        jest.restoreAllMocks();
        connectors.set([]);
    });

    afterEach(() => {
        connectors.set([]);
    });

    it('does not register ordinary data write events as Socket.IO commands', () => {
        const socket = {
            id: 'socket-1',
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
