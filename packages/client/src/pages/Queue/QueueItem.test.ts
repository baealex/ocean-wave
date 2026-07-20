import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/components/shared', () => ({
    Badge: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
    IconButton: ({ children, ...props }: { children?: ReactNode }) => (
        createElement('button', props, children)
    ),
    Image: ({ alt }: { alt?: string }) => createElement('img', { alt }),
    SelectionCheckButton: ({ children, ...props }: { children?: ReactNode }) => (
        createElement('button', props, children)
    ),
    Text: ({ as = 'span', children }: { as?: string; children?: ReactNode }) => (
        createElement(as, null, children)
    ),
    listRowButtonContentClass: () => 'queue-track-button',
    listRowClass: () => 'queue-track-row'
}));

vi.mock('~/icon', () => ({
    Disc: () => createElement('span'),
    Menu: () => createElement('span'),
    VerticalDots: () => createElement('span')
}));

import type { Music } from '~/models/type';
import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';
import QueueItem from './QueueItem';

const music = {
    id: 'track-1',
    name: 'Midnight Current',
    artist: { name: 'Ocean Signals' },
    album: { name: 'Tidal Memory', cover: '/cover.jpg' }
} as Music;

describe('QueueItem remote ownership', () => {
    it('exposes an honest disabled playback action while keeping queue tools available', () => {
        const markup = renderToStaticMarkup(createElement(QueueItem, {
            music,
            index: 0,
            tone: 'current',
            isSelectMode: false,
            isSelected: false,
            playbackDisabled: true,
            onSelect: vi.fn(),
            onClick: vi.fn(),
            onOpenActions: vi.fn()
        }));

        expect(markup).toContain('disabled=""');
        expect(markup).toContain(
            'aria-label="Midnight Current cannot start here while another device owns playback"'
        );
        expect(markup).toContain(`aria-describedby="${REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID}"`);
        expect(markup).toContain(`title="${REMOTE_PLAYBACK_OWNERSHIP_MESSAGE}"`);
        expect(markup).toContain('aria-label="Move Midnight Current in queue"');
        expect(markup).toContain('aria-label="Open actions for Midnight Current"');
    });
});
