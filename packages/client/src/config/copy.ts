import { APP_BRAND_NAME } from './app-shell';

export const appCopy = {
    documentTitle: APP_BRAND_NAME,
    documentDescription: 'Self-hosted music streaming for a trusted personal library.',
    settings: {
        title: 'Settings',
        description: 'Manage sync, playback, audio, and devices.'
    },
    playbackDevices: { description: `Browsers registered for playback in this ${APP_BRAND_NAME} library.` }
} as const;
