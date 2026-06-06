import { Prisma } from '@prisma/client';

import models from '~/models';

const PLAY_COUNT_MIN_MS = 30_000;
const SHORT_TRACK_COUNT_THRESHOLD = 0.5;

export interface PlaybackRecordInput {
    id?: string;
    playedMs?: number;
    completionRate?: number;
    startedAt?: string;
    source?: string;
    clientSessionId?: string;
    connectorId?: string | null;
}

export interface PlaybackRecordResult {
    id: string;
    playCount: number;
    lastPlayedAt: string | null;
    totalPlayedMs: number;
    countedAsPlay: boolean;
    deduped: boolean;
}

const clamp = (value: number, min: number, max: number) => {
    return Math.min(Math.max(value, min), max);
};

const shouldCountAsPlay = ({
    durationSeconds,
    playedMs
}: {
    durationSeconds: number;
    playedMs: number;
}) => {
    const durationMs = Math.max(durationSeconds * 1000, 0);
    const minimumMeaningfulPlayMs = Math.min(
        PLAY_COUNT_MIN_MS,
        durationMs * SHORT_TRACK_COUNT_THRESHOLD
    );

    return playedMs >= minimumMeaningfulPlayMs;
};

const readExistingPlaybackEventResult = async (
    clientSessionId: string
): Promise<PlaybackRecordResult | null> => {
    const existingEvent = await models.playbackEvent.findUnique({
        where: { clientSessionId },
        include: {
            Music: {
                select: {
                    id: true,
                    playCount: true,
                    lastPlayedAt: true,
                    totalPlayedMs: true
                }
            }
        }
    });

    if (!existingEvent) {
        return null;
    }

    return {
        id: existingEvent.Music.id.toString(),
        playCount: existingEvent.Music.playCount,
        lastPlayedAt: existingEvent.Music.lastPlayedAt?.toISOString() ?? null,
        totalPlayedMs: existingEvent.Music.totalPlayedMs,
        countedAsPlay: existingEvent.countedAsPlay,
        deduped: true
    };
};

const isUniqueConstraintError = (error: unknown) => {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
};

export const recordPlayback = async ({
    id = '',
    playedMs = 0,
    completionRate,
    startedAt,
    source = 'queue',
    clientSessionId,
    connectorId = null
}: PlaybackRecordInput): Promise<PlaybackRecordResult | null> => {
    if (!id) {
        return null;
    }

    const music = await models.music.findUnique({ where: { id: parseInt(id) } });

    if (!music) {
        return null;
    }

    if (clientSessionId) {
        const existingEvent = await readExistingPlaybackEventResult(clientSessionId);

        if (existingEvent) {
            return existingEvent;
        }
    }

    const endedAt = new Date();
    const requestedStartedAt = startedAt ? new Date(startedAt) : null;
    const validStartedAtMs =
        requestedStartedAt && !Number.isNaN(requestedStartedAt.getTime())
            ? requestedStartedAt.getTime()
            : null;
    const resolvedStartedAt =
        validStartedAtMs !== null
            ? new Date(Math.min(validStartedAtMs, endedAt.getTime()))
            : new Date(endedAt.getTime() - Math.max(playedMs, 0));
    const elapsedWallClockMs = Math.max(
        endedAt.getTime() - resolvedStartedAt.getTime(),
        0
    );
    const maxPlayedMs =
        validStartedAtMs !== null
            ? elapsedWallClockMs
            : Math.max(music.duration * 1000, PLAY_COUNT_MIN_MS);
    const normalizedPlayedMs = clamp(playedMs, 0, maxPlayedMs);

    if (normalizedPlayedMs <= 0) {
        return null;
    }

    const normalizedCompletionRate = clamp(
        completionRate ?? normalizedPlayedMs / Math.max(music.duration * 1000, 1),
        0,
        1
    );
    const countedAsPlay = shouldCountAsPlay({
        durationSeconds: music.duration,
        playedMs: normalizedPlayedMs
    });
    try {
        const updatedMusic = await models.$transaction(async (tx) => {
            await tx.playbackEvent.create({
                data: {
                    musicId: music.id,
                    startedAt: resolvedStartedAt,
                    endedAt,
                    playedMs: normalizedPlayedMs,
                    completionRate: normalizedCompletionRate,
                    countedAsPlay,
                    source,
                    clientSessionId: clientSessionId ?? undefined,
                    connectorId: connectorId ?? undefined
                }
            });

            return tx.music.update({
                where: { id: music.id },
                data: {
                    playCount: countedAsPlay
                        ? { increment: 1 }
                        : undefined,
                    lastPlayedAt: endedAt,
                    totalPlayedMs: { increment: normalizedPlayedMs }
                },
                select: {
                    id: true,
                    playCount: true,
                    lastPlayedAt: true,
                    totalPlayedMs: true
                }
            });
        });

        return {
            id: updatedMusic.id.toString(),
            playCount: updatedMusic.playCount,
            lastPlayedAt: endedAt.toISOString(),
            totalPlayedMs: updatedMusic.totalPlayedMs,
            countedAsPlay,
            deduped: false
        };
    } catch (error) {
        if (clientSessionId && isUniqueConstraintError(error)) {
            const existingEvent = await readExistingPlaybackEventResult(clientSessionId);

            if (existingEvent) {
                return existingEvent;
            }
        }

        throw error;
    }
};
