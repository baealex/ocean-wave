import { connectors } from './connectors';
import { MUSIC_COUNT } from './music';

type TestConnector = Parameters<typeof connectors.set>[0][number];

describe('socket connectors', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        connectors.set([]);
    });

    afterEach(() => {
        connectors.set([]);
    });

    it('notifies connectors without waiting for acknowledgements', () => {
        const emit = jest.fn();
        connectors.set([{
            id: 'socket-1',
            userAgent: 'test',
            connectedAt: Date.now(),
            disconnect: jest.fn(),
            emit
        } as TestConnector]);

        const result = connectors.notify(MUSIC_COUNT, { id: '1' });

        expect(result).toBeUndefined();
        expect(emit).toHaveBeenCalledWith(
            MUSIC_COUNT,
            { id: '1' }
        );
    });

    it('logs notification emit failures', () => {
        const error = new Error('emit failed');
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        connectors.set([{
            id: 'socket-1',
            userAgent: 'test',
            connectedAt: Date.now(),
            disconnect: jest.fn(),
            emit: jest.fn(() => {
                throw error;
            })
        } as TestConnector]);

        connectors.notify(MUSIC_COUNT, { id: '1' });

        expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });
});
