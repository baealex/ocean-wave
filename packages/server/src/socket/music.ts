import type { Socket } from 'socket.io';

import models from '~/models';
import {
    setMusicHated,
    setMusicLiked,
    toggleMusicHated,
    toggleMusicLiked
} from '~/features/music/services/preferences';

import { connectors } from './connectors';

export const MUSIC_LIKE = 'music-like';
export const MUSIC_HATE = 'music-hate';
export const MUSIC_COUNT = 'music-count';

const PLAY_COUNT_MIN_MS = 30_000;
const SHORT_TRACK_COUNT_THRESHOLD = 0.5;

interface CountPayload {
    id?: string;
    playedMs?: number;
    completionRate?: number;
    startedAt?: string;
    source?: string;
    clientSessionId?: string;
    connectorId?: string | null;
}

interface CountResult {
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

export const musicListener = (socket: Socket) => {
    socket.on(MUSIC_LIKE, like);
    socket.on(MUSIC_HATE, hate);
    socket.on(MUSIC_COUNT, async (
        payload: CountPayload,
        ack?: (response: { ok: boolean }) => void
    ) => {
        const result = await count({
            ...payload,
            connectorId: socket.id
        });

        ack?.({ ok: result !== null });
    });
};

export const like = async ({ id = '', isLiked }: { id?: string; isLiked?: boolean }) => {
    if (!id) {
        return;
    }

    try {
        const result = typeof isLiked === 'boolean'
            ? await setMusicLiked({ id, isLiked })
            : await toggleMusicLiked({ id });

        connectors.broadcast(MUSIC_LIKE, result);
    } catch (error) {
        console.error(error);
    }
};

export const hate = async ({ id = '', isHated }: { id?: string; isHated?: boolean }) => {
    if (!id) {
        return;
    }

    try {
        const result = typeof isHated === 'boolean'
            ? await setMusicHated({ id, isHated })
            : await toggleMusicHated({ id });

        connectors.broadcast(MUSIC_HATE, result);
    } catch (error) {
        console.error(error);
    }
};

export const count = async ({
    id = '',
    playedMs = 0,
    completionRate,
    startedAt,
    source = 'queue',
    clientSessionId,
    connectorId = null
}: CountPayload): Promise<CountResult | null> => {
    if (!id) {
        return null;
    }

    const $music = await models.music.findUnique({ where: { id: parseInt(id) } });

    if ($music) {
        if (clientSessionId) {
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

            if (existingEvent) {
                return {
                    id: existingEvent.Music.id.toString(),
                    playCount: existingEvent.Music.playCount,
                    lastPlayedAt: existingEvent.Music.lastPlayedAt?.toISOString() ?? null,
                    totalPlayedMs: existingEvent.Music.totalPlayedMs,
                    countedAsPlay: existingEvent.countedAsPlay,
                    deduped: true
                };
            }
        }

        const endedAt = new Date();
        const requestedStartedAt = startedAt ? new Date(startedAt) : null;
        const validStartedAtMs = requestedStartedAt && !Number.isNaN(requestedStartedAt.getTime())
            ? requestedStartedAt.getTime()
            : null;
        const resolvedStartedAt = validStartedAtMs !== null
            ? new Date(Math.min(validStartedAtMs, endedAt.getTime()))
            : new Date(endedAt.getTime() - Math.max(playedMs, 0));
        const elapsedWallClockMs = Math.max(
            endedAt.getTime() - resolvedStartedAt.getTime(),
            0
        );
        const maxPlayedMs = validStartedAtMs !== null
            ? elapsedWallClockMs
            : Math.max($music.duration * 1000, PLAY_COUNT_MIN_MS);
        const normalizedPlayedMs = clamp(playedMs, 0, maxPlayedMs);

        if (normalizedPlayedMs <= 0) {
            return null;
        }

        const normalizedCompletionRate = clamp(
            completionRate ?? normalizedPlayedMs / Math.max($music.duration * 1000, 1),
            0,
            1
        );
        const countedAsPlay = shouldCountAsPlay({
            durationSeconds: $music.duration,
            playedMs: normalizedPlayedMs
        });
        const updatedMusic = await models.$transaction(async (tx) => {
            await tx.playbackEvent.create({
                data: {
                    musicId: $music.id,
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
                where: { id: $music.id },
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

        const result = {
            id: updatedMusic.id.toString(),
            playCount: updatedMusic.playCount,
            lastPlayedAt: endedAt.toISOString(),
            totalPlayedMs: updatedMusic.totalPlayedMs,
            countedAsPlay,
            deduped: false
        } satisfies CountResult;

        await connectors.broadcast(MUSIC_COUNT, result);

        return result;
    }

    return null;
};
