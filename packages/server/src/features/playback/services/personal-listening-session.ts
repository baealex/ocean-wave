import { Prisma } from '@prisma/client';

import { TAG_SCOPE_KEY } from '~/features/tag/services/normalization';
import models from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

import {
    type PlaybackQueueSaveResult,
    savePlaybackQueueWithTransaction
} from './playback-queue';
import { PLAYBACK_SCOPE_KEY } from './playback-session';
import {
    PERSONAL_LISTENING_SESSION_RECENT_REPEAT_DAYS,
    type PersonalListeningSessionReasonCode,
    type PersonalListeningSessionScope,
    type PersonalListeningSessionSmartViewInput,
    type PersonalListeningSessionTrackInput,
    rankPersonalListeningSession
} from './personal-listening-session-ranking';

export const PERSONAL_LISTENING_SESSION_LENGTHS = {
    short: 8,
    standard: 15,
    long: 25
} as const;

export type PersonalListeningSessionLength =
    keyof typeof PERSONAL_LISTENING_SESSION_LENGTHS;

export interface CreatePersonalListeningSessionInput {
    expectedRevision: number;
    expectedPlaybackSessionRevision: number;
    length: PersonalListeningSessionLength;
    requestingEndpointId: string;
    scope: PersonalListeningSessionScope;
    startMusicId: string;
}

export interface PersonalListeningSessionItem {
    musicId: string;
    reasonCodes: PersonalListeningSessionReasonCode[];
}

export interface PersonalListeningSessionResult {
    type: PlaybackQueueSaveResult['type'];
    queue: PlaybackQueueSaveResult['queue'];
    conflict: PlaybackQueueSaveResult['conflict'];
    items: PersonalListeningSessionItem[];
    changed: boolean;
    generatedAt: string;
}

export class PersonalListeningSessionServiceError extends Error {
    code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'PersonalListeningSessionServiceError';
        this.code = code;
    }
}

export const isPersonalListeningSessionServiceError = (
    error: unknown
): error is PersonalListeningSessionServiceError => (
    error instanceof PersonalListeningSessionServiceError
);

const parseInput = (input: CreatePersonalListeningSessionInput) => {
    const startMusicId = Number(input.startMusicId);
    const requestingEndpointId = input.requestingEndpointId?.trim();

    if (!Number.isInteger(startMusicId) || startMusicId <= 0) {
        throw new PersonalListeningSessionServiceError(
            'The session start track id must be a positive integer.',
            'INVALID_PERSONAL_LISTENING_SESSION_TRACK'
        );
    }
    if (!(input.length in PERSONAL_LISTENING_SESSION_LENGTHS)) {
        throw new PersonalListeningSessionServiceError(
            'The session length must be short, standard, or long.',
            'INVALID_PERSONAL_LISTENING_SESSION_LENGTH'
        );
    }
    if (input.scope !== 'focused' && input.scope !== 'explore') {
        throw new PersonalListeningSessionServiceError(
            'The session scope must be focused or explore.',
            'INVALID_PERSONAL_LISTENING_SESSION_SCOPE'
        );
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new PersonalListeningSessionServiceError(
            'Expected queue revision must be a non-negative integer.',
            'INVALID_PERSONAL_LISTENING_SESSION_REVISION'
        );
    }
    if (
        !Number.isInteger(input.expectedPlaybackSessionRevision)
        || input.expectedPlaybackSessionRevision < 0
    ) {
        throw new PersonalListeningSessionServiceError(
            'Expected playback session revision must be a non-negative integer.',
            'INVALID_PERSONAL_LISTENING_SESSION_PLAYBACK_REVISION'
        );
    }
    if (!requestingEndpointId || requestingEndpointId.length > 512) {
        throw new PersonalListeningSessionServiceError(
            'A current playback endpoint is required to create a listening session.',
            'INVALID_PERSONAL_LISTENING_SESSION_ENDPOINT'
        );
    }

    return {
        expectedPlaybackSessionRevision: input.expectedPlaybackSessionRevision,
        expectedRevision: input.expectedRevision,
        length: input.length,
        limit: PERSONAL_LISTENING_SESSION_LENGTHS[input.length],
        scope: input.scope,
        requestingEndpointId,
        startMusicId
    };
};

interface PersonalListeningSessionTrackRow {
    id: number;
    albumId: number;
    artistId: number;
    completionCount: number;
    lastPlayedAt: Date | null;
    playCount: number;
    skipCount: number;
    Recording: {
        RecordingGenre: Array<{ genreId: number }>;
        MusicLike: { id: number } | null;
        MusicTag: Array<{ tagId: number }>;
    };
}

const toTrackInput = (
    track: PersonalListeningSessionTrackRow
): PersonalListeningSessionTrackInput => ({
    albumId: track.albumId,
    artistId: track.artistId,
    completionCount: track.completionCount,
    genreIds: track.Recording.RecordingGenre.map(genre => genre.genreId),
    id: track.id,
    isLiked: track.Recording.MusicLike !== null,
    lastPlayedAtMs: track.lastPlayedAt?.getTime() ?? null,
    playCount: track.playCount,
    skipCount: track.skipCount,
    tagIds: track.Recording.MusicTag.map(musicTag => musicTag.tagId)
});

const trackSelect = {
    id: true,
    albumId: true,
    artistId: true,
    completionCount: true,
    lastPlayedAt: true,
    playCount: true,
    skipCount: true,
    Recording: {
        select: {
            RecordingGenre: { select: { genreId: true } },
            MusicLike: { select: { id: true } },
            MusicTag: { select: { tagId: true } }
        }
    }
} as const;

const matchesView = (tagIds: number[], view: PersonalListeningSessionSmartViewInput) => {
    const tags = new Set(tagIds);
    return view.tagMode === 'all'
        ? view.tagIds.length > 0 && view.tagIds.every(tagId => tags.has(tagId))
        : view.tagIds.some(tagId => tags.has(tagId));
};

const candidatePageSizeFor = (limit: number) => Math.min(
    Math.max(limit * 16, 96),
    400
);

const isUniqueConstraintError = (error: unknown) => (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === 'P2002'
);

export const createPersonalListeningSession = async (
    input: CreatePersonalListeningSessionInput,
    {
        database = models,
        now = new Date()
    }: {
        database?: typeof models;
        now?: Date;
    } = {}
): Promise<PersonalListeningSessionResult> => {
    const parsed = parseInput(input);
    const nowMs = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
    const generatedAt = new Date(nowMs).toISOString();
    const run = () => database.$transaction(async (transaction) => {
        const playbackSession = await transaction.playbackSession.findUnique({
            where: { scopeKey: PLAYBACK_SCOPE_KEY },
            select: {
                id: true,
                activeDeviceId: true,
                revision: true
            }
        });
        const playbackSessionRevision = playbackSession?.revision ?? 0;

        if (playbackSessionRevision !== parsed.expectedPlaybackSessionRevision) {
            throw new PersonalListeningSessionServiceError(
                'Shared playback changed before this listening session could be saved.',
                'STALE_PERSONAL_LISTENING_SESSION_PLAYBACK'
            );
        }
        if (
            playbackSession?.activeDeviceId
            && playbackSession.activeDeviceId !== parsed.requestingEndpointId
        ) {
            throw new PersonalListeningSessionServiceError(
                'Playback is active in another browser. Use Play Here before starting a local session.',
                'PERSONAL_LISTENING_SESSION_REMOTE_PLAYBACK'
            );
        }

        const seedRow = await transaction.music.findFirst({
            where: {
                id: parsed.startMusicId,
                syncStatus: TRACK_SYNC_STATUS.active,
                Recording: { MusicHate: null }
            },
            select: trackSelect
        });

        if (!seedRow) {
            throw new PersonalListeningSessionServiceError(
                'The session start track does not exist or is unavailable.',
                'PERSONAL_LISTENING_SESSION_TRACK_NOT_FOUND'
            );
        }

        const seed = toTrackInput(seedRow);
        const viewRows = await transaction.smartView.findMany({
            where: { scopeKey: TAG_SCOPE_KEY },
            orderBy: { id: 'asc' },
            select: {
                id: true,
                tagMode: true,
                SmartViewTag: {
                    orderBy: { order: 'asc' },
                    select: { tagId: true }
                }
            }
        });
        const smartViews: PersonalListeningSessionSmartViewInput[] = viewRows.flatMap(
            (view) => (view.tagMode === 'all' || view.tagMode === 'any') ? [{
                id: view.id,
                tagIds: view.SmartViewTag.map(viewTag => viewTag.tagId),
                tagMode: view.tagMode
            }] : []
        );
        const seedViewTagIds = smartViews
            .filter(view => matchesView(seed.tagIds, view))
            .flatMap(view => view.tagIds);
        const relatedTagIds = [...new Set([...seed.tagIds, ...seedViewTagIds])];
        const queue = await transaction.playbackQueue.findFirst({
            where: { Session: { scopeKey: PLAYBACK_SCOPE_KEY } },
            select: {
                Item: { select: { musicId: true } }
            }
        });
        const existingQueueMusicIds = queue?.Item.map(item => item.musicId) ?? [];
        const relationships: Prisma.MusicWhereInput[] = [
            { albumId: seed.albumId },
            { artistId: seed.artistId },
            ...(seed.genreIds.length > 0 ? [{
                Recording: {
                    RecordingGenre: { some: { genreId: { in: seed.genreIds } } }
                }
            }] : []),
            ...(relatedTagIds.length > 0 ? [{
                Recording: {
                    MusicTag: { some: { tagId: { in: relatedTagIds } } }
                }
            }] : [])
        ];
        const recentRepeatCutoff = new Date(
            nowMs - PERSONAL_LISTENING_SESSION_RECENT_REPEAT_DAYS * 24 * 60 * 60 * 1_000
        );
        const candidatePageSize = candidatePageSizeFor(parsed.limit);
        const candidates: PersonalListeningSessionTrackInput[] = [];
        let candidateCursorId: number | null = null;
        let rankedItems = rankPersonalListeningSession({
            candidates,
            existingQueueMusicIds,
            limit: parsed.limit,
            nowMs,
            scope: parsed.scope,
            seed,
            smartViews
        });

        while (rankedItems.length < parsed.limit) {
            const page: PersonalListeningSessionTrackRow[] = await transaction.music.findMany({
                where: {
                    id: { not: seed.id },
                    syncStatus: TRACK_SYNC_STATUS.active,
                    Recording: { MusicHate: null },
                    AND: [
                        { OR: relationships },
                        {
                            OR: [
                                { lastPlayedAt: null },
                                { lastPlayedAt: { lte: recentRepeatCutoff } }
                            ]
                        }
                    ]
                },
                orderBy: { id: 'asc' },
                select: trackSelect,
                take: candidatePageSize,
                ...(candidateCursorId === null ? {} : {
                    cursor: { id: candidateCursorId },
                    skip: 1
                })
            });

            candidates.push(...page.map(toTrackInput));
            rankedItems = rankPersonalListeningSession({
                candidates,
                existingQueueMusicIds,
                limit: parsed.limit,
                nowMs,
                scope: parsed.scope,
                seed,
                smartViews
            });

            if (page.length < candidatePageSize) {
                break;
            }
            candidateCursorId = page[page.length - 1]?.id ?? null;
            if (candidateCursorId === null) {
                break;
            }
        }

        if (playbackSession) {
            const playbackFence = await transaction.playbackSession.updateMany({
                where: {
                    id: playbackSession.id,
                    revision: parsed.expectedPlaybackSessionRevision,
                    OR: [
                        { activeDeviceId: null },
                        { activeDeviceId: parsed.requestingEndpointId }
                    ]
                },
                data: { revision: { increment: 0 } }
            });

            if (playbackFence.count !== 1) {
                throw new PersonalListeningSessionServiceError(
                    'Shared playback changed before this listening session could be saved.',
                    'STALE_PERSONAL_LISTENING_SESSION_PLAYBACK'
                );
            }
        }

        const queueResult = await savePlaybackQueueWithTransaction(transaction, {
            musicIds: rankedItems.map(item => item.musicId.toString()),
            sourceMusicIds: [],
            currentIndex: 0,
            contextType: 'queue',
            contextId: null,
            contextTitle: null,
            shuffle: false,
            repeatMode: 'none',
            expectedRevision: parsed.expectedRevision
        });

        return {
            type: queueResult.type,
            queue: queueResult.queue,
            conflict: queueResult.conflict,
            items: rankedItems.map(item => ({
                musicId: item.musicId.toString(),
                reasonCodes: item.reasonCodes
            })),
            changed: queueResult.changed,
            generatedAt
        };
    });

    try {
        return await run();
    } catch (error) {
        if (!isUniqueConstraintError(error) || parsed.expectedRevision !== 0) {
            throw error;
        }

        return run();
    }
};
