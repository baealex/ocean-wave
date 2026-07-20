import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const INSTALLATION_ID_KEY = 'ocean-wave-device-id';
const ENDPOINT_ID_KEY = 'ocean-wave-playback-device-id';
const ENDPOINT_SEQUENCE_KEY = 'ocean-wave-playback-device-sequence';

const createStorage = (initial: Record<string, string> = {}): Storage => {
    const values = new Map(Object.entries(initial));

    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value)
    };
};

const installUuidGenerator = () => {
    let sequence = 0;

    vi.stubGlobal('crypto', {
        randomUUID: vi.fn(() => `uuid-${++sequence}`)
    });
};

describe('playback device identity', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('shares one installation identity while keeping tab endpoints distinct', async () => {
        const local = createStorage();
        const firstTab = createStorage();

        installUuidGenerator();
        vi.stubGlobal('localStorage', local);
        vi.stubGlobal('sessionStorage', firstTab);
        const firstDocument = await import('./playback-device');
        const firstInstallationId = firstDocument.getPlaybackInstallationId();
        const firstEndpointId = firstDocument.getPlaybackEndpointId();
        const firstInstanceId = firstDocument.getPlaybackEndpointInstanceId();

        vi.resetModules();
        const secondTab = createStorage();
        vi.stubGlobal('sessionStorage', secondTab);
        const secondDocument = await import('./playback-device');

        expect(secondDocument.getPlaybackInstallationId()).toBe(firstInstallationId);
        expect(secondDocument.getPlaybackEndpointId()).not.toBe(firstEndpointId);
        expect(secondDocument.getPlaybackEndpointInstanceId()).not.toBe(firstInstanceId);
        expect(local.getItem(INSTALLATION_ID_KEY)).toBe(firstInstallationId);
        expect(firstTab.getItem(ENDPOINT_ID_KEY)).toBe(firstEndpointId);
        expect(secondTab.getItem(ENDPOINT_ID_KEY)).toBe(
            secondDocument.getPlaybackEndpointId()
        );
        expect(firstTab.getItem('ocean-wave-playback-endpoint-instance-id')).toBeNull();
        expect(secondTab.getItem('ocean-wave-playback-endpoint-instance-id')).toBeNull();
    });

    it('preserves legacy endpoint state and resets its sequence after rotation', async () => {
        const session = createStorage({
            [ENDPOINT_ID_KEY]: 'legacy-tab',
            [ENDPOINT_SEQUENCE_KEY]: '7'
        });

        installUuidGenerator();
        vi.stubGlobal('localStorage', createStorage());
        vi.stubGlobal('sessionStorage', session);
        const identity = await import('./playback-device');

        expect(identity.getPlaybackEndpointId()).toBe('legacy-tab');
        expect(identity.getPlaybackEndpointSequence()).toBe(7);
        expect(identity.nextPlaybackEndpointSequence()).toBe(8);

        const rotatedEndpointId = identity.rotatePlaybackEndpointId();

        expect(rotatedEndpointId).toBe('uuid-1');
        expect(session.getItem(ENDPOINT_ID_KEY)).toBe(rotatedEndpointId);
        expect(identity.getPlaybackEndpointSequence()).toBe(0);
        expect(identity.nextPlaybackEndpointSequence()).toBe(1);
    });

    it('advances a restored endpoint sequence to the authoritative server floor', async () => {
        const session = createStorage({
            [ENDPOINT_ID_KEY]: 'restored-tab',
            [ENDPOINT_SEQUENCE_KEY]: '4'
        });

        installUuidGenerator();
        vi.stubGlobal('localStorage', createStorage());
        vi.stubGlobal('sessionStorage', session);
        const identity = await import('./playback-device');

        expect(identity.ensurePlaybackEndpointSequenceAtLeast(9)).toBe(9);
        expect(session.getItem(ENDPOINT_SEQUENCE_KEY)).toBe('9');
        expect(identity.ensurePlaybackEndpointSequenceAtLeast(6)).toBe(9);
        expect(identity.nextPlaybackEndpointSequence()).toBe(10);
    });

    it('repairs corrupted stored identities before registration', async () => {
        const local = createStorage({
            [INSTALLATION_ID_KEY]: ' invalid-device '
        });
        const session = createStorage({
            [ENDPOINT_ID_KEY]: 'x'.repeat(129),
            [ENDPOINT_SEQUENCE_KEY]: (Number.MAX_SAFE_INTEGER + 1).toString()
        });

        installUuidGenerator();
        vi.stubGlobal('localStorage', local);
        vi.stubGlobal('sessionStorage', session);
        const identity = await import('./playback-device');

        expect(identity.getPlaybackInstallationId()).toBe('uuid-1');
        expect(identity.getPlaybackEndpointId()).toBe('uuid-2');
        expect(identity.getPlaybackEndpointSequence()).toBe(0);
        expect(local.getItem(INSTALLATION_ID_KEY)).toBe('uuid-1');
        expect(session.getItem(ENDPOINT_ID_KEY)).toBe('uuid-2');
    });

    it('keeps stable in-memory identity and sequence when storage is blocked', async () => {
        const blockedStorage = {
            get length(): number {
                throw new Error('blocked');
            },
            clear: () => {
                throw new Error('blocked');
            },
            getItem: () => {
                throw new Error('blocked');
            },
            key: () => {
                throw new Error('blocked');
            },
            removeItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            }
        } satisfies Storage;

        installUuidGenerator();
        vi.stubGlobal('localStorage', blockedStorage);
        vi.stubGlobal('sessionStorage', blockedStorage);
        const identity = await import('./playback-device');

        expect(identity.getPlaybackInstallationId()).toBe('uuid-1');
        expect(identity.getPlaybackInstallationId()).toBe('uuid-1');
        expect(identity.getPlaybackEndpointId()).toBe('uuid-2');
        expect(identity.getPlaybackEndpointId()).toBe('uuid-2');
        expect(identity.nextPlaybackEndpointSequence()).toBe(1);
        expect(identity.nextPlaybackEndpointSequence()).toBe(2);
    });
});
