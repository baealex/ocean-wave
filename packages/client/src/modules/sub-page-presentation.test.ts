import { describe, expect, it } from 'vitest';

import {
    isSubPagePath,
    shouldHideMiniPlayer,
    shouldRenderSubPageHeader,
    resolveSubPagePresentation
} from './sub-page-presentation';

describe('isSubPagePath', () => {
    it('marks only detail and overlay routes as sub pages', () => {
        expect(isSubPagePath('/album/1')).toBe(true);
        expect(isSubPagePath('/artist/1')).toBe(true);
        expect(isSubPagePath('/playlist/1')).toBe(true);
        expect(isSubPagePath('/music/1/edit')).toBe(true);
        expect(isSubPagePath('/player')).toBe(true);
        expect(isSubPagePath('/queue')).toBe(true);
        expect(isSubPagePath('/album')).toBe(false);
        expect(isSubPagePath('/equalizer')).toBe(false);
        expect(isSubPagePath('/setting')).toBe(false);
    });
});

describe('resolveSubPagePresentation', () => {
    it('treats detail routes as stacked overlays', () => {
        expect(resolveSubPagePresentation('/album/1')).toBe('stacked');
        expect(resolveSubPagePresentation('/artist/1')).toBe('stacked');
        expect(resolveSubPagePresentation('/playlist/1')).toBe('stacked');
        expect(resolveSubPagePresentation('/music/1/edit')).toBe('stacked');
    });

    it('does not treat equalizer as a sub page overlay', () => {
        expect(resolveSubPagePresentation('/equalizer')).toBe('stacked');
        expect(shouldRenderSubPageHeader('/equalizer')).toBe(true);
        expect(shouldHideMiniPlayer('/equalizer')).toBe(false);
    });

    it('treats player and queue as fullscreen overlays with their own chrome', () => {
        expect(resolveSubPagePresentation('/player')).toBe('fullscreen');
        expect(resolveSubPagePresentation('/queue')).toBe('fullscreen');
        expect(shouldRenderSubPageHeader('/player')).toBe(false);
        expect(shouldRenderSubPageHeader('/queue')).toBe(false);
        expect(shouldHideMiniPlayer('/player')).toBe(true);
        expect(shouldHideMiniPlayer('/queue')).toBe(true);
    });
});
