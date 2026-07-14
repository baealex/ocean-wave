import { connectors } from '~/socket/connectors';
import { PLAYBACK_STATE_UPDATED } from '~/socket/playback';
import { createReportPlaybackStateMutationResolver } from './playback.mutation.resolver';

const snapshot = {
    id: '1',
    state: 'playing' as const,
    activeDeviceId: 'web-tab-1',
    currentMusicId: '42',
    positionMs: 1_000,
    positionUpdatedAt: '2026-07-14T00:00:00.000Z',
    startedAt: '2026-07-14T00:00:00.000Z',
    revision: 1,
    serverTime: '2026-07-14T00:00:00.000Z'
};

describe('playback state mutation resolver', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    it('notifies other clients only after an accepted state change', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const report = jest.fn().mockResolvedValue({
            type: 'accepted',
            session: snapshot,
            conflict: null,
            changed: true
        });
        const resolver = createReportPlaybackStateMutationResolver(report);

        await resolver(null, {
            input: {
                deviceId: 'web-tab-1',
                sequence: 1,
                claimActive: true,
                state: 'playing',
                currentMusicId: '42',
                positionMs: 1_000
            },
            originClientId: 'origin-1'
        });

        expect(notifySpy).toHaveBeenCalledWith(PLAYBACK_STATE_UPDATED, {
            ...snapshot,
            originClientId: 'origin-1'
        });
    });

    it('keeps an accepted mutation successful when notification fails', async () => {
        const error = new Error('notification failed');
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(connectors, 'notify').mockImplementation(() => {
            throw error;
        });
        const resolver = createReportPlaybackStateMutationResolver(
            jest.fn().mockResolvedValue({
                type: 'accepted',
                session: snapshot,
                conflict: null,
                changed: true
            })
        );

        await expect(resolver(null, {
            input: {
                deviceId: 'web-tab-1',
                sequence: 1,
                claimActive: true,
                state: 'playing',
                currentMusicId: '42',
                positionMs: 1_000
            }
        })).resolves.toMatchObject({ type: 'accepted', session: snapshot });
        expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });

    it('does not notify for conflicts or idempotent reports', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createReportPlaybackStateMutationResolver(
            jest.fn().mockResolvedValue({
                type: 'conflict',
                session: snapshot,
                conflict: { reason: 'active-device', session: snapshot },
                changed: false
            })
        );

        await resolver(null, {
            input: {
                deviceId: 'web-tab-2',
                sequence: 1,
                claimActive: false,
                state: 'paused',
                currentMusicId: '42',
                positionMs: 1_000
            }
        });

        expect(notifySpy).not.toHaveBeenCalled();
    });
});
