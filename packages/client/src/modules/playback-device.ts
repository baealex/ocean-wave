const PLAYBACK_INSTALLATION_ID_KEY = 'ocean-wave-device-id';
const PLAYBACK_ENDPOINT_ID_KEY = 'ocean-wave-playback-device-id';
const PLAYBACK_ENDPOINT_SEQUENCE_KEY = 'ocean-wave-playback-device-sequence';

let memoryInstallationId: string | null = null;
let memoryEndpointId: string | null = null;
let memoryEndpointInstanceId: string | null = null;
let memorySequence = 0;

const createId = (prefix: string) => {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const getStorage = (kind: 'local' | 'session') => {
    try {
        if (kind === 'local') {
            return typeof localStorage === 'undefined' ? null : localStorage;
        }
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
};

const readStorage = (kind: 'local' | 'session', key: string) => {
    try {
        return getStorage(kind)?.getItem(key) ?? null;
    } catch {
        return null;
    }
};

const writeStorage = (
    kind: 'local' | 'session',
    key: string,
    value: string
) => {
    try {
        getStorage(kind)?.setItem(key, value);
    } catch {
        // In-memory identity remains available when browser storage is blocked.
    }
};

const isStoredId = (value: string | null): value is string => {
    return Boolean(
        value
        && value === value.trim()
        && value.length <= 128
    );
};

const readSequence = () => {
    const value = readStorage('session', PLAYBACK_ENDPOINT_SEQUENCE_KEY);
    const stored = value === null ? Number.NaN : Number(value);

    return Number.isSafeInteger(stored) && stored >= 0
        ? stored
        : memorySequence;
};

export const getPlaybackInstallationId = () => {
    const stored = readStorage('local', PLAYBACK_INSTALLATION_ID_KEY);

    if (isStoredId(stored)) {
        return stored;
    }

    if (!memoryInstallationId) {
        memoryInstallationId = createId('device');
    }

    writeStorage('local', PLAYBACK_INSTALLATION_ID_KEY, memoryInstallationId);
    return memoryInstallationId;
};

export const getPlaybackEndpointId = () => {
    const stored = readStorage('session', PLAYBACK_ENDPOINT_ID_KEY);

    if (isStoredId(stored)) {
        return stored;
    }

    if (!memoryEndpointId) {
        memoryEndpointId = createId('endpoint');
    }

    writeStorage('session', PLAYBACK_ENDPOINT_ID_KEY, memoryEndpointId);
    return memoryEndpointId;
};

export const rotatePlaybackEndpointId = () => {
    const endpointId = createId('endpoint');

    memoryEndpointId = endpointId;
    memorySequence = 0;
    writeStorage('session', PLAYBACK_ENDPOINT_ID_KEY, endpointId);
    writeStorage('session', PLAYBACK_ENDPOINT_SEQUENCE_KEY, '0');
    return endpointId;
};

export const getPlaybackEndpointInstanceId = () => {
    if (!memoryEndpointInstanceId) {
        memoryEndpointInstanceId = createId('instance');
    }

    return memoryEndpointInstanceId;
};

export const getPlaybackEndpointSequence = () => readSequence();

export const ensurePlaybackEndpointSequenceAtLeast = (minimum: number) => {
    if (!Number.isSafeInteger(minimum) || minimum < 0) {
        return readSequence();
    }

    const current = readSequence();
    if (current >= minimum) {
        return current;
    }

    memorySequence = minimum;
    writeStorage(
        'session',
        PLAYBACK_ENDPOINT_SEQUENCE_KEY,
        minimum.toString()
    );
    return minimum;
};

export const nextPlaybackEndpointSequence = () => {
    const next = readSequence() + 1;

    memorySequence = next;
    writeStorage(
        'session',
        PLAYBACK_ENDPOINT_SEQUENCE_KEY,
        next.toString()
    );
    return next;
};

// Compatibility aliases for the existing playback-session GraphQL field names.
export const getPlaybackDeviceId = getPlaybackEndpointId;
export const nextPlaybackDeviceSequence = nextPlaybackEndpointSequence;
