import {
    describe,
    expect,
    it
} from 'vitest';

import type { PlaybackSessionSnapshot } from '~/api/playback-session';
import {
    isNewerPlaybackSnapshot,
    resolveSharedPlaybackPositionMs
} from './shared-playback';

const createSnapshot = (
    overrides: Partial<PlaybackSessionSnapshot> = {}
): PlaybackSessionSnapshot => ({
    id: '1',
    state: 'playing',
    activeDeviceId: 'web-tab-1',
    currentMusicId: '42',
    positionMs: 10_000,
    positionUpdatedAt: '2026-07-14T00:00:00.000Z',
    startedAt: '2026-07-14T00:00:00.000Z',
    revision: 1,
    serverTime: '2026-07-14T00:00:02.000Z',
    ...overrides
});

describe('shared playback state', () => {
    it('accepts only snapshots with a newer revision', () => {
        const current = createSnapshot({ revision: 4 });

        expect(isNewerPlaybackSnapshot(current, createSnapshot({ revision: 5 }))).toBe(true);
        expect(isNewerPlaybackSnapshot(current, createSnapshot({ revision: 4 }))).toBe(false);
        expect(isNewerPlaybackSnapshot(current, createSnapshot({ revision: 3 }))).toBe(false);
    });

    it('derives playing position from server time and local receipt time', () => {
        expect(resolveSharedPlaybackPositionMs({
            snapshot: createSnapshot(),
            receivedAtMs: 20_000,
            nowMs: 23_000,
            durationMs: 60_000
        })).toBe(15_000);
    });

    it('does not advance paused state and clamps playing state to duration', () => {
        expect(resolveSharedPlaybackPositionMs({
            snapshot: createSnapshot({ state: 'paused' }),
            receivedAtMs: 20_000,
            nowMs: 40_000,
            durationMs: 12_000
        })).toBe(10_000);
        expect(resolveSharedPlaybackPositionMs({
            snapshot: createSnapshot({ positionMs: 59_000 }),
            receivedAtMs: 20_000,
            nowMs: 40_000,
            durationMs: 60_000
        })).toBe(60_000);
    });
});
