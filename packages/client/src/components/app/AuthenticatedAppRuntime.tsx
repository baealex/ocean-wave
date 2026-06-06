import { useEffect } from 'react';

import { useAppStore as useStore } from '~/store/base-store';

import { redirectToLogin } from '~/modules/auth-redirect';
import { albumStore } from '~/store/album';
import { artistStore } from '~/store/artist';
import { musicStore } from '~/store/music';
import { MusicListener, socket } from '~/socket';
import StartupSplash from './StartupSplash';

interface AuthenticatedAppRuntimeProps {
    children: React.ReactNode;
}

export default function AuthenticatedAppRuntime({
    children
}: AuthenticatedAppRuntimeProps) {
    const [{ loaded }] = useStore(musicStore);
    useEffect(() => {
        const handleResync = () => {
            musicStore.init = false;
            artistStore.init = false;
            albumStore.init = false;
        };

        socket.on('resync', handleResync);

        return () => {
            socket.off('resync', handleResync);
        };
    }, []);

    useEffect(() => {
        const handleConnect = () => {
            void (async () => {
                await MusicListener.count();
                await MusicListener.recoverPlaybackCheckpoints();
            })();
        };

        const handleWindowFocus = () => {
            if (!socket.connected) {
                socket.connect();
            }
        };

        const handleBeforeUnload = () => {
            socket.disconnect();
        };

        const handleConnectError = (error: Error) => {
            if (error.message === 'Authentication required') {
                redirectToLogin();
            }
        };

        socket.connect();
        void (async () => {
            await MusicListener.count();
            await MusicListener.recoverPlaybackCheckpoints();
        })();
        socket.on('connect', handleConnect);
        socket.on('connect_error', handleConnectError);
        window.addEventListener('focus', handleWindowFocus);
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            socket.disconnect();
            socket.off('connect', handleConnect);
            socket.off('connect_error', handleConnectError);
            window.removeEventListener('focus', handleWindowFocus);
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, []);

    return (
        <>
            {children}
            {!loaded && <StartupSplash />}
        </>
    );
}
