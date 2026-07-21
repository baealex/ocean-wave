import { connectors } from '~/socket/connectors';
import {
    PLAYBACK_QUEUE_INVALIDATED,
    PLAYBACK_STATE_UPDATED
} from '~/socket/playback';
import {
    PLAYBACK_ENDPOINTS_INVALIDATED,
    type PlaybackEndpointAuthorizedReportResult,
    type PlaybackEndpointReportAuthorization
} from '~/socket/playback-endpoints';
import type { PlaybackSessionReportResult } from '../services/playback-session';
import type { PersonalListeningSessionResult } from '../services/personal-listening-session';
import {
    createPersonalListeningSessionMutationResolver,
    createRenamePlaybackDeviceMutationResolver,
    createReportPlaybackStateMutationResolver,
    createSavePlaybackQueueMutationResolver
} from './playback.mutation.resolver';

const snapshot = {
    id: '1',
    state: 'playing' as const,
    activeDeviceId: 'web-tab-1',
    activeDeviceSequence: 1,
    currentMusicId: '42',
    positionMs: 1_000,
    positionUpdatedAt: '2026-07-14T00:00:00.000Z',
    startedAt: '2026-07-14T00:00:00.000Z',
    revision: 1,
    serverTime: '2026-07-14T00:00:00.000Z'
};

const queueSnapshot = {
    id: '1',
    musicIds: ['42'],
    sourceMusicIds: [],
    currentIndex: 0,
    contextType: 'queue' as const,
    contextId: null,
    contextTitle: null,
    shuffle: false,
    repeatMode: 'none' as const,
    revision: 2,
    updatedAt: '2026-07-14T00:00:00.000Z'
};

const queueInput = {
    musicIds: ['42'],
    sourceMusicIds: [],
    currentIndex: 0,
    contextType: 'queue' as const,
    contextId: null,
    contextTitle: null,
    shuffle: false,
    repeatMode: 'none' as const,
    expectedRevision: 1
};

const authorizeReports = (authorized = true) => jest.fn(
    async (
        _authorization: PlaybackEndpointReportAuthorization,
        report: () => Promise<PlaybackSessionReportResult>
    ): Promise<PlaybackEndpointAuthorizedReportResult<PlaybackSessionReportResult>> => {
        if (!authorized) {
            return { authorized: false };
        }

        return {
            authorized: true,
            result: await report()
        };
    }
);

const authorizePersonalSessions = (authorized = true) => jest.fn(
    async (
        _authorization: PlaybackEndpointReportAuthorization,
        createSession: () => Promise<PersonalListeningSessionResult>
    ): Promise<PlaybackEndpointAuthorizedReportResult<PersonalListeningSessionResult>> => {
        if (!authorized) {
            return { authorized: false };
        }

        return {
            authorized: true,
            result: await createSession()
        };
    }
);

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
        const runAuthorized = authorizeReports();
        const resolver = createReportPlaybackStateMutationResolver(report, runAuthorized);

        await resolver(null, {
            input: {
                deviceId: 'web-tab-1',
                registrationGeneration: 3,
                registrationProof: 'proof-3',
                sequence: 1,
                expectedRevision: 0,
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
        expect(runAuthorized).toHaveBeenCalledWith(
            {
                endpointId: 'web-tab-1',
                registrationGeneration: 3,
                registrationProof: 'proof-3'
            },
            expect.any(Function)
        );
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
            authorizeReports()
        );

        await expect(resolver(null, {
            input: {
                deviceId: 'web-tab-1',
                registrationGeneration: 1,
                registrationProof: 'proof-1',
                sequence: 1,
                expectedRevision: 0,
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
            authorizeReports()
        );

        await resolver(null, {
            input: {
                deviceId: 'web-tab-2',
                registrationGeneration: 1,
                registrationProof: 'proof-2',
                sequence: 1,
                expectedRevision: 1,
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
            authorizeReports()
        );

        await resolver(null, {
            input: {
                deviceId: 'web-tab-1',
                registrationGeneration: 1,
                registrationProof: 'proof-1',
                sequence: 2,
                expectedRevision: 1,
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
            authorizeReports(false)
        );

        await expect(resolver(null, {
            input: {
                deviceId: 'web-tab-duplicate',
                registrationGeneration: 1,
                registrationProof: 'challenger-proof',
                sequence: 1,
                expectedRevision: 0,
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

describe('playback queue mutation resolver', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    it('invalidates other clients after an accepted queue save', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const save = jest.fn().mockResolvedValue({
            type: 'accepted',
            queue: queueSnapshot,
            conflict: null,
            changed: true
        });
        const resolver = createSavePlaybackQueueMutationResolver(save);

        await expect(resolver(null, {
            input: queueInput,
            originClientId: 'origin-1'
        })).resolves.toEqual({
            type: 'accepted',
            queue: queueSnapshot,
            conflict: null
        });
        expect(save).toHaveBeenCalledWith(queueInput);
        expect(notifySpy).toHaveBeenCalledWith(PLAYBACK_QUEUE_INVALIDATED, {
            revision: 2,
            originClientId: 'origin-1'
        });
    });

    it('does not invalidate the queue when a stale save conflicts', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const conflict = {
            reason: 'stale-revision' as const,
            queue: queueSnapshot
        };
        const resolver = createSavePlaybackQueueMutationResolver(
            jest.fn().mockResolvedValue({
                type: 'conflict',
                queue: queueSnapshot,
                conflict,
                changed: false
            })
        );

        await expect(resolver(null, { input: queueInput })).resolves.toEqual({
            type: 'conflict',
            queue: queueSnapshot,
            conflict
        });
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it('keeps an accepted queue save successful when invalidation delivery fails', async () => {
        const error = new Error('notification failed');
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(connectors, 'notify').mockImplementation(() => {
            throw error;
        });
        const resolver = createSavePlaybackQueueMutationResolver(
            jest.fn().mockResolvedValue({
                type: 'accepted',
                queue: queueSnapshot,
                conflict: null,
                changed: true
            })
        );

        await expect(resolver(null, { input: queueInput })).resolves.toMatchObject({
            type: 'accepted',
            queue: queueSnapshot
        });
        expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });

    it('invalidates the queue after an accepted personal session is created', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const createSession = jest.fn().mockResolvedValue({
            type: 'accepted',
            queue: queueSnapshot,
            conflict: null,
            changed: true,
            generatedAt: '2026-07-21T00:00:00.000Z',
            items: [{ musicId: '42', reasonCodes: ['START_TRACK'] }]
        });
        const runAuthorized = authorizePersonalSessions();
        const resolver = createPersonalListeningSessionMutationResolver(
            createSession,
            runAuthorized
        );
        const sessionInput = {
            startMusicId: '42',
            length: 'standard' as const,
            scope: 'explore' as const,
            expectedRevision: 1,
            expectedPlaybackSessionRevision: 4,
            requestingEndpointId: 'web-tab-1'
        };

        await expect(resolver(null, {
            input: {
                ...sessionInput,
                registrationGeneration: 3,
                registrationProof: 'proof-3'
            },
            originClientId: 'origin-1'
        })).resolves.toEqual({
            type: 'accepted',
            queue: queueSnapshot,
            conflict: null,
            generatedAt: '2026-07-21T00:00:00.000Z',
            items: [{ musicId: '42', reasonCodes: ['START_TRACK'] }]
        });
        expect(createSession).toHaveBeenCalledWith(sessionInput);
        expect(runAuthorized).toHaveBeenCalledWith({
            endpointId: 'web-tab-1',
            registrationGeneration: 3,
            registrationProof: 'proof-3'
        }, expect.any(Function));
        expect(notifySpy).toHaveBeenCalledWith(PLAYBACK_QUEUE_INVALIDATED, {
            revision: 2,
            originClientId: 'origin-1'
        });
    });

    it('does not invalidate the queue when personal session creation conflicts', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const conflict = {
            reason: 'stale-revision' as const,
            queue: queueSnapshot
        };
        const resolver = createPersonalListeningSessionMutationResolver(
            jest.fn().mockResolvedValue({
                type: 'conflict',
                queue: queueSnapshot,
                conflict,
                changed: false,
                generatedAt: '2026-07-21T00:00:00.000Z',
                items: [{ musicId: '42', reasonCodes: ['START_TRACK'] }]
            }),
            authorizePersonalSessions()
        );

        await expect(resolver(null, {
            input: {
                startMusicId: '42',
                length: 'short',
                scope: 'focused',
                expectedRevision: 1,
                expectedPlaybackSessionRevision: 4,
                requestingEndpointId: 'web-tab-1',
                registrationGeneration: 3,
                registrationProof: 'proof-3'
            }
        })).resolves.toMatchObject({
            type: 'conflict',
            queue: queueSnapshot,
            conflict
        });
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it('rejects personal sessions without current endpoint authority', async () => {
        const createSession = jest.fn();
        const resolver = createPersonalListeningSessionMutationResolver(
            createSession,
            authorizePersonalSessions(false)
        );

        await expect(resolver(null, {
            input: {
                startMusicId: '42',
                length: 'short',
                scope: 'focused',
                expectedRevision: 1,
                expectedPlaybackSessionRevision: 4,
                requestingEndpointId: 'web-tab-1',
                registrationGeneration: 3,
                registrationProof: 'stale-proof'
            }
        })).rejects.toMatchObject({
            extensions: { code: 'PLAYBACK_ENDPOINT_REGISTRATION_REQUIRED' }
        });
        expect(createSession).not.toHaveBeenCalled();
    });
});
