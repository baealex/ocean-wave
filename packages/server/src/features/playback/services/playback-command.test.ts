import models from '~/models';
import {
    createReadableAudioTestFile,
    removeReadableAudioTestFiles
} from '~/test-support/readable-audio-file';
import type {
    PlaybackCommandExecutionResult,
    PlaybackCommandRequest
} from '~/socket/playback-command-contract';

import {
    PlaybackCommandServiceError,
    commitPlaybackCommandResult,
    resolvePlaybackCommand
} from './playback-command';
import { resolvePlaybackHandoff } from './playback-handoff';

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
            filePath: createReadableAudioTestFile(),
            duration,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320,
            sampleRate: 44100,
            trackNumber: 1
        }
    });
};

describe('playback command service', () => {
    let firstMusicId: number;
    let secondMusicId: number;

    beforeEach(async () => {
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
        const first = await createMusic('Command First', 60);
        const second = await createMusic('Command Second', 90);
        firstMusicId = first.id;
        secondMusicId = second.id;
        await models.playbackSession.create({
            data: {
                scopeKey: 'local',
                state: 'paused',
                activeDeviceId: 'target-tab',
                activeDeviceSequence: 4,
                currentMusicId: firstMusicId,
                positionMs: 12_000,
                positionUpdatedAt: new Date('2026-07-20T00:00:00.000Z'),
                startedAt: new Date('2026-07-20T00:00:00.000Z'),
                historyMusicId: first.recordingId,
                historyReleaseTrackId: first.releaseTrackId,
                historyPhysicalFileId: first.physicalFileId,
                historySessionId: 'command-history-1',
                historyBranchId: 'command-history-1',
                historyParentBranchId: null,
                historyBranchBasePlayedMs: 0,
                historyStartedAt: new Date('2026-07-20T00:00:00.000Z'),
                historyPlayedMs: 12_000,
                historyHadSeek: false,
                historyUpdatedAt: new Date('2026-07-20T00:00:12.000Z'),
                revision: 3,
                Queue: {
                    create: {
                        currentIndex: 0,
                        shuffle: false,
                        repeatMode: 'none',
                        revision: 2,
                        Item: {
                            create: [
                                { musicId: firstMusicId, order: 0 },
                                { musicId: secondMusicId, order: 1 }
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
        removeReadableAudioTestFiles();
    });

    const request = (
        command: PlaybackCommandRequest['command'],
        expectedQueueRevision: number | null
    ): PlaybackCommandRequest => ({
        protocolVersion: 1,
        commandId: '10000000-0000-4000-8000-000000000001',
        targetEndpointId: 'target-tab',
        expectedSessionRevision: 3,
        expectedQueueRevision,
        command
    });

    it('resolves all command transitions from authoritative session and queue state', async () => {
        const now = new Date('2026-07-20T00:00:01.000Z');
        const play = await resolvePlaybackCommand(request({ type: 'play' }, null), now);
        const pause = await resolvePlaybackCommand(request({ type: 'pause' }, null), now);
        const seek = await resolvePlaybackCommand(request({
            type: 'seek',
            positionMs: 120_000
        }, null), now);
        const next = await resolvePlaybackCommand(request({ type: 'next' }, 2), now);
        const previous = await resolvePlaybackCommand(request({ type: 'previous' }, 2), now);

        expect(play.desiredResult).toEqual({
            state: 'playing',
            currentMusicId: firstMusicId.toString(),
            currentIndex: 0,
            position: { mode: 'absolute', positionMs: 12_000 }
        });
        expect(pause.desiredResult).toEqual({
            state: 'paused',
            currentMusicId: firstMusicId.toString(),
            currentIndex: 0,
            position: { mode: 'capture-current' }
        });
        expect(seek.desiredResult.position).toEqual({
            mode: 'absolute',
            positionMs: 60_000
        });
        expect(next.desiredResult).toEqual({
            state: 'playing',
            currentMusicId: secondMusicId.toString(),
            currentIndex: 1,
            position: { mode: 'absolute', positionMs: 0 }
        });
        expect(previous.desiredResult).toEqual({
            state: 'paused',
            currentMusicId: firstMusicId.toString(),
            currentIndex: 0,
            position: { mode: 'absolute', positionMs: 0 }
        });
    });

    it('rejects non-active targets and stale queue revisions before dispatch', async () => {
        await expect(resolvePlaybackCommand({
            ...request({ type: 'pause' }, null),
            targetEndpointId: 'other-tab'
        })).rejects.toEqual(expect.objectContaining({
            code: 'TARGET_NOT_ACTIVE',
            retryable: true,
            sessionRevision: 3,
            queueRevision: 2
        } satisfies Partial<PlaybackCommandServiceError>));

        await expect(resolvePlaybackCommand(
            request({ type: 'next' }, 1)
        )).rejects.toEqual(expect.objectContaining({
            code: 'STALE_QUEUE_REVISION',
            retryable: true,
            queueRevision: 2
        } satisfies Partial<PlaybackCommandServiceError>));
    });

    it('commits a queue transition and session result in one revision-fenced transaction', async () => {
        const resolved = await resolvePlaybackCommand(
            request({ type: 'next' }, 2),
            new Date('2026-07-20T00:00:01.000Z')
        );
        const result: Extract<PlaybackCommandExecutionResult, { status: 'completed' }> = {
            protocolVersion: 1,
            commandId: '10000000-0000-4000-8000-000000000001',
            targetEndpointId: 'target-tab',
            targetRegistrationGeneration: 1,
            commandSequence: 1,
            executionToken: '30000000-0000-4000-8000-000000000001',
            status: 'completed',
            endpointSequence: 5,
            observedAt: '2026-07-20T00:00:01.000Z',
            resultingState: {
                state: 'playing',
                currentMusicId: secondMusicId.toString(),
                currentIndex: 1,
                positionMs: 0
            }
        };

        await expect(commitPlaybackCommandResult(
            'target-tab',
            resolved,
            result,
            new Date('2026-07-20T00:00:01.000Z')
        )).resolves.toEqual({
            sessionRevision: 4,
            queueRevision: 3
        });
        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' },
            include: { Queue: true }
        })).resolves.toEqual(expect.objectContaining({
            state: 'playing',
            currentMusicId: secondMusicId,
            activeDeviceId: 'target-tab',
            activeDeviceSequence: 5,
            historyMusicId: null,
            historyReleaseTrackId: null,
            historyPhysicalFileId: null,
            historySessionId: null,
            historyBranchId: null,
            historyParentBranchId: null,
            historyBranchBasePlayedMs: 0,
            historyStartedAt: null,
            historyPlayedMs: 0,
            historyHadSeek: false,
            historyUpdatedAt: null,
            revision: 4,
            Queue: expect.objectContaining({ currentIndex: 1, revision: 3 })
        }));
        await expect(resolvePlaybackHandoff({
            protocolVersion: 1,
            commandEpoch: 'epoch-1',
            handoffId: 'forced-after-command-track-change',
            sourceEndpointId: 'target-tab',
            targetEndpointId: 'next-tab',
            expectedSessionRevision: 4,
            expectedQueueRevision: 3,
            targetClaimSequence: 1,
            force: true
        })).resolves.toEqual(expect.objectContaining({
            playbackHistory: null,
            snapshot: expect.objectContaining({
                currentMusicId: secondMusicId.toString()
            })
        }));
    });

    it('rolls back the queue fence when the session changes before completion', async () => {
        const resolved = await resolvePlaybackCommand(
            request({ type: 'next' }, 2),
            new Date('2026-07-20T00:00:01.000Z')
        );
        await models.playbackSession.update({
            where: { scopeKey: 'local' },
            data: { revision: { increment: 1 } }
        });

        await expect(commitPlaybackCommandResult('target-tab', resolved, {
            protocolVersion: 1,
            commandId: '10000000-0000-4000-8000-000000000001',
            targetEndpointId: 'target-tab',
            targetRegistrationGeneration: 1,
            commandSequence: 1,
            executionToken: '30000000-0000-4000-8000-000000000001',
            status: 'completed',
            endpointSequence: 5,
            observedAt: '2026-07-20T00:00:01.000Z',
            resultingState: {
                state: 'playing',
                currentMusicId: secondMusicId.toString(),
                currentIndex: 1,
                positionMs: 0
            }
        })).rejects.toEqual(expect.objectContaining({
            code: 'STALE_SESSION_REVISION',
            retryable: true
        } satisfies Partial<PlaybackCommandServiceError>));
        await expect(models.playbackQueue.findFirst({
            where: { Session: { scopeKey: 'local' } }
        })).resolves.toEqual(expect.objectContaining({
            currentIndex: 0,
            revision: 2
        }));
    });
});
