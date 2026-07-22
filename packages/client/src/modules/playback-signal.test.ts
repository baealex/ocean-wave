import {
    describe,
    expect,
    it
} from 'vitest';

import type { PlaybackSessionSnapshot } from '~/api/playback-session';
import {
    getPlaybackSignalLabel,
    resolvePlaybackSignal
} from './playback-signal';

const createSnapshot = (
    overrides: Partial<PlaybackSessionSnapshot> = {}
): PlaybackSessionSnapshot => ({
    id: '1',
    state: 'playing',
    activeDeviceId: 'remote-tab',
    activeDeviceSequence: 3,
    currentMusicId: 'remote-track',
    positionMs: 10_000,
    positionUpdatedAt: '2026-07-18T00:00:00.000Z',
    startedAt: '2026-07-18T00:00:00.000Z',
    revision: 1,
    serverTime: '2026-07-18T00:00:02.000Z',
    ...overrides
});

describe('playback signal', () => {
    it('uses the active remote device before the local queue state', () => {
        expect(resolvePlaybackSignal({
            currentTrackId: 'local-track',
            isPlaying: true,
            localDeviceId: 'local-tab',
            snapshot: createSnapshot()
        })).toEqual({
            location: 'remote',
            musicId: 'remote-track',
            state: 'playing'
        });
    });

    it('uses local playing and paused states when this device is active', () => {
        const snapshot = createSnapshot({
            activeDeviceId: 'local-tab',
            currentMusicId: 'local-track'
        });

        expect(resolvePlaybackSignal({
            currentTrackId: 'local-track',
            isPlaying: true,
            localDeviceId: 'local-tab',
            snapshot
        })?.state).toBe('playing');
        expect(resolvePlaybackSignal({
            currentTrackId: 'local-track',
            isPlaying: false,
            localDeviceId: 'local-tab',
            snapshot
        })?.state).toBe('paused');
    });

    it('ignores stopped remote sessions and returns no signal without a local track', () => {
        expect(resolvePlaybackSignal({
            currentTrackId: null,
            isPlaying: false,
            localDeviceId: 'local-tab',
            snapshot: createSnapshot({ state: 'stopped' })
        })).toBeNull();
    });

    it('provides explicit local and remote state copy', () => {
        expect(getPlaybackSignalLabel({
            location: 'local',
            musicId: '1',
            state: 'paused'
        })).toBe('Paused');
        expect(getPlaybackSignalLabel({
            location: 'remote',
            musicId: '1',
            state: 'playing'
        })).toBe('Playing elsewhere');
    });
});
