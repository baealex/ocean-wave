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
    state: {
        registry: null as unknown,
        loading: false,
        renamingDeviceId: null as string | null,
        error: null as string | null,
        errorRetryable: false
    },
    refresh: vi.fn(),
    rename: vi.fn().mockResolvedValue(true)
}));

vi.mock('~/store/base-store', () => ({
    useAppStore: (store: { state: object; setState: (partial: object) => void }) => [
        store.state,
        store.setState
    ]
}));

vi.mock('~/store/playback-devices', () => ({
    playbackDevicesStore: {
        get state() {
            return ui.state;
        },
        setState: (partial: Record<string, unknown>) => {
            Object.assign(ui.state, partial);
        },
        currentDeviceId: 'browser-1',
        refresh: ui.refresh,
        rename: ui.rename
    }
}));

vi.mock('~/components/shared', async () => {
    const { createElement } = await import('react');

    return {
        Button: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
        SettingSection: ({
            title,
            description,
            children
        }: {
            title: string;
            description: string;
            children?: ReactNode;
        }) => createElement('section', null,
            createElement('h2', null, title),
            createElement('p', null, description),
            children
        ),
        Tag: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
        TagButton: ({
            children,
            'aria-label': ariaLabel
        }: {
            children?: ReactNode;
            'aria-label'?: string;
        }) => createElement('button', { 'aria-label': ariaLabel }, children),
        Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children)
    };
});

vi.mock('~/components/shared/Modal', () => ({
    TextEntryDialog: () => null
}));

import { playbackDevicesStore } from '~/store/playback-devices';
import { PlaybackDevicesSection } from './PlaybackDevicesSection';

const renderSection = () => renderToStaticMarkup(
    createElement(PlaybackDevicesSection)
);

describe('PlaybackDevicesSection', () => {
    beforeEach(() => {
        playbackDevicesStore.setState({
            registry: null,
            loading: false,
            renamingDeviceId: null,
            error: null,
            errorRetryable: false
        });
    });

    it('shows loading, empty, and recovery states', () => {
        playbackDevicesStore.setState({ loading: true });
        expect(renderSection()).toContain('Loading playback devices…');

        playbackDevicesStore.setState({ loading: false });
        expect(renderSection()).toContain('No playback devices have registered yet.');

        playbackDevicesStore.setState({
            error: 'Unable to read playback devices.',
            errorRetryable: true
        });
        const errorMarkup = renderSection();
        expect(errorMarkup).toContain('Unable to read playback devices.');
        expect(errorMarkup).toContain('Retry');
    });

    it('shows terminal registration guidance without registry retry', () => {
        playbackDevicesStore.setState({
            error: 'Playback endpoint capacity is full. Close another playback tab and reload.',
            errorRetryable: false
        });

        const markup = renderSection();
        expect(markup).toContain('Close another playback tab and reload.');
        expect(markup).not.toContain('Retry');
    });

    it('renders active and online device information with a rename action', () => {
        playbackDevicesStore.setState({
            registry: {
                commandEpoch: 'epoch-1',
                activeEndpointId: 'tab-1',
                serverTime: '2026-07-20T00:00:00.000Z',
                devices: [
                    {
                        id: 'browser-1',
                        name: 'Studio Browser',
                        type: 'desktop-web',
                        lastSeenAt: '2026-07-20T00:00:00.000Z',
                        online: true,
                        active: true,
                        endpoints: [{
                            id: 'tab-1',
                            capabilities: ['play', 'pause'],
                            lastSeenAt: '2026-07-20T00:00:00.000Z',
                            online: true,
                            active: true,
                            registrationGeneration: 2
                        }]
                    },
                    {
                        id: 'browser-2',
                        name: 'Pocket Browser',
                        type: 'mobile-web',
                        lastSeenAt: '2026-07-19T00:00:00.000Z',
                        online: false,
                        active: false,
                        endpoints: [{
                            id: 'tab-2',
                            capabilities: ['play', 'pause'],
                            lastSeenAt: '2026-07-19T00:00:00.000Z',
                            online: false,
                            active: false,
                            registrationGeneration: null
                        }]
                    }
                ]
            }
        });

        const markup = renderSection();

        expect(markup).toContain('Studio Browser');
        expect(markup).toContain('This browser');
        expect(markup).toContain('Active player');
        expect(markup).toContain('Online');
        expect(markup).toContain('Desktop web · 1 online tab · Last seen');
        expect(markup).toContain('Pocket Browser');
        expect(markup).toContain('Mobile web · 0 online tabs · Last seen');
        expect(markup).toContain('Offline');
        expect(markup).toContain('aria-label="Rename Studio Browser"');
    });
});
