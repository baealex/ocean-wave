import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({
    navigate: vi.fn(),
    remoteOwnership: null as null | {
        state: 'playing';
        targetEndpointId: string;
    },
    resetQueue: vi.fn()
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
    useNavigate: () => ui.navigate,
    useSearchParams: () => [new URLSearchParams(), vi.fn()]
}));

vi.mock('~/hooks', () => ({
    usePlaybackSignal: () => null,
    useRemotePlaybackOwnership: () => ui.remoteOwnership,
    useResetQueue: () => ui.resetQueue
}));

vi.mock('~/store/base-store', () => ({
    useAppStore: (store: { state: object }) => [store.state, vi.fn()]
}));

vi.mock('~/store/music', () => ({
    musicStore: {
        state: {
            loaded: true,
            musics: [fixtures.music]
        },
        sortItems: []
    }
}));

vi.mock('~/store/queue', () => ({
    queueStore: { add: vi.fn() }
}));

vi.mock('~/modules/panel', () => ({
    panel: { open: vi.fn() }
}));

vi.mock('~/components/music', () => ({
    LibraryPlaybackSurface: () => createElement(
        'section',
        { id: 'remote-playback-ownership-notice' },
        ui.remoteOwnership
            ? 'Remote controls affect another device. Play Here moves playback to this browser.'
            : null
    ),
    LibraryRediscoverySections: () => null,
    MusicActionPanelContent: () => null,
    MusicListItem: () => null,
    MusicTagFilterPanelContent: () => null,
    SmartMusicFilterPanelContent: () => null
}));

vi.mock('~/components/shared', () => ({
    Button: ({ children, ...props }: { children?: ReactNode }) => (
        createElement('button', props, children)
    ),
    CollectionHeader: ({
        actions,
        children,
        summary,
        title
    }: {
        actions?: ReactNode;
        children?: ReactNode;
        summary?: ReactNode;
        title?: ReactNode;
    }) => createElement('header', null, title, summary, actions, children),
    FixedVirtualList: () => null,
    ItemSortPanelContent: () => null,
    Loading: () => null,
    PanelContent: () => null,
    SearchField: () => null,
    StateMessage: () => null,
    StickyHeaderActions: ({ children }: { children?: ReactNode }) => (
        createElement('div', null, children)
    )
}));

vi.mock('~/icon', () => ({
    Filter: () => createElement('span'),
    Music: () => createElement('span'),
    Play: () => createElement('span'),
    Sort: () => createElement('span'),
    Tags: () => createElement('span')
}));

import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';
import MusicList from './MusicList';

describe('MusicList remote ownership', () => {
    beforeEach(() => {
        ui.navigate.mockClear();
        ui.resetQueue.mockClear();
        ui.remoteOwnership = {
            state: 'playing',
            targetEndpointId: 'remote-tab'
        };
    });

    it('labels and disables Play while preserving visible remote-control guidance', () => {
        const markup = renderToStaticMarkup(createElement(MusicList));

        expect(markup).toContain('Remote controls affect another device');
        expect(markup).toContain('disabled=""');
        expect(markup).toContain(
            'aria-label="Play library unavailable while another device owns playback"'
        );
        expect(markup).toContain(`aria-describedby="${REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID}"`);
        expect(markup).toContain(`title="${REMOTE_PLAYBACK_OWNERSHIP_MESSAGE}"`);
    });

    it('keeps Play available when this browser is not observing a remote owner', () => {
        ui.remoteOwnership = null;

        const markup = renderToStaticMarkup(createElement(MusicList));

        expect(markup).not.toContain(REMOTE_PLAYBACK_OWNERSHIP_MESSAGE);
        expect(markup).not.toContain(
            'aria-label="Play library unavailable while another device owns playback"'
        );
        expect(markup).not.toContain('disabled=""');
    });
});
