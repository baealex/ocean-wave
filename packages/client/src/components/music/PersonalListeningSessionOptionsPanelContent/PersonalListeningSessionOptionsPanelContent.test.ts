import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/components/shared', () => ({
    Button: ({
        active: _active,
        children,
        fullWidth: _fullWidth,
        ...props
    }: {
        active?: boolean;
        children?: ReactNode;
        fullWidth?: boolean;
        [key: string]: unknown;
    }) => createElement('button', props, children),
    Text: ({
        as = 'span',
        children,
        variant: _variant,
        weight: _weight,
        ...props
    }: {
        as?: string;
        children?: ReactNode;
        variant?: string;
        weight?: string;
        [key: string]: unknown;
    }) => createElement(as, props, children)
}));

vi.mock('~/hooks/usePersonalListeningSessionStarter', () => ({
    usePersonalListeningSessionStarter: () => ({
        message: null,
        start: vi.fn(),
        starting: false
    })
}));

import PersonalListeningSessionOptionsPanelContent from './PersonalListeningSessionOptionsPanelContent';

describe('PersonalListeningSessionOptionsPanelContent', () => {
    it('keeps the adjustable surface to two small choices with clear defaults', () => {
        const markup = renderToStaticMarkup(createElement(
            PersonalListeningSessionOptionsPanelContent,
            {
                musicName: 'Starting Track',
                startMusicId: '42'
            }
        ));

        expect(markup).toContain('Start from “Starting Track”');
        expect(markup).toContain('Short · 8');
        expect(markup).toContain('Standard · 15');
        expect(markup).toContain('Long · 25');
        expect(markup).toContain('Focused');
        expect(markup).toContain('Explore');
        expect(markup).toContain('Start session');
        expect(markup).toMatch(/aria-pressed="true"[^>]*>Standard · 15/);
        expect(markup).toMatch(/aria-pressed="true"[^>]*><span[^>]*><span>Explore/);
    });
});
