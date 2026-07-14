import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchPlaybackSession: vi.fn(),
    reportPlaybackState: vi.fn(),
    listenerConnect: vi.fn(),
    listenerDisconnect: vi.fn(),
    socketOn: vi.fn(),
    socketOff: vi.fn(),
    sequence: 0
}));

vi.mock('~/api/playback-session', () => ({
    fetchPlaybackSession: mocks.fetchPlaybackSession,
    reportPlaybackState: mocks.reportPlaybackState
}));

vi.mock('~/modules/playback-device', () => ({
    getPlaybackDeviceId: () => 'web-tab-local',
    nextPlaybackDeviceSequence: () => {
        mocks.sequence += 1;
        return mocks.sequence;
    }
}));

vi.mock('~/socket', () => ({
    PlaybackListener: class {
        connect = mocks.listenerConnect;
        disconnect = mocks.listenerDisconnect;
    },
    socket: {
        on: mocks.socketOn,
        off: mocks.socketOff
    }
}));

import type { PlaybackSessionSnapshot } from '~/api/playback-session';
import { PlaybackSessionStore } from './playback-session';

const createSnapshot = (
    overrides: Partial<PlaybackSessionSnapshot> = {}
): PlaybackSessionSnapshot => ({
    id: '1',
    state: 'playing',
    activeDeviceId: 'web-tab-remote',
    currentMusicId: '42',
    positionMs: 1_000,
    positionUpdatedAt: '2026-07-14T00:00:00.000Z',
    startedAt: '2026-07-14T00:00:00.000Z',
    revision: 1,
    serverTime: '2026-07-14T00:00:00.000Z',
    ...overrides
});

describe('PlaybackSessionStore', () => {
    beforeEach(() => {
        mocks.fetchPlaybackSession.mockReset();
        mocks.reportPlaybackState.mockReset();
        mocks.listenerConnect.mockReset();
        mocks.listenerDisconnect.mockReset();
        mocks.socketOn.mockReset();
        mocks.socketOff.mockReset();
        mocks.sequence = 0;
    });

    it('loads the snapshot and ignores an older realtime notification', async () => {
        const initial = createSnapshot({ revision: 2 });
        mocks.fetchPlaybackSession.mockResolvedValue({
            type: 'success',
            playbackSession: initial
        });
        const store = new PlaybackSessionStore();

        store.connect();
        await vi.waitFor(() => expect(store.state.loading).toBe(false));

        const handler = mocks.listenerConnect.mock.calls[0]?.[0] as {
            onStateUpdated: (snapshot: PlaybackSessionSnapshot) => void;
        };
        handler.onStateUpdated(createSnapshot({ revision: 1 }));
        expect(store.state.snapshot?.revision).toBe(2);

        handler.onStateUpdated(createSnapshot({ revision: 3 }));
        expect(store.state.snapshot?.revision).toBe(3);

        store.disconnect();
        expect(mocks.listenerDisconnect).toHaveBeenCalledOnce();
        expect(mocks.socketOff).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('reports a user playback claim and applies the committed snapshot', async () => {
        const accepted = createSnapshot({
            activeDeviceId: 'web-tab-local',
            revision: 1
        });
        mocks.reportPlaybackState.mockResolvedValue({
            type: 'success',
            reportPlaybackState: {
                type: 'accepted',
                session: accepted,
                conflict: null
            }
        });
        const store = new PlaybackSessionStore();

        store.report({
            state: 'playing',
            currentMusicId: '42',
            positionMs: 1_500
        }, { claimActive: true });

        await vi.waitFor(() => expect(mocks.reportPlaybackState).toHaveBeenCalledOnce());
        expect(mocks.reportPlaybackState).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'web-tab-local',
            sequence: 1,
            claimActive: true,
            state: 'playing',
            currentMusicId: '42',
            positionMs: 1_500
        }));
        await vi.waitFor(() => expect(store.state.snapshot).toEqual(accepted));

        store.report({
            state: 'playing',
            currentMusicId: '42',
            positionMs: 1_600
        }, { checkpoint: true });
        expect(mocks.reportPlaybackState).toHaveBeenCalledOnce();
    });
});
