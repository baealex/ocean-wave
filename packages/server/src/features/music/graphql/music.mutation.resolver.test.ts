import { connectors } from '~/socket/connectors';
import { MUSIC_COUNT, MUSIC_UPDATED } from '~/socket/music';

import {
    createRecordPlaybackMutationResolver,
    createUpdateMusicMetadataMutationResolver
} from './music.mutation.resolver';

describe('music mutation resolvers', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    it('returns recordPlayback result without waiting for realtime broadcast acknowledgements', async () => {
        const result = {
            id: '1',
            playCount: 1,
            lastPlayedAt: '2026-06-06T11:00:00.000Z',
            totalPlayedMs: 35_000,
            countedAsPlay: true,
            deduped: false
        };
        const input = {
            id: '1',
            playedMs: 35_000,
            startedAt: '2026-06-06T10:59:25.000Z',
            clientSessionId: 'session-1'
        };
        const record = jest.fn().mockResolvedValue(result);
        const broadcastSpy = jest
            .spyOn(connectors, 'broadcast')
            .mockReturnValue(new Promise(() => {}) as ReturnType<typeof connectors.broadcast>);
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createRecordPlaybackMutationResolver(record);

        await expect(Promise.race([
            resolver(null, { input, originClientId: 'client-1' }),
            new Promise((resolve) => {
                setTimeout(() => {
                    resolve('timed-out');
                }, 10);
            })
        ])).resolves.toEqual(result);
        expect(record).toHaveBeenCalledWith(input);
        expect(notifySpy).toHaveBeenCalledWith(MUSIC_COUNT, {
            ...result,
            originClientId: 'client-1'
        });
        expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('does not notify playback count updates for deduped records', async () => {
        const result = {
            id: '1',
            playCount: 1,
            lastPlayedAt: '2026-06-06T11:00:00.000Z',
            totalPlayedMs: 35_000,
            countedAsPlay: true,
            deduped: true
        };
        const input = {
            id: '1',
            playedMs: 35_000,
            startedAt: '2026-06-06T10:59:25.000Z',
            clientSessionId: 'session-1'
        };
        const record = jest.fn().mockResolvedValue(result);
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createRecordPlaybackMutationResolver(record);

        await expect(resolver(null, { input })).resolves.toEqual(result);
        expect(record).toHaveBeenCalledWith(input);
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it('notifies other clients after metadata is committed', async () => {
        const input = {
            id: '1',
            title: 'Edited Track',
            artist: 'Edited Artist',
            album: 'Edited Album',
            publishedYear: '2026',
            trackNumber: 1,
            genres: []
        };
        const update = jest.fn().mockResolvedValue({ id: 1, name: 'Edited Track' });
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createUpdateMusicMetadataMutationResolver(update);

        await expect(resolver(null, {
            input,
            originClientId: 'client-1'
        })).resolves.toEqual({ id: 1, name: 'Edited Track' });
        expect(update).toHaveBeenCalledWith(input);
        expect(notifySpy).toHaveBeenCalledWith(MUSIC_UPDATED, {
            musicId: '1',
            originClientId: 'client-1'
        });
    });
});
