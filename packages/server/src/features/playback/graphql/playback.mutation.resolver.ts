import type { IResolvers } from '@graphql-tools/utils';

import { connectors } from '~/socket/connectors';
import { withOriginClientId } from '~/socket/origin-client';
import { PLAYBACK_STATE_UPDATED } from '~/socket/playback';
import {
    PLAYBACK_ENDPOINTS_INVALIDATED,
    playbackEndpointRegistry,
    type PlaybackEndpointAuthorizedReportResult,
    type PlaybackEndpointReportAuthorization
} from '~/socket/playback-endpoints';

import {
    isPlaybackDeviceServiceError,
    renamePlaybackDevice
} from '../services/playback-device';
import {
    isPlaybackSessionServiceError,
    type PlaybackSessionReportResult,
    reportPlaybackState,
    type ReportPlaybackStateInput
} from '../services/playback-session';
import {
    isPlaybackQueueServiceError,
    savePlaybackQueue,
    type SavePlaybackQueueInput
} from '../services/playback-queue';

class PlaybackGraphQLError extends Error {
    extensions: { code: string };

    constructor(message: string, code: string) {
        super(message);
        this.name = 'PlaybackGraphQLError';
        this.extensions = { code };
    }
}

const toGraphQLError = (error: unknown) => {
    if (isPlaybackDeviceServiceError(error)) {
        return new PlaybackGraphQLError(error.message, error.code);
    }

    if (isPlaybackQueueServiceError(error)) {
        return new PlaybackGraphQLError(error.message, error.code);
    }

    if (isPlaybackSessionServiceError(error)) {
        return new PlaybackGraphQLError(error.message, error.code);
    }

    return error;
};

const notifySafely = (callback: () => void) => {
    try {
        callback();
    } catch (error) {
        console.error(error);
    }
};

type RunAuthorizedPlaybackReport = (
    authorization: PlaybackEndpointReportAuthorization,
    report: () => Promise<PlaybackSessionReportResult>
) => Promise<PlaybackEndpointAuthorizedReportResult<PlaybackSessionReportResult>>;

export const createReportPlaybackStateMutationResolver = (
    report = reportPlaybackState,
    runAuthorized: RunAuthorizedPlaybackReport = (authorization, operation) => (
        playbackEndpointRegistry.runAuthorizedReport(authorization, operation)
    )
) => {
    return async (_: unknown, {
        input,
        originClientId
    }: {
        input: ReportPlaybackStateInput & {
            registrationGeneration: number;
            registrationProof: string;
        };
        originClientId?: string | null;
    }) => {
        try {
            const {
                registrationGeneration,
                registrationProof,
                ...reportInput
            } = input;

            const authorized = await runAuthorized({
                endpointId: reportInput.deviceId.trim(),
                registrationGeneration,
                registrationProof
            }, () => report(reportInput));

            if (!authorized.authorized) {
                throw new PlaybackGraphQLError(
                    'A current playback endpoint registration is required.',
                    'PLAYBACK_ENDPOINT_REGISTRATION_REQUIRED'
                );
            }

            const result = authorized.result;

            if (result.type === 'accepted' && result.changed) {
                notifySafely(() => {
                    connectors.notify(
                        PLAYBACK_STATE_UPDATED,
                        withOriginClientId(result.session, originClientId)
                    );
                });
            }
            if (result.type === 'accepted' && reportInput.claimActive) {
                notifySafely(() => {
                    connectors.notify(
                        PLAYBACK_ENDPOINTS_INVALIDATED,
                        withOriginClientId({
                            reason: 'active-changed' as const,
                            deviceId: null,
                            endpointId: result.session.activeDeviceId
                        }, originClientId)
                    );
                });
            }

            return {
                type: result.type,
                session: result.session,
                conflict: result.conflict
            };
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createSavePlaybackQueueMutationResolver = (
    save = savePlaybackQueue
) => {
    return async (_: unknown, { input }: { input: SavePlaybackQueueInput }) => {
        try {
            const result = await save(input);

            return {
                type: result.type,
                queue: result.queue,
                conflict: result.conflict
            };
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createRenamePlaybackDeviceMutationResolver = (
    rename = renamePlaybackDevice
) => {
    return async (_: unknown, {
        input,
        originClientId
    }: {
        input: { deviceId: string; name: string };
        originClientId?: string | null;
    }) => {
        try {
            const device = await rename(input.deviceId, input.name);

            notifySafely(() => {
                connectors.notify(
                    PLAYBACK_ENDPOINTS_INVALIDATED,
                    withOriginClientId({
                        reason: 'renamed' as const,
                        deviceId: device.id,
                        endpointId: null
                    }, originClientId)
                );
            });
            return {
                deviceId: device.id,
                name: device.name
            };
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

type PlaybackMutationResolvers = NonNullable<IResolvers['Mutation']>;

export const playbackMutationResolvers: PlaybackMutationResolvers = {
    reportPlaybackState: createReportPlaybackStateMutationResolver(),
    savePlaybackQueue: createSavePlaybackQueueMutationResolver(),
    renamePlaybackDevice: createRenamePlaybackDeviceMutationResolver()
};
