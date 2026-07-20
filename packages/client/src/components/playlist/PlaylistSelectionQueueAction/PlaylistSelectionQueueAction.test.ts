import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/components/shared', () => ({
    ActionBarButton: ({ children, ...props }: { children?: ReactNode }) => (
        createElement('button', props, children)
    )
}));

vi.mock('~/icon', () => ({
    ListMusic: () => createElement('span', { 'aria-hidden': true })
}));

import PlaylistSelectionQueueAction from './PlaylistSelectionQueueAction';

describe('PlaylistSelectionQueueAction', () => {
    it('describes its structural queue edit without promising playback', () => {
        const markup = renderToStaticMarkup(createElement(
            PlaylistSelectionQueueAction,
            { onClick: vi.fn() }
        ));

        expect(markup).toContain('Add to Queue');
        expect(markup).not.toContain('>Play<');
    });
});
