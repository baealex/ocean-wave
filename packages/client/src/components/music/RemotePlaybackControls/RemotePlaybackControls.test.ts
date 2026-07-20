import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/components/shared', () => ({
    IconButton: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
        createElement('button', props, children)
    )
}));

vi.mock('~/icon', () => ({
    Pause: () => createElement('span', null, 'pause'),
    Play: () => createElement('span', null, 'play'),
    SkipBack: () => createElement('span', null, 'previous'),
    SkipForward: () => createElement('span', null, 'next')
}));

import RemotePlaybackControls from './RemotePlaybackControls';

describe('RemotePlaybackControls', () => {
    it('labels remote actions with the output device and preserves authoritative playing state', () => {
        const markup = renderToStaticMarkup(createElement(RemotePlaybackControls, {
            canSend: command => command === 'pause',
            deviceName: 'Living Room Browser',
            onCommand: vi.fn(),
            state: 'playing'
        }));

        expect(markup).toContain('aria-label="Remote playback controls for Living Room Browser"');
        expect(markup).toContain('aria-label="Previous track on Living Room Browser" disabled=""');
        expect(markup).toContain('aria-label="Pause playback on Living Room Browser"');
        expect(markup).not.toContain('Resume playback on Living Room Browser');
        expect(markup).toContain('aria-label="Next track on Living Room Browser" disabled=""');
    });

    it('renders a resume action only from an observed paused state', () => {
        const markup = renderToStaticMarkup(createElement(RemotePlaybackControls, {
            canSend: () => true,
            deviceName: 'Pocket Browser',
            layout: 'detail',
            onCommand: vi.fn(),
            state: 'paused'
        }));

        expect(markup).toContain('Resume playback on Pocket Browser');
        expect(markup).not.toContain('Pause playback on Pocket Browser');
        expect(markup).not.toContain('disabled=""');
    });

    it('renders remote Play rather than a local resume action for a stopped target', () => {
        const markup = renderToStaticMarkup(createElement(RemotePlaybackControls, {
            canSend: command => command === 'play',
            deviceName: 'Living Room Browser',
            onCommand: vi.fn(),
            state: 'stopped'
        }));

        expect(markup).toContain('Play on Living Room Browser');
        expect(markup).not.toContain('Resume playback on Living Room Browser');
        expect(markup).not.toContain('Pause playback on Living Room Browser');
    });
});
