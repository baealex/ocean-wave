import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const ui = vi.hoisted(() => ({
    refresh: vi.fn(),
    playHere: vi.fn(),
    forcePlayHere: vi.fn(),
    retryHandoff: vi.fn(),
    resumeHere: vi.fn(),
    dismissHandoff: vi.fn(),
    onOpenChange: null as null | ((open: boolean) => void),
    retryProps: null as null | Record<string, unknown>,
    playHereProps: null as null | Record<string, unknown>,
    forceProps: null as null | Record<string, unknown>,
    state: {
        registry: null as null | Record<string, unknown>,
        loading: false,
        error: null as string | null,
        errorRetryable: false
    },
    handoffState: {
        handoffId: null,
        sourceEndpointId: null,
        sourceDeviceName: null,
        targetEndpointId: null,
        targetDeviceName: null,
        phase: 'idle',
        message: null as string | null,
        error: null as null | Record<string, unknown>,
        forceAvailable: false,
        retryAvailable: false,
        resumeAvailable: false
    }
}));

vi.mock('@baejino/react-ui/modal/dialog', () => ({
    Close: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
    Content: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
        createElement('div', props, children)
    ),
    Description: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
    Overlay: (props: Record<string, unknown>) => createElement('div', props),
    Portal: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
    Root: ({
        children,
        onOpenChange
    }: {
        children?: ReactNode;
        onOpenChange?: (open: boolean) => void;
    }) => {
        ui.onOpenChange = onOpenChange ?? null;
        return createElement(Fragment, null, children);
    },
    Title: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
    Trigger: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children)
}));

vi.mock('~/store/base-store', () => ({
    useAppStore: (store: { state: object }) => [store.state, vi.fn()]
}));

vi.mock('~/store/playback-devices', () => ({
    playbackDevicesStore: {
        currentDeviceId: 'local-browser',
        get state() {
            return ui.state;
        },
        refresh: ui.refresh
    },
    resolveActivePlaybackTarget: (registry: {
        activeEndpointId?: string | null;
        devices?: Array<{ endpoints: Array<{ id: string }> }>;
    } | null) => {
        if (!registry?.activeEndpointId) {
            return null;
        }
        for (const device of registry.devices ?? []) {
            const endpoint = device.endpoints.find(
                candidate => candidate.id === registry.activeEndpointId
            );
            if (endpoint) {
                return { device, endpoint };
            }
        }
        return null;
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
        playHere: ui.playHere,
        forcePlayHere: ui.forcePlayHere,
        retry: ui.retryHandoff,
        resumeHere: ui.resumeHere,
        dismiss: ui.dismissHandoff
    }
}));

vi.mock('~/store/playback-session', () => ({
    playbackSessionStore: {
        state: { endpointId: 'local-tab' }
    }
}));

vi.mock('~/components/shared', () => ({
    Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
        if (children === 'Retry') {
            ui.retryProps = props;
        }
        if (children === 'Play Here') {
            ui.playHereProps = props;
        }
        if (children === 'Force Play Here') {
            ui.forceProps = props;
        }
        return createElement('button', props, children);
    },
    IconButton: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
        createElement('button', props, children)
    ),
    IconTextButton: ({
        icon,
        label,
        meta,
        ...props
    }: {
        icon?: ReactNode;
        label?: ReactNode;
        meta?: ReactNode;
        [key: string]: unknown;
    }) => createElement('button', props, icon, label, meta),
    Text: ({
        as = 'span',
        children,
        ...props
    }: {
        as?: string;
        children?: ReactNode;
        [key: string]: unknown;
    }) => createElement(as, props, children)
}));

vi.mock('~/components/shared/Modal/DialogShell', () => ({
    dialogChromeClass: {
        body: '',
        description: '',
        header: '',
        panel: '',
        stickyHeader: '',
        title: ''
    },
    dialogContentClass: () => '',
    dialogOverlayClass: () => ''
}));

vi.mock('~/icon', () => ({
    Check: () => createElement('span', null, 'selected'),
    Close: () => createElement('span', null, 'close'),
    Smartphone: () => createElement('span', null, 'phone')
}));

import { PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS } from '~/modules/playback-controller';
import PlaybackDeviceMenu from './PlaybackDeviceMenu';

const remoteEndpoint = {
    id: 'remote-tab',
    capabilities: ['play', 'pause', 'seek', 'next', 'previous', 'handoff'],
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    online: true,
    active: true,
    registrationGeneration: 2
};

const remoteDevice = {
    id: 'remote-browser',
    name: 'Living Room Browser',
    type: 'desktop-web',
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    online: true,
    active: true,
    endpoints: [remoteEndpoint]
};

const localDevice = {
    id: 'local-browser',
    name: 'Pocket Browser',
    type: 'mobile-web',
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    online: true,
    active: false,
    endpoints: [{
        ...remoteEndpoint,
        id: 'local-tab',
        active: false
    }]
};

const renderMenu = () => renderToStaticMarkup(createElement(PlaybackDeviceMenu));

describe('PlaybackDeviceMenu', () => {
    beforeEach(() => {
        ui.refresh.mockReset();
        ui.onOpenChange = null;
        ui.retryProps = null;
        ui.playHereProps = null;
        ui.forceProps = null;
        ui.playHere.mockReset();
        ui.forcePlayHere.mockReset();
        ui.retryHandoff.mockReset();
        ui.resumeHere.mockReset();
        ui.dismissHandoff.mockReset();
        Object.assign(ui.handoffState, {
            handoffId: null,
            sourceEndpointId: null,
            sourceDeviceName: null,
            targetEndpointId: null,
            targetDeviceName: null,
            phase: 'idle',
            message: null,
            error: null,
            forceAvailable: false,
            retryAvailable: false,
            resumeAvailable: false
        });
        Object.assign(ui.state, {
            registry: {
                commandEpoch: 'epoch-1',
                activeEndpointId: 'remote-tab',
                serverTime: '2026-07-20T00:00:00.000Z',
                devices: [remoteDevice, localDevice]
            },
            loading: false,
            error: null,
            errorRetryable: false
        });
    });

    it('offers Play Here on this browser when both endpoint registrations support handoff', () => {
        const markup = renderMenu();

        expect(markup).toContain('Playback output: Living Room Browser, Online. Open device list');
        expect(markup).toContain('Playback output');
        expect(markup).toContain('Review the active output or move its queue and position to this browser.');
        expect(markup).toContain('aria-label="Playback devices"');
        expect(markup).toContain('Living Room Browser');
        expect(markup).toContain('Active player');
        expect(markup).toContain('Pocket Browser');
        expect(markup).toContain('This browser · Online');
        expect(markup).toContain('Play Here');
        expect(markup).toContain('Close playback output');

        (ui.playHereProps?.onClick as undefined | (() => void))?.();
        expect(ui.playHere).toHaveBeenCalledTimes(1);
    });

    it('shows an explicit forced recovery choice after an offline source rejection', () => {
        Object.assign(ui.handoffState, {
            phase: 'rejected',
            message: 'The source endpoint is offline.',
            error: {
                code: 'SOURCE_OFFLINE',
                message: 'The source endpoint is offline.',
                retryable: true,
                forceAllowed: true
            },
            forceAvailable: true
        });

        const markup = renderMenu();
        expect(markup).toContain('role="alert"');
        expect(markup).toContain('The source endpoint is offline.');
        expect(markup).toContain('Force Play Here');

        (ui.forceProps?.onClick as undefined | (() => void))?.();
        expect(ui.forcePlayHere).toHaveBeenCalledTimes(1);
    });

    it('keeps the last known device list visible with a retryable registry error', () => {
        ui.state.error = 'Unable to read playback devices.';
        ui.state.errorRetryable = true;

        const markup = renderMenu();
        expect(markup).toContain('role="alert"');
        expect(markup).toContain('Unable to read playback devices.');
        expect(markup).toContain('Retry');
        expect(markup).toContain('Living Room Browser');

        (ui.retryProps?.onClick as undefined | (() => void))?.();
        expect(ui.refresh).toHaveBeenCalledWith(
            PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
        );
    });

    it('shows terminal registration guidance without a dead registry retry', () => {
        ui.state.error = 'Playback endpoint capacity is full. Close another playback tab and reload.';
        ui.state.errorRetryable = false;

        const markup = renderMenu();
        expect(markup).toContain('Close another playback tab and reload.');
        expect(markup).not.toContain('>Retry<');
        expect(ui.retryProps).toBeNull();
    });

    it('bounds the device read started when the dialog opens', () => {
        renderMenu();

        ui.onOpenChange?.(true);
        expect(ui.refresh).toHaveBeenCalledWith(
            PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
        );
    });
});
