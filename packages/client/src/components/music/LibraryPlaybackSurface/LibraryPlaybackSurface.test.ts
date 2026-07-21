import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const ui = vi.hoisted(() => ({
    actions: new Map<string, () => unknown>(),
    dismissHandoff: vi.fn(),
    forcePlayHere: vi.fn(),
    model: null as null | Record<string, unknown>,
    navigate: vi.fn(),
    playHere: vi.fn(),
    queuePlay: vi.fn(),
    remoteControlProps: null as null | Record<string, unknown>,
    remoteSend: vi.fn(),
    resumeHere: vi.fn(),
    retryHandoff: vi.fn(),
    handoffState: {
        phase: 'idle',
        message: null as string | null,
        error: null as null | Record<string, unknown>,
        forceAvailable: false,
        retryAvailable: false,
        resumeAvailable: false
    },
    queueState: {
        currentTrackId: 'track-1'
    },
    remoteState: {
        phase: 'idle',
        controllerReady: true
    }
}));

vi.mock('react-router-dom', () => ({
    useNavigate: () => ui.navigate
}));

vi.mock('~/modules/library-playback-surface', () => ({
    resolveLibraryPlaybackSurface: () => ui.model
}));

vi.mock('~/modules/playback-ownership', () => ({
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID: 'remote-playback-ownership-notice'
}));

vi.mock('~/store/base-store', () => ({
    useAppStore: (store: { state: object }) => [store.state, vi.fn()]
}));

vi.mock('~/store/music', () => ({
    musicStore: { state: { musicMap: new Map() } }
}));

vi.mock('~/store/playback-devices', () => ({
    playbackDevicesStore: { state: { registry: null } }
}));

vi.mock('~/store/playback-queue', () => ({
    playbackQueueStore: { state: { snapshot: null } }
}));

vi.mock('~/store/playback-session', () => ({
    playbackSessionStore: {
        state: { snapshot: null, endpointId: 'local-tab' }
    }
}));

vi.mock('~/store/queue', () => ({
    queueStore: {
        get state() {
            return ui.queueState;
        },
        play: ui.queuePlay
    }
}));

vi.mock('~/store/remote-playback-control', () => ({
    isRemotePlaybackControllerReady: () => ui.remoteState.controllerReady,
    isRemotePlaybackControlPending: (phase: string) => phase !== 'idle',
    remotePlaybackControlStore: {
        get state() {
            return ui.remoteState;
        },
        send: ui.remoteSend
    }
}));

vi.mock('~/store/playback-handoff', () => ({
    isPlaybackHandoffPending: (phase: string) => [
        'preparing',
        'releasing',
        'claiming',
        'activating',
        'recovering',
        'reconciling'
    ].includes(phase),
    playbackHandoffStore: {
        get state() {
            return ui.handoffState;
        },
        dismiss: ui.dismissHandoff,
        forcePlayHere: ui.forcePlayHere,
        playHere: ui.playHere,
        resumeHere: ui.resumeHere,
        retry: ui.retryHandoff
    }
}));

vi.mock('~/components/shared', () => ({
    Button: ({ children, onClick, ...props }: {
        children?: ReactNode;
        onClick?: () => unknown;
        [key: string]: unknown;
    }) => {
        if (typeof children === 'string' && onClick) {
            ui.actions.set(children, onClick);
        }
        return createElement('button', props, children);
    },
    Surface: ({ as = 'div', children, radius: _radius, variant: _variant, ...props }: {
        as?: string;
        children?: ReactNode;
        [key: string]: unknown;
    }) => createElement(as, props, children),
    Text: ({ as = 'span', children, truncate: _truncate, ...props }: {
        as?: string;
        children?: ReactNode;
        [key: string]: unknown;
    }) => createElement(as, props, children),
    TrackArtwork: (props: Record<string, unknown>) => createElement('img', props)
}));

vi.mock('../PlaybackCommandFeedback', () => ({
    default: () => createElement('div', null, 'Command status')
}));

vi.mock('../RemotePlaybackControls/RemotePlaybackControls', () => ({
    default: (props: Record<string, unknown>) => {
        ui.remoteControlProps = props;
        return createElement('div', { role: 'group' }, 'Remote controls');
    }
}));

import LibraryPlaybackSurface from './LibraryPlaybackSurface';

const music = {
    id: 'track-1',
    name: 'Midnight Current',
    artist: { name: 'Ocean Signals' },
    album: { name: 'Tidal Memory', cover: '/cover.jpg' }
};

const remoteRecovery = {
    canTransfer: true,
    kind: 'recovery',
    state: 'stopped',
    music,
    contextType: 'playlist',
    contextId: 'playlist-1',
    contextTitle: 'Night Drive',
    queueLength: 8,
    queuePosition: 3,
    updatedAt: '2026-07-21T08:55:00.000Z',
    capabilities: ['play', 'pause', 'next', 'previous', 'handoff'],
    deviceName: 'Studio PC',
    deviceOnline: true,
    isRemote: true,
    targetEndpointId: 'remote-tab'
};

const renderSurface = () => renderToStaticMarkup(
    createElement(LibraryPlaybackSurface)
);

describe('LibraryPlaybackSurface', () => {
    beforeEach(() => {
        ui.actions.clear();
        ui.dismissHandoff.mockReset();
        ui.forcePlayHere.mockReset();
        ui.navigate.mockReset();
        ui.playHere.mockReset();
        ui.queuePlay.mockReset();
        ui.remoteControlProps = null;
        ui.remoteSend.mockReset();
        ui.resumeHere.mockReset();
        ui.retryHandoff.mockReset();
        ui.model = remoteRecovery;
        ui.queueState.currentTrackId = 'track-1';
        ui.remoteState.phase = 'idle';
        ui.remoteState.controllerReady = true;
        Object.assign(ui.handoffState, {
            phase: 'idle',
            message: null,
            error: null,
            forceAvailable: false,
            retryAvailable: false,
            resumeAvailable: false
        });
    });

    it('makes remote controls and Play Here separate actions', () => {
        const markup = renderSurface();

        expect(markup).toContain('Continue listening');
        expect(markup).toContain('Night Drive playlist');
        expect(markup).toContain('3 of 8 tracks');
        expect(markup).toContain('Studio PC · Online');
        expect(markup).toContain('Remote controls affect Studio PC');
        expect(markup).toContain('Play Here moves playback to this browser');
        expect(markup).toContain('Remote controls');
        expect(markup).toContain('Play Here');
        expect(markup).toContain('id="remote-playback-ownership-notice"');

        const canSend = ui.remoteControlProps?.canSend as (command: string) => boolean;
        const onCommand = ui.remoteControlProps?.onCommand as (command: string) => void;
        expect(canSend('play')).toBe(true);
        onCommand('play');
        expect(ui.remoteSend).toHaveBeenCalledWith({ type: 'play' });

        ui.actions.get('Play Here')?.();
        expect(ui.playHere).toHaveBeenCalledOnce();
    });

    it('updates the output status and disables remote commands when it goes offline', () => {
        ui.model = { ...remoteRecovery, deviceOnline: false };

        const markup = renderSurface();
        const canSend = ui.remoteControlProps?.canSend as (command: string) => boolean;

        expect(markup).toContain('Studio PC · Offline');
        expect(markup).toContain('Remote controls are unavailable');
        expect(markup).toContain('Play Here can recover the saved queue');
        expect(canSend('play')).toBe(false);
    });

    it('resumes a synchronized local recovery without showing remote actions', () => {
        ui.model = {
            ...remoteRecovery,
            capabilities: [],
            deviceName: 'This browser',
            deviceOnline: true,
            isRemote: false,
            targetEndpointId: 'local-tab'
        };

        const markup = renderSurface();

        expect(markup).toContain('Resume here');
        expect(markup).toContain('This browser · Ready');
        expect(markup).not.toContain('Remote controls');
        expect(markup).not.toContain('>Play Here<');

        ui.actions.get('Resume here')?.();
        expect(ui.queuePlay).toHaveBeenCalledOnce();
    });

    it('offers forced recovery after an offline handoff rejection', () => {
        Object.assign(ui.handoffState, {
            phase: 'rejected',
            message: 'The source endpoint is offline.',
            error: { code: 'SOURCE_OFFLINE' },
            forceAvailable: true
        });

        const markup = renderSurface();

        expect(markup).toContain('role="alert"');
        expect(markup).toContain('The source endpoint is offline.');
        expect(markup).toContain('Force Play Here');

        ui.actions.get('Force Play Here')?.();
        expect(ui.forcePlayHere).toHaveBeenCalledOnce();
    });

    it('does not offer Play Here when an output has no transferable queue', () => {
        ui.model = {
            ...remoteRecovery,
            canTransfer: false,
            kind: 'output',
            music: null,
            queueLength: 0,
            queuePosition: null
        };

        const markup = renderSurface();

        expect(markup).toContain('No saved queue is available to move here');
        expect(markup).not.toContain('>Play Here<');
        expect(ui.actions.has('Play Here')).toBe(false);
    });

    it('keeps remote ownership guidance after a transferable queue completes', () => {
        ui.model = {
            ...remoteRecovery,
            kind: 'output',
            queueLength: 1,
            queuePosition: 1
        };

        const markup = renderSurface();

        expect(markup).toContain('Playback output');
        expect(markup).not.toContain('Continue listening');
        expect(markup).toContain('Remote controls affect Studio PC');
        expect(markup).toContain('Play Here moves playback to this browser');
        expect(markup).toContain('id="remote-playback-ownership-notice"');
        expect(markup).toContain('>Play Here<');
    });

    it('renders nothing when there is no active or recoverable playback data', () => {
        ui.model = null;

        expect(renderSurface()).toBe('');
    });
});
