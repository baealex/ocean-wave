import models from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import {
    COMMAND_COMPLETION_TIMEOUT_MS,
    EXECUTION_GRANT_TTL_MS,
    type PlaybackCommandDispatch,
    type PlaybackCommandErrorCode,
    type PlaybackCommandExecutionResult,
    type PlaybackCommandRequest
} from '~/socket/playback-command-contract';

import { PLAYBACK_SCOPE_KEY, type PlaybackState } from './playback-session';

const PREVIOUS_RESTART_THRESHOLD_MS = 10_000;
const ABSOLUTE_POSITION_TOLERANCE_MS = EXECUTION_GRANT_TTL_MS;

interface PlaybackCommandQueueSource {
    id: number;
    revision: number;
    currentIndex: number | null;
    musicIds: string[];
}

export interface ResolvedPlaybackCommand {
    dispatchSource: PlaybackCommandDispatch['expectedSource'];
    desiredResult: PlaybackCommandDispatch['desiredResult'];
    sessionId: number;
    activeEndpointSequence: number;
    sourceStartedAt: Date | null;
    durationMs: number;
    queue: PlaybackCommandQueueSource | null;
}

export interface PlaybackCommandCommitResult {
    sessionRevision: number;
    queueRevision: number | null;
}

export class PlaybackCommandServiceError extends Error {
    readonly code: PlaybackCommandErrorCode;
    readonly retryable: boolean;
    readonly sessionRevision: number | null;
    readonly queueRevision: number | null;

    constructor(
        message: string,
        code: PlaybackCommandErrorCode,
        options: {
            retryable?: boolean;
            sessionRevision?: number | null;
            queueRevision?: number | null;
        } = {}
    ) {
        super(message);
        this.name = 'PlaybackCommandServiceError';
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.sessionRevision = options.sessionRevision ?? null;
        this.queueRevision = options.queueRevision ?? null;
    }
}

export const isPlaybackCommandServiceError = (
    error: unknown
): error is PlaybackCommandServiceError => error instanceof PlaybackCommandServiceError;

const retryableError = (
    message: string,
    code: PlaybackCommandErrorCode,
    sessionRevision: number | null,
    queueRevision: number | null
) => new PlaybackCommandServiceError(message, code, {
    retryable: true,
    sessionRevision,
    queueRevision
});

const commandNeedsQueueRevision = (
    request: PlaybackCommandRequest,
    state: PlaybackState
) => request.command.type === 'next'
    || request.command.type === 'previous'
    || (request.command.type === 'play' && state === 'stopped');

const toEffectivePositionMs = (input: {
    state: string;
    positionMs: number;
    positionUpdatedAt: Date;
    durationMs: number;
}, now: Date) => {
    const elapsedMs = input.state === 'playing'
        ? Math.max(now.getTime() - input.positionUpdatedAt.getTime(), 0)
        : 0;

    return Math.min(
        Math.max(Math.round(input.positionMs + elapsedMs), 0),
        input.durationMs
    );
};

const resolveDesiredResult = (input: {
    request: PlaybackCommandRequest;
    state: PlaybackState;
    currentMusicId: string | null;
    positionMs: number;
    queue: PlaybackCommandQueueSource | null;
}) => {
    const { request, state, currentMusicId, positionMs, queue } = input;
    const currentIndex = queue?.currentIndex ?? null;

    if (request.command.type === 'pause') {
        if (state === 'stopped' || !currentMusicId) {
            throw new PlaybackCommandServiceError(
                'Pause requires an active playback item.',
                'INVALID_COMMAND'
            );
        }

        return {
            state: 'paused' as const,
            currentMusicId,
            currentIndex,
            position: { mode: 'capture-current' as const }
        };
    }

    if (request.command.type === 'seek') {
        if (state === 'stopped' || !currentMusicId) {
            throw new PlaybackCommandServiceError(
                'Seek requires an active playback item.',
                'INVALID_COMMAND'
            );
        }

        return {
            state,
            currentMusicId,
            currentIndex,
            position: {
                mode: 'absolute' as const,
                positionMs: request.command.positionMs
            }
        };
    }

    if (request.command.type === 'play') {
        if (state !== 'stopped') {
            if (!currentMusicId) {
                throw new PlaybackCommandServiceError(
                    'Play requires an available playback item.',
                    'MEDIA_UNAVAILABLE'
                );
            }

            return {
                state: 'playing' as const,
                currentMusicId,
                currentIndex,
                position: state === 'playing'
                    ? { mode: 'capture-current' as const }
                    : { mode: 'absolute' as const, positionMs }
            };
        }

        if (!queue || currentIndex === null || !queue.musicIds[currentIndex]) {
            throw new PlaybackCommandServiceError(
                'The playback queue does not have a selected item.',
                'QUEUE_EMPTY'
            );
        }

        return {
            state: 'playing' as const,
            currentMusicId: queue.musicIds[currentIndex],
            currentIndex,
            position: { mode: 'absolute' as const, positionMs: 0 }
        };
    }

    if (!queue || currentIndex === null || queue.musicIds.length === 0) {
        throw new PlaybackCommandServiceError(
            'The playback queue does not have a selected item.',
            'QUEUE_EMPTY'
        );
    }

    if (queue.musicIds[currentIndex] !== currentMusicId) {
        throw new PlaybackCommandServiceError(
            'The playback session and queue selection do not match.',
            'STALE_QUEUE_REVISION',
            {
                retryable: true,
                sessionRevision: request.expectedSessionRevision,
                queueRevision: queue.revision
            }
        );
    }

    if (
        request.command.type === 'previous'
        && positionMs > PREVIOUS_RESTART_THRESHOLD_MS
    ) {
        return {
            state,
            currentMusicId,
            currentIndex,
            position: { mode: 'absolute' as const, positionMs: 0 }
        };
    }

    const offset = request.command.type === 'next' ? 1 : -1;
    const destinationIndex = (
        currentIndex + offset + queue.musicIds.length
    ) % queue.musicIds.length;

    return {
        state: 'playing' as const,
        currentMusicId: queue.musicIds[destinationIndex],
        currentIndex: destinationIndex,
        position: { mode: 'absolute' as const, positionMs: 0 }
    };
};

export const resolvePlaybackCommand = async (
    request: PlaybackCommandRequest,
    now = new Date()
): Promise<ResolvedPlaybackCommand> => {
    const session = await models.playbackSession.findUnique({
        where: { scopeKey: PLAYBACK_SCOPE_KEY },
        include: {
            Music: { select: { duration: true, syncStatus: true } },
            Queue: {
                include: {
                    Item: {
                        select: {
                            musicId: true,
                            order: true
                        },
                        orderBy: { order: 'asc' }
                    }
                }
            }
        }
    });

    if (!session) {
        throw new PlaybackCommandServiceError(
            'No authoritative playback session exists.',
            'SESSION_NOT_FOUND',
            { retryable: true }
        );
    }

    const queue = session.Queue
        ? {
            id: session.Queue.id,
            revision: session.Queue.revision,
            currentIndex: session.Queue.currentIndex,
            musicIds: session.Queue.Item.map(item => item.musicId.toString())
        }
        : null;
    const queueRevision = queue?.revision ?? null;

    if (session.activeDeviceId !== request.targetEndpointId) {
        throw retryableError(
            'The requested endpoint is not the active playback endpoint.',
            'TARGET_NOT_ACTIVE',
            session.revision,
            queueRevision
        );
    }

    if (session.revision !== request.expectedSessionRevision) {
        throw retryableError(
            'The playback session revision is stale.',
            'STALE_SESSION_REVISION',
            session.revision,
            queueRevision
        );
    }

    const needsQueueRevision = commandNeedsQueueRevision(
        request,
        session.state as PlaybackState
    );

    if (
        needsQueueRevision
        && (
            !queue
            || queue.musicIds.length === 0
            || queue.currentIndex === null
            || !queue.musicIds[queue.currentIndex]
        )
    ) {
        throw new PlaybackCommandServiceError(
            'The playback queue does not have a selected item.',
            'QUEUE_EMPTY',
            {
                sessionRevision: session.revision,
                queueRevision
            }
        );
    }

    if (
        needsQueueRevision
        && (
            request.expectedQueueRevision === null
            || request.expectedQueueRevision !== queueRevision
        )
    ) {
        throw retryableError(
            'The playback queue revision is stale.',
            'STALE_QUEUE_REVISION',
            session.revision,
            queueRevision
        );
    }

    if (!needsQueueRevision && request.expectedQueueRevision !== null) {
        throw new PlaybackCommandServiceError(
            'This playback command must not include a queue revision.',
            'INVALID_COMMAND',
            {
                sessionRevision: session.revision,
                queueRevision
            }
        );
    }

    const currentMusicId = session.currentMusicId?.toString() ?? null;
    const currentMusicAvailable = !session.currentMusicId || (
        session.Music?.syncStatus === TRACK_SYNC_STATUS.active
    );

    if (!currentMusicAvailable) {
        throw new PlaybackCommandServiceError(
            'The current playback item is unavailable.',
            'MEDIA_UNAVAILABLE',
            {
                sessionRevision: session.revision,
                queueRevision
            }
        );
    }

    const durationMs = session.Music
        ? Math.max(Math.round(session.Music.duration * 1_000), 0)
        : 0;
    const positionMs = toEffectivePositionMs({
        state: session.state,
        positionMs: session.positionMs,
        positionUpdatedAt: session.positionUpdatedAt,
        durationMs
    }, now);
    const desiredResult = resolveDesiredResult({
        request,
        state: session.state as PlaybackState,
        currentMusicId,
        positionMs,
        queue
    });

    if (desiredResult.position.mode === 'absolute') {
        const desiredMusic = desiredResult.currentMusicId === currentMusicId
            ? session.Music
            : await models.music.findFirst({
                where: {
                    id: Number(desiredResult.currentMusicId),
                    syncStatus: TRACK_SYNC_STATUS.active
                },
                select: { duration: true }
            });

        if (!desiredMusic) {
            throw new PlaybackCommandServiceError(
                'The resolved playback item is unavailable.',
                'MEDIA_UNAVAILABLE',
                {
                    sessionRevision: session.revision,
                    queueRevision
                }
            );
        }

        desiredResult.position.positionMs = Math.min(
            Math.max(Math.round(desiredResult.position.positionMs), 0),
            Math.max(Math.round(desiredMusic.duration * 1_000), 0)
        );
    }

    const resolvedDurationMs = desiredResult.currentMusicId === currentMusicId
        ? durationMs
        : Math.max(
            Math.round(((await models.music.findUnique({
                where: { id: Number(desiredResult.currentMusicId) },
                select: { duration: true }
            }))?.duration ?? 0) * 1_000),
            0
        );

    return {
        dispatchSource: {
            sessionRevision: session.revision,
            queueRevision,
            state: session.state as PlaybackState,
            currentMusicId,
            currentIndex: queue?.currentIndex ?? null,
            positionMs
        },
        desiredResult,
        sessionId: session.id,
        activeEndpointSequence: session.activeDeviceSequence,
        sourceStartedAt: session.startedAt,
        durationMs: resolvedDurationMs,
        queue
    };
};

const validateCompletedResult = (
    resolved: ResolvedPlaybackCommand,
    result: Extract<PlaybackCommandExecutionResult, { status: 'completed' }>
) => {
    const desired = resolved.desiredResult;
    const actual = result.resultingState;

    if (
        actual.state !== desired.state
        || actual.currentMusicId !== desired.currentMusicId
        || actual.currentIndex !== desired.currentIndex
        || !Number.isFinite(actual.positionMs)
        || actual.positionMs < 0
        || actual.positionMs > resolved.durationMs
    ) {
        throw new PlaybackCommandServiceError(
            'The target reported a state outside the resolved command transition.',
            'TARGET_STATE_MISMATCH',
            {
                retryable: true,
                sessionRevision: resolved.dispatchSource.sessionRevision,
                queueRevision: resolved.dispatchSource.queueRevision
            }
        );
    }

    if (
        desired.position.mode === 'absolute'
        && Math.abs(actual.positionMs - desired.position.positionMs)
            > ABSOLUTE_POSITION_TOLERANCE_MS
    ) {
        throw new PlaybackCommandServiceError(
            'The target position does not match the resolved command transition.',
            'TARGET_STATE_MISMATCH',
            {
                retryable: true,
                sessionRevision: resolved.dispatchSource.sessionRevision,
                queueRevision: resolved.dispatchSource.queueRevision
            }
        );
    }
};

export const commitPlaybackCommandResult = async (
    targetEndpointId: string,
    resolved: ResolvedPlaybackCommand,
    result: Extract<PlaybackCommandExecutionResult, { status: 'completed' }>,
    now = new Date(),
    transactionTimeoutMs = COMMAND_COMPLETION_TIMEOUT_MS
): Promise<PlaybackCommandCommitResult> => {
    validateCompletedResult(resolved, result);

    if (result.endpointSequence <= resolved.activeEndpointSequence) {
        throw retryableError(
            'The target endpoint sequence is stale.',
            'TARGET_STATE_MISMATCH',
            resolved.dispatchSource.sessionRevision,
            resolved.dispatchSource.queueRevision
        );
    }

    try {
        return await models.$transaction(async (transaction) => {
            let queueRevision = resolved.queue?.revision ?? null;

            if (resolved.queue) {
                const queueIndexChanged = resolved.queue.currentIndex
                    !== resolved.desiredResult.currentIndex;
                const queueFence = await transaction.playbackQueue.updateMany({
                    where: {
                        id: resolved.queue.id,
                        revision: resolved.queue.revision,
                        currentIndex: resolved.queue.currentIndex,
                        ...(resolved.queue.currentIndex === null
                            ? {}
                            : {
                                Item: {
                                    some: {
                                        order: resolved.queue.currentIndex,
                                        musicId: Number(resolved.queue.musicIds[
                                            resolved.queue.currentIndex
                                        ])
                                    }
                                }
                            })
                    },
                    data: queueIndexChanged
                        ? {
                            currentIndex: resolved.desiredResult.currentIndex,
                            revision: { increment: 1 }
                        }
                        : { currentIndex: resolved.queue.currentIndex }
                });

                if (queueFence.count !== 1) {
                    throw retryableError(
                        'The playback queue changed before command completion.',
                        'STALE_QUEUE_REVISION',
                        resolved.dispatchSource.sessionRevision,
                        null
                    );
                }

                queueRevision = queueIndexChanged
                    ? resolved.queue.revision + 1
                    : resolved.queue.revision;
            }

            const resultingState = result.resultingState;
            const continuesCurrentPlay = resolved.dispatchSource.state === 'playing'
                && resultingState.state === 'playing'
                && resolved.dispatchSource.currentMusicId === resultingState.currentMusicId;
            const startedAt = resultingState.state === 'playing'
                ? (continuesCurrentPlay ? resolved.sourceStartedAt ?? now : now)
                : (resultingState.state === 'paused' ? resolved.sourceStartedAt : null);
            const sessionFence = await transaction.playbackSession.updateMany({
                where: {
                    id: resolved.sessionId,
                    revision: resolved.dispatchSource.sessionRevision,
                    activeDeviceId: targetEndpointId,
                    activeDeviceSequence: resolved.activeEndpointSequence,
                    state: resolved.dispatchSource.state,
                    currentMusicId: resolved.dispatchSource.currentMusicId === null
                        ? null
                        : Number(resolved.dispatchSource.currentMusicId)
                },
                data: {
                    state: resultingState.state,
                    currentMusicId: resultingState.currentMusicId === null
                        ? null
                        : Number(resultingState.currentMusicId),
                    positionMs: Math.round(resultingState.positionMs),
                    positionUpdatedAt: now,
                    startedAt,
                    activeDeviceSequence: result.endpointSequence,
                    revision: { increment: 1 }
                }
            });

            if (sessionFence.count !== 1) {
                throw retryableError(
                    'The playback session changed before command completion.',
                    'STALE_SESSION_REVISION',
                    null,
                    queueRevision
                );
            }

            return {
                sessionRevision: resolved.dispatchSource.sessionRevision + 1,
                queueRevision
            };
        }, {
            isolationLevel: 'Serializable',
            timeout: Math.max(Math.round(transactionTimeoutMs), 1)
        });
    } catch (error) {
        if (isPlaybackCommandServiceError(error)) {
            if (
                error.code === 'STALE_SESSION_REVISION'
                || error.code === 'STALE_QUEUE_REVISION'
            ) {
                const current = await models.playbackSession.findUnique({
                    where: { scopeKey: PLAYBACK_SCOPE_KEY },
                    select: {
                        revision: true,
                        Queue: { select: { revision: true } }
                    }
                });
                throw new PlaybackCommandServiceError(
                    error.message,
                    error.code,
                    {
                        retryable: error.retryable,
                        sessionRevision: current?.revision ?? null,
                        queueRevision: current?.Queue?.revision ?? null
                    }
                );
            }
            throw error;
        }

        throw new PlaybackCommandServiceError(
            'The authoritative playback state could not be committed.',
            'STATE_COMMIT_FAILED',
            {
                retryable: true,
                sessionRevision: resolved.dispatchSource.sessionRevision,
                queueRevision: resolved.dispatchSource.queueRevision
            }
        );
    }
};
