import type { Socket } from 'socket.io';

import {
    MUSIC_COUNT,
    MUSIC_HATE,
    MUSIC_LIKE
} from './music';
import {
    PLAYLIST_ADD_MUSIC,
    PLAYLIST_CHANGE_MUSIC_ORDER,
    PLAYLIST_CHANGE_ORDER,
    PLAYLIST_CREATE,
    PLAYLIST_DELETE,
    PLAYLIST_MOVE_MUSIC,
    PLAYLIST_REMOVE_MUSIC,
    PLAYLIST_UPDATE
} from './playlist';
import { connectors } from './connectors';
import { SYNC_EVENT } from './sync';
import { socketManager } from './index';

describe('socket manager', () => {
    const legacyWriteEvents = [
        MUSIC_LIKE,
        MUSIC_HATE,
        MUSIC_COUNT,
        PLAYLIST_CREATE,
        PLAYLIST_DELETE,
        PLAYLIST_UPDATE,
        PLAYLIST_CHANGE_ORDER,
        PLAYLIST_ADD_MUSIC,
        PLAYLIST_MOVE_MUSIC,
        PLAYLIST_REMOVE_MUSIC,
        PLAYLIST_CHANGE_MUSIC_ORDER
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

        expect(registeredEvents).toContain(SYNC_EVENT);
        expect(registeredEvents).toEqual(expect.arrayContaining([
            'get-connectors',
            'remove-connector',
            'disconnect'
        ]));
        for (const event of legacyWriteEvents) {
            expect(registeredEvents).not.toContain(event);
        }
    });
});
