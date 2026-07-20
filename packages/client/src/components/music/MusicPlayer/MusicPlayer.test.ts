import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({
    navigate: vi.fn(),
    queuePause: vi.fn(),
    queuePlay: vi.fn(),
    queueSeek: vi.fn(),
    queueSelect: vi.fn(),
    remoteSend: vi.fn(),
    feedbackRenders: 0,
    localButtons: new Map<string, Record<string, unknown>>(),
    remotePlayback: null as null | {
        music: unknown;
        positionMs: number;
        progress: number;
        state: 'playing' | 'paused' | 'stopped';
        targetEndpointId: string;
    },
    remoteControls: null as null | {
        canSend: (command: 'play' | 'pause' | 'seek' | 'next' | 'previous') => boolean;
        onCommand: (command: 'play' | 'pause' | 'next' | 'previous') => void;
        state: 'playing' | 'paused' | 'stopped';
    }
}));

const fixtures = vi.hoisted(() => ({
    music: {
        id: 'track-1',
        name: 'Midnight Current',
        duration: 245,
        isLiked: false,
        artist: { name: 'Ocean Signals' },
        album: { name: 'Tidal Memory', cover: '/cover.jpg' }
    },
    remotePlayback: {
        music: null as unknown,
        positionMs: 0,
        progress: 0,
        state: 'stopped' as const,
        targetEndpointId: 'remote-tab'
    }
}));

fixtures.remotePlayback.music = fixtures.music;

const stores = vi.hoisted(() => ({
    devices: {
        currentDeviceId: 'local-browser',
        state: {
            registry: {
                commandEpoch: 'epoch-1',
                activeEndpointId: 'remote-tab',
                serverTime: '2026-07-20T00:00:00.000Z',
                devices: [{
                    id: 'remote-browser',
                    name: 'Living Room Browser',
                    type: 'desktop-web',
                    lastSeenAt: '2026-07-20T00:00:00.000Z',
                    online: true,
                    active: true,
                    endpoints: [{
                        id: 'remote-tab',
                        capabilities: ['play', 'pause', 'seek', 'next', 'previous'],
                        lastSeenAt: '2026-07-20T00:00:00.000Z',
                        online: true,
                        active: true,
                        registrationGeneration: 2
                    }]
                }]
            }
        }
    },
    music: {
        state: {
            musicMap: new Map([['track-1', fixtures.music]])
        }
    },
    queue: {
        state: {
            currentTrackId: 'track-1',
            progress: 72,
            isPlaying: true,
            repeatMode: 'none',
            shuffle: false
        }
    },
    remoteControl: {
        state: {
            commandId: null,
            command: null,
            targetEndpointId: null,
            targetDeviceName: null,
            phase: 'idle' as 'idle' | 'refresh_error',
            message: null as string | null,
            error: null as null | {
                code: 'STATE_COMMIT_FAILED';
                message: string;
                retryable: true;
            },
            controllerReady: true
        }
    }
}));

vi.mock('react-router-dom', () => ({
    useNavigate: () => ui.navigate
}));

vi.mock('~/hooks', () => ({
    useRemotePlayback: () => ui.remotePlayback,
    useStoreValue: (store: { state: Record<string, unknown> }, name: string) => (
        [store.state[name], vi.fn()]
    )
}));

vi.mock('~/store/base-store', () => ({
    useAppStore: (store: { state: object }) => [store.state, vi.fn()]
}));

vi.mock('~/store/music', () => ({ musicStore: stores.music }));

vi.mock('~/store/queue', () => ({
    queueStore: {
        ...stores.queue,
        pause: ui.queuePause,
        play: ui.queuePlay,
        seek: ui.queueSeek,
        select: ui.queueSelect,
        changeRepeatMode: vi.fn(),
        next: vi.fn(),
        prev: vi.fn(),
        toggleShuffle: vi.fn()
    }
}));

vi.mock('~/store/playback-devices', () => ({
    playbackDevicesStore: stores.devices,
    resolveActivePlaybackTarget: () => ({
        device: stores.devices.state.registry.devices[0],
        endpoint: stores.devices.state.registry.devices[0].endpoints[0]
    })
}));

vi.mock('~/store/remote-playback-control', () => ({
    isRemotePlaybackControlPending: (phase: string) => [
        'sending',
        'accepted',
        'recovering',
        'reconciling',
        'refresh_error'
    ].includes(phase),
    isRemotePlaybackControllerReady: () => stores.remoteControl.state.controllerReady,
    remotePlaybackControlStore: {
        ...stores.remoteControl,
        send: ui.remoteSend
    }
}));

vi.mock('~/components/shared', () => ({
    IconButton: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
        if (typeof props['aria-label'] === 'string') {
            ui.localButtons.set(props['aria-label'], props);
        }
        return createElement('button', props, children);
    },
    Image: ({ alt }: { alt?: string }) => createElement('img', { alt })
}));

vi.mock('~/icon', () => ({
    Disc: () => createElement('span'),
    Heart: () => createElement('span'),
    Infinite: () => createElement('span'),
    ListMusic: () => createElement('span'),
    Pause: () => createElement('span'),
    Play: () => createElement('span'),
    Repeat: () => createElement('span'),
    RightLeft: () => createElement('span'),
    Shuffle: () => createElement('span'),
    SkipBack: () => createElement('span'),
    SkipForward: () => createElement('span')
}));

vi.mock('~/socket', () => ({
    MusicListener: { like: vi.fn() }
}));

vi.mock('../PlaybackCommandFeedback', () => ({
    default: () => {
        ui.feedbackRenders += 1;
        return createElement('div', null, 'command feedback');
    }
}));
vi.mock('../PlaybackDeviceMenu', () => ({ default: () => null }));
vi.mock('../RemotePlaybackControls', () => ({
    default: (props: NonNullable<typeof ui.remoteControls>) => {
        ui.remoteControls = props;
        return createElement('div', null, 'remote controls');
    }
}));

import MusicPlayer, { seekLocalPlaybackToPercent } from './MusicPlayer';

describe('MusicPlayer remote ownership', () => {
    beforeEach(() => {
        ui.queuePause.mockClear();
        ui.queuePlay.mockClear();
        ui.queueSeek.mockClear();
        ui.queueSelect.mockClear();
        ui.remoteSend.mockClear();
        ui.feedbackRenders = 0;
        ui.localButtons.clear();
        ui.remotePlayback = fixtures.remotePlayback;
        ui.remoteControls = null;
        stores.remoteControl.state.phase = 'idle';
        stores.remoteControl.state.message = null;
        stores.remoteControl.state.error = null;
        stores.remoteControl.state.controllerReady = true;
    });

    it('routes stopped remote Play through the command store without claiming local audio', () => {
        const markup = renderToStaticMarkup(createElement(MusicPlayer));

        expect(markup).toContain('Stopped on Living Room Browser');
        expect(ui.remoteControls?.state).toBe('stopped');
        expect(ui.remoteControls?.canSend('play')).toBe(true);
        expect(ui.remoteControls?.canSend('seek')).toBe(false);

        ui.remoteControls?.onCommand('play');

        expect(ui.remoteSend).toHaveBeenCalledWith({ type: 'play' });
        expect(ui.queuePlay).not.toHaveBeenCalled();
        expect(ui.queueSeek).not.toHaveBeenCalled();
        expect(ui.queueSelect).not.toHaveBeenCalled();
    });

    it('shows remote ownership without falling back to local controls when media is missing', () => {
        ui.remotePlayback = {
            ...fixtures.remotePlayback,
            music: null
        };

        const markup = renderToStaticMarkup(createElement(MusicPlayer));

        expect(markup).toContain('Remote playback item unavailable');
        expect(markup).toContain('remote controls');
        expect(markup).toContain('playback item unavailable');
        expect(ui.remoteControls?.state).toBe('stopped');
        expect(ui.remoteControls?.canSend('seek')).toBe(false);
        expect(ui.localButtons.has('Pause playback')).toBe(false);
        expect(ui.localButtons.has('Resume playback')).toBe(false);
    });

    it('keeps refresh recovery visible and blocks local controls after remote ownership disappears', () => {
        ui.remotePlayback = null;
        stores.remoteControl.state.phase = 'refresh_error';
        stores.remoteControl.state.message = 'The latest playback state could not be confirmed.';
        stores.remoteControl.state.error = {
            code: 'STATE_COMMIT_FAILED',
            message: 'The latest playback state could not be confirmed.',
            retryable: true
        };

        const markup = renderToStaticMarkup(createElement(MusicPlayer));

        expect(markup).toContain('command feedback');
        expect(markup).toContain('aria-label="Seek playback position"');
        expect(markup).toContain('aria-disabled="true"');
        expect(ui.feedbackRenders).toBe(1);
        expect(ui.localButtons.get('Pause playback')).toMatchObject({
            disabled: true
        });
        expect(ui.localButtons.get('Previous track')).toMatchObject({
            disabled: true
        });
        expect(ui.localButtons.get('Next track')).toMatchObject({
            disabled: true
        });
        expect(seekLocalPlaybackToPercent(
            ui.queueSeek,
            fixtures.music.duration,
            0.5,
            true
        )).toBe(false);
        expect(ui.queueSeek).not.toHaveBeenCalled();
    });

    it('keeps local fallback controls available during controller-only refresh', () => {
        ui.remotePlayback = null;
        stores.remoteControl.state.controllerReady = false;

        const markup = renderToStaticMarkup(createElement(MusicPlayer));

        expect(markup).toContain('aria-label="Seek playback position"');
        expect(markup).toContain('aria-disabled="false"');
        expect(ui.localButtons.get('Pause playback')).toMatchObject({
            disabled: false
        });
        expect(ui.localButtons.get('Previous track')).toMatchObject({
            disabled: false
        });
        expect(ui.localButtons.get('Next track')).toMatchObject({
            disabled: false
        });
    });
});
