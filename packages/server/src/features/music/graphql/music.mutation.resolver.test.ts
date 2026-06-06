import { connectors } from '~/socket/connectors';
import { MUSIC_COUNT } from '~/socket/music';

import { createRecordPlaybackMutationResolver } from './music.mutation.resolver';

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
            resolver(null, { input }),
            new Promise((resolve) => {
                setTimeout(() => {
                    resolve('timed-out');
                }, 10);
            })
        ])).resolves.toEqual(result);
        expect(record).toHaveBeenCalledWith(input);
        expect(notifySpy).toHaveBeenCalledWith(MUSIC_COUNT, result);
        expect(broadcastSpy).not.toHaveBeenCalled();
    });
});
