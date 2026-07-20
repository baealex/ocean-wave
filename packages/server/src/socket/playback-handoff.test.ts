import type { Socket } from 'socket.io';

import models from '~/models';
import { PlaybackHandoffServiceError } from '~/features/playback/services/playback-handoff';

import {
    PLAYBACK_HANDOFF_ACTIVATE,
    PLAYBACK_HANDOFF_ABORT_TARGET,
    PLAYBACK_HANDOFF_RELEASE,
    PLAYBACK_HANDOFF_SETTLE_SOURCE,
    PLAYBACK_HANDOFF_STATUS,
    type PlaybackHandoffActivationDispatch,
    type PlaybackHandoffReleaseDispatch,
    type PlaybackHandoffRequest,
    type PlaybackHandoffSourceSettleDispatch,
    type PlaybackHandoffStatus
} from './playback-handoff-contract';
import { PlaybackHandoffCoordinator } from './playback-handoff';
import type { PlaybackEndpointRoute } from './playback-endpoints';

const createMusic = async (name: string, duration = 180) => {
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const artist = await models.artist.create({
        data: { name: `${name} Artist ${unique}` }
    });
    const album = await models.album.create({
        data: {
            name: `${name} Album ${unique}`,
            cover: `/covers/${unique}.jpg`,
            publishedYear: '2026',
            artistId: artist.id
        }
    });

    return models.music.create({
        data: {
            name: `${name} ${unique}`,
            artistId: artist.id,
            albumId: album.id,
            filePath: `/music/${unique}.mp3`,
            duration,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320,
            sampleRate: 44100,
            trackNumber: 1
        }
    });
};

interface TestSocket extends Socket {
    pushedStatuses: PlaybackHandoffStatus[];
    pushedEvents: string[];
}

const createSocket = (
    socketId: string,
    endpointId: string,
    registrationGeneration: number,
    onEmit?: (
        event: string,
        payload: unknown,
        acknowledge?: (value: unknown) => void
    ) => void
) => {
    const pushedStatuses: PlaybackHandoffStatus[] = [];
    const pushedEvents: string[] = [];
    const socket = {
        id: socketId,
        connected: true,
        data: {
            playbackEndpointId: endpointId,
            playbackRegistrationGeneration: registrationGeneration
        },
        pushedStatuses,
        pushedEvents,
        emit: jest.fn((event: string, payload: unknown, acknowledge?: (value: unknown) => void) => {
            pushedEvents.push(event);
            if (event === PLAYBACK_HANDOFF_STATUS) {
                pushedStatuses.push(payload as PlaybackHandoffStatus);
            }
            onEmit?.(event, payload, acknowledge);
            return true;
        })
    } as unknown as TestSocket;

    return socket;
};

const route = (
    socket: TestSocket,
    endpointId: string,
    registrationGeneration: number,
    lastEndpointSequence: number
): PlaybackEndpointRoute => ({
    socket,
    socketId: socket.id,
    deviceId: `${endpointId}-device`,
    endpointId,
    registrationGeneration,
    capabilities: ['play', 'pause', 'seek', 'next', 'previous', 'handoff'],
    lastEndpointSequence
});

const waitForTerminalStatus = async (socket: TestSocket) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const terminal = socket.pushedStatuses.find(status => [
            'completed',
            'rolled_back',
            'rejected',
            'timed_out',
            'recovery_required'
        ].includes(status.phase));
        if (terminal) {
            return terminal;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    throw new Error('Timed out waiting for a terminal handoff status.');
};

describe('playback handoff coordinator integration', () => {
    let firstMusicId: number;
    let secondMusicId: number;

    beforeEach(async () => {
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
        const first = await createMusic('Coordinator Handoff First', 60);
        const second = await createMusic('Coordinator Handoff Second', 90);
        firstMusicId = first.id;
        secondMusicId = second.id;
        await models.playbackSession.create({
            data: {
                scopeKey: 'local',
                state: 'playing',
                activeDeviceId: 'source-tab',
                activeDeviceSequence: 7,
                currentMusicId: firstMusicId,
                positionMs: 12_000,
                positionUpdatedAt: new Date(),
                startedAt: new Date(),
                revision: 3,
                Queue: {
                    create: {
                        currentIndex: 0,
                        shuffle: false,
                        repeatMode: 'none',
                        revision: 2,
                        Item: {
                            create: [
                                { musicId: firstMusicId, order: 0 },
                                { musicId: secondMusicId, order: 1 }
                            ]
                        }
                    }
                }
            }
        });
    });

    afterEach(async () => {
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
    });

    const request = (force = false): PlaybackHandoffRequest => ({
        protocolVersion: 1,
        commandEpoch: 'epoch-1',
        handoffId: force ? 'forced-handoff' : 'normal-handoff',
        sourceEndpointId: 'source-tab',
        targetEndpointId: 'target-tab',
        expectedSessionRevision: 3,
        expectedQueueRevision: 2,
        targetClaimSequence: 4,
        force
    });

    it('releases the old endpoint before atomically claiming and activating the target', async () => {
        const eventOrder: string[] = [];
        const sourceSocket = createSocket('source-socket', 'source-tab', 2, (
            event,
            payload,
            acknowledge
        ) => {
            if (event === PLAYBACK_HANDOFF_RELEASE) {
                eventOrder.push('release');
                const dispatch = payload as PlaybackHandoffReleaseDispatch;
                acknowledge?.({
                    protocolVersion: 1,
                    handoffId: dispatch.handoffId,
                    handoffSequence: dispatch.handoffSequence,
                    sourceEndpointId: dispatch.sourceEndpointId,
                    sourceRegistrationGeneration: dispatch.sourceRegistrationGeneration,
                    status: 'released',
                    endpointSequence: 8,
                    positionMs: 12_500
                });
            }
            if (event === PLAYBACK_HANDOFF_SETTLE_SOURCE) {
                eventOrder.push('source-complete');
            }
        });
        const targetSocket = createSocket('target-socket', 'target-tab', 3, (
            event,
            payload,
            acknowledge
        ) => {
            if (event === PLAYBACK_HANDOFF_ACTIVATE) {
                eventOrder.push('activate');
                const dispatch = payload as PlaybackHandoffActivationDispatch;
                acknowledge?.({
                    protocolVersion: 1,
                    handoffId: dispatch.handoffId,
                    handoffSequence: dispatch.handoffSequence,
                    targetEndpointId: dispatch.targetEndpointId,
                    targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                    status: 'completed',
                    endpointSequence: 5,
                    positionMs: 12_600
                });
            }
        });
        const routes = new Map([
            ['source-tab', route(sourceSocket, 'source-tab', 2, 7)],
            ['target-tab', route(targetSocket, 'target-tab', 3, 3)]
        ]);
        const coordinator = new PlaybackHandoffCoordinator({
            commandEpoch: 'epoch-1',
            getRoute: endpointId => routes.get(endpointId) ?? null,
            onStateChanged: jest.fn()
        });

        await expect(coordinator.request(targetSocket, request())).resolves.toEqual(
            expect.objectContaining({ phase: 'releasing' })
        );
        await expect(waitForTerminalStatus(targetSocket)).resolves.toEqual(
            expect.objectContaining({
                phase: 'completed',
                sessionRevision: 5,
                queueRevision: 2
            })
        );
        expect(eventOrder).toEqual(['release', 'activate', 'source-complete']);
        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        })).resolves.toEqual(expect.objectContaining({
            state: 'playing',
            activeDeviceId: 'target-tab',
            activeDeviceSequence: 5,
            revision: 5
        }));
        coordinator.clear();
    });

    it('allows an explicit forced claim only after the old endpoint is terminated', async () => {
        await models.playbackSession.update({
            where: { scopeKey: 'local' },
            data: { state: 'stopped' }
        });
        const targetSocket = createSocket('target-socket', 'target-tab', 3, (
            event,
            payload,
            acknowledge
        ) => {
            if (event !== PLAYBACK_HANDOFF_ACTIVATE) {
                return;
            }
            const dispatch = payload as PlaybackHandoffActivationDispatch;
            expect(dispatch.snapshot.state).toBe('paused');
            acknowledge?.({
                protocolVersion: 1,
                handoffId: dispatch.handoffId,
                handoffSequence: dispatch.handoffSequence,
                targetEndpointId: dispatch.targetEndpointId,
                targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                status: 'completed',
                endpointSequence: 5,
                positionMs: dispatch.snapshot.positionMs
            });
        });
        const routes = new Map([
            ['target-tab', route(targetSocket, 'target-tab', 3, 3)]
        ]);
        const coordinator = new PlaybackHandoffCoordinator({
            commandEpoch: 'epoch-1',
            getRoute: endpointId => routes.get(endpointId) ?? null,
            onStateChanged: jest.fn()
        });

        await expect(coordinator.request(targetSocket, request(false))).resolves.toEqual(
            expect.objectContaining({
                phase: 'rejected',
                error: expect.objectContaining({
                    code: 'SOURCE_OFFLINE',
                    forceAllowed: true
                })
            })
        );
        targetSocket.pushedStatuses.length = 0;

        await expect(coordinator.request(targetSocket, request(true))).resolves.toEqual(
            expect.objectContaining({ phase: 'claiming' })
        );
        await expect(waitForTerminalStatus(targetSocket)).resolves.toEqual(
            expect.objectContaining({ phase: 'completed' })
        );
        expect(targetSocket.pushedEvents).not.toContain(PLAYBACK_HANDOFF_RELEASE);
        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        })).resolves.toEqual(expect.objectContaining({
            state: 'paused',
            activeDeviceId: 'target-tab',
            revision: 5
        }));
        coordinator.clear();
    });

    it('rolls ownership back before asking the old endpoint to resume after activation failure', async () => {
        const eventOrder: string[] = [];
        const sourceSocket = createSocket('source-socket', 'source-tab', 2, (
            event,
            payload,
            acknowledge
        ) => {
            if (event === PLAYBACK_HANDOFF_RELEASE) {
                const dispatch = payload as PlaybackHandoffReleaseDispatch;
                acknowledge?.({
                    protocolVersion: 1,
                    handoffId: dispatch.handoffId,
                    handoffSequence: dispatch.handoffSequence,
                    sourceEndpointId: dispatch.sourceEndpointId,
                    sourceRegistrationGeneration: dispatch.sourceRegistrationGeneration,
                    status: 'released',
                    endpointSequence: 8,
                    positionMs: 12_500
                });
            }
            if (event === PLAYBACK_HANDOFF_SETTLE_SOURCE) {
                eventOrder.push('source-restored');
                const dispatch = payload as PlaybackHandoffSourceSettleDispatch;
                expect(dispatch.action).toBe('restore');
                acknowledge?.({
                    protocolVersion: 1,
                    handoffId: dispatch.handoffId,
                    handoffSequence: dispatch.handoffSequence,
                    sourceEndpointId: dispatch.sourceEndpointId,
                    sourceRegistrationGeneration: dispatch.sourceRegistrationGeneration,
                    status: 'settled',
                    endpointSequence: 9,
                    positionMs: 12_500
                });
            }
        });
        const targetSocket = createSocket('target-socket', 'target-tab', 3, (
            event,
            payload,
            acknowledge
        ) => {
            if (event === PLAYBACK_HANDOFF_ACTIVATE) {
                eventOrder.push('target-started');
                const dispatch = payload as PlaybackHandoffActivationDispatch;
                acknowledge?.({
                    protocolVersion: 1,
                    handoffId: dispatch.handoffId,
                    handoffSequence: dispatch.handoffSequence,
                    targetEndpointId: dispatch.targetEndpointId,
                    targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                    status: 'completed',
                    endpointSequence: 5,
                    positionMs: 12_500
                });
            }
            if (event === PLAYBACK_HANDOFF_ABORT_TARGET) {
                eventOrder.push('target-paused');
                const dispatch = payload as {
                    handoffId: string;
                    handoffSequence: number;
                    targetEndpointId: string;
                    targetRegistrationGeneration: number;
                };
                acknowledge?.({
                    protocolVersion: 1,
                    handoffId: dispatch.handoffId,
                    handoffSequence: dispatch.handoffSequence,
                    targetEndpointId: dispatch.targetEndpointId,
                    targetRegistrationGeneration: dispatch.targetRegistrationGeneration,
                    status: 'paused'
                });
            }
        });
        const routes = new Map([
            ['source-tab', route(sourceSocket, 'source-tab', 2, 7)],
            ['target-tab', route(targetSocket, 'target-tab', 3, 3)]
        ]);
        const coordinator = new PlaybackHandoffCoordinator({
            commandEpoch: 'epoch-1',
            getRoute: endpointId => routes.get(endpointId) ?? null,
            completeHandoff: async () => {
                throw new PlaybackHandoffServiceError(
                    'The activation commit failed.',
                    'CLAIM_FAILED',
                    {
                        retryable: true,
                        sessionRevision: 4,
                        queueRevision: 2
                    }
                );
            },
            onStateChanged: jest.fn()
        });

        await coordinator.request(targetSocket, request());
        await expect(waitForTerminalStatus(targetSocket)).resolves.toEqual(
            expect.objectContaining({
                phase: 'rolled_back',
                sessionRevision: 6
            })
        );
        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        })).resolves.toEqual(expect.objectContaining({
            state: 'playing',
            activeDeviceId: 'source-tab',
            activeDeviceSequence: 9,
            revision: 6
        }));
        expect(eventOrder).toEqual([
            'target-started',
            'target-paused',
            'source-restored'
        ]);
        coordinator.clear();
    });
});
