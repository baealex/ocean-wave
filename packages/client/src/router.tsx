import { createBrowserRouter } from 'react-router-dom';

import {
    AlbumList,
    AlbumDetail,
    Dashboard,
    ArtistList,
    ArtistDetail,
    Equalizer,
    Favorite,
    Home,
    MusicList,
    MusicEdit,
    NotFound,
    Player,
    Playlist,
    PlaylistDetail,
    Queue,
    Setting,
    TagList
} from './pages';
import { SiteLayout } from './components/layout';

const router = createBrowserRouter([
    {
        element: <SiteLayout />,
        children: [
            {
                path: '/',
                element: <Home />,
                handle: {
                    pageFrame: {
                        width: 'wide',
                        className: 'flex flex-col gap-[clamp(16px,2.4vw,24px)]'
                    }
                }
            },
            {
                path: '/dashboard',
                element: <Dashboard />,
                handle: {
                    pageFrame: {
                        width: 'wide',
                        className: 'flex flex-col gap-[clamp(16px,2.4vw,24px)]'
                    }
                }
            },
            {
                path: '/library',
                element: <MusicList />
            },
            {
                path: '/favorite',
                element: <Favorite />
            },
            {
                path: '/album',
                element: <AlbumList />
            },
            {
                path: '/artist',
                element: <ArtistList />
            },
            {
                path: '/playlist',
                element: <Playlist />
            },
            {
                path: '/tags',
                element: <TagList />
            },
            {
                path: '/tag',
                element: <TagList />
            },
            {
                path: '/setting',
                element: <Setting />,
                handle: {
                    pageFrame: {
                        width: 'standard',
                        padding: 'content',
                        className: 'min-h-full'
                    }
                }
            },
            {
                path: '/album/:id',
                element: <AlbumDetail />
            },
            {
                path: '/music/:id/edit',
                element: <MusicEdit />,
                handle: {
                    pageFrame: {
                        width: 'standard',
                        padding: 'content',
                        className: 'min-h-full'
                    }
                }
            },
            {
                path: '/artist/:id',
                element: <ArtistDetail />
            },
            {
                path: '/playlist/:id',
                element: <PlaylistDetail />
            },
            {
                path: '/equalizer',
                element: <Equalizer />,
                handle: {
                    pageFrame: {
                        width: 'wide',
                        className: 'flex min-h-full flex-col gap-4'
                    }
                }
            },
            {
                path: '/player',
                element: <Player />
            },
            {
                path: '/queue',
                element: <Queue />
            }
        ]
    },
    {
        element: <NotFound />,
        path: '*'
    }
]);

export default router;
