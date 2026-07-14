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

interface PlaybackQueueRecord {
    id: number;
    currentIndex: number | null;
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
    shuffle: boolean;
    repeatMode: PlaybackQueueRepeatMode;
    revision: number;
    updatedAt: string;
}

export interface SavePlaybackQueueInput {
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex?: number | null;
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

        const repaired = await transaction.playbackQueue.update({
            where: { id: queue.id },
            data: {
                currentIndex,
                revision: { increment: 1 }
            },
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

    return models.$transaction(async (transaction) => {
        const session = await transaction.playbackSession.upsert({
            where: { scopeKey: PLAYBACK_SCOPE_KEY },
            create: { scopeKey: PLAYBACK_SCOPE_KEY },
            update: {}
        });
        const current = await transaction.playbackQueue.findUnique({
            where: { sessionId: session.id },
            include: queueInclude
        });

        if (current && current.revision !== normalized.expectedRevision) {
            const queue = toSnapshot(current);

            return {
                type: 'conflict',
                queue,
                conflict: { reason: 'stale-revision', queue },
                changed: false
            };
        }

        if (!current && normalized.expectedRevision !== 0) {
            throw new PlaybackQueueServiceError(
                'Playback queue revision is stale because no server queue exists.',
                'STALE_PLAYBACK_QUEUE_REVISION'
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

        if (current) {
            await transaction.playbackQueueItem.deleteMany({
                where: { queueId: current.id }
            });
            const updated = await transaction.playbackQueue.update({
                where: { id: current.id },
                data: {
                    currentIndex: normalized.currentIndex,
                    shuffle: normalized.shuffle,
                    repeatMode: normalized.repeatMode,
                    revision: { increment: 1 },
                    Item: { create: items }
                },
                include: queueInclude
            });

            return {
                type: 'accepted',
                queue: toSnapshot(updated),
                conflict: null,
                changed: true
            };
        }

        const created = await transaction.playbackQueue.create({
            data: {
                sessionId: session.id,
                currentIndex: normalized.currentIndex,
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
};
