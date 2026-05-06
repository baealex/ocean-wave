import type { ComponentType, SVGProps } from 'react';

import {
    Activity,
    Disc,
    Gear,
    Heart,
    ListMusic,
    Music,
    Play,
    User
} from '~/icon';

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface AppShellNavigationItem {
    id: string;
    label: string;
    path: string;
    icon: NavigationIcon;
}

export const APP_BRAND_NAME = 'Ocean Wave';

export const appShell = {
    brand: { name: APP_BRAND_NAME },
    navigation: {
        primary: [
            {
                id: 'home',
                label: 'Now',
                path: '/',
                icon: Play
            },
            {
                id: 'dashboard',
                label: 'Dashboard',
                path: '/dashboard',
                icon: Activity
            },
            {
                id: 'library',
                label: 'Library',
                path: '/library',
                icon: Music
            },
            {
                id: 'favorites',
                label: 'Favorites',
                path: '/favorite',
                icon: Heart
            },
            {
                id: 'albums',
                label: 'Albums',
                path: '/album',
                icon: Disc
            },
            {
                id: 'artists',
                label: 'Artists',
                path: '/artist',
                icon: User
            },
            {
                id: 'playlists',
                label: 'Playlists',
                path: '/playlist',
                icon: ListMusic
            }
        ] satisfies AppShellNavigationItem[],
        utility: [
            {
                id: 'settings',
                label: 'Settings',
                path: '/setting',
                icon: Gear
            }
        ] satisfies AppShellNavigationItem[]
    }
};
