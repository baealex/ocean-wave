import type { Socket } from 'socket.io';

type Connector = Pick<Socket, 'disconnect' | 'emit' | 'id'> & {
    userAgent: string;
    connectedAt: number;
};

export const connectors = (() => {
    let connectors: Connector[] = [];

    const api = {
        get: () => connectors,
        set: (newConnectors: Connector[]) => {
            connectors = newConnectors;
        },
        remove: (id: string) => {
            connectors = connectors.filter((c) => c.id !== id);
        },
        append: (connector: Connector) => {
            connectors = [...connectors, connector];
        },
        broadcast: <T>(event: string, data: T) => {
            const promises = connectors.map((connector) => {
                return new Promise((resolve) => {
                    connector.emit(event, data, resolve);
                });
            });
            return Promise.all(promises);
        },
        notify: <T>(event: string, data: T) => {
            for (const connector of connectors) {
                try {
                    connector.emit(event, data);
                } catch (error) {
                    console.error(error);
                }
            }
        }
    };

    return api;
})();
