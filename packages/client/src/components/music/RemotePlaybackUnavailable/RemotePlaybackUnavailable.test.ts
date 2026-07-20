import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/components/shared', () => ({
    IconTextButton: ({ icon, label, ...props }: {
        icon?: ReactNode;
        label?: ReactNode;
    }) => createElement('button', props, icon, label),
    StateMessage: ({
        actions,
        description,
        heading,
        icon
    }: {
        actions?: ReactNode;
        description?: ReactNode;
        heading?: ReactNode;
        icon?: ReactNode;
    }) => createElement('section', null, icon, heading, description, actions)
}));

vi.mock('~/icon', () => ({
    Activity: () => createElement('span'),
    ListMusic: () => createElement('span')
}));

vi.mock('../RemotePlaybackControls', () => ({
    default: () => createElement('div', null, 'remote controls')
}));

import RemotePlaybackUnavailable from './RemotePlaybackUnavailable';

describe('RemotePlaybackUnavailable', () => {
    it('keeps remote state, device, and connection status visible without media', () => {
        const markup = renderToStaticMarkup(createElement(RemotePlaybackUnavailable, {
            canSend: () => false,
            deviceName: 'Living Room Browser',
            deviceStatus: 'Offline',
            onCommand: vi.fn(),
            onOpenQueue: vi.fn(),
            state: 'stopped'
        }));

        expect(markup).toContain('Remote playback item unavailable.');
        expect(markup).toContain('Stopped on Living Room Browser · Offline.');
        expect(markup).toContain('local playback is disabled until ownership changes.');
        expect(markup).toContain('remote controls');
        expect(markup).toContain('Open queue');
    });
});
