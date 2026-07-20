import type { Socket } from 'socket.io';

import { connectors } from './connectors';
import {
    playbackEndpointListener,
    playbackEndpointRegistry
} from './playback-endpoints';
import {
    playbackCommandCoordinator,
    playbackCommandListener
} from './playback-command';
import {
    playbackHandoffCoordinator,
    playbackHandoffListener
} from './playback-handoff';
import { syncListener } from './sync';

export const socketManager = (socket: Socket) => {
    console.log(`${socket.id} : a user connected`);
    connectors.append(Object.assign(socket, {
        userAgent: socket.handshake.headers['user-agent'] ?? '',
        connectedAt: Date.now()
    }));
    connectors.notify('get-connectors', connectors.get().map((c) => ({
        id: c.id,
        userAgent: c.userAgent,
        connectedAt: c.connectedAt
    })));

    syncListener(socket);
    playbackEndpointListener(socket);
    playbackCommandListener(socket);
    playbackHandoffListener(socket);

    socket.on('get-connectors', () => {
        socket.emit('get-connectors', connectors.get().map((c) => ({
            id: c.id,
            userAgent: c.userAgent,
            connectedAt: c.connectedAt
        })));
    });

    socket.on('remove-connector', ({ id = '' }) => {
        if (!id) return;
        connectors.get().forEach((connector) => {
            if (connector.id === id) {
                connector.disconnect();
            }
        });
    });

    socket.on('disconnect', () => {
        console.log(`${socket.id} : user disconnected`);
        playbackCommandCoordinator.handleSocketDisconnected(socket.id);
        playbackHandoffCoordinator.handleSocketDisconnected(socket.id);
        void playbackEndpointRegistry.unregisterSocket(socket.id);
        connectors.remove(socket.id);
        connectors.notify('get-connectors', connectors.get().map((c) => ({
            id: c.id,
            userAgent: c.userAgent,
            connectedAt: c.connectedAt
        })));
    });
};
