import { describe, expect, it } from 'vitest';

import type { PlaybackDeviceRegistrySnapshot } from '~/api/playback-devices';
import type { PlaybackQueueSnapshot } from '~/api/playback-queue';
import type { PlaybackSessionSnapshot } from '~/api/playback-session';
import type { Music } from '~/models/type';
import {
    RECENT_PLAYBACK_RECOVERY_MAX_AGE_MS,
    resolveLibraryPlaybackSurface
} from './library-playback-surface';

const NOW_MS = Date.parse('2026-07-21T09:00:00.000Z');

const music: Music = {
    id: 'track-1',
    name: 'Midnight Current',
    duration: 245,
    codec: 'FLAC',
    bitrate: 1_411,
    sampleRate: 44_100,
    trackNumber: 1,
    playCount: 0,
    lastPlayedAt: null,
    totalPlayedMs: 0,
    skipCount: 0,
    lastSkippedAt: null,
    completionCount: 0,
    lastCompletedAt: null,
    filePath: '/track.flac',
    hasMetadataOverride: false,
    isLiked: false,
    isHated: false,
    createdAt: 1,
    genres: [],
    tags: [],
    artistDisplayName: 'Ocean Signals',
    artistCredits: [{
        artist: { id: 'artist-1', name: 'Ocean Signals' },
        role: 'PRIMARY',
        position: 0,
        creditedName: null,
        joinPhrase: ''
    }],
    artist: {
        id: 'artist-1',
        name: 'Ocean Signals',
        albums: [],
        albumCount: 1,
        musics: [{ id: 'track-1' }],
        musicCount: 1,
        createdAt: 1
    },
    album: {
        id: 'album-1',
        name: 'Tidal Memory',
        cover: '/cover.jpg',
        isCoverCustom: false,
        publishedYear: '2026',
        artistDisplayName: 'Ocean Signals',
        artistCredits: [{
            artist: { id: 'artist-1', name: 'Ocean Signals' },
            role: 'PRIMARY',
            position: 0,
            creditedName: null,
            joinPhrase: ''
        }],
        artist: { id: 'artist-1', name: 'Ocean Signals' },
        musics: [{ id: 'track-1' }],
        createdAt: 1
    }
};

const secondMusic: Music = {
    ...music,
    id: 'track-2',
    name: 'Second Current'
};

const session = (
    overrides: Partial<PlaybackSessionSnapshot> = {}
): PlaybackSessionSnapshot => ({
    id: 'session-1',
    state: 'playing',
    activeDeviceId: 'remote-tab',
    activeDeviceSequence: 3,
    currentMusicId: music.id,
    positionMs: 12_000,
    positionUpdatedAt: '2026-07-21T08:59:00.000Z',
    startedAt: '2026-07-21T08:58:00.000Z',
    revision: 7,
    serverTime: '2026-07-21T09:00:00.000Z',
    ...overrides
});

const queue = (
    overrides: Partial<PlaybackQueueSnapshot> = {}
): PlaybackQueueSnapshot => ({
    id: 'queue-1',
    musicIds: [music.id, 'track-2'],
    sourceMusicIds: [],
    currentIndex: 0,
    contextType: 'playlist',
    contextId: 'playlist-1',
    contextTitle: 'Night Drive',
    shuffle: false,
    repeatMode: 'none',
    revision: 4,
    updatedAt: '2026-07-21T08:55:00.000Z',
    ...overrides
});

const registry = (
    online = true
): PlaybackDeviceRegistrySnapshot => ({
    commandEpoch: 'epoch-1',
    activeEndpointId: 'remote-tab',
    serverTime: '2026-07-21T09:00:00.000Z',
    devices: [{
        id: 'desktop-1',
        name: 'Studio PC',
        type: 'desktop-web',
        lastSeenAt: '2026-07-21T09:00:00.000Z',
        online,
        active: true,
        endpoints: [{
            id: 'remote-tab',
            capabilities: ['play', 'pause', 'next', 'previous', 'handoff'],
            lastSeenAt: '2026-07-21T09:00:00.000Z',
            online,
            active: true,
            registrationGeneration: 2
        }]
    }, {
        id: 'desktop-local',
        name: 'Local Browser',
        type: 'desktop-web',
        lastSeenAt: '2026-07-21T09:00:00.000Z',
        online: true,
        active: false,
        endpoints: [{
            id: 'local-tab',
            capabilities: ['play', 'pause', 'next', 'previous', 'handoff'],
            lastSeenAt: '2026-07-21T09:00:00.000Z',
            online: true,
            active: false,
            registrationGeneration: 1
        }]
    }]
});

const resolve = ({
    playbackQueue = queue(),
    playbackSession = session(),
    playbackRegistry = registry()
}: {
    playbackQueue?: PlaybackQueueSnapshot | null;
    playbackSession?: PlaybackSessionSnapshot | null;
    playbackRegistry?: PlaybackDeviceRegistrySnapshot | null;
} = {}) => resolveLibraryPlaybackSurface({
    session: playbackSession,
    queue: playbackQueue,
    registry: playbackRegistry,
    localEndpointId: 'local-tab',
    musicMap: new Map([
        [music.id, music],
        [secondMusic.id, secondMusic]
    ]),
    nowMs: NOW_MS
});

describe('resolveLibraryPlaybackSurface', () => {
    it('shows the active remote session and its current output', () => {
        expect(resolve()).toMatchObject({
            kind: 'active',
            state: 'playing',
            music,
            deviceName: 'Studio PC',
            deviceOnline: true,
            canTransfer: true,
            isRemote: true,
            targetEndpointId: 'remote-tab'
        });
    });

    it('switches to a recent playlist recovery when playback stops', () => {
        expect(resolve({
            playbackSession: session({ state: 'stopped' })
        })).toMatchObject({
            kind: 'recovery',
            state: 'stopped',
            music,
            contextType: 'playlist',
            contextTitle: 'Night Drive',
            queueLength: 2,
            queuePosition: 1,
            canTransfer: true,
            isRemote: true
        });
    });

    it('reflects an offline output without dropping the recovery candidate', () => {
        expect(resolve({
            playbackSession: session({ state: 'stopped' }),
            playbackRegistry: registry(false)
        })).toMatchObject({
            kind: 'recovery',
            deviceName: 'Studio PC',
            deviceOnline: false,
            isRemote: true
        });
    });

    it('treats a recent queue without an active session as local recovery', () => {
        expect(resolve({ playbackSession: null })).toMatchObject({
            kind: 'recovery',
            deviceName: 'This browser',
            deviceOnline: true,
            isRemote: false,
            targetEndpointId: null
        });
    });

    it('uses the album name when an album context has no usable title', () => {
        expect(resolve({
            playbackSession: session({ state: 'stopped' }),
            playbackQueue: queue({
                contextType: 'album',
                contextId: 'album-1',
                contextTitle: '   '
            })
        })).toMatchObject({
            kind: 'recovery',
            contextType: 'album',
            contextTitle: 'Tidal Memory'
        });
    });

    it('hides empty, invalid, or stale local recovery data', () => {
        expect(resolveLibraryPlaybackSurface({
            session: null,
            queue: queue({ currentIndex: null }),
            registry: null,
            localEndpointId: 'local-tab',
            musicMap: new Map([[music.id, music]]),
            nowMs: NOW_MS
        })).toBeNull();

        expect(resolveLibraryPlaybackSurface({
            session: session({
                state: 'stopped',
                activeDeviceId: 'local-tab',
                positionUpdatedAt: new Date(
                    NOW_MS - RECENT_PLAYBACK_RECOVERY_MAX_AGE_MS - 1
                ).toISOString()
            }),
            queue: queue({
                updatedAt: new Date(
                    NOW_MS - RECENT_PLAYBACK_RECOVERY_MAX_AGE_MS - 1
                ).toISOString()
            }),
            registry: null,
            localEndpointId: 'local-tab',
            musicMap: new Map([[music.id, music]]),
            nowMs: NOW_MS
        })).toBeNull();
    });

    it('hides a naturally completed local final track instead of offering recovery', () => {
        expect(resolve({
            playbackSession: session({
                state: 'stopped',
                activeDeviceId: 'local-tab',
                positionMs: music.duration * 1_000
            }),
            playbackQueue: queue({
                musicIds: [music.id],
                currentIndex: 0,
                repeatMode: 'none'
            })
        })).toBeNull();
    });

    it('keeps remote ownership visible after natural completion without recovery copy', () => {
        expect(resolve({
            playbackSession: session({
                state: 'stopped',
                positionMs: music.duration * 1_000
            }),
            playbackQueue: queue({
                musicIds: [music.id],
                currentIndex: 0,
                repeatMode: 'none'
            })
        })).toMatchObject({
            kind: 'output',
            state: 'stopped',
            music,
            canTransfer: true,
            deviceName: 'Studio PC',
            isRemote: true,
            targetEndpointId: 'remote-tab'
        });
    });

    it('keeps a stopped remote output visible when no track can be restored', () => {
        expect(resolve({
            playbackSession: session({
                state: 'stopped',
                currentMusicId: null
            }),
            playbackQueue: null
        })).toMatchObject({
            kind: 'output',
            canTransfer: false,
            music: null,
            state: 'stopped',
            deviceName: 'Studio PC',
            isRemote: true
        });
    });
});
