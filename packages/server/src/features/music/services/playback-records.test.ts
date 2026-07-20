import models from '~/models';
import {
    classifyPlaybackOutcome,
    recordPlayback,
    shouldCountAsPlay
} from './playback-records';

const createMusic = async (overrides?: { duration?: number }) => {
    const unique = Date.now().toString() + Math.random().toString(16).slice(2);
    const artist = await models.artist.create({ data: { name: `Artist ${unique}` } });
    const album = await models.album.create({
        data: {
            name: `Album ${unique}`,
            cover: `/covers/${unique}.jpg`,
            publishedYear: '2026',
            artistId: artist.id
        }
    });

    return models.music.create({
        data: {
            name: `Track ${unique}`,
            artistId: artist.id,
            albumId: album.id,
            filePath: `/music/${unique}.mp3`,
            duration: overrides?.duration ?? 200,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320,
            sampleRate: 44100,
            trackNumber: 1
        }
    });
};

const at = (seconds: number) => new Date(
    Date.UTC(2026, 6, 21, 0, 0, seconds)
);

describe('playback history classification', () => {
    it.each([
        { durationSeconds: 180, playedMs: 29_999, expected: false },
        { durationSeconds: 180, playedMs: 30_000, expected: true },
        { durationSeconds: 180, playedMs: 30_001, expected: true },
        { durationSeconds: 20, playedMs: 9_999, expected: false },
        { durationSeconds: 20, playedMs: 10_000, expected: true },
        { durationSeconds: 20, playedMs: 10_001, expected: true },
        { durationSeconds: 0, playedMs: 29_999, expected: false },
        { durationSeconds: 0, playedMs: 30_000, expected: true },
        { durationSeconds: Number.NaN, playedMs: 30_000, expected: true }
    ])('fixes the meaningful-listen boundary for %#', ({
        durationSeconds,
        playedMs,
        expected
    }) => {
        expect(shouldCountAsPlay({ durationSeconds, playedMs })).toBe(expected);
    });

    it.each([
        {
            durationSeconds: 180,
            playedMs: 161_999,
            endReason: 'ended' as const,
            expected: 'listen'
        },
        {
            durationSeconds: 180,
            playedMs: 162_000,
            endReason: 'ended' as const,
            expected: 'complete'
        },
        {
            durationSeconds: 180,
            playedMs: 162_001,
            endReason: 'ended' as const,
            expected: 'complete'
        },
        {
            durationSeconds: 20,
            playedMs: 17_999,
            endReason: 'ended' as const,
            expected: 'listen'
        },
        {
            durationSeconds: 20,
            playedMs: 18_000,
            endReason: 'ended' as const,
            expected: 'complete'
        },
        {
            durationSeconds: 20,
            playedMs: 18_001,
            endReason: 'ended' as const,
            expected: 'complete'
        },
        {
            durationSeconds: 180,
            playedMs: 161_999,
            endReason: 'skipped' as const,
            expected: 'skip'
        },
        {
            durationSeconds: 180,
            playedMs: 162_000,
            endReason: 'skipped' as const,
            expected: 'complete'
        },
        {
            durationSeconds: 180,
            playedMs: 162_000,
            endReason: 'stopped' as const,
            expected: 'complete'
        },
        {
            durationSeconds: 180,
            playedMs: 170_000,
            endReason: 'handoff' as const,
            expected: 'listen'
        },
        {
            durationSeconds: 0,
            playedMs: 30_000,
            endReason: 'ended' as const,
            expected: 'listen'
        }
    ])('classifies terminal playback at the actual-listening boundary for %#', ({
        durationSeconds,
        playedMs,
        endReason,
        expected
    }) => {
        expect(classifyPlaybackOutcome({
            durationSeconds,
            playedMs,
            endReason
        })).toBe(expected);
    });
});

describe('music playback history persistence', () => {
    beforeEach(async () => {
        jest.restoreAllMocks();
        await models.playbackEvent.deleteMany();
        await models.musicLike.deleteMany();
        await models.musicHate.deleteMany();
        await models.playlistMusic.deleteMany();
        await models.music.deleteMany();
        await models.album.deleteMany();
        await models.artist.deleteMany();
    });

    it('creates a listen event and updates meaningful-listen aggregates', async () => {
        const music = await createMusic({ duration: 180 });

        const result = await recordPlayback({
            id: music.id.toString(),
            playedMs: 35_000,
            startedAt: at(0).toISOString(),
            endedAt: at(35).toISOString(),
            endReason: 'stopped',
            hadSeek: false,
            source: 'queue-stop',
            clientSessionId: 'listen-1'
        }, at(40));

        const updatedMusic = await models.music.findUniqueOrThrow({
            where: { id: music.id }
        });
        const event = await models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        });

        expect(result).toEqual(expect.objectContaining({
            playCount: 1,
            totalPlayedMs: 35_000,
            skipCount: 0,
            completionCount: 0,
            countedAsPlay: true,
            completionRate: 35_000 / 180_000,
            outcome: 'listen',
            deduped: false
        }));
        expect(updatedMusic.lastPlayedAt).toEqual(at(40));
        expect(event).toMatchObject({
            musicId: music.id,
            playedMs: 35_000,
            countedAsPlay: true,
            completionRate: 35_000 / 180_000,
            outcome: 'listen',
            endReason: 'stopped',
            hadSeek: false,
            source: 'queue-stop'
        });
    });

    it('records a partial listen without incrementing play count', async () => {
        const music = await createMusic({ duration: 240 });

        await recordPlayback({
            id: music.id.toString(),
            playedMs: 10_000,
            startedAt: at(0).toISOString(),
            endedAt: at(10).toISOString(),
            endReason: 'stopped',
            hadSeek: false,
            clientSessionId: 'partial-1'
        }, at(20));

        const updatedMusic = await models.music.findUniqueOrThrow({
            where: { id: music.id }
        });
        const event = await models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        });

        expect(updatedMusic.playCount).toBe(0);
        expect(updatedMusic.totalPlayedMs).toBe(10_000);
        expect(event.countedAsPlay).toBe(false);
        expect(event.outcome).toBe('listen');
    });

    it('records an immediate explicit skip with zero listened time', async () => {
        const music = await createMusic({ duration: 100 });

        const result = await recordPlayback({
            id: music.id.toString(),
            clientSessionId: 'immediate-skip-1',
            playedMs: 0,
            endReason: 'skipped',
            hadSeek: false
        }, at(1));

        expect(result).toMatchObject({
            playCount: 0,
            totalPlayedMs: 0,
            skipCount: 1,
            completionCount: 0,
            countedAsPlay: false,
            completionRate: 0,
            outcome: 'skip',
            deduped: false
        });
        await expect(models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        })).resolves.toMatchObject({
            playedMs: 0,
            outcome: 'skip',
            endReason: 'skipped'
        });
    });

    it('uses server observation time when client clocks are skewed', async () => {
        const music = await createMusic({ duration: 180 });

        await recordPlayback({
            id: music.id.toString(),
            playedMs: 60_000,
            startedAt: new Date(at(10).getTime() + 3_600_000).toISOString(),
            endedAt: new Date(at(10).getTime() - 3_600_000).toISOString(),
            endReason: 'skipped',
            hadSeek: true,
            clientSessionId: 'clamped-1'
        }, at(10));

        const updatedMusic = await models.music.findUniqueOrThrow({
            where: { id: music.id }
        });
        const event = await models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        });

        expect(updatedMusic.playCount).toBe(1);
        expect(updatedMusic.totalPlayedMs).toBe(60_000);
        expect(updatedMusic.lastPlayedAt).toEqual(at(10));
        expect(updatedMusic.skipCount).toBe(1);
        expect(event).toMatchObject({
            playedMs: 60_000,
            completionRate: 60_000 / 180_000,
            outcome: 'skip',
            endedAt: at(10),
            hadSeek: true
        });
    });

    it('upserts cumulative reports without double-counting the same playback', async () => {
        const music = await createMusic({ duration: 180 });
        const base = {
            id: music.id.toString(),
            startedAt: at(0).toISOString(),
            clientSessionId: 'cumulative-1'
        };

        await recordPlayback({
            ...base,
            playedMs: 10_000,
            endedAt: at(10).toISOString(),
            endReason: 'recovery',
            hadSeek: false,
            source: 'queue-recovery'
        }, at(60));
        const advanced = await recordPlayback({
            ...base,
            playedMs: 40_000,
            endedAt: at(45).toISOString(),
            endReason: 'skipped',
            hadSeek: true,
            source: 'queue-track-change'
        }, at(60));
        const duplicate = await recordPlayback({
            ...base,
            playedMs: 10_000,
            endedAt: at(10).toISOString(),
            endReason: 'recovery',
            hadSeek: false,
            source: 'queue-recovery'
        }, at(60));

        const updatedMusic = await models.music.findUniqueOrThrow({
            where: { id: music.id }
        });
        const events = await models.playbackEvent.findMany({
            where: { musicId: music.id }
        });

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            playedMs: 40_000,
            countedAsPlay: true,
            outcome: 'skip',
            hadSeek: true
        });
        expect(updatedMusic).toMatchObject({
            playCount: 1,
            totalPlayedMs: 40_000,
            skipCount: 1,
            completionCount: 0
        });
        expect(advanced?.deduped).toBe(false);
        expect(duplicate?.deduped).toBe(true);
    });

    it('caps an unseeked branch at one track duration', async () => {
        const music = await createMusic({ duration: 180 });
        const base = {
            id: music.id.toString(),
            clientSessionId: 'observation-window-1',
            endReason: 'recovery' as const,
            hadSeek: false
        };

        await recordPlayback({ ...base, playedMs: 10_000 }, at(60));
        await recordPlayback({ ...base, playedMs: 250_000 }, at(60));

        await expect(models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        })).resolves.toMatchObject({
            playedMs: 180_000,
            endedAt: at(60)
        });
    });

    it('accepts delayed cumulative completion independent of observation spacing', async () => {
        const music = await createMusic({ duration: 100 });
        const base = {
            id: music.id.toString(),
            clientSessionId: 'delayed-handoff-1',
            branchId: 'delayed-handoff-1',
            parentBranchId: null,
            branchBasePlayedMs: 0,
            hadSeek: false
        };

        await recordPlayback({
            ...base,
            playedMs: 40_000,
            endReason: 'handoff'
        }, at(60));
        await recordPlayback({
            ...base,
            playedMs: 95_000,
            endReason: 'ended'
        }, new Date(at(60).getTime() + 1_000));

        await expect(models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        })).resolves.toMatchObject({
            playedMs: 95_000,
            completionRate: 0.95,
            outcome: 'complete',
            endReason: 'ended'
        });
        await expect(models.music.findUniqueOrThrow({
            where: { id: music.id }
        })).resolves.toMatchObject({
            playCount: 1,
            totalPlayedMs: 95_000,
            completionCount: 1
        });
    });

    it('preserves a completed terminal outcome after track duration changes', async () => {
        const music = await createMusic({ duration: 100 });
        const report = {
            id: music.id.toString(),
            clientSessionId: 'duration-change-complete-1',
            playedMs: 95_000,
            endReason: 'ended' as const,
            hadSeek: false
        };

        await recordPlayback(report, at(60));
        await models.music.update({
            where: { id: music.id },
            data: { duration: 200 }
        });
        const duplicate = await recordPlayback(report, at(61));

        expect(duplicate).toMatchObject({
            completionCount: 1,
            completionRate: 0.95,
            outcome: 'complete',
            deduped: true
        });
        await expect(models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        })).resolves.toMatchObject({
            completionRate: 0.95,
            outcome: 'complete'
        });
        await expect(models.music.findUniqueOrThrow({
            where: { id: music.id }
        })).resolves.toMatchObject({
            duration: 200,
            completionCount: 1
        });
    });

    it('keeps one aggregate across source and target handoff reports', async () => {
        const music = await createMusic({ duration: 100 });
        const base = {
            id: music.id.toString(),
            startedAt: at(0).toISOString(),
            clientSessionId: 'handoff-shared-1'
        };

        await recordPlayback({
            ...base,
            playedMs: 40_000,
            endedAt: at(40).toISOString(),
            endReason: 'handoff',
            hadSeek: false,
            source: 'queue-handoff'
        }, at(40));
        await recordPlayback({
            ...base,
            playedMs: 95_000,
            endedAt: at(100).toISOString(),
            endReason: 'ended',
            hadSeek: false,
            source: 'queue-ended'
        }, at(100));

        const updatedMusic = await models.music.findUniqueOrThrow({
            where: { id: music.id }
        });
        const events = await models.playbackEvent.findMany({
            where: { musicId: music.id }
        });

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            clientSessionId: 'handoff-shared-1',
            playedMs: 95_000,
            countedAsPlay: true,
            outcome: 'complete'
        });
        expect(updatedMusic).toMatchObject({
            playCount: 1,
            totalPlayedMs: 95_000,
            skipCount: 0,
            completionCount: 1
        });
        expect(updatedMusic.lastCompletedAt).toEqual(at(100));
    });

    it.each(['source-first', 'target-first'])(
        'adds offline source and target branch deltas in %s recovery order',
        async (order) => {
            const music = await createMusic({ duration: 100 });
            const clientSessionId = `forced-branches-${order}`;
            const source = {
                id: music.id.toString(),
                clientSessionId,
                branchId: clientSessionId,
                parentBranchId: null,
                branchBasePlayedMs: 0,
                playedMs: 39_000,
                endReason: 'handoff' as const,
                hadSeek: false
            };
            const target = {
                id: music.id.toString(),
                clientSessionId,
                branchId: `target-${order}`,
                parentBranchId: clientSessionId,
                branchBasePlayedMs: 30_000,
                playedMs: 50_000,
                endReason: 'ended' as const,
                hadSeek: false
            };
            const reports = order === 'source-first'
                ? [source, target]
                : [target, source];

            await recordPlayback(reports[0], at(60));
            await recordPlayback(reports[1], at(61));

            await expect(models.playbackEvent.findFirstOrThrow({
                where: { musicId: music.id },
                include: { Branch: true }
            })).resolves.toMatchObject({
                playedMs: 59_000,
                countedAsPlay: true,
                Branch: expect.arrayContaining([
                    expect.objectContaining({
                        branchId: clientSessionId,
                        basePlayedMs: 0,
                        reportedPlayedMs: 39_000
                    }),
                    expect.objectContaining({
                        branchId: `target-${order}`,
                        parentBranchId: clientSessionId,
                        basePlayedMs: 30_000,
                        reportedPlayedMs: 50_000
                    })
                ])
            });
            await expect(models.music.findUniqueOrThrow({
                where: { id: music.id }
            })).resolves.toMatchObject({
                playCount: 1,
                totalPlayedMs: 59_000
            });
        }
    );

    it('reconciles sequential handoff branches when ancestors recover last', async () => {
        const music = await createMusic({ duration: 100 });
        const clientSessionId = 'sequential-branches-1';
        const shared = {
            id: music.id.toString(),
            clientSessionId,
            endReason: 'handoff' as const,
            hadSeek: false
        };

        await recordPlayback({
            ...shared,
            branchId: 'target-b',
            parentBranchId: clientSessionId,
            branchBasePlayedMs: 50_000,
            playedMs: 70_000
        }, at(60));
        await recordPlayback({
            ...shared,
            branchId: 'target-a',
            parentBranchId: clientSessionId,
            branchBasePlayedMs: 30_000,
            playedMs: 50_000
        }, at(61));

        await expect(models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        })).resolves.toMatchObject({ playedMs: 70_000 });

        await recordPlayback({
            ...shared,
            branchId: clientSessionId,
            parentBranchId: null,
            branchBasePlayedMs: 0,
            playedMs: 39_000
        }, at(62));

        await expect(models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        })).resolves.toMatchObject({ playedMs: 79_000 });
        await expect(models.music.findUniqueOrThrow({
            where: { id: music.id }
        })).resolves.toMatchObject({
            playCount: 1,
            totalPlayedMs: 79_000
        });
    });

    it.each(['root-first', 'continuation-first'])(
        'keeps a cumulative continuation lower bound in %s recovery order',
        async (order) => {
            const music = await createMusic({ duration: 100 });
            const clientSessionId = `missing-intermediate-${order}`;
            const root = {
                id: music.id.toString(),
                clientSessionId,
                branchId: clientSessionId,
                parentBranchId: null,
                branchBasePlayedMs: 0,
                playedMs: 39_000,
                endReason: 'handoff' as const,
                hadSeek: false
            };
            const continuation = {
                id: music.id.toString(),
                clientSessionId,
                branchId: `target-b-${order}`,
                parentBranchId: clientSessionId,
                branchBasePlayedMs: 50_000,
                playedMs: 70_000,
                endReason: 'handoff' as const,
                hadSeek: false
            };
            const reports = order === 'root-first'
                ? [root, continuation]
                : [continuation, root];

            await recordPlayback(reports[0], at(60));
            await recordPlayback(reports[1], at(61));

            await expect(models.playbackEvent.findFirstOrThrow({
                where: { musicId: music.id }
            })).resolves.toMatchObject({ playedMs: 70_000 });
            await expect(models.music.findUniqueOrThrow({
                where: { id: music.id }
            })).resolves.toMatchObject({ totalPlayedMs: 70_000 });
        }
    );

    it.each(['root-first', 'continuations-first'])(
        'keeps a stale parent anchor and late sibling progress in %s order',
        async (order) => {
            const music = await createMusic({ duration: 100 });
            const clientSessionId = `stale-parent-${order}`;
            const shared = {
                id: music.id.toString(),
                clientSessionId,
                parentBranchId: clientSessionId,
                endReason: 'handoff' as const,
                hadSeek: false
            };
            const root = {
                ...shared,
                branchId: clientSessionId,
                parentBranchId: null,
                branchBasePlayedMs: 0,
                playedMs: 20_000
            };
            const firstContinuation = {
                ...shared,
                branchId: `target-b-${order}`,
                branchBasePlayedMs: 30_000,
                playedMs: 50_000
            };
            const latestContinuation = {
                ...shared,
                branchId: `target-c-${order}`,
                branchBasePlayedMs: 50_000,
                playedMs: 70_000
            };
            const initialReports = order === 'root-first'
                ? [root, firstContinuation, latestContinuation]
                : [firstContinuation, latestContinuation, root];

            for (const [index, report] of initialReports.entries()) {
                await recordPlayback(report, at(60 + index));
            }
            await recordPlayback({
                ...firstContinuation,
                playedMs: 55_000
            }, at(63));

            await expect(models.playbackEvent.findFirstOrThrow({
                where: { musicId: music.id }
            })).resolves.toMatchObject({ playedMs: 75_000 });
            await expect(models.music.findUniqueOrThrow({
                where: { id: music.id }
            })).resolves.toMatchObject({ totalPlayedMs: 75_000 });
        }
    );

    it('promotes a terminal listen when delayed branch progress completes it', async () => {
        const music = await createMusic({ duration: 100 });
        const clientSessionId = 'delayed-completion-branches-1';

        await recordPlayback({
            id: music.id.toString(),
            clientSessionId,
            branchId: 'delayed-completion-target',
            parentBranchId: clientSessionId,
            branchBasePlayedMs: 30_000,
            playedMs: 80_000,
            endReason: 'ended',
            hadSeek: false
        }, at(60));
        await recordPlayback({
            id: music.id.toString(),
            clientSessionId,
            branchId: clientSessionId,
            parentBranchId: null,
            branchBasePlayedMs: 0,
            playedMs: 45_000,
            endReason: 'handoff',
            hadSeek: false
        }, at(61));

        await expect(models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        })).resolves.toMatchObject({
            playedMs: 95_000,
            endReason: 'ended',
            outcome: 'complete'
        });
        await expect(models.music.findUniqueOrThrow({
            where: { id: music.id }
        })).resolves.toMatchObject({
            playCount: 1,
            totalPlayedMs: 95_000,
            skipCount: 0,
            completionCount: 1
        });
    });

    it('dedupes a late source handoff report after the target already completed', async () => {
        const music = await createMusic({ duration: 100 });
        const base = {
            id: music.id.toString(),
            startedAt: at(0).toISOString(),
            clientSessionId: 'handoff-target-first-1'
        };

        await recordPlayback({
            ...base,
            playedMs: 95_000,
            endedAt: at(100).toISOString(),
            endReason: 'ended',
            hadSeek: false,
            source: 'queue-ended'
        }, at(40));
        const lateSource = await recordPlayback({
            ...base,
            playedMs: 40_000,
            endedAt: at(40).toISOString(),
            endReason: 'handoff',
            hadSeek: false,
            source: 'queue-handoff'
        }, at(100));

        const updatedMusic = await models.music.findUniqueOrThrow({
            where: { id: music.id }
        });
        const events = await models.playbackEvent.findMany({
            where: { musicId: music.id }
        });

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            playedMs: 95_000,
            outcome: 'complete',
            endReason: 'ended'
        });
        expect(updatedMusic).toMatchObject({
            playCount: 1,
            totalPlayedMs: 95_000,
            skipCount: 0,
            completionCount: 1
        });
        expect(lateSource?.deduped).toBe(true);
    });

    it('keeps the first skip signal when a later report advances progress', async () => {
        const music = await createMusic({ duration: 100 });
        const base = {
            id: music.id.toString(),
            startedAt: at(0).toISOString(),
            clientSessionId: 'terminal-first-1'
        };

        await recordPlayback({
            ...base,
            playedMs: 40_000,
            endedAt: at(40).toISOString(),
            endReason: 'skipped',
            hadSeek: false
        }, at(40));
        await recordPlayback({
            ...base,
            playedMs: 95_000,
            endedAt: at(100).toISOString(),
            endReason: 'ended',
            hadSeek: false
        }, at(100));

        const updatedMusic = await models.music.findUniqueOrThrow({
            where: { id: music.id }
        });
        const event = await models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        });

        expect(event).toMatchObject({
            playedMs: 95_000,
            outcome: 'skip',
            endReason: 'skipped'
        });
        expect(updatedMusic).toMatchObject({
            playCount: 1,
            totalPlayedMs: 95_000,
            skipCount: 1,
            completionCount: 0
        });
    });

    it('stores a terminal listen even when its cumulative time did not advance', async () => {
        const music = await createMusic({ duration: 100 });
        const base = {
            id: music.id.toString(),
            playedMs: 40_000,
            startedAt: at(0).toISOString(),
            endedAt: at(40).toISOString(),
            hadSeek: true,
            clientSessionId: 'terminal-listen-1'
        };

        await recordPlayback({
            ...base,
            endReason: 'recovery'
        }, at(60));
        const terminal = await recordPlayback({
            ...base,
            endReason: 'ended'
        }, at(60));

        const event = await models.playbackEvent.findFirstOrThrow({
            where: { musicId: music.id }
        });
        const updatedMusic = await models.music.findUniqueOrThrow({
            where: { id: music.id }
        });

        expect(event).toMatchObject({
            playedMs: 40_000,
            outcome: 'listen',
            endReason: 'ended',
            hadSeek: true
        });
        expect(updatedMusic).toMatchObject({
            playCount: 1,
            totalPlayedMs: 40_000,
            skipCount: 0,
            completionCount: 0
        });
        expect(terminal?.deduped).toBe(false);
    });

    it('dedupes concurrent cumulative reports and keeps the largest value', async () => {
        const music = await createMusic({ duration: 100 });
        const base = {
            id: music.id.toString(),
            startedAt: at(0).toISOString(),
            endedAt: at(50).toISOString(),
            endReason: 'skipped' as const,
            hadSeek: false,
            clientSessionId: 'concurrent-1'
        };

        await Promise.all([
            recordPlayback({ ...base, playedMs: 35_000 }, at(60)),
            recordPlayback({ ...base, playedMs: 45_000 }, at(60))
        ]);

        const updatedMusic = await models.music.findUniqueOrThrow({
            where: { id: music.id }
        });
        const events = await models.playbackEvent.findMany({
            where: { musicId: music.id }
        });

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            playedMs: 45_000,
            countedAsPlay: true,
            outcome: 'skip'
        });
        expect(updatedMusic).toMatchObject({
            playCount: 1,
            totalPlayedMs: 45_000,
            skipCount: 1
        });
    });

    it('rejects reusing a playback identity for another track', async () => {
        const first = await createMusic({ duration: 100 });
        const second = await createMusic({ duration: 100 });

        await recordPlayback({
            id: first.id.toString(),
            playedMs: 10_000,
            startedAt: at(0).toISOString(),
            endedAt: at(10).toISOString(),
            endReason: 'recovery',
            hadSeek: false,
            clientSessionId: 'identity-track-fence'
        }, at(30));

        await expect(recordPlayback({
            id: second.id.toString(),
            playedMs: 10_000,
            startedAt: at(0).toISOString(),
            endedAt: at(10).toISOString(),
            endReason: 'recovery',
            hadSeek: false,
            clientSessionId: 'identity-track-fence'
        }, at(30))).rejects.toThrow(
            'Playback session identity belongs to another track.'
        );

        const secondAfter = await models.music.findUniqueOrThrow({
            where: { id: second.id }
        });
        expect(secondAfter).toMatchObject({
            playCount: 0,
            totalPlayedMs: 0,
            skipCount: 0,
            lastSkippedAt: null,
            completionCount: 0,
            lastCompletedAt: null
        });
    });

    it.each(['   ', 'x'.repeat(129)])(
        'rejects an invalid supplied playback identity %#',
        async (clientSessionId) => {
            const music = await createMusic({ duration: 100 });

            await expect(recordPlayback({
                id: music.id.toString(),
                playedMs: 10_000,
                endReason: 'recovery',
                hadSeek: false,
                clientSessionId
            }, at(30))).rejects.toThrow(
                'Playback session identity must contain between 1 and 128 characters.'
            );

            await expect(models.playbackEvent.count({
                where: { musicId: music.id }
            })).resolves.toBe(0);
        }
    );

    it('rejects a continuation whose parent is not the canonical session', async () => {
        const music = await createMusic({ duration: 100 });

        await expect(recordPlayback({
            id: music.id.toString(),
            clientSessionId: 'canonical-session',
            branchId: 'target-branch',
            parentBranchId: 'missing-parent',
            branchBasePlayedMs: 20_000,
            playedMs: 30_000,
            endReason: 'recovery',
            hadSeek: false
        }, at(30))).rejects.toThrow('Playback branch metadata is invalid.');
        await expect(models.playbackEvent.count({
            where: { musicId: music.id }
        })).resolves.toBe(0);
    });
});
