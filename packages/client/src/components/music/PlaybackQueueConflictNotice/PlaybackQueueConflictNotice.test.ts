import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({
    accept: vi.fn(),
    actions: new Map<string, () => unknown>(),
    retry: vi.fn(),
    state: {
        conflict: null as null | {
            authoritative: { revision: number };
            local: { musicIds: string[] };
        }
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
    Text: ({ as = 'span', children, ...props }: {
        as?: string;
        children?: ReactNode;
        [key: string]: unknown;
    }) => createElement(as, props, children)
}));

vi.mock('~/store/base-store', () => ({
    useAppStore: (store: { state: object }) => [store.state, vi.fn()]
}));

vi.mock('~/store/playback-queue', () => ({
    playbackQueueStore: {
        get state() {
            return ui.state;
        },
        retryConflict: ui.retry
    }
}));

vi.mock('~/store/queue', () => ({
    queueStore: { acceptServerQueueConflict: ui.accept }
}));

import PlaybackQueueConflictNotice from './PlaybackQueueConflictNotice';

describe('PlaybackQueueConflictNotice', () => {
    beforeEach(() => {
        ui.state.conflict = null;
        ui.accept.mockReset();
        ui.actions.clear();
        ui.retry.mockReset();
    });

    it('stays hidden without a queue conflict', () => {
        expect(renderToStaticMarkup(
            createElement(PlaybackQueueConflictNotice)
        )).toBe('');
    });

    it('keeps playback honest and exposes both explicit recovery choices', () => {
        ui.state.conflict = {
            authoritative: { revision: 8 },
            local: { musicIds: ['42'] }
        };

        const markup = renderToStaticMarkup(
            createElement(PlaybackQueueConflictNotice)
        );

        expect(markup).toContain('role="alert"');
        expect(markup).toContain('A newer queue is already saved');
        expect(markup).toContain('Current playback will continue until you choose');
        expect(markup).toContain('Keep newer queue');
        expect(markup).toContain('Replace with this queue');

        ui.actions.get('Keep newer queue')?.();
        expect(ui.accept).toHaveBeenCalledOnce();
        expect(ui.retry).not.toHaveBeenCalled();

        ui.actions.get('Replace with this queue')?.();
        expect(ui.retry).toHaveBeenCalledOnce();
    });
});
