import { describe, expect, it } from 'vitest';

import { PlaybackSessionTracker } from './playback-session';

describe('PlaybackSessionTracker', () => {
    it('commits an immediate explicit skip after playback starts', () => {
        const tracker = new PlaybackSessionTracker();

        tracker.play({ id: 'track-0', durationMs: 100_000 }, 1_000);

        expect(tracker.commit('skipped', 1_000)).toEqual({
            clientSessionId: expect.any(String),
            branchId: expect.any(String),
            parentBranchId: null,
            branchBasePlayedMs: 0,
            id: 'track-0',
            playedMs: 0,
            completionRate: 0,
            startedAt: new Date(1_000).toISOString(),
            endedAt: new Date(1_000).toISOString(),
            endReason: 'skipped',
            hadSeek: false
        });
    });

    it('tracks only real listening time across ticks and pauses', () => {
        const tracker = new PlaybackSessionTracker();

        tracker.play({
            id: 'track-1',
            durationMs: 200_000
        }, 1_000);
        tracker.tick(1_400);
        tracker.tick(1_900);
        tracker.pause(2_100);
        tracker.play({
            id: 'track-1',
            durationMs: 200_000
        }, 5_000);
        tracker.tick(5_300);

        expect(tracker.commit('stopped', 5_500)).toEqual({
            clientSessionId: expect.any(String),
            branchId: expect.any(String),
            parentBranchId: null,
            branchBasePlayedMs: 0,
            id: 'track-1',
            playedMs: 1_600,
            completionRate: expect.closeTo(0.008, 10),
            startedAt: new Date(1_000).toISOString(),
            endedAt: new Date(5_500).toISOString(),
            endReason: 'stopped',
            hadSeek: false
        });
    });

    it('does not count paused gaps or seek jumps as listened time', () => {
        const tracker = new PlaybackSessionTracker();

        tracker.play({
            id: 'track-2',
            durationMs: 180_000
        }, 10_000);
        tracker.tick(10_300);
        tracker.pause(10_300);

        tracker.play({
            id: 'track-2',
            durationMs: 180_000
        }, 20_000);
        tracker.tick(20_200);
        tracker.markSeek();

        expect(tracker.commit('skipped', 20_400)).toEqual({
            clientSessionId: expect.any(String),
            branchId: expect.any(String),
            parentBranchId: null,
            branchBasePlayedMs: 0,
            id: 'track-2',
            playedMs: 700,
            completionRate: expect.closeTo(700 / 180_000, 10),
            startedAt: new Date(10_000).toISOString(),
            endedAt: new Date(20_400).toISOString(),
            endReason: 'skipped',
            hadSeek: true
        });
    });

    it('resets after commit so the next track starts a fresh session', () => {
        const tracker = new PlaybackSessionTracker();

        tracker.play({
            id: 'track-1',
            durationMs: 120_000
        }, 1_000);
        tracker.tick(2_000);

        expect(tracker.commit('ended', 2_500)).toEqual({
            clientSessionId: expect.any(String),
            branchId: expect.any(String),
            parentBranchId: null,
            branchBasePlayedMs: 0,
            id: 'track-1',
            playedMs: 1_500,
            completionRate: expect.closeTo(0.0125, 10),
            startedAt: new Date(1_000).toISOString(),
            endedAt: new Date(2_500).toISOString(),
            endReason: 'ended',
            hadSeek: false
        });

        tracker.play({
            id: 'track-2',
            durationMs: 60_000
        }, 5_000);
        tracker.tick(5_600);

        expect(tracker.commit('stopped', 5_800)).toEqual({
            clientSessionId: expect.any(String),
            branchId: expect.any(String),
            parentBranchId: null,
            branchBasePlayedMs: 0,
            id: 'track-2',
            playedMs: 800,
            completionRate: expect.closeTo(800 / 60_000, 10),
            startedAt: new Date(5_000).toISOString(),
            endedAt: new Date(5_800).toISOString(),
            endReason: 'stopped',
            hadSeek: false
        });
    });

    it('creates overwriteable checkpoints with stable session identity across pause and resume', () => {
        const tracker = new PlaybackSessionTracker();

        tracker.play({
            id: 'track-3',
            durationMs: 90_000
        }, 1_000);
        tracker.tick(5_000);

        const firstCheckpoint = tracker.createCheckpoint('queue-checkpoint', 11_000);

        tracker.pause(11_500);
        tracker.play({
            id: 'track-3',
            durationMs: 90_000
        }, 20_000);
        tracker.tick(23_000);
        tracker.pause(23_000);

        const secondCheckpoint = tracker.createCheckpoint('queue-pause', 23_000);

        expect(firstCheckpoint).toEqual({
            clientSessionId: expect.any(String),
            branchId: expect.any(String),
            parentBranchId: null,
            branchBasePlayedMs: 0,
            trackId: 'track-3',
            startedAt: new Date(1_000).toISOString(),
            accumulatedPlayedMs: 10_000,
            hadSeek: false,
            lastResumedAt: new Date(1_000).toISOString(),
            active: true,
            updatedAt: new Date(11_000).toISOString(),
            source: 'queue-checkpoint'
        });
        expect(secondCheckpoint).toEqual({
            clientSessionId: firstCheckpoint?.clientSessionId,
            branchId: firstCheckpoint?.branchId,
            parentBranchId: null,
            branchBasePlayedMs: 0,
            trackId: 'track-3',
            startedAt: new Date(1_000).toISOString(),
            accumulatedPlayedMs: 13_500,
            hadSeek: false,
            lastResumedAt: new Date(20_000).toISOString(),
            active: false,
            updatedAt: new Date(23_000).toISOString(),
            source: 'queue-pause'
        });
    });

    it('starts a fresh client session id when the track changes', () => {
        const tracker = new PlaybackSessionTracker();

        tracker.play({
            id: 'track-4',
            durationMs: 100_000
        }, 1_000);
        tracker.tick(4_000);
        const firstCheckpoint = tracker.createCheckpoint('queue-checkpoint', 4_000);

        tracker.play({
            id: 'track-5',
            durationMs: 120_000
        }, 10_000);
        tracker.tick(12_000);
        const secondCheckpoint = tracker.createCheckpoint('queue-checkpoint', 12_000);

        expect(firstCheckpoint?.clientSessionId).not.toBe(secondCheckpoint?.clientSessionId);
        expect(secondCheckpoint).toEqual({
            clientSessionId: expect.any(String),
            branchId: expect.any(String),
            parentBranchId: null,
            branchBasePlayedMs: 0,
            trackId: 'track-5',
            startedAt: new Date(10_000).toISOString(),
            accumulatedPlayedMs: 2_000,
            hadSeek: false,
            lastResumedAt: new Date(10_000).toISOString(),
            active: true,
            updatedAt: new Date(12_000).toISOString(),
            source: 'queue-checkpoint'
        });
    });

    it('continues a transferred cumulative session without changing its identity', () => {
        const tracker = new PlaybackSessionTracker();
        const restored = tracker.restore({
            clientSessionId: 'shared-session',
            branchId: 'target-branch',
            parentBranchId: 'shared-session',
            branchBasePlayedMs: 40_000,
            trackId: 'track-6',
            startedAt: new Date(1_000).toISOString(),
            accumulatedPlayedMs: 40_000,
            hadSeek: true,
            lastResumedAt: new Date(10_000).toISOString(),
            active: false,
            updatedAt: new Date(45_000).toISOString(),
            source: 'queue-handoff-transfer'
        }, {
            id: 'track-6',
            durationMs: 100_000
        });

        expect(restored).toBe(true);

        tracker.play({ id: 'track-6', durationMs: 100_000 }, 50_000);
        tracker.tick(60_000);

        expect(tracker.commit('ended', 70_000)).toEqual({
            clientSessionId: 'shared-session',
            branchId: 'target-branch',
            parentBranchId: 'shared-session',
            branchBasePlayedMs: 40_000,
            id: 'track-6',
            playedMs: 60_000,
            completionRate: 0.6,
            startedAt: new Date(1_000).toISOString(),
            endedAt: new Date(70_000).toISOString(),
            endReason: 'ended',
            hadSeek: true
        });
    });

    it('rejects a transferred branch with a noncanonical parent', () => {
        const tracker = new PlaybackSessionTracker();

        expect(tracker.restore({
            clientSessionId: 'shared-session',
            branchId: 'target-branch',
            parentBranchId: 'missing-parent',
            branchBasePlayedMs: 20_000,
            trackId: 'track-6',
            startedAt: new Date(1_000).toISOString(),
            accumulatedPlayedMs: 30_000,
            hadSeek: false,
            lastResumedAt: null,
            active: false,
            updatedAt: new Date(30_000).toISOString(),
            source: 'queue-handoff-transfer'
        }, {
            id: 'track-6',
            durationMs: 100_000
        })).toBe(false);
        expect(tracker.hasSession()).toBe(false);
    });

    it('starts a fresh session when the same track is replayed after commit', () => {
        const tracker = new PlaybackSessionTracker();
        const track = { id: 'track-7', durationMs: 30_000 };

        tracker.play(track, 1_000);
        const first = tracker.commit('ended', 2_000);
        tracker.play(track, 3_000);
        const replay = tracker.commit('ended', 4_000);

        expect(first?.clientSessionId).toBeTruthy();
        expect(replay?.clientSessionId).toBeTruthy();
        expect(replay?.clientSessionId).not.toBe(first?.clientSessionId);
    });

    it('exposes an empty lineage immediately for authoritative handoff state', () => {
        const tracker = new PlaybackSessionTracker();

        tracker.play({ id: 'track-8', durationMs: 120_000 }, 1_000);

        expect(tracker.createCheckpoint('queue-shared-playback', 1_000, true))
            .toEqual(expect.objectContaining({
                clientSessionId: expect.any(String),
                trackId: 'track-8',
                accumulatedPlayedMs: 0,
                active: true
            }));
    });

    it('credits only the audible outgoing tail after a crossfade starts', () => {
        const tracker = new PlaybackSessionTracker();

        tracker.play({ id: 'track-9', durationMs: 180_000 }, 0);
        tracker.pause(160_000);
        tracker.creditListenedMs(20_000);

        expect(tracker.commit('ended', 180_000)).toEqual(expect.objectContaining({
            id: 'track-9',
            playedMs: 180_000,
            completionRate: 1,
            endReason: 'ended'
        }));
    });

    it('keeps transferred lineage valid when the target clock is behind', () => {
        const tracker = new PlaybackSessionTracker();
        const sourceStartedAt = '2026-07-21T01:00:00.000Z';

        expect(tracker.restore({
            clientSessionId: 'skewed-handoff',
            trackId: 'track-10',
            startedAt: sourceStartedAt,
            accumulatedPlayedMs: 40_000,
            hadSeek: false,
            lastResumedAt: null,
            active: false,
            updatedAt: '2026-07-21T01:00:40.000Z',
            source: 'queue-handoff-transfer'
        }, {
            id: 'track-10',
            durationMs: 120_000
        })).toBe(true);

        const behindTargetNow = Date.parse('2026-07-21T00:00:45.000Z');
        const checkpoint = tracker.createCheckpoint(
            'queue-shared-playback',
            behindTargetNow,
            true
        );

        expect(checkpoint?.updatedAt).toBe(sourceStartedAt);
        expect(new PlaybackSessionTracker().restore(checkpoint!, {
            id: 'track-10',
            durationMs: 120_000
        })).toBe(true);
    });
});
