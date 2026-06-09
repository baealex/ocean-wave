import { ToastProvider as BaseToastProvider } from '@baejino/react-ui/toast';
import type { CSSProperties } from 'react';

interface ToastProviderProps {
    avoidMiniPlayer?: boolean;
}

const SAFE_AREA_BOTTOM_OFFSET = 'var(--app-toast-safe-area-bottom-offset)';
const MINI_PLAYER_BOTTOM_OFFSET = 'var(--app-toast-mini-player-bottom-offset)';
const TOAST_VIEWPORT_STYLE = {
    '--width': 'var(--app-toast-width)'
} as CSSProperties;

export default function ToastProvider({ avoidMiniPlayer = false }: ToastProviderProps) {
    const bottomOffset = avoidMiniPlayer
        ? MINI_PLAYER_BOTTOM_OFFSET
        : SAFE_AREA_BOTTOM_OFFSET;

    return (
        <BaseToastProvider
            theme="dark"
            position="bottom-center"
            offset={{ bottom: bottomOffset }}
            mobileOffset={{ bottom: bottomOffset }}
            style={TOAST_VIEWPORT_STYLE}
            expand={false}
            visibleToasts={3}
            toastOptions={{
                duration: 2400,
                classNames: {
                    toast: 'app-toast',
                    title: 'app-toast-title',
                    description: 'app-toast-description',
                    content: 'app-toast-content',
                    icon: 'app-toast-icon'
                }
            }}
        />
    );
}
