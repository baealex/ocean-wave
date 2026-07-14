import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const socketMock = vi.hoisted(() => ({
    on: vi.fn(),
    off: vi.fn()
}));

vi.mock('./socket', () => ({
    socket: socketMock,
    isOwnRealtimeNotification: (payload?: { originClientId?: string | null }) => {
        return payload?.originClientId === 'origin-client-1';
    }
}));

import {
    PLAYBACK_STATE_UPDATED,
    PlaybackListener
} from './playback-listener';

const payload = {
    id: '1',
    state: 'playing' as const,
    activeDeviceId: 'web-tab-2',
    currentMusicId: '42',
    positionMs: 1_000,
    positionUpdatedAt: '2026-07-14T00:00:00.000Z',
    startedAt: '2026-07-14T00:00:00.000Z',
    revision: 1,
    serverTime: '2026-07-14T00:00:00.000Z'
};

describe('PlaybackListener', () => {
    beforeEach(() => {
        socketMock.on.mockReset();
        socketMock.off.mockReset();
    });

    it('subscribes, ignores own notifications, and disconnects cleanly', () => {
        const onStateUpdated = vi.fn();
        const listener = new PlaybackListener();

        listener.connect({ onStateUpdated });

        const socketHandler = socketMock.on.mock.calls.find(
            ([event]) => event === PLAYBACK_STATE_UPDATED
        )?.[1] as (value: typeof payload & { originClientId?: string }) => void;

        socketHandler({ ...payload, originClientId: 'origin-client-1' });
        socketHandler({ ...payload, originClientId: 'origin-client-2' });

        expect(onStateUpdated).toHaveBeenCalledTimes(1);
        expect(onStateUpdated).toHaveBeenCalledWith({
            ...payload,
            originClientId: 'origin-client-2'
        });

        listener.disconnect();
        expect(socketMock.off).toHaveBeenCalledWith(PLAYBACK_STATE_UPDATED, socketHandler);
    });
});
