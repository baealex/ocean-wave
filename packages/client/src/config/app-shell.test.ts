import { describe, expect, it } from 'vitest';

import { appShell } from './app-shell';

describe('appShell', () => {
    it('keeps the listening navigation order stable', () => {
        expect(appShell.navigation.primary).toEqual([
            expect.objectContaining({
                id: 'home',
                label: 'Now',
                path: '/'
            }),
            expect.objectContaining({
                id: 'dashboard',
                label: 'Dashboard',
                path: '/dashboard'
            }),
            expect.objectContaining({
                id: 'library',
                label: 'Library',
                path: '/library'
            }),
            expect.objectContaining({
                id: 'favorites',
                label: 'Favorites',
                path: '/favorite'
            }),
            expect.objectContaining({
                id: 'albums',
                label: 'Albums',
                path: '/album'
            }),
            expect.objectContaining({
                id: 'artists',
                label: 'Artists',
                path: '/artist'
            }),
            expect.objectContaining({
                id: 'playlists',
                label: 'Playlists',
                path: '/playlist'
            })
        ]);
    });

    it('exposes unique navigation ids and paths across shell sections', () => {
        const items = [
            ...appShell.navigation.primary,
            ...appShell.navigation.utility
        ];
        const ids = items.map(({ id }) => id);
        const paths = items.map(({ path }) => path);

        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(paths).size).toBe(paths.length);
    });

    it('keeps settings isolated in utility navigation', () => {
        expect(appShell.navigation.utility).toEqual([
            expect.objectContaining({
                id: 'settings',
                label: 'Settings',
                path: '/setting'
            })
        ]);
    });
});
