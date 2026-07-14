import type { IResolvers } from '@graphql-tools/utils';

import { connectors } from '~/socket/connectors';
import { withOriginClientId } from '~/socket/origin-client';
import { PLAYBACK_STATE_UPDATED } from '~/socket/playback';

import {
    isPlaybackSessionServiceError,
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

export const createReportPlaybackStateMutationResolver = (
    report = reportPlaybackState
) => {
    return async (_: unknown, {
        input,
        originClientId
    }: {
        input: ReportPlaybackStateInput;
        originClientId?: string | null;
    }) => {
        try {
            const result = await report(input);

            if (result.type === 'accepted' && result.changed) {
                notifySafely(() => {
                    connectors.notify(
                        PLAYBACK_STATE_UPDATED,
                        withOriginClientId(result.session, originClientId)
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

type PlaybackMutationResolvers = NonNullable<IResolvers['Mutation']>;

export const playbackMutationResolvers: PlaybackMutationResolvers = {
    reportPlaybackState: createReportPlaybackStateMutationResolver(),
    savePlaybackQueue: createSavePlaybackQueueMutationResolver()
};
