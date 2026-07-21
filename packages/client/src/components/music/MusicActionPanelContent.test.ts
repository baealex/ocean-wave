import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({
    actions: new Map<string, () => void>(),
    openPanel: vi.fn(),
    startSession: vi.fn()
}));

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn()
}));

vi.mock('~/components/shared', () => ({
    Image: ({ alt }: { alt: string }) => createElement('img', { alt }),
    PanelContent: ({ items }: {
        items: Array<{
            description?: string;
            onClick: () => void;
            text: string;
        }>;
    }) => createElement('div', null, items.map((item) => {
        ui.actions.set(item.text, item.onClick);
        return createElement('button', { key: item.text }, [
            item.text,
            item.description ? `: ${item.description}` : ''
        ]);
    }))
}));

vi.mock('~/components/shared/PanelContent', () => ({
    PanelHeaderAction: ({ children }: { children?: ReactNode }) => (
        createElement('div', null, children)
    ),
    panelContentClass: {
        cover: '',
        subContent: '',
        subTitle: ''
    }
}));

vi.mock('~/components/playlist', () => ({
    PlaylistPanelContent: () => null
}));

vi.mock('./MusicTagPanelContent', () => ({ default: () => null }));
vi.mock('./PersonalListeningSessionOptionsPanelContent', () => ({
    default: () => createElement('div', null, 'Session choices')
}));

vi.mock('~/hooks/usePersonalListeningSessionStarter', () => ({
    usePersonalListeningSessionStarter: () => ({
        message: null,
        start: ui.startSession,
        starting: false
    })
}));

vi.mock('~/icon', () => ({
    Close: () => null,
    Download: () => null,
    Heart: () => null,
    List: () => null,
    ListMusic: () => null,
    Pencil: () => null,
    Play: () => null,
    Shuffle: () => null,
    Tags: () => null
}));

vi.mock('~/modules/panel', () => ({
    panel: {
        close: vi.fn(),
        open: ui.openPanel
    }
}));

vi.mock('~/modules/time', () => ({ makePlayTime: () => '03:00' }));
vi.mock('~/modules/toast', () => ({ toast: vi.fn() }));

vi.mock('~/socket', () => ({
    MusicListener: { hate: vi.fn(), like: vi.fn() },
    PlaylistListener: { addMusic: vi.fn() }
}));

vi.mock('~/store/base-store', () => ({
    useAppStore: (store: { state: object }) => [store.state, vi.fn()]
}));

vi.mock('~/store/music', () => ({
    musicStore: {
        state: {
            musicMap: new Map([['42', {
                album: { cover: '', id: '2', name: 'Starting Album' },
                artist: { id: '3', name: 'Starting Artist' },
                codec: 'mp3',
                duration: 180,
                id: '42',
                isHated: false,
                isLiked: false,
                name: 'Starting Track',
                playCount: 0,
                tags: []
            }]])
        }
    }
}));

vi.mock('~/store/queue', () => ({
    queueStore: { add: vi.fn(), download: vi.fn() }
}));

import MusicActionPanelContent from './MusicActionPanelContent';

describe('MusicActionPanelContent personal sessions', () => {
    beforeEach(() => {
        ui.actions.clear();
        ui.openPanel.mockReset();
        ui.startSession.mockReset();
    });

    it('offers a one-action default and a separate minimal options surface', () => {
        const markup = renderToStaticMarkup(createElement(
            MusicActionPanelContent,
            { id: '42' }
        ));

        expect(markup).toContain('Start a session');
        expect(markup).toContain('Session options');

        ui.actions.get('Start a session')?.();
        expect(ui.startSession).toHaveBeenCalledWith({
            length: 'standard',
            scope: 'explore',
            startMusicId: '42'
        });

        ui.actions.get('Session options')?.();
        expect(ui.openPanel).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Session options'
        }));
    });
});
