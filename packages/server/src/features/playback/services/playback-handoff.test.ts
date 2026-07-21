import models from '~/models';
import type { PlaybackHandoffRequest } from '~/socket/playback-handoff-contract';

import {
    claimPlaybackHandoff,
    completePlaybackHandoff,
    completePlaybackHandoffRollback,
    PlaybackHandoffServiceError,
    resolvePlaybackHandoff,
    rollbackPlaybackHandoff
} from './playback-handoff';

const createMusic = async (name: string, duration = 180) => {
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const artist = await models.artist.create({
        data: { name: `${name} Artist ${unique}` }
    });
    const album = await models.album.create({
        data: {
            name: `${name} Album ${unique}`,
            cover: `/covers/${unique}.jpg`,
            publishedYear: '2026',
            artistId: artist.id
        }
    });

    return models.music.create({
        data: {
            name: `${name} ${unique}`,
            artistId: artist.id,
            albumId: album.id,
            filePath: `/music/${unique}.mp3`,
            duration,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320,
            sampleRate: 44100,
            trackNumber: 1
        }
    });
};

describe('playback handoff service', () => {
    let firstMusicId: number;
    let secondMusicId: number;

    beforeEach(async () => {
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
        const first = await createMusic('Handoff First', 60);
        const second = await createMusic('Handoff Second', 90);
        firstMusicId = first.id;
        secondMusicId = second.id;
        await models.playbackSession.create({
            data: {
                scopeKey: 'local',
                state: 'playing',
                activeDeviceId: 'source-tab',
                activeDeviceSequence: 7,
                currentMusicId: firstMusicId,
                positionMs: 12_000,
                positionUpdatedAt: new Date('2026-07-20T00:00:00.000Z'),
                startedAt: new Date('2026-07-19T23:59:30.000Z'),
                revision: 3,
                Queue: {
                    create: {
                        currentIndex: 0,
                        shuffle: true,
                        repeatMode: 'all',
                        revision: 2,
                        Item: {
                            create: [
                                {
                                    musicId: firstMusicId,
                                    order: 0,
                                    sourceOrder: 1
                                },
                                {
                                    musicId: secondMusicId,
                                    order: 1,
                                    sourceOrder: 0
                                }
                            ]
                        }
                    }
                }
            }
        });
    });

    afterEach(async () => {
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
    });

    const request = (
        targetEndpointId = 'target-tab',
        targetClaimSequence = 4
    ): PlaybackHandoffRequest => ({
        protocolVersion: 1,
        commandEpoch: 'epoch-1',
        handoffId: `handoff-${targetEndpointId}`,
        sourceEndpointId: 'source-tab',
        targetEndpointId,
        expectedSessionRevision: 3,
        expectedQueueRevision: 2,
        targetClaimSequence,
        force: false
    });

    it('resolves one authoritative session, position, and queue snapshot', async () => {
        const resolved = await resolvePlaybackHandoff(
            request(),
            new Date('2026-07-20T00:00:01.500Z')
        );

        expect(resolved.snapshot).toEqual(expect.objectContaining({
            sessionRevision: 3,
            queueRevision: 2,
            state: 'playing',
            currentMusicId: firstMusicId.toString(),
            currentIndex: 0,
            positionMs: 13_500,
            queue: expect.objectContaining({
                musicIds: [firstMusicId.toString(), secondMusicId.toString()],
                sourceMusicIds: [secondMusicId.toString(), firstMusicId.toString()],
                currentIndex: 0,
                contextType: 'queue',
                contextId: null,
                contextTitle: null,
                shuffle: true,
                repeatMode: 'all',
                revision: 2
            })
        }));
    });

    it('claims paused ownership only after release and completes within one revision fence', async () => {
        const resolved = await resolvePlaybackHandoff(
            request(),
            new Date('2026-07-20T00:00:01.000Z')
        );
        const claimed = await claimPlaybackHandoff(
            resolved,
            13_250,
            new Date('2026-07-20T00:00:01.250Z')
        );

        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        })).resolves.toEqual(expect.objectContaining({
            state: 'paused',
            activeDeviceId: 'target-tab',
            activeDeviceSequence: 4,
            positionMs: 13_250,
            revision: 4
        }));

        await expect(completePlaybackHandoff(
            resolved,
            claimed,
            { endpointSequence: 5, positionMs: 13_400 },
            new Date('2026-07-20T00:00:01.400Z')
        )).resolves.toEqual({
            sessionRevision: 5,
            queueRevision: 2
        });
        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        })).resolves.toEqual(expect.objectContaining({
            state: 'playing',
            activeDeviceId: 'target-tab',
            activeDeviceSequence: 5,
            positionMs: 13_400,
            revision: 5
        }));
    });

    it('claims a stopped offline source as a safely paused forced transfer', async () => {
        await models.playbackSession.update({
            where: { scopeKey: 'local' },
            data: { state: 'stopped' }
        });
        const resolved = await resolvePlaybackHandoff({
            ...request(),
            force: true
        });

        expect(resolved).toEqual(expect.objectContaining({
            sourceState: 'stopped',
            snapshot: expect.objectContaining({
                state: 'paused',
                positionMs: 12_000
            })
        }));

        const claimed = await claimPlaybackHandoff(resolved, 12_000);
        await completePlaybackHandoff(
            resolved,
            claimed,
            { endpointSequence: 5, positionMs: 12_000 }
        );

        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        })).resolves.toEqual(expect.objectContaining({
            state: 'paused',
            activeDeviceId: 'target-tab',
            activeDeviceSequence: 5,
            positionMs: 12_000,
            revision: 5
        }));
    });

    it('elects exactly one winner when two targets claim the same server revision', async () => {
        const [first, second] = await Promise.all([
            resolvePlaybackHandoff(request('target-a', 4)),
            resolvePlaybackHandoff(request('target-b', 8))
        ]);
        const claims = await Promise.allSettled([
            claimPlaybackHandoff(first, 13_000),
            claimPlaybackHandoff(second, 13_000)
        ]);

        expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(claims.filter(result => result.status === 'rejected')).toHaveLength(1);
        const rejected = claims.find(result => result.status === 'rejected');
        expect((rejected as PromiseRejectedResult).reason).toEqual(
            expect.objectContaining({
                code: 'STALE_SESSION_REVISION',
                retryable: true
            } satisfies Partial<PlaybackHandoffServiceError>)
        );

        const session = await models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        });
        expect(['target-a', 'target-b']).toContain(session?.activeDeviceId);
        expect(session).toEqual(expect.objectContaining({
            state: 'paused',
            revision: 4
        }));
    });

    it('rolls a failed target back to the released source before resuming it', async () => {
        const resolved = await resolvePlaybackHandoff(request());
        const claimed = await claimPlaybackHandoff(resolved, 13_000);
        const rolledBack = await rollbackPlaybackHandoff(
            resolved,
            claimed,
            8
        );

        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        })).resolves.toEqual(expect.objectContaining({
            state: 'paused',
            activeDeviceId: 'source-tab',
            activeDeviceSequence: 8,
            revision: 5
        }));

        await expect(completePlaybackHandoffRollback(
            resolved,
            rolledBack,
            8,
            { endpointSequence: 9, positionMs: 13_100 }
        )).resolves.toEqual({
            sessionRevision: 6,
            queueRevision: 2
        });
        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        })).resolves.toEqual(expect.objectContaining({
            state: 'playing',
            activeDeviceId: 'source-tab',
            activeDeviceSequence: 9,
            positionMs: 13_100,
            revision: 6
        }));
    });
});
