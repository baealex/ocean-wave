import models, { type Prisma } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import {
    normalizePlaybackHandoffState,
    type PlaybackHandoffErrorCode,
    type PlaybackHandoffHistoryTransfer,
    type PlaybackHandoffRequest,
    type PlaybackHandoffSnapshot,
    type PlaybackHandoffSourceState
} from '~/socket/playback-handoff-contract';

import { PLAYBACK_SCOPE_KEY } from './playback-session';

const HANDOFF_POSITION_TOLERANCE_MS = 5_000;
const HANDOFF_TRANSACTION_TIMEOUT_MS = 10_000;

export interface ResolvedPlaybackHandoff {
    sessionId: number;
    sourceEndpointId: string;
    targetEndpointId: string;
    targetClaimSequence: number;
    sourceActiveDeviceSequence: number;
    sourceState: PlaybackHandoffSourceState;
    sourceStartedAt: Date | null;
    durationMs: number;
    playbackHistory: PlaybackHandoffHistoryTransfer | null;
    snapshot: PlaybackHandoffSnapshot;
}

export interface ClaimedPlaybackHandoff {
    sessionRevision: number;
    queueRevision: number;
    snapshot: PlaybackHandoffSnapshot;
}

export interface PlaybackHandoffCommitResult {
    sessionRevision: number;
    queueRevision: number;
}

export class PlaybackHandoffServiceError extends Error {
    readonly code: PlaybackHandoffErrorCode;
    readonly retryable: boolean;
    readonly sessionRevision: number | null;
    readonly queueRevision: number | null;

    constructor(
        message: string,
        code: PlaybackHandoffErrorCode,
        options: {
            retryable?: boolean;
            sessionRevision?: number | null;
            queueRevision?: number | null;
        } = {}
    ) {
        super(message);
        this.name = 'PlaybackHandoffServiceError';
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.sessionRevision = options.sessionRevision ?? null;
        this.queueRevision = options.queueRevision ?? null;
    }
}

export const isPlaybackHandoffServiceError = (
    error: unknown
): error is PlaybackHandoffServiceError => error instanceof PlaybackHandoffServiceError;

const retryableError = (
    message: string,
    code: PlaybackHandoffErrorCode,
    sessionRevision: number | null,
    queueRevision: number | null
) => new PlaybackHandoffServiceError(message, code, {
    retryable: true,
    sessionRevision,
    queueRevision
});

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

const toPlaybackHistoryTransfer = (session: {
    currentMusicId: number | null;
    historyMusicId: number | null;
    historySessionId: string | null;
    historyBranchId: string | null;
    historyParentBranchId: string | null;
    historyBranchBasePlayedMs: number;
    historyStartedAt: Date | null;
    historyPlayedMs: number;
    historyHadSeek: boolean;
    historyUpdatedAt: Date | null;
}): PlaybackHandoffHistoryTransfer | null => {
    if (
        !session.currentMusicId
        || session.historyMusicId !== session.currentMusicId
        || !session.historySessionId
        || !session.historyStartedAt
        || !session.historyUpdatedAt
        || session.historyStartedAt > session.historyUpdatedAt
        || !Number.isSafeInteger(session.historyPlayedMs)
        || session.historyPlayedMs < 0
        || !Number.isSafeInteger(session.historyBranchBasePlayedMs)
        || session.historyBranchBasePlayedMs < 0
        || (
            session.historyParentBranchId === null
            && session.historyBranchBasePlayedMs !== 0
        )
        || session.historyPlayedMs < session.historyBranchBasePlayedMs
    ) {
        return null;
    }

    const branchId = session.historyBranchId ?? session.historySessionId;
    if (
        !branchId
        || branchId.length > 128
        || session.historyParentBranchId === branchId
        || (
            session.historyParentBranchId !== null
            && session.historyParentBranchId !== session.historySessionId
        )
        || (
            session.historyParentBranchId === null
            && branchId !== session.historySessionId
        )
    ) {
        return null;
    }

    return {
        clientSessionId: session.historySessionId,
        branchId,
        parentBranchId: session.historyParentBranchId,
        branchBasePlayedMs: session.historyBranchBasePlayedMs,
        trackId: session.currentMusicId.toString(),
        startedAt: session.historyStartedAt.toISOString(),
        accumulatedPlayedMs: session.historyPlayedMs,
        hadSeek: session.historyHadSeek,
        updatedAt: session.historyUpdatedAt.toISOString()
    };
};

const playbackHistoryUpdateData = (
    history: PlaybackHandoffHistoryTransfer | null,
    currentMusicId: number
) => history ? {
        historyMusicId: currentMusicId,
        historySessionId: history.clientSessionId,
        historyBranchId: history.branchId,
        historyParentBranchId: history.parentBranchId,
        historyBranchBasePlayedMs: history.branchBasePlayedMs,
        historyStartedAt: new Date(history.startedAt),
        historyPlayedMs: history.accumulatedPlayedMs,
        historyHadSeek: history.hadSeek,
        historyUpdatedAt: new Date(history.updatedAt)
    } : {
        historyMusicId: null,
        historySessionId: null,
        historyBranchId: null,
        historyParentBranchId: null,
        historyBranchBasePlayedMs: 0,
        historyStartedAt: null,
        historyPlayedMs: 0,
        historyHadSeek: false,
        historyUpdatedAt: null
    };

const currentRevisions = async () => {
    const current = await models.playbackSession.findUnique({
        where: { scopeKey: PLAYBACK_SCOPE_KEY },
        select: {
            revision: true,
            Queue: { select: { revision: true } }
        }
    });

    return {
        sessionRevision: current?.revision ?? null,
        queueRevision: current?.Queue?.revision ?? null
    };
};

const translateCommitError = async (
    error: unknown,
    fallback: {
        message: string;
        code: PlaybackHandoffErrorCode;
        sessionRevision: number;
        queueRevision: number;
    }
) => {
    if (isPlaybackHandoffServiceError(error)) {
        if (
            error.code === 'STALE_SESSION_REVISION'
            || error.code === 'STALE_QUEUE_REVISION'
        ) {
            const current = await currentRevisions();
            return new PlaybackHandoffServiceError(error.message, error.code, {
                retryable: error.retryable,
                ...current
            });
        }

        return error;
    }

    return new PlaybackHandoffServiceError(
        fallback.message,
        fallback.code,
        {
            retryable: true,
            sessionRevision: fallback.sessionRevision,
            queueRevision: fallback.queueRevision
        }
    );
};

const assertPosition = (
    positionMs: number,
    durationMs: number,
    code: 'SOURCE_STATE_MISMATCH' | 'TARGET_STATE_MISMATCH'
) => {
    if (
        !Number.isFinite(positionMs)
        || positionMs < 0
        || positionMs > durationMs
    ) {
        throw new PlaybackHandoffServiceError(
            'The reported handoff position is outside the current playback item.',
            code,
            { retryable: true }
        );
    }

    return Math.round(positionMs);
};

const fenceQueue = async (
    transaction: Prisma.TransactionClient,
    resolved: ResolvedPlaybackHandoff
) => {
    const queueFence = await transaction.playbackQueue.updateMany({
        where: {
            id: Number(resolved.snapshot.queue.id),
            revision: resolved.snapshot.queueRevision,
            currentIndex: resolved.snapshot.currentIndex,
            Item: {
                some: {
                    order: resolved.snapshot.currentIndex,
                    musicId: Number(resolved.snapshot.currentMusicId)
                }
            }
        },
        data: { currentIndex: resolved.snapshot.currentIndex }
    });

    if (queueFence.count !== 1) {
        throw retryableError(
            'The playback queue changed during the handoff.',
            'STALE_QUEUE_REVISION',
            resolved.snapshot.sessionRevision,
            null
        );
    }
};

export const resolvePlaybackHandoff = async (
    request: PlaybackHandoffRequest,
    now = new Date()
): Promise<ResolvedPlaybackHandoff> => {
    const session = await models.playbackSession.findUnique({
        where: { scopeKey: PLAYBACK_SCOPE_KEY },
        include: {
            Music: { select: { duration: true, syncStatus: true } },
            Queue: {
                include: {
                    Item: {
                        select: {
                            musicId: true,
                            order: true,
                            sourceOrder: true
                        },
                        orderBy: { order: 'asc' }
                    }
                }
            }
        }
    });

    if (!session) {
        throw new PlaybackHandoffServiceError(
            'No authoritative playback session exists.',
            'SESSION_NOT_FOUND',
            { retryable: true }
        );
    }

    const queueRevision = session.Queue?.revision ?? null;

    if (request.sourceEndpointId === request.targetEndpointId) {
        throw new PlaybackHandoffServiceError(
            'The target browser already owns playback.',
            'TARGET_ALREADY_ACTIVE'
        );
    }

    if (session.activeDeviceId !== request.sourceEndpointId) {
        throw retryableError(
            'The requested source is no longer the active playback endpoint.',
            'SOURCE_NOT_ACTIVE',
            session.revision,
            queueRevision
        );
    }

    if (session.revision !== request.expectedSessionRevision) {
        throw retryableError(
            'The playback session changed before the handoff started.',
            'STALE_SESSION_REVISION',
            session.revision,
            queueRevision
        );
    }

    if (
        !session.Queue
        || session.Queue.currentIndex === null
        || session.Queue.Item.length === 0
    ) {
        throw new PlaybackHandoffServiceError(
            'The authoritative playback queue is not available for transfer.',
            'QUEUE_UNAVAILABLE',
            {
                retryable: true,
                sessionRevision: session.revision,
                queueRevision
            }
        );
    }

    if (session.Queue.revision !== request.expectedQueueRevision) {
        throw retryableError(
            'The playback queue changed before the handoff started.',
            'STALE_QUEUE_REVISION',
            session.revision,
            session.Queue.revision
        );
    }

    const handoffState = normalizePlaybackHandoffState(session.state);
    if (
        !handoffState
        || !session.currentMusicId
        || !session.Music
        || session.Music.syncStatus !== TRACK_SYNC_STATUS.active
    ) {
        throw new PlaybackHandoffServiceError(
            'The current playback item is unavailable for transfer.',
            'MEDIA_UNAVAILABLE',
            {
                retryable: false,
                sessionRevision: session.revision,
                queueRevision: session.Queue.revision
            }
        );
    }

    const currentItem = session.Queue.Item[session.Queue.currentIndex];
    if (currentItem?.musicId !== session.currentMusicId) {
        throw retryableError(
            'The playback session and queue selection do not match.',
            'STALE_QUEUE_REVISION',
            session.revision,
            session.Queue.revision
        );
    }

    const durationMs = Math.max(Math.round(session.Music.duration * 1_000), 0);
    const orderedItems = [...session.Queue.Item].sort((a, b) => a.order - b.order);
    const sourceItems = session.Queue.shuffle
        ? [...session.Queue.Item].sort((a, b) => (
            (a.sourceOrder ?? a.order) - (b.sourceOrder ?? b.order)
        ))
        : [];
    const snapshot: PlaybackHandoffSnapshot = {
        sessionRevision: session.revision,
        queueRevision: session.Queue.revision,
        state: handoffState,
        currentMusicId: session.currentMusicId.toString(),
        currentIndex: session.Queue.currentIndex,
        positionMs: toEffectivePositionMs({
            state: session.state,
            positionMs: session.positionMs,
            positionUpdatedAt: session.positionUpdatedAt,
            durationMs
        }, now),
        queue: {
            id: session.Queue.id.toString(),
            musicIds: orderedItems.map(item => item.musicId.toString()),
            sourceMusicIds: sourceItems.map(item => item.musicId.toString()),
            currentIndex: session.Queue.currentIndex,
            contextType: session.Queue.contextType as 'album' | 'playlist' | 'queue',
            contextId: session.Queue.contextId?.toString() ?? null,
            contextTitle: session.Queue.contextTitle,
            shuffle: session.Queue.shuffle,
            repeatMode: session.Queue.repeatMode as 'none' | 'one' | 'all',
            revision: session.Queue.revision,
            updatedAt: session.Queue.updatedAt.toISOString()
        }
    };

    return {
        sessionId: session.id,
        sourceEndpointId: request.sourceEndpointId,
        targetEndpointId: request.targetEndpointId,
        targetClaimSequence: request.targetClaimSequence,
        sourceActiveDeviceSequence: session.activeDeviceSequence,
        sourceState: session.state as PlaybackHandoffSourceState,
        sourceStartedAt: session.startedAt,
        durationMs,
        playbackHistory: toPlaybackHistoryTransfer(session),
        snapshot
    };
};

export const claimPlaybackHandoff = async (
    resolved: ResolvedPlaybackHandoff,
    releasedPositionMs: number,
    now = new Date(),
    targetPlaybackHistory = resolved.playbackHistory
): Promise<ClaimedPlaybackHandoff> => {
    const positionMs = assertPosition(
        releasedPositionMs,
        resolved.durationMs,
        'SOURCE_STATE_MISMATCH'
    );

    try {
        await models.$transaction(async (transaction) => {
            await fenceQueue(transaction, resolved);
            const sessionFence = await transaction.playbackSession.updateMany({
                where: {
                    id: resolved.sessionId,
                    revision: resolved.snapshot.sessionRevision,
                    activeDeviceId: resolved.sourceEndpointId,
                    activeDeviceSequence: resolved.sourceActiveDeviceSequence,
                    state: resolved.sourceState,
                    currentMusicId: Number(resolved.snapshot.currentMusicId)
                },
                data: {
                    state: 'paused',
                    activeDeviceId: resolved.targetEndpointId,
                    activeDeviceSequence: resolved.targetClaimSequence,
                    positionMs,
                    positionUpdatedAt: now,
                    startedAt: resolved.sourceStartedAt,
                    ...playbackHistoryUpdateData(
                        targetPlaybackHistory,
                        Number(resolved.snapshot.currentMusicId)
                    ),
                    revision: { increment: 1 }
                }
            });

            if (sessionFence.count !== 1) {
                throw retryableError(
                    'The playback session changed before ownership could be claimed.',
                    'STALE_SESSION_REVISION',
                    null,
                    resolved.snapshot.queueRevision
                );
            }
        }, {
            isolationLevel: 'Serializable',
            timeout: HANDOFF_TRANSACTION_TIMEOUT_MS
        });
    } catch (error) {
        throw await translateCommitError(error, {
            message: 'The playback handoff claim could not be committed.',
            code: 'CLAIM_FAILED',
            sessionRevision: resolved.snapshot.sessionRevision,
            queueRevision: resolved.snapshot.queueRevision
        });
    }

    const sessionRevision = resolved.snapshot.sessionRevision + 1;
    return {
        sessionRevision,
        queueRevision: resolved.snapshot.queueRevision,
        snapshot: {
            ...resolved.snapshot,
            sessionRevision,
            positionMs
        }
    };
};

export const completePlaybackHandoff = async (
    resolved: ResolvedPlaybackHandoff,
    claimed: ClaimedPlaybackHandoff,
    input: { endpointSequence: number; positionMs: number },
    now = new Date()
): Promise<PlaybackHandoffCommitResult> => {
    const positionMs = assertPosition(
        input.positionMs,
        resolved.durationMs,
        'TARGET_STATE_MISMATCH'
    );

    if (input.endpointSequence <= resolved.targetClaimSequence) {
        throw retryableError(
            'The target endpoint sequence is stale.',
            'TARGET_STATE_MISMATCH',
            claimed.sessionRevision,
            claimed.queueRevision
        );
    }

    if (
        Math.abs(positionMs - claimed.snapshot.positionMs)
        > HANDOFF_POSITION_TOLERANCE_MS
    ) {
        throw retryableError(
            'The target position drifted outside the handoff tolerance.',
            'TARGET_STATE_MISMATCH',
            claimed.sessionRevision,
            claimed.queueRevision
        );
    }

    try {
        await models.$transaction(async (transaction) => {
            await fenceQueue(transaction, resolved);
            const sessionFence = await transaction.playbackSession.updateMany({
                where: {
                    id: resolved.sessionId,
                    revision: claimed.sessionRevision,
                    activeDeviceId: resolved.targetEndpointId,
                    activeDeviceSequence: resolved.targetClaimSequence,
                    state: 'paused',
                    currentMusicId: Number(resolved.snapshot.currentMusicId)
                },
                data: {
                    state: resolved.snapshot.state,
                    positionMs,
                    positionUpdatedAt: now,
                    startedAt: resolved.snapshot.state === 'playing'
                        ? resolved.sourceStartedAt ?? now
                        : resolved.sourceStartedAt,
                    activeDeviceSequence: input.endpointSequence,
                    revision: { increment: 1 }
                }
            });

            if (sessionFence.count !== 1) {
                throw retryableError(
                    'The playback session changed before handoff activation completed.',
                    'STALE_SESSION_REVISION',
                    null,
                    claimed.queueRevision
                );
            }
        }, {
            isolationLevel: 'Serializable',
            timeout: HANDOFF_TRANSACTION_TIMEOUT_MS
        });
    } catch (error) {
        throw await translateCommitError(error, {
            message: 'The activated playback handoff could not be committed.',
            code: 'CLAIM_FAILED',
            sessionRevision: claimed.sessionRevision,
            queueRevision: claimed.queueRevision
        });
    }

    return {
        sessionRevision: claimed.sessionRevision + 1,
        queueRevision: claimed.queueRevision
    };
};

export const rollbackPlaybackHandoff = async (
    resolved: ResolvedPlaybackHandoff,
    claimed: ClaimedPlaybackHandoff,
    sourceReleaseSequence: number,
    now = new Date()
): Promise<ClaimedPlaybackHandoff> => {
    if (sourceReleaseSequence <= resolved.sourceActiveDeviceSequence) {
        throw retryableError(
            'The released source endpoint sequence is stale.',
            'SOURCE_STATE_MISMATCH',
            claimed.sessionRevision,
            claimed.queueRevision
        );
    }

    try {
        await models.$transaction(async (transaction) => {
            await fenceQueue(transaction, resolved);
            const sessionFence = await transaction.playbackSession.updateMany({
                where: {
                    id: resolved.sessionId,
                    revision: claimed.sessionRevision,
                    activeDeviceId: resolved.targetEndpointId,
                    activeDeviceSequence: resolved.targetClaimSequence,
                    state: 'paused',
                    currentMusicId: Number(resolved.snapshot.currentMusicId)
                },
                data: {
                    activeDeviceId: resolved.sourceEndpointId,
                    activeDeviceSequence: sourceReleaseSequence,
                    positionMs: claimed.snapshot.positionMs,
                    positionUpdatedAt: now,
                    ...playbackHistoryUpdateData(
                        resolved.playbackHistory,
                        Number(resolved.snapshot.currentMusicId)
                    ),
                    revision: { increment: 1 }
                }
            });

            if (sessionFence.count !== 1) {
                throw retryableError(
                    'The playback session changed before the handoff rollback.',
                    'STALE_SESSION_REVISION',
                    null,
                    claimed.queueRevision
                );
            }
        }, {
            isolationLevel: 'Serializable',
            timeout: HANDOFF_TRANSACTION_TIMEOUT_MS
        });
    } catch (error) {
        throw await translateCommitError(error, {
            message: 'The playback handoff could not be rolled back safely.',
            code: 'ROLLBACK_FAILED',
            sessionRevision: claimed.sessionRevision,
            queueRevision: claimed.queueRevision
        });
    }

    const sessionRevision = claimed.sessionRevision + 1;
    return {
        sessionRevision,
        queueRevision: claimed.queueRevision,
        snapshot: {
            ...claimed.snapshot,
            sessionRevision
        }
    };
};

export const completePlaybackHandoffRollback = async (
    resolved: ResolvedPlaybackHandoff,
    rolledBack: ClaimedPlaybackHandoff,
    sourceReleaseSequence: number,
    input: { endpointSequence: number; positionMs: number },
    now = new Date()
): Promise<PlaybackHandoffCommitResult> => {
    const positionMs = assertPosition(
        input.positionMs,
        resolved.durationMs,
        'SOURCE_STATE_MISMATCH'
    );

    if (input.endpointSequence <= sourceReleaseSequence) {
        throw retryableError(
            'The restored source endpoint sequence is stale.',
            'SOURCE_STATE_MISMATCH',
            rolledBack.sessionRevision,
            rolledBack.queueRevision
        );
    }

    try {
        await models.$transaction(async (transaction) => {
            await fenceQueue(transaction, resolved);
            const sessionFence = await transaction.playbackSession.updateMany({
                where: {
                    id: resolved.sessionId,
                    revision: rolledBack.sessionRevision,
                    activeDeviceId: resolved.sourceEndpointId,
                    activeDeviceSequence: sourceReleaseSequence,
                    state: 'paused',
                    currentMusicId: Number(resolved.snapshot.currentMusicId)
                },
                data: {
                    state: resolved.sourceState,
                    positionMs,
                    positionUpdatedAt: now,
                    startedAt: resolved.sourceState === 'playing'
                        ? resolved.sourceStartedAt ?? now
                        : resolved.sourceStartedAt,
                    activeDeviceSequence: input.endpointSequence,
                    revision: { increment: 1 }
                }
            });

            if (sessionFence.count !== 1) {
                throw retryableError(
                    'The playback session changed while the source was restored.',
                    'STALE_SESSION_REVISION',
                    null,
                    rolledBack.queueRevision
                );
            }
        }, {
            isolationLevel: 'Serializable',
            timeout: HANDOFF_TRANSACTION_TIMEOUT_MS
        });
    } catch (error) {
        throw await translateCommitError(error, {
            message: 'The restored source state could not be committed.',
            code: 'ROLLBACK_FAILED',
            sessionRevision: rolledBack.sessionRevision,
            queueRevision: rolledBack.queueRevision
        });
    }

    return {
        sessionRevision: rolledBack.sessionRevision + 1,
        queueRevision: rolledBack.queueRevision
    };
};
