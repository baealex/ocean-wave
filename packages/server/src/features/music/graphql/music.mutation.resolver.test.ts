import { connectors } from '~/socket/connectors';
import { MUSIC_COUNT, MUSIC_UPDATED } from '~/socket/music';

import {
    createRecordPlaybackMutationResolver,
    createRecoverMusicMetadataOperationMutationResolver,
    createRetryMusicMetadataOperationMutationResolver,
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
            skipCount: 0,
            lastSkippedAt: null,
            completionCount: 0,
            lastCompletedAt: null,
            countedAsPlay: true,
            completionRate: 35_000 / 180_000,
            outcome: 'listen',
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
            skipCount: 0,
            lastSkippedAt: null,
            completionCount: 0,
            lastCompletedAt: null,
            countedAsPlay: true,
            completionRate: 35_000 / 180_000,
            outcome: 'listen',
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
        const result = {
            operationId: 'operation-1',
            status: 'cleaned',
            retryable: false,
            errorCode: null,
            errorMessage: null,
            music: { id: 1, name: 'Edited Track' },
            targets: []
        };
        const update = jest.fn().mockResolvedValue(result);
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createUpdateMusicMetadataMutationResolver(update);

        await expect(resolver(null, {
            input,
            previewToken: 'preview-1',
            originClientId: 'client-1'
        })).resolves.toEqual(result);
        expect(update).toHaveBeenCalledWith(input, 'preview-1');
        expect(notifySpy).toHaveBeenCalledWith(MUSIC_UPDATED, {
            musicId: '1',
            originClientId: 'client-1'
        });
    });

    it('does not notify other clients when metadata changes were rolled back', async () => {
        const result = {
            operationId: 'operation-1',
            status: 'rolled-back',
            retryable: true,
            errorCode: 'AUDIO_METADATA_WRITE_FAILED',
            errorMessage: 'The original audio file was restored.',
            music: null,
            targets: []
        };
        const update = jest.fn().mockResolvedValue(result);
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createUpdateMusicMetadataMutationResolver(update);

        await expect(resolver(null, {
            input: {
                id: '1',
                title: 'Edited Track',
                album: 'Edited Album',
                publishedYear: '2026',
                trackNumber: 1,
                genres: []
            },
            previewToken: 'preview-1',
            originClientId: 'client-1'
        })).resolves.toEqual(result);
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it.each([
        ['retry', createRetryMusicMetadataOperationMutationResolver],
        ['recovery', createRecoverMusicMetadataOperationMutationResolver]
    ] as const)('notifies other clients after successful metadata %s', async (
        _label,
        createResolver
    ) => {
        const result = {
            operationId: 'operation-1',
            status: 'cleaned',
            retryable: false,
            errorCode: null,
            errorMessage: null,
            music: { id: 1, name: 'Recovered Track' },
            targets: []
        };
        const mutate = jest.fn().mockResolvedValue(result);
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createResolver(mutate);

        await expect(resolver(null, {
            operationId: 'operation-1',
            originClientId: 'client-1'
        })).resolves.toEqual(result);
        expect(mutate).toHaveBeenCalledWith('operation-1');
        expect(notifySpy).toHaveBeenCalledWith(MUSIC_UPDATED, {
            musicId: '1',
            originClientId: 'client-1'
        });
    });
});
