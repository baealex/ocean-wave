import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({
    navigate: vi.fn(),
    remotePlayback: null as null | Record<string, unknown>,
    remoteControlPhase: 'idle',
    remoteControllerReady: true
}));

const fixtures = vi.hoisted(() => ({
    music: {
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
        filePath: '/track.flac',
        hasMetadataOverride: false,
        isLiked: false,
        isHated: false,
        createdAt: 1,
        genres: [],
        tags: [],
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
            artist: { id: 'artist-1', name: 'Ocean Signals' },
            musics: [{ id: 'track-1' }],
            createdAt: 1
        }
    }
}));

vi.mock('react-router-dom', () => ({
    useNavigate: () => ui.navigate
}));

vi.mock('~/hooks', () => ({
    useRemotePlayback: () => ui.remotePlayback,
    useResetQueue: () => vi.fn()
}));

vi.mock('~/store/base-store', () => ({
    useAppStore: (store: { state: object }) => [store.state, vi.fn()]
}));

vi.mock('~/store/music', () => ({
    musicStore: {
        state: {
            loaded: true,
            musics: [fixtures.music],
            musicMap: new Map([[fixtures.music.id, fixtures.music]])
        }
    }
}));

vi.mock('~/store/queue', () => ({
    queueStore: {
        state: {
            currentTrackId: fixtures.music.id,
            isPlaying: false,
            items: [fixtures.music.id],
            progress: 12,
            queueLength: 1,
            selected: 0
        }
    }
}));

vi.mock('~/store/remote-playback-control', () => ({
    isRemotePlaybackControlPending: (phase: string) => [
        'sending',
        'accepted',
        'recovering',
        'reconciling',
        'refresh_error'
    ].includes(phase),
    remotePlaybackControlStore: {
        get state() {
            return {
                phase: ui.remoteControlPhase,
                controllerReady: ui.remoteControllerReady
            };
        }
    }
}));

vi.mock('~/components/shared', () => ({
    CompactTrackRow: () => null,
    IconTextButton: ({
        disabled,
        icon,
        label,
        meta
    }: {
        disabled?: boolean;
        icon?: ReactNode;
        label?: ReactNode;
        meta?: ReactNode;
    }) => createElement('button', { disabled }, icon, label, meta),
    Image: ({ alt }: { alt?: string }) => createElement('img', { alt }),
    LibraryActionCard: ({ label, meta }: { label?: string; meta?: string }) => (
        createElement('div', null, label, meta)
    ),
    SectionEmptyState: ({ children }: { children?: ReactNode }) => (
        createElement('div', null, children)
    ),
    SectionHeader: ({
        eyebrow,
        heading,
        actions
    }: {
        eyebrow?: string;
        heading?: string;
        actions?: ReactNode;
    }) => createElement('header', null, eyebrow, heading, actions),
    SectionHeaderAction: ({ children }: { children?: ReactNode }) => (
        createElement('button', null, children)
    ),
    Surface: ({ children }: { children?: ReactNode }) => createElement('section', null, children),
    Text: ({
        as = 'span',
        children
    }: {
        as?: string;
        children?: ReactNode;
    }) => createElement(as, null, children)
}));

vi.mock('~/icon', () => ({
    Disc: () => createElement('span'),
    Heart: () => createElement('span'),
    ListMusic: () => createElement('span'),
    Music: () => createElement('span'),
    Pause: () => createElement('span'),
    Play: () => createElement('span'),
    User: () => createElement('span')
}));

import Home from './Home';

describe('Home playback hero', () => {
    beforeEach(() => {
        ui.remoteControlPhase = 'idle';
        ui.remoteControllerReady = true;
    });

    it('labels observed remote playback separately from this browser audio', () => {
        ui.remotePlayback = {
            music: fixtures.music,
            positionMs: 30_000,
            progress: 25,
            state: 'paused',
            targetEndpointId: 'remote-tab'
        };

        const markup = renderToStaticMarkup(createElement(Home));

        expect(markup).toContain('Paused remotely');
        expect(markup).toContain('Midnight Current');
        expect(markup).toContain('Open controls');
        expect(markup).toContain('Open queue');
        expect(markup).toMatch(/<button disabled="">[^<]*<span><\/span>Play library/);
        expect(markup).not.toContain('Ready here');
        expect(markup).not.toContain('>Resume<');
    });

    it('keeps a stopped remote target separate from local playback actions', () => {
        ui.remotePlayback = {
            music: fixtures.music,
            positionMs: 0,
            progress: 0,
            state: 'stopped',
            targetEndpointId: 'remote-tab'
        };

        const markup = renderToStaticMarkup(createElement(Home));

        expect(markup).toContain('Stopped remotely');
        expect(markup).toContain('Open controls');
        expect(markup).toMatch(/<button disabled="">[^<]*<span><\/span>Play library/);
        expect(markup).not.toContain('Ready here');
        expect(markup).not.toContain('>Resume<');
    });

    it('keeps remote ownership visible when its media cannot be resolved', () => {
        ui.remotePlayback = {
            music: null,
            positionMs: 0,
            progress: 0,
            state: 'stopped',
            targetEndpointId: 'remote-tab'
        };

        const markup = renderToStaticMarkup(createElement(Home));

        expect(markup).toContain('Stopped remotely');
        expect(markup).toContain('Remote playback item unavailable.');
        expect(markup).toContain('Open controls');
        expect(markup).toMatch(/<button disabled="">[^<]*<span><\/span>Play library/);
        expect(markup).not.toContain('Ready here');
        expect(markup).not.toContain('>Start library<');
    });

    it('routes to recovery controls and disables new playback while reconciliation is pending', () => {
        ui.remotePlayback = null;
        ui.remoteControlPhase = 'refresh_error';

        const markup = renderToStaticMarkup(createElement(Home));

        expect(markup).toContain('Refreshing playback state');
        expect(markup).toContain('Open controls');
        expect(markup).toMatch(/<button disabled="">[^<]*<span><\/span>Play library/);
        expect(markup).not.toContain('>Resume<');
    });

    it('keeps local fallback playback available while controller snapshots refresh', () => {
        ui.remotePlayback = null;
        ui.remoteControllerReady = false;

        const markup = renderToStaticMarkup(createElement(Home));

        expect(markup).toContain('Ready here');
        expect(markup).toContain('>Resume<');
        expect(markup).not.toContain('Refreshing playback state');
        expect(markup).not.toMatch(/<button disabled="">[^<]*<span><\/span>Play library/);
    });
});
