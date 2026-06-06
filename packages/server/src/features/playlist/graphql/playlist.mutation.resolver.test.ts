import { connectors } from '~/socket/connectors';
import {
    PLAYLIST_CHANGE_ORDER,
    PLAYLIST_DELETE
} from '~/socket/playlist';

import {
    createDeletePlaylistMutationResolver,
    createReorderPlaylistsMutationResolver
} from './playlist.mutation.resolver';

describe('playlist mutation resolvers', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    it('notifies playlist deletion with origin client metadata', async () => {
        const result = { id: 'playlist-1' };
        const deleteById = jest.fn().mockResolvedValue(result);
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createDeletePlaylistMutationResolver(deleteById);

        await expect(resolver(null, {
            id: 'playlist-1',
            originClientId: 'client-1'
        })).resolves.toEqual(result);

        expect(deleteById).toHaveBeenCalledWith({ id: 'playlist-1' });
        expect(notifySpy).toHaveBeenCalledWith(PLAYLIST_DELETE, {
            id: 'playlist-1',
            originClientId: 'client-1'
        });
    });



    it('keeps playlist deletion successful when realtime notification fails', async () => {
        const error = new Error('notification failed');
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const result = { id: 'playlist-1' };
        const deleteById = jest.fn().mockResolvedValue(result);
        jest.spyOn(connectors, 'notify').mockImplementation(() => {
            throw error;
        });
        const resolver = createDeletePlaylistMutationResolver(deleteById);

        await expect(resolver(null, {
            id: 'playlist-1',
            originClientId: 'client-1'
        })).resolves.toEqual(result);
        expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });

    it('notifies playlist order updates with origin client metadata', async () => {
        const result = { ids: ['playlist-2', 'playlist-1'] };
        const reorder = jest.fn().mockResolvedValue(result);
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createReorderPlaylistsMutationResolver(reorder);

        await expect(resolver(null, {
            ids: ['playlist-2', 'playlist-1'],
            originClientId: 'client-1'
        })).resolves.toEqual(result);

        expect(reorder).toHaveBeenCalledWith({ ids: ['playlist-2', 'playlist-1'] });
        expect(notifySpy).toHaveBeenCalledWith(PLAYLIST_CHANGE_ORDER, {
            ids: ['playlist-2', 'playlist-1'],
            originClientId: 'client-1'
        });
    });
});
