import { connectors } from '~/socket/connectors';
import { PLAYBACK_STATE_UPDATED } from '~/socket/playback';
import { PLAYBACK_ENDPOINTS_INVALIDATED } from '~/socket/playback-endpoints';
import {
    createRenamePlaybackDeviceMutationResolver,
    createReportPlaybackStateMutationResolver
} from './playback.mutation.resolver';

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
        const isAuthorized = jest.fn().mockReturnValue(true);
        const resolver = createReportPlaybackStateMutationResolver(report, isAuthorized);

        await resolver(null, {
            input: {
                deviceId: 'web-tab-1',
                registrationGeneration: 3,
                registrationProof: 'proof-3',
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
        expect(notifySpy).toHaveBeenCalledWith(PLAYBACK_ENDPOINTS_INVALIDATED, {
            reason: 'active-changed',
            deviceId: null,
            endpointId: 'web-tab-1',
            originClientId: 'origin-1'
        });
        expect(isAuthorized).toHaveBeenCalledWith({
            endpointId: 'web-tab-1',
            registrationGeneration: 3,
            registrationProof: 'proof-3'
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
            }),
            jest.fn().mockReturnValue(true)
        );

        await expect(resolver(null, {
            input: {
                deviceId: 'web-tab-1',
                registrationGeneration: 1,
                registrationProof: 'proof-1',
                sequence: 1,
                claimActive: true,
                state: 'playing',
                currentMusicId: '42',
                positionMs: 1_000
            }
        })).resolves.toMatchObject({ type: 'accepted', session: snapshot });
        expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });

    it('does not notify for conflicts', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createReportPlaybackStateMutationResolver(
            jest.fn().mockResolvedValue({
                type: 'conflict',
                session: snapshot,
                conflict: { reason: 'active-device', session: snapshot },
                changed: false
            }),
            jest.fn().mockReturnValue(true)
        );

        await resolver(null, {
            input: {
                deviceId: 'web-tab-2',
                registrationGeneration: 1,
                registrationProof: 'proof-2',
                sequence: 1,
                claimActive: false,
                state: 'paused',
                currentMusicId: '42',
                positionMs: 1_000
            }
        });

        expect(notifySpy).not.toHaveBeenCalled();
    });

    it('does not invalidate the device registry for an ordinary checkpoint', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createReportPlaybackStateMutationResolver(
            jest.fn().mockResolvedValue({
                type: 'accepted',
                session: { ...snapshot, positionMs: 2_000, revision: 2 },
                conflict: null,
                changed: true
            }),
            jest.fn().mockReturnValue(true)
        );

        await resolver(null, {
            input: {
                deviceId: 'web-tab-1',
                registrationGeneration: 1,
                registrationProof: 'proof-1',
                sequence: 2,
                claimActive: false,
                state: 'playing',
                currentMusicId: '42',
                positionMs: 2_000
            }
        });

        expect(notifySpy).toHaveBeenCalledWith(
            PLAYBACK_STATE_UPDATED,
            expect.objectContaining({ positionMs: 2_000 })
        );
        expect(notifySpy).not.toHaveBeenCalledWith(
            PLAYBACK_ENDPOINTS_INVALIDATED,
            expect.anything()
        );
    });

    it('rejects reports without current registration authority', async () => {
        const report = jest.fn();
        const resolver = createReportPlaybackStateMutationResolver(
            report,
            jest.fn().mockReturnValue(false)
        );

        await expect(resolver(null, {
            input: {
                deviceId: 'web-tab-duplicate',
                registrationGeneration: 1,
                registrationProof: 'challenger-proof',
                sequence: 1,
                claimActive: true,
                state: 'playing',
                currentMusicId: '42',
                positionMs: 1_000
            }
        })).rejects.toMatchObject({
            extensions: { code: 'PLAYBACK_ENDPOINT_REGISTRATION_REQUIRED' }
        });
        expect(report).not.toHaveBeenCalled();
    });
});

describe('playback device mutation resolver', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    it('returns the committed rename result and notifies other clients', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const rename = jest.fn().mockResolvedValue({
            id: 'browser-1',
            name: 'Listening Room',
            type: 'desktop-web'
        });
        const resolver = createRenamePlaybackDeviceMutationResolver(rename);

        await expect(resolver(null, {
            input: {
                deviceId: ' browser-1 ',
                name: 'Listening Room'
            },
            originClientId: 'origin-1'
        })).resolves.toEqual({
            deviceId: 'browser-1',
            name: 'Listening Room'
        });
        expect(rename).toHaveBeenCalledWith(' browser-1 ', 'Listening Room');
        expect(notifySpy).toHaveBeenCalledWith(PLAYBACK_ENDPOINTS_INVALIDATED, {
            reason: 'renamed',
            deviceId: 'browser-1',
            endpointId: null,
            originClientId: 'origin-1'
        });
    });

    it('keeps a committed rename successful when invalidation delivery fails', async () => {
        const error = new Error('notification failed');
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(connectors, 'notify').mockImplementation(() => {
            throw error;
        });
        const resolver = createRenamePlaybackDeviceMutationResolver(
            jest.fn().mockResolvedValue({
                id: 'browser-1',
                name: 'Listening Room'
            })
        );

        await expect(resolver(null, {
            input: { deviceId: 'browser-1', name: 'Listening Room' }
        })).resolves.toEqual({
            deviceId: 'browser-1',
            name: 'Listening Room'
        });
        expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });
});
