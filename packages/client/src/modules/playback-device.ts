const PLAYBACK_DEVICE_ID_KEY = 'ocean-wave-playback-device-id';
const PLAYBACK_DEVICE_SEQUENCE_KEY = 'ocean-wave-playback-device-sequence';

let memoryDeviceId: string | null = null;
let memorySequence = 0;

const createDeviceId = () => {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const getSessionStorage = () => {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
};

export const getPlaybackDeviceId = () => {
    const storage = getSessionStorage();
    const stored = storage?.getItem(PLAYBACK_DEVICE_ID_KEY);

    if (stored) {
        return stored;
    }

    if (!memoryDeviceId) {
        memoryDeviceId = createDeviceId();
    }

    storage?.setItem(PLAYBACK_DEVICE_ID_KEY, memoryDeviceId);
    return memoryDeviceId;
};

export const nextPlaybackDeviceSequence = () => {
    const storage = getSessionStorage();
    const stored = Number(storage?.getItem(PLAYBACK_DEVICE_SEQUENCE_KEY));
    const current = Number.isInteger(stored) && stored >= 0
        ? stored
        : memorySequence;
    const next = current + 1;

    memorySequence = next;
    storage?.setItem(PLAYBACK_DEVICE_SEQUENCE_KEY, next.toString());
    return next;
};
