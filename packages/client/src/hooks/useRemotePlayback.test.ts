import { describe, expect, it } from 'vitest';

import type { PlaybackQueueSnapshot } from '~/api/playback-queue';
import type { PlaybackSessionSnapshot } from '~/api/playback-session';
import {
    isRemotePlaybackOwnershipActive,
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE
} from '~/modules/playback-ownership';
import { resolveRemotePlaybackMusicId } from './useRemotePlayback';
import { resolveRemotePlaybackOwnership } from './useRemotePlaybackOwnership';

const createSession = (
    overrides: Partial<PlaybackSessionSnapshot> = {}
): PlaybackSessionSnapshot => ({
    id: 'session-1',
    state: 'playing',
    activeDeviceId: 'remote-tab',
    activeDeviceSequence: 3,
    currentMusicId: 'track-1',
    positionMs: 1_000,
    positionUpdatedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    revision: 7,
    serverTime: '2026-07-20T00:00:00.000Z',
    ...overrides
});

const createQueue = (
    overrides: Partial<PlaybackQueueSnapshot> = {}
): PlaybackQueueSnapshot => ({
    id: 'queue-1',
    musicIds: ['track-1', 'track-2'],
    sourceMusicIds: ['track-1', 'track-2'],
    currentIndex: 1,
    contextType: 'queue',
    contextId: null,
    contextTitle: null,
    shuffle: false,
    repeatMode: 'none',
    revision: 4,
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides
});

describe('resolveRemotePlaybackMusicId', () => {
    it('uses the shared queue selection for a stopped remote target', () => {
        expect(resolveRemotePlaybackMusicId(
            createSession({ state: 'stopped' }),
            createQueue()
        )).toBe('track-2');
    });

    it('falls back to the stopped session item while the queue is unavailable', () => {
        expect(resolveRemotePlaybackMusicId(
            createSession({ state: 'stopped' }),
            null
        )).toBe('track-1');
    });

    it('keeps the authoritative session item while playback is active', () => {
        expect(resolveRemotePlaybackMusicId(
            createSession(),
            createQueue()
        )).toBe('track-1');
    });

    it('keeps an empty stopped selection distinct from remote ownership', () => {
        const session = createSession({
            state: 'stopped',
            currentMusicId: null
        });

        expect(resolveRemotePlaybackMusicId(
            session,
            createQueue({ currentIndex: null })
        )).toBeNull();
        expect(resolveRemotePlaybackOwnership(session, 'local-tab')).toEqual({
            state: 'stopped',
            targetEndpointId: 'remote-tab'
        });
    });
});

describe('isRemotePlaybackOwnershipActive', () => {
    it('distinguishes another active endpoint from local or disconnected ownership', () => {
        const session = createSession({ activeDeviceId: 'remote-tab' });

        expect(isRemotePlaybackOwnershipActive(session, 'local-tab')).toBe(true);
        expect(isRemotePlaybackOwnershipActive(session, 'remote-tab')).toBe(false);
        expect(isRemotePlaybackOwnershipActive(session, null)).toBe(false);
        expect(isRemotePlaybackOwnershipActive(null, 'local-tab')).toBe(false);
    });

    it('uses state-neutral ownership guidance for stopped remote sessions', () => {
        expect(REMOTE_PLAYBACK_OWNERSHIP_MESSAGE).toBe(
            'Another device owns playback. Open the player for remote controls.'
        );
        expect(REMOTE_PLAYBACK_OWNERSHIP_MESSAGE).not.toContain('active');
    });
});
