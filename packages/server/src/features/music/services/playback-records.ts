import { Prisma } from '@prisma/client';

import models, {
    type Music,
    type PlaybackEvent,
    type PlaybackEventBranch
} from '~/models';
import { resolvePlayableReleaseTrack } from '~/modules/physical-file-selection';

export const PLAY_COUNT_MIN_MS = 30_000;
export const SHORT_TRACK_COUNT_THRESHOLD = 0.5;
export const PLAYBACK_COMPLETE_THRESHOLD = 0.9;

export const PLAYBACK_END_REASONS = {
    ended: 'ended',
    skipped: 'skipped',
    stopped: 'stopped',
    handoff: 'handoff',
    unload: 'unload',
    recovery: 'recovery',
    legacy: 'legacy'
} as const;

export type PlaybackEndReason = typeof PLAYBACK_END_REASONS[
    keyof typeof PLAYBACK_END_REASONS
];

export const PLAYBACK_OUTCOMES = {
    listen: 'listen',
    skip: 'skip',
    complete: 'complete',
    legacy: 'legacy'
} as const;

export type PlaybackOutcome = typeof PLAYBACK_OUTCOMES[
    keyof typeof PLAYBACK_OUTCOMES
];

const TERMINAL_COMPLETION_REASONS = new Set<PlaybackEndReason>([
    PLAYBACK_END_REASONS.ended,
    PLAYBACK_END_REASONS.skipped,
    PLAYBACK_END_REASONS.stopped
]);

export interface PlaybackRecordInput {
    id?: string;
    playedMs?: number;
    completionRate?: number;
    startedAt?: string;
    endedAt?: string;
    endReason?: PlaybackEndReason;
    hadSeek?: boolean;
    source?: string;
    clientSessionId?: string;
    branchId?: string;
    parentBranchId?: string | null;
    branchBasePlayedMs?: number;
    connectorId?: string | null;
}

export interface PlaybackRecordResult {
    id: string;
    playCount: number;
    lastPlayedAt: string | null;
    totalPlayedMs: number;
    skipCount: number;
    lastSkippedAt: string | null;
    completionCount: number;
    lastCompletedAt: string | null;
    countedAsPlay: boolean;
    completionRate: number;
    outcome: PlaybackOutcome;
    deduped: boolean;
}

interface NormalizedPlaybackRecord {
    music: Music;
    physicalFileId: number;
    durationSeconds: number;
    playedMs: number;
    startedAt: Date;
    endedAt: Date;
    endReason: PlaybackEndReason;
    hadSeek: boolean;
    source: string;
    clientSessionId: string | null;
    branch: {
        branchId: string;
        parentBranchId: string | null;
        basePlayedMs: number;
    } | null;
    connectorId: string | null;
}

const clamp = (value: number, min: number, max: number) => {
    return Math.min(Math.max(value, min), max);
};

const toCompletionRate = (durationSeconds: number, playedMs: number) => {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return 0;
    }

    const durationMs = durationSeconds * 1_000;
    return clamp(playedMs / durationMs, 0, 1);
};

export const shouldCountAsPlay = ({
    durationSeconds,
    playedMs
}: {
    durationSeconds: number;
    playedMs: number;
}) => {
    const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds * 1_000
        : 0;
    const minimumMeaningfulPlayMs = durationMs > 0
        ? Math.min(
            PLAY_COUNT_MIN_MS,
            durationMs * SHORT_TRACK_COUNT_THRESHOLD
        )
        : PLAY_COUNT_MIN_MS;

    return playedMs >= minimumMeaningfulPlayMs;
};

export const classifyPlaybackOutcome = ({
    durationSeconds,
    playedMs,
    endReason
}: {
    durationSeconds: number;
    playedMs: number;
    endReason: PlaybackEndReason;
}): PlaybackOutcome => {
    if (endReason === PLAYBACK_END_REASONS.legacy) {
        return PLAYBACK_OUTCOMES.legacy;
    }

    const completionRate = toCompletionRate(durationSeconds, playedMs);
    if (
        TERMINAL_COMPLETION_REASONS.has(endReason)
        && completionRate >= PLAYBACK_COMPLETE_THRESHOLD
    ) {
        return PLAYBACK_OUTCOMES.complete;
    }

    if (endReason === PLAYBACK_END_REASONS.skipped) {
        return PLAYBACK_OUTCOMES.skip;
    }

    return PLAYBACK_OUTCOMES.listen;
};

const isPlaybackEndReason = (value: unknown): value is PlaybackEndReason => {
    return typeof value === 'string'
        && Object.values(PLAYBACK_END_REASONS).includes(value as PlaybackEndReason);
};

const normalizeOpaqueId = (value: string | undefined) => {
    const normalized = value?.trim() ?? '';
    return normalized && normalized.length <= 128 ? normalized : null;
};

const normalizeBranch = (
    input: PlaybackRecordInput,
    clientSessionId: string | null
) => {
    if (!clientSessionId) {
        if (
            input.branchId !== undefined
            || input.parentBranchId !== undefined
            || input.branchBasePlayedMs !== undefined
        ) {
            throw new Error(
                'Playback branch metadata requires a playback session identity.'
            );
        }
        return null;
    }

    const branchId = normalizeOpaqueId(input.branchId ?? clientSessionId);
    const parentBranchId = input.parentBranchId === undefined
        || input.parentBranchId === null
        ? null
        : normalizeOpaqueId(input.parentBranchId);
    const basePlayedMs = input.branchBasePlayedMs ?? 0;
    if (
        !branchId
        || (
            input.parentBranchId !== undefined
            && input.parentBranchId !== null
            && !parentBranchId
        )
        || parentBranchId === branchId
        || (parentBranchId !== null && parentBranchId !== clientSessionId)
        || !Number.isSafeInteger(basePlayedMs)
        || basePlayedMs < 0
        || (parentBranchId === null && basePlayedMs !== 0)
        || (parentBranchId === null && branchId !== clientSessionId)
    ) {
        throw new Error('Playback branch metadata is invalid.');
    }

    return { branchId, parentBranchId, basePlayedMs };
};

const normalizeRecord = async (
    input: PlaybackRecordInput,
    serverTime: Date,
    existing: PlaybackEvent | null,
    clientSessionId: string | null,
    branch: ReturnType<typeof normalizeBranch>
): Promise<NormalizedPlaybackRecord | null> => {
    const musicId = Number(input.id);
    if (!Number.isInteger(musicId) || musicId <= 0) {
        return null;
    }

    const music = await models.music.findUnique({ where: { id: musicId } });
    if (!music) {
        return null;
    }

    if (existing && existing.releaseTrackId !== music.releaseTrackId) {
        throw new Error('Playback session identity belongs to another track.');
    }

    const existingPhysicalFile = existing?.physicalFileId
        ? await models.physicalFile.findFirst({
            where: {
                id: existing.physicalFileId,
                releaseTrackId: music.releaseTrackId
            },
            select: { id: true, durationMs: true }
        })
        : null;
    const playable = existingPhysicalFile
        ? {
            physicalFileId: existingPhysicalFile.id,
            duration: existingPhysicalFile.durationMs / 1_000
        }
        : await resolvePlayableReleaseTrack(music.releaseTrackId);
    if (!playable) return null;

    const requestedPlayedMs = Number.isFinite(input.playedMs)
        ? Math.round(Number(input.playedMs))
        : 0;
    const endReason = isPlaybackEndReason(input.endReason)
        ? input.endReason
        : PLAYBACK_END_REASONS.legacy;
    const requestedNonNegativePlayedMs = Math.max(requestedPlayedMs, 0);
    const durationMs = Number.isFinite(playable.duration) && playable.duration > 0
        ? Math.round(playable.duration * 1_000)
        : null;
    const maximumUnseekedPlayedMs = durationMs === null
        ? requestedNonNegativePlayedMs
        : (branch?.basePlayedMs ?? 0) + durationMs;
    const playedMs = input.hadSeek === true
        ? requestedNonNegativePlayedMs
        : Math.min(requestedNonNegativePlayedMs, maximumUnseekedPlayedMs);

    if (branch && playedMs < branch.basePlayedMs) {
        throw new Error('Playback branch progress precedes its baseline.');
    }
    const isImmediateSkip = input.playedMs === 0
        && endReason === PLAYBACK_END_REASONS.skipped;
    if (playedMs <= 0 && !isImmediateSkip) {
        return null;
    }

    // Client timestamps remain protocol-compatible diagnostics only. Aggregate
    // recency is anchored to server time so clock skew across handoff devices
    // cannot erase or backdate a listen.
    const endedAt = serverTime;
    const startedAt = new Date(serverTime.getTime() - playedMs);

    return {
        music,
        physicalFileId: playable.physicalFileId,
        durationSeconds: playable.duration,
        playedMs,
        startedAt,
        endedAt,
        endReason,
        hadSeek: input.hadSeek === true,
        source: input.source?.trim() || 'queue',
        clientSessionId,
        branch,
        connectorId: normalizeOpaqueId(input.connectorId ?? undefined)
    };
};

type PlaybackBranchState = Pick<PlaybackEventBranch,
    | 'branchId'
    | 'parentBranchId'
    | 'basePlayedMs'
    | 'reportedPlayedMs'>;

const calculateBranchedPlayedMs = (branches: PlaybackBranchState[]) => {
    const byId = new Map(branches.map(branch => [branch.branchId, branch]));

    for (const branch of branches) {
        const visited = new Set<string>();
        let current: PlaybackBranchState | undefined = branch;
        while (current) {
            if (visited.has(current.branchId)) {
                throw new Error('Playback branch lineage contains a cycle.');
            }
            visited.add(current.branchId);
            current = current.parentBranchId
                ? byId.get(current.parentBranchId)
                : undefined;
        }
    }

    const minimumChildBaselines = new Map<string, number>();
    let totalPlayedMs = 0;
    for (const branch of branches) {
        totalPlayedMs += Math.max(
            branch.reportedPlayedMs - branch.basePlayedMs,
            0
        );
        if (branch.parentBranchId) {
            minimumChildBaselines.set(
                branch.parentBranchId,
                minimumChildBaselines.has(branch.parentBranchId)
                    ? Math.min(
                        minimumChildBaselines.get(branch.parentBranchId)!,
                        branch.basePlayedMs
                    )
                    : branch.basePlayedMs
            );
        } else if (!branch.parentBranchId) {
            totalPlayedMs += branch.basePlayedMs;
        }
    }

    for (const [parentBranchId, baseline] of minimumChildBaselines) {
        const parentReportedPlayedMs = byId.get(parentBranchId)?.reportedPlayedMs
            ?? 0;
        totalPlayedMs += Math.max(baseline - parentReportedPlayedMs, 0);
    }

    const greatestCumulativeReport = branches.reduce(
        (greatest, branch) => Math.max(greatest, branch.reportedPlayedMs),
        0
    );
    return Math.min(
        Math.round(Math.max(totalPlayedMs, greatestCumulativeReport)),
        Number.MAX_SAFE_INTEGER
    );
};

const isTerminalOutcome = (outcome: string) => {
    return outcome === PLAYBACK_OUTCOMES.skip
        || outcome === PLAYBACK_OUTCOMES.complete;
};

const isTerminalEndReason = (endReason: string) => {
    return TERMINAL_COMPLETION_REASONS.has(endReason as PlaybackEndReason);
};

const mergeOutcome = (
    current: string,
    incoming: PlaybackOutcome
): PlaybackOutcome => {
    if (isTerminalOutcome(current)) {
        return current as PlaybackOutcome;
    }

    if (isTerminalOutcome(incoming)) {
        return incoming;
    }

    if (current === PLAYBACK_OUTCOMES.listen || incoming === PLAYBACK_OUTCOMES.listen) {
        return PLAYBACK_OUTCOMES.listen;
    }

    return PLAYBACK_OUTCOMES.legacy;
};

const latestDate = (current: Date | null, incoming: Date) => {
    return !current || incoming > current ? incoming : current;
};

const toResult = (
    music: Pick<Music,
        | 'id'
        | 'playCount'
        | 'lastPlayedAt'
        | 'totalPlayedMs'
        | 'skipCount'
        | 'lastSkippedAt'
        | 'completionCount'
        | 'lastCompletedAt'>,
    event: Pick<PlaybackEvent, 'countedAsPlay' | 'completionRate' | 'outcome'>,
    deduped: boolean
): PlaybackRecordResult => ({
    id: music.id.toString(),
    playCount: music.playCount,
    lastPlayedAt: music.lastPlayedAt?.toISOString() ?? null,
    totalPlayedMs: music.totalPlayedMs,
    skipCount: music.skipCount,
    lastSkippedAt: music.lastSkippedAt?.toISOString() ?? null,
    completionCount: music.completionCount,
    lastCompletedAt: music.lastCompletedAt?.toISOString() ?? null,
    countedAsPlay: event.countedAsPlay,
    completionRate: event.completionRate,
    outcome: event.outcome as PlaybackOutcome,
    deduped
});

const recordNormalizedPlayback = async (
    input: PlaybackRecordInput,
    serverTime: Date
): Promise<PlaybackRecordResult | null> => {
    const clientSessionId = normalizeOpaqueId(input.clientSessionId);
    if (
        input.clientSessionId !== undefined
        && input.clientSessionId !== null
        && clientSessionId === null
    ) {
        throw new Error(
            'Playback session identity must contain between 1 and 128 characters.'
        );
    }
    const branch = normalizeBranch(input, clientSessionId);
    const existingBeforeNormalization = clientSessionId
        ? await models.playbackEvent.findUnique({ where: { clientSessionId } })
        : null;
    const normalized = await normalizeRecord(
        input,
        serverTime,
        existingBeforeNormalization,
        clientSessionId,
        branch
    );
    if (!normalized) {
        return null;
    }

    return models.$transaction(async (transaction) => {
        const existing = normalized.clientSessionId
            ? await transaction.playbackEvent.findUnique({
                where: { clientSessionId: normalized.clientSessionId }
            })
            : null;
        if (existing && existing.releaseTrackId !== normalized.music.releaseTrackId) {
            throw new Error('Playback session identity belongs to another track.');
        }

        const music = await transaction.music.findUniqueOrThrow({
            where: { id: normalized.music.id }
        });

        if (!existing) {
            const completionRate = toCompletionRate(
                normalized.durationSeconds,
                normalized.playedMs
            );
            const countedAsPlay = shouldCountAsPlay({
                durationSeconds: normalized.durationSeconds,
                playedMs: normalized.playedMs
            });
            const outcome = classifyPlaybackOutcome({
                durationSeconds: normalized.durationSeconds,
                playedMs: normalized.playedMs,
                endReason: normalized.endReason
            });
            const event = await transaction.playbackEvent.create({
                data: {
                    musicId: music.recordingId,
                    releaseTrackId: music.releaseTrackId,
                    physicalFileId: normalized.physicalFileId,
                    startedAt: normalized.startedAt,
                    endedAt: normalized.endedAt,
                    playedMs: normalized.playedMs,
                    completionRate,
                    countedAsPlay,
                    outcome,
                    endReason: normalized.endReason,
                    hadSeek: normalized.hadSeek,
                    source: normalized.source,
                    clientSessionId: normalized.clientSessionId ?? undefined,
                    connectorId: normalized.connectorId ?? undefined,
                    Branch: normalized.branch ? {
                        create: {
                            branchId: normalized.branch.branchId,
                            parentBranchId: normalized.branch.parentBranchId,
                            basePlayedMs: normalized.branch.basePlayedMs,
                            reportedPlayedMs: normalized.playedMs
                        }
                    } : undefined
                }
            });
            const updatedRecording = await transaction.recording.update({
                where: { id: music.recordingId },
                data: {
                    playCount: countedAsPlay ? { increment: 1 } : undefined,
                    lastPlayedAt: latestDate(music.lastPlayedAt, normalized.endedAt),
                    totalPlayedMs: { increment: normalized.playedMs },
                    skipCount: outcome === PLAYBACK_OUTCOMES.skip
                        ? { increment: 1 }
                        : undefined,
                    lastSkippedAt: outcome === PLAYBACK_OUTCOMES.skip
                        ? latestDate(music.lastSkippedAt, normalized.endedAt)
                        : undefined,
                    completionCount: outcome === PLAYBACK_OUTCOMES.complete
                        ? { increment: 1 }
                        : undefined,
                    lastCompletedAt: outcome === PLAYBACK_OUTCOMES.complete
                        ? latestDate(music.lastCompletedAt, normalized.endedAt)
                        : undefined
                },
                select: {
                    playCount: true,
                    lastPlayedAt: true,
                    totalPlayedMs: true,
                    skipCount: true,
                    lastSkippedAt: true,
                    completionCount: true,
                    lastCompletedAt: true
                }
            });
            const updatedMusic = { id: music.id, ...updatedRecording };

            return toResult(updatedMusic, event, false);
        }

        if (normalized.branch) {
            const existingBranch = await transaction.playbackEventBranch.findUnique({
                where: {
                    playbackEventId_branchId: {
                        playbackEventId: existing.id,
                        branchId: normalized.branch.branchId
                    }
                }
            });
            if (
                existingBranch
                && (
                    existingBranch.parentBranchId
                        !== normalized.branch.parentBranchId
                    || existingBranch.basePlayedMs
                        !== normalized.branch.basePlayedMs
                )
            ) {
                throw new Error('Playback branch identity has conflicting metadata.');
            }

            if (existingBranch) {
                if (normalized.playedMs > existingBranch.reportedPlayedMs) {
                    await transaction.playbackEventBranch.update({
                        where: { id: existingBranch.id },
                        data: { reportedPlayedMs: normalized.playedMs }
                    });
                }
            } else {
                await transaction.playbackEventBranch.create({
                    data: {
                        playbackEventId: existing.id,
                        branchId: normalized.branch.branchId,
                        parentBranchId: normalized.branch.parentBranchId,
                        basePlayedMs: normalized.branch.basePlayedMs,
                        reportedPlayedMs: normalized.playedMs
                    }
                });
            }
        }

        const branches = normalized.clientSessionId
            ? await transaction.playbackEventBranch.findMany({
                where: { playbackEventId: existing.id }
            })
            : [];
        const playedMs = Math.max(
            existing.playedMs,
            normalized.playedMs,
            branches.length > 0
                ? calculateBranchedPlayedMs(branches)
                : normalized.playedMs
        );
        const playedDelta = playedMs - existing.playedMs;
        const completionRate = Math.max(
            existing.completionRate,
            toCompletionRate(normalized.durationSeconds, playedMs)
        );
        const countedAsPlay = existing.countedAsPlay || shouldCountAsPlay({
            durationSeconds: normalized.durationSeconds,
            playedMs
        });
        const incomingOutcome = classifyPlaybackOutcome({
            durationSeconds: normalized.durationSeconds,
            playedMs,
            endReason: normalized.endReason
        });
        const existingIsTerminal = isTerminalEndReason(existing.endReason);
        const outcome = existingIsTerminal
            ? isTerminalOutcome(existing.outcome)
                ? existing.outcome as PlaybackOutcome
                : classifyPlaybackOutcome({
                    durationSeconds: normalized.durationSeconds,
                    playedMs,
                    endReason: existing.endReason as PlaybackEndReason
                })
            : mergeOutcome(existing.outcome, incomingOutcome);
        const outcomeChanged = outcome !== existing.outcome;
        const countChanged = countedAsPlay !== existing.countedAsPlay;
        const seekChanged = normalized.hadSeek && !existing.hadSeek;
        const terminalReasonChanged = !existingIsTerminal
            && isTerminalEndReason(normalized.endReason);
        const aggregateChanged = playedDelta > 0 || outcomeChanged || countChanged;

        if (!aggregateChanged && !seekChanged && !terminalReasonChanged) {
            return toResult(music, existing, true);
        }

        const endedAt = normalized.endedAt > existing.endedAt
            ? normalized.endedAt
            : existing.endedAt;
        const startedAt = existing.startedAt;
        const event = await transaction.playbackEvent.update({
            where: { id: existing.id },
            data: {
                startedAt,
                endedAt,
                playedMs,
                completionRate,
                countedAsPlay,
                outcome,
                endReason: existingIsTerminal
                    ? existing.endReason
                    : terminalReasonChanged || outcomeChanged || playedDelta > 0
                        ? normalized.endReason
                        : existing.endReason,
                hadSeek: existing.hadSeek || normalized.hadSeek,
                source: playedDelta > 0 ? normalized.source : existing.source,
                connectorId: existing.connectorId ?? normalized.connectorId ?? undefined
            }
        });
        const becameSkipped = existing.outcome !== PLAYBACK_OUTCOMES.skip
            && outcome === PLAYBACK_OUTCOMES.skip;
        const becameCompleted = existing.outcome !== PLAYBACK_OUTCOMES.complete
            && outcome === PLAYBACK_OUTCOMES.complete;
        const updatedMusic = aggregateChanged
            ? {
                id: music.id,
                ...await transaction.recording.update({
                    where: { id: music.recordingId },
                    data: {
                        playCount: countChanged ? { increment: 1 } : undefined,
                        lastPlayedAt: playedDelta > 0
                            ? latestDate(music.lastPlayedAt, normalized.endedAt)
                            : undefined,
                        totalPlayedMs: playedDelta > 0
                            ? { increment: playedDelta }
                            : undefined,
                        skipCount: becameSkipped ? { increment: 1 } : undefined,
                        lastSkippedAt: becameSkipped
                            ? latestDate(music.lastSkippedAt, normalized.endedAt)
                            : undefined,
                        completionCount: becameCompleted
                            ? { increment: 1 }
                            : undefined,
                        lastCompletedAt: becameCompleted
                            ? latestDate(music.lastCompletedAt, normalized.endedAt)
                            : undefined
                    },
                    select: {
                        playCount: true,
                        lastPlayedAt: true,
                        totalPlayedMs: true,
                        skipCount: true,
                        lastSkippedAt: true,
                        completionCount: true,
                        lastCompletedAt: true
                    }
                })
            }
            : music;

        return toResult(updatedMusic, event, false);
    }, {
        isolationLevel: 'Serializable'
    });
};

const isRetryableWriteConflict = (error: unknown) => {
    return error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === 'P2002' || error.code === 'P2034');
};

export const recordPlayback = async (
    input: PlaybackRecordInput,
    serverTime = new Date()
): Promise<PlaybackRecordResult | null> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await recordNormalizedPlayback(input, serverTime);
        } catch (error) {
            if (!isRetryableWriteConflict(error) || attempt === 2) {
                throw error;
            }
        }
    }

    return null;
};
