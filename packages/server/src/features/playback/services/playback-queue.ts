import { Prisma } from '@prisma/client';

import models from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

import { PLAYBACK_SCOPE_KEY } from './playback-session';

export const PLAYBACK_QUEUE_REPEAT_MODES = {
    none: 'none',
    one: 'one',
    all: 'all'
} as const;

export type PlaybackQueueRepeatMode = typeof PLAYBACK_QUEUE_REPEAT_MODES[
    keyof typeof PLAYBACK_QUEUE_REPEAT_MODES
];

export const PLAYBACK_QUEUE_CONTEXT_TYPES = {
    album: 'album',
    playlist: 'playlist',
    queue: 'queue'
} as const;

export type PlaybackQueueContextType = typeof PLAYBACK_QUEUE_CONTEXT_TYPES[
    keyof typeof PLAYBACK_QUEUE_CONTEXT_TYPES
];

interface PlaybackQueueRecord {
    id: number;
    currentIndex: number | null;
    contextType: string;
    contextId: number | null;
    contextTitle: string | null;
    shuffle: boolean;
    repeatMode: string;
    revision: number;
    updatedAt: Date;
    Item: Array<{
        id: number;
        musicId: number;
        order: number;
        sourceOrder: number | null;
        Music?: { syncStatus: string };
    }>;
}

export interface PlaybackQueueSnapshot {
    id: string;
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex: number | null;
    contextType: PlaybackQueueContextType;
    contextId: string | null;
    contextTitle: string | null;
    shuffle: boolean;
    repeatMode: PlaybackQueueRepeatMode;
    revision: number;
    updatedAt: string;
}

export interface SavePlaybackQueueInput {
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex?: number | null;
    contextType?: PlaybackQueueContextType;
    contextId?: string | null;
    contextTitle?: string | null;
    shuffle: boolean;
    repeatMode: PlaybackQueueRepeatMode;
    expectedRevision: number;
}

export interface PlaybackQueueSaveResult {
    type: 'accepted' | 'conflict';
    queue: PlaybackQueueSnapshot;
    conflict: {
        reason: 'stale-revision';
        queue: PlaybackQueueSnapshot;
    } | null;
    changed: boolean;
}

export class PlaybackQueueServiceError extends Error {
    code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'PlaybackQueueServiceError';
        this.code = code;
    }
}

export const isPlaybackQueueServiceError = (
    error: unknown
): error is PlaybackQueueServiceError => error instanceof PlaybackQueueServiceError;

const toRepeatMode = (repeatMode: string): PlaybackQueueRepeatMode => {
    if (Object.values(PLAYBACK_QUEUE_REPEAT_MODES).includes(
        repeatMode as PlaybackQueueRepeatMode
    )) {
        return repeatMode as PlaybackQueueRepeatMode;
    }

    throw new PlaybackQueueServiceError(
        'Playback queue repeat mode must be none, one, or all.',
        'INVALID_PLAYBACK_QUEUE_REPEAT_MODE'
    );
};

const toContextType = (contextType: string): PlaybackQueueContextType => {
    if (Object.values(PLAYBACK_QUEUE_CONTEXT_TYPES).includes(
        contextType as PlaybackQueueContextType
    )) {
        return contextType as PlaybackQueueContextType;
    }

    throw new PlaybackQueueServiceError(
        'Playback queue context type must be album, playlist, or queue.',
        'INVALID_PLAYBACK_QUEUE_CONTEXT'
    );
};

const toSnapshot = (queue: PlaybackQueueRecord): PlaybackQueueSnapshot => {
    const orderedItems = [...queue.Item].sort((a, b) => a.order - b.order);
    const sourceItems = queue.shuffle
        ? [...queue.Item].sort((a, b) => (
            (a.sourceOrder ?? a.order) - (b.sourceOrder ?? b.order)
        ))
        : [];

    return {
        id: queue.id.toString(),
        musicIds: orderedItems.map(item => item.musicId.toString()),
        sourceMusicIds: sourceItems.map(item => item.musicId.toString()),
        currentIndex: queue.currentIndex,
        contextType: toContextType(queue.contextType),
        contextId: queue.contextId?.toString() ?? null,
        contextTitle: queue.contextTitle,
        shuffle: queue.shuffle,
        repeatMode: toRepeatMode(queue.repeatMode),
        revision: queue.revision,
        updatedAt: queue.updatedAt.toISOString()
    };
};

const queueInclude = {
    Item: {
        select: {
            id: true,
            musicId: true,
            order: true,
            sourceOrder: true,
            Music: { select: { syncStatus: true } }
        },
        orderBy: { order: 'asc' as const }
    }
};

const conflictResult = (queue: PlaybackQueueRecord): PlaybackQueueSaveResult => {
    const snapshot = toSnapshot(queue);

    return {
        type: 'conflict',
        queue: snapshot,
        conflict: { reason: 'stale-revision', queue: snapshot },
        changed: false
    };
};

const isUniqueConstraintError = (error: unknown) => {
    return error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002';
};

const parseMusicIds = (musicIds: string[], field: string) => {
    if (musicIds.length > 5_000) {
        throw new PlaybackQueueServiceError(
            'Playback queue cannot contain more than 5000 items.',
            'PLAYBACK_QUEUE_TOO_LARGE'
        );
    }

    const parsed = musicIds.map(Number);

    if (parsed.some(id => !Number.isInteger(id) || id <= 0)) {
        throw new PlaybackQueueServiceError(
            `${field} must contain only positive music ids.`,
            'INVALID_PLAYBACK_QUEUE_MUSIC'
        );
    }

    if (new Set(parsed).size !== parsed.length) {
        throw new PlaybackQueueServiceError(
            `${field} cannot contain duplicate music ids.`,
            'DUPLICATE_PLAYBACK_QUEUE_MUSIC'
        );
    }

    return parsed;
};

const validateInput = (input: SavePlaybackQueueInput) => {
    const musicIds = parseMusicIds(input.musicIds, 'musicIds');
    const sourceMusicIds = parseMusicIds(input.sourceMusicIds, 'sourceMusicIds');
    const repeatMode = toRepeatMode(input.repeatMode);
    const currentIndex = input.currentIndex ?? null;
    const contextType = toContextType(input.contextType ?? 'queue');
    const contextId = input.contextId === undefined || input.contextId === null
        ? null
        : Number(input.contextId);
    const contextTitle = input.contextTitle?.trim() || null;

    if (contextType === 'queue') {
        if (contextId !== null || contextTitle !== null) {
            throw new PlaybackQueueServiceError(
                'A general queue context cannot include a collection id or title.',
                'INVALID_PLAYBACK_QUEUE_CONTEXT'
            );
        }
    } else if (
        contextId === null
        || !Number.isInteger(contextId)
        || contextId <= 0
        || !contextTitle
        || contextTitle.length > 512
    ) {
        throw new PlaybackQueueServiceError(
            'Album and playlist queue contexts require a positive id and title.',
            'INVALID_PLAYBACK_QUEUE_CONTEXT'
        );
    }

    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new PlaybackQueueServiceError(
            'Expected queue revision must be a non-negative integer.',
            'INVALID_PLAYBACK_QUEUE_REVISION'
        );
    }

    if (currentIndex !== null && (
        !Number.isInteger(currentIndex)
        || currentIndex < 0
        || currentIndex >= musicIds.length
    )) {
        throw new PlaybackQueueServiceError(
            'Current queue index must point to an existing item.',
            'INVALID_PLAYBACK_QUEUE_INDEX'
        );
    }

    if (musicIds.length === 0 && currentIndex !== null) {
        throw new PlaybackQueueServiceError(
            'An empty playback queue cannot have a current index.',
            'INVALID_PLAYBACK_QUEUE_INDEX'
        );
    }

    if (input.shuffle) {
        const musicIdSet = new Set(musicIds);
        const isPermutation = sourceMusicIds.length === musicIds.length
            && sourceMusicIds.every(id => musicIdSet.has(id));

        if (!isPermutation) {
            throw new PlaybackQueueServiceError(
                'A shuffled queue requires the same items in source order.',
                'INVALID_PLAYBACK_QUEUE_SOURCE_ORDER'
            );
        }
    } else if (sourceMusicIds.length > 0) {
        throw new PlaybackQueueServiceError(
            'An unshuffled queue cannot contain source-order items.',
            'INVALID_PLAYBACK_QUEUE_SOURCE_ORDER'
        );
    }

    return {
        musicIds,
        sourceMusicIds,
        currentIndex,
        contextType,
        contextId,
        contextTitle,
        shuffle: input.shuffle === true,
        repeatMode,
        expectedRevision: input.expectedRevision
    };
};

export const getPlaybackQueueSnapshot = async (): Promise<PlaybackQueueSnapshot | null> => {
    return models.$transaction(async (transaction) => {
        const queue = await transaction.playbackQueue.findFirst({
            where: { Session: { scopeKey: PLAYBACK_SCOPE_KEY } },
            include: queueInclude
        });

        if (!queue) {
            return null;
        }

        const orderedItems = [...queue.Item].sort((a, b) => a.order - b.order);
        const availableItems = orderedItems.filter(
            item => item.Music.syncStatus === TRACK_SYNC_STATUS.active
        );
        const needsRepair = availableItems.length !== orderedItems.length
            || orderedItems.some((item, index) => item.order !== index)
            || (queue.currentIndex !== null && (
                queue.currentIndex < 0 || queue.currentIndex >= orderedItems.length
            ));

        if (!needsRepair) {
            return toSnapshot(queue);
        }

        const selectedMusicId = queue.currentIndex === null
            ? null
            : orderedItems[queue.currentIndex]?.musicId ?? null;
        const selectedAvailableIndex = availableItems.findIndex(
            item => item.musicId === selectedMusicId
        );
        const currentIndex = availableItems.length === 0 || queue.currentIndex === null
            ? null
            : (selectedAvailableIndex >= 0
                ? selectedAvailableIndex
                : Math.min(queue.currentIndex, availableItems.length - 1));
        const sourceItems = [...availableItems].sort((a, b) => (
            (a.sourceOrder ?? a.order) - (b.sourceOrder ?? b.order)
        ));
        const sourceOrderByItemId = new Map(
            sourceItems.map((item, index) => [item.id, index])
        );

        const claim = await transaction.playbackQueue.updateMany({
            where: {
                id: queue.id,
                revision: queue.revision
            },
            data: {
                currentIndex,
                revision: { increment: 1 }
            }
        });

        if (claim.count !== 1) {
            const latest = await transaction.playbackQueue.findUnique({
                where: { id: queue.id },
                include: queueInclude
            });
            return latest ? toSnapshot(latest) : null;
        }

        await transaction.playbackQueueItem.deleteMany({
            where: {
                queueId: queue.id,
                id: { notIn: availableItems.map(item => item.id) }
            }
        });

        for (const [order, item] of availableItems.entries()) {
            await transaction.playbackQueueItem.update({
                where: { id: item.id },
                data: {
                    order,
                    sourceOrder: queue.shuffle
                        ? sourceOrderByItemId.get(item.id) ?? order
                        : null
                }
            });
        }

        const repaired = await transaction.playbackQueue.findUniqueOrThrow({
            where: { id: queue.id },
            include: queueInclude
        });

        return toSnapshot(repaired);
    });
};

export const savePlaybackQueue = async (
    input: SavePlaybackQueueInput
): Promise<PlaybackQueueSaveResult> => {
    const normalized = validateInput(input);
    const activeMusicCount = await models.music.count({
        where: {
            id: { in: normalized.musicIds },
            syncStatus: TRACK_SYNC_STATUS.active
        }
    });

    if (activeMusicCount !== normalized.musicIds.length) {
        throw new PlaybackQueueServiceError(
            'Playback queue contains music that does not exist or is unavailable.',
            'PLAYBACK_QUEUE_MUSIC_NOT_FOUND'
        );
    }

    const sourceOrderByMusicId = new Map(
        normalized.sourceMusicIds.map((musicId, index) => [musicId, index])
    );
    const items = normalized.musicIds.map((musicId, order) => ({
        musicId,
        order,
        sourceOrder: normalized.shuffle
            ? sourceOrderByMusicId.get(musicId) ?? order
            : null
    }));

    try {
        return await models.$transaction(async (transaction) => {
            const session = await transaction.playbackSession.upsert({
                where: { scopeKey: PLAYBACK_SCOPE_KEY },
                create: { scopeKey: PLAYBACK_SCOPE_KEY },
                update: {}
            });
            const claim = await transaction.playbackQueue.updateMany({
                where: {
                    sessionId: session.id,
                    revision: normalized.expectedRevision
                },
                data: {
                    currentIndex: normalized.currentIndex,
                    contextType: normalized.contextType,
                    contextId: normalized.contextId,
                    contextTitle: normalized.contextTitle,
                    shuffle: normalized.shuffle,
                    repeatMode: normalized.repeatMode,
                    revision: { increment: 1 }
                }
            });

            if (claim.count === 1) {
                const claimed = await transaction.playbackQueue.findUniqueOrThrow({
                    where: { sessionId: session.id },
                    select: { id: true }
                });
                await transaction.playbackQueueItem.deleteMany({
                    where: { queueId: claimed.id }
                });
                if (items.length > 0) {
                    await transaction.playbackQueueItem.createMany({
                        data: items.map(item => ({
                            ...item,
                            queueId: claimed.id
                        }))
                    });
                }
                const updated = await transaction.playbackQueue.findUniqueOrThrow({
                    where: { id: claimed.id },
                    include: queueInclude
                });

                return {
                    type: 'accepted',
                    queue: toSnapshot(updated),
                    conflict: null,
                    changed: true
                };
            }

            const current = await transaction.playbackQueue.findUnique({
                where: { sessionId: session.id },
                include: queueInclude
            });

            if (current) {
                return conflictResult(current);
            }
            if (normalized.expectedRevision !== 0) {
                throw new PlaybackQueueServiceError(
                    'Playback queue revision is stale because no server queue exists.',
                    'STALE_PLAYBACK_QUEUE_REVISION'
                );
            }

            const created = await transaction.playbackQueue.create({
                data: {
                    sessionId: session.id,
                    currentIndex: normalized.currentIndex,
                    contextType: normalized.contextType,
                    contextId: normalized.contextId,
                    contextTitle: normalized.contextTitle,
                    shuffle: normalized.shuffle,
                    repeatMode: normalized.repeatMode,
                    revision: 1,
                    Item: { create: items }
                },
                include: queueInclude
            });

            return {
                type: 'accepted',
                queue: toSnapshot(created),
                conflict: null,
                changed: true
            };
        });
    } catch (error) {
        if (!isUniqueConstraintError(error) || normalized.expectedRevision !== 0) {
            throw error;
        }

        const current = await models.playbackQueue.findFirst({
            where: { Session: { scopeKey: PLAYBACK_SCOPE_KEY } },
            include: queueInclude
        });

        if (!current) {
            throw error;
        }
        return conflictResult(current);
    }
};
