import models, { type PlaybackSession } from '~/models';
import { resolvePlayableReleaseTrack } from '~/modules/physical-file-selection';

export const PLAYBACK_SCOPE_KEY = 'local';

export const PLAYBACK_STATES = {
    playing: 'playing',
    paused: 'paused',
    stopped: 'stopped'
} as const;

export type PlaybackState = typeof PLAYBACK_STATES[keyof typeof PLAYBACK_STATES];

export interface PlaybackSessionSnapshot {
    id: string;
    state: PlaybackState;
    activeDeviceId: string | null;
    activeDeviceSequence: number;
    currentMusicId: string | null;
    positionMs: number;
    positionUpdatedAt: string;
    startedAt: string | null;
    revision: number;
    serverTime: string;
}

export interface PlaybackHistoryLineageInput {
    clientSessionId: string;
    branchId?: string;
    parentBranchId?: string | null;
    branchBasePlayedMs?: number;
    startedAt: string;
    accumulatedPlayedMs: number;
    hadSeek: boolean;
    updatedAt: string;
}

export interface ReportPlaybackStateInput {
    deviceId: string;
    sequence: number;
    expectedRevision: number;
    claimActive: boolean;
    state: PlaybackState;
    currentMusicId?: string | null;
    positionMs: number;
    observedAt?: string | null;
    playbackHistory?: PlaybackHistoryLineageInput | null;
}

export type PlaybackSessionConflictReason =
    | 'active-device'
    | 'stale-revision'
    | 'stale-sequence';

export interface PlaybackSessionReportResult {
    type: 'accepted' | 'conflict';
    session: PlaybackSessionSnapshot;
    conflict: {
        reason: PlaybackSessionConflictReason;
        session: PlaybackSessionSnapshot;
    } | null;
    changed: boolean;
}

export class PlaybackSessionServiceError extends Error {
    code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'PlaybackSessionServiceError';
        this.code = code;
    }
}

export const isPlaybackSessionServiceError = (
    error: unknown
): error is PlaybackSessionServiceError => {
    return error instanceof PlaybackSessionServiceError;
};

const toPlaybackState = (state: string): PlaybackState => {
    if (Object.values(PLAYBACK_STATES).includes(state as PlaybackState)) {
        return state as PlaybackState;
    }

    throw new PlaybackSessionServiceError(
        'Playback state must be playing, paused, or stopped.',
        'INVALID_PLAYBACK_STATE'
    );
};

const toSnapshot = (
    session: PlaybackSession,
    serverTime = new Date()
): PlaybackSessionSnapshot => ({
    id: session.id.toString(),
    state: toPlaybackState(session.state),
    activeDeviceId: session.activeDeviceId,
    activeDeviceSequence: session.activeDeviceSequence,
    currentMusicId: session.currentMusicId?.toString() ?? null,
    positionMs: session.positionMs,
    positionUpdatedAt: session.positionUpdatedAt.toISOString(),
    startedAt: session.startedAt?.toISOString() ?? null,
    revision: session.revision,
    serverTime: serverTime.toISOString()
});

const conflictResult = (
    session: PlaybackSession,
    reason: PlaybackSessionConflictReason,
    serverTime: Date
): PlaybackSessionReportResult => {
    const snapshot = toSnapshot(session, serverTime);

    return {
        type: 'conflict',
        session: snapshot,
        conflict: { reason, session: snapshot },
        changed: false
    };
};

const validateInput = (input: ReportPlaybackStateInput) => {
    const deviceId = input.deviceId.trim();

    if (!deviceId || deviceId.length > 128) {
        throw new PlaybackSessionServiceError(
            'Playback device id must contain between 1 and 128 characters.',
            'INVALID_PLAYBACK_DEVICE'
        );
    }

    if (!Number.isInteger(input.sequence) || input.sequence <= 0) {
        throw new PlaybackSessionServiceError(
            'Playback sequence must be a positive integer.',
            'INVALID_PLAYBACK_SEQUENCE'
        );
    }

    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw new PlaybackSessionServiceError(
            'Expected playback session revision must be a non-negative integer.',
            'INVALID_PLAYBACK_SESSION_REVISION'
        );
    }

    const state = toPlaybackState(input.state);

    if (!Number.isFinite(input.positionMs) || input.positionMs < 0) {
        throw new PlaybackSessionServiceError(
            'Playback position must be a finite non-negative number.',
            'INVALID_PLAYBACK_POSITION'
        );
    }

    if (input.observedAt) {
        const observedAt = new Date(input.observedAt);

        if (Number.isNaN(observedAt.getTime())) {
            throw new PlaybackSessionServiceError(
                'Playback observation time must be a valid date.',
                'INVALID_PLAYBACK_OBSERVED_AT'
            );
        }
    }

    const currentMusicId = input.currentMusicId === null || input.currentMusicId === undefined
        ? null
        : Number(input.currentMusicId);

    if (currentMusicId !== null && (!Number.isInteger(currentMusicId) || currentMusicId <= 0)) {
        throw new PlaybackSessionServiceError(
            'Current music id must be a positive integer.',
            'INVALID_PLAYBACK_MUSIC'
        );
    }

    if (state !== PLAYBACK_STATES.stopped && currentMusicId === null) {
        throw new PlaybackSessionServiceError(
            'Playing and paused snapshots require a current music id.',
            'PLAYBACK_MUSIC_REQUIRED'
        );
    }

    let playbackHistory: {
        clientSessionId: string;
        branchId: string;
        parentBranchId: string | null;
        branchBasePlayedMs: number;
        startedAt: Date;
        accumulatedPlayedMs: number;
        hadSeek: boolean;
        updatedAt: Date;
    } | null | undefined;
    if (input.playbackHistory === undefined) {
        playbackHistory = undefined;
    } else if (input.playbackHistory === null) {
        playbackHistory = null;
    } else {
        const clientSessionId = input.playbackHistory.clientSessionId.trim();
        const branchId = (input.playbackHistory.branchId
            ?? input.playbackHistory.clientSessionId).trim();
        const parentBranchId = input.playbackHistory.parentBranchId === undefined
            || input.playbackHistory.parentBranchId === null
            ? null
            : input.playbackHistory.parentBranchId.trim();
        const branchBasePlayedMs = input.playbackHistory.branchBasePlayedMs ?? 0;
        const startedAt = new Date(input.playbackHistory.startedAt);
        const updatedAt = new Date(input.playbackHistory.updatedAt);
        if (
            !clientSessionId
            || clientSessionId !== input.playbackHistory.clientSessionId
            || clientSessionId.length > 128
            || !branchId
            || branchId !== (input.playbackHistory.branchId
                ?? input.playbackHistory.clientSessionId)
            || branchId.length > 128
            || (
                parentBranchId !== null
                && (
                    !parentBranchId
                    || parentBranchId !== input.playbackHistory.parentBranchId
                    || parentBranchId.length > 128
                    || parentBranchId === branchId
                    || parentBranchId !== clientSessionId
                )
            )
            || !Number.isSafeInteger(branchBasePlayedMs)
            || branchBasePlayedMs < 0
            || (parentBranchId === null && branchBasePlayedMs !== 0)
            || (parentBranchId === null && branchId !== clientSessionId)
            || Number.isNaN(startedAt.getTime())
            || Number.isNaN(updatedAt.getTime())
            || startedAt > updatedAt
            || !Number.isSafeInteger(input.playbackHistory.accumulatedPlayedMs)
            || input.playbackHistory.accumulatedPlayedMs < 0
            || input.playbackHistory.accumulatedPlayedMs < branchBasePlayedMs
            || typeof input.playbackHistory.hadSeek !== 'boolean'
            || currentMusicId === null
        ) {
            throw new PlaybackSessionServiceError(
                'Playback history lineage is invalid.',
                'INVALID_PLAYBACK_HISTORY'
            );
        }

        playbackHistory = {
            clientSessionId,
            branchId,
            parentBranchId,
            branchBasePlayedMs,
            startedAt,
            accumulatedPlayedMs: input.playbackHistory.accumulatedPlayedMs,
            hadSeek: input.playbackHistory.hadSeek,
            updatedAt
        };
    }

    return {
        deviceId,
        sequence: input.sequence,
        expectedRevision: input.expectedRevision,
        claimActive: input.claimActive === true,
        state,
        currentMusicId,
        positionMs: Math.round(input.positionMs),
        playbackHistory
    };
};

const historyUpdateData = (
    history: ReturnType<typeof validateInput>['playbackHistory'],
    currentMusic: {
        recordingId: number;
        releaseTrackId: number;
        physicalFileId: number;
    } | null
) => {
    if (history === undefined) {
        return {};
    }
    if (history === null) {
        return {
            historyMusicId: null,
            historyReleaseTrackId: null,
            historyPhysicalFileId: null,
            historySessionId: null,
            historyBranchId: null,
            historyParentBranchId: null,
            historyBranchBasePlayedMs: 0,
            historyStartedAt: null,
            historyPlayedMs: 0,
            historyHadSeek: false,
            historyUpdatedAt: null
        };
    }

    return {
        historyMusicId: currentMusic?.recordingId ?? null,
        historyReleaseTrackId: currentMusic?.releaseTrackId ?? null,
        historyPhysicalFileId: currentMusic?.physicalFileId ?? null,
        historySessionId: history.clientSessionId,
        historyBranchId: history.branchId,
        historyParentBranchId: history.parentBranchId,
        historyBranchBasePlayedMs: history.branchBasePlayedMs,
        historyStartedAt: history.startedAt,
        historyPlayedMs: history.accumulatedPlayedMs,
        historyHadSeek: history.hadSeek,
        historyUpdatedAt: history.updatedAt
    };
};

export const getPlaybackSessionSnapshot = async (
    serverTime = new Date()
): Promise<PlaybackSessionSnapshot | null> => {
    const session = await models.playbackSession.findUnique({
        where: { scopeKey: PLAYBACK_SCOPE_KEY }
    });

    return session ? toSnapshot(session, serverTime) : null;
};

export const reportPlaybackState = async (
    input: ReportPlaybackStateInput,
    serverTime = new Date()
): Promise<PlaybackSessionReportResult> => {
    const normalized = validateInput(input);
    const previousSession = normalized.currentMusicId === null
        ? null
        : await models.playbackSession.findUnique({
            where: { scopeKey: PLAYBACK_SCOPE_KEY },
            select: {
                currentMusicId: true,
                historyPhysicalFileId: true
            }
        });
    const currentPhysicalFileId = previousSession?.currentMusicId
        === normalized.currentMusicId
        ? previousSession.historyPhysicalFileId
        : null;
    const music = normalized.currentMusicId === null
        ? null
        : await resolvePlayableReleaseTrack(
            normalized.currentMusicId,
            currentPhysicalFileId
        );

    if (normalized.currentMusicId !== null && !music) {
        throw new PlaybackSessionServiceError(
            'Current music does not exist or is unavailable.',
            'PLAYBACK_MUSIC_NOT_FOUND'
        );
    }

    const positionMs = music
        ? Math.min(normalized.positionMs, Math.max(Math.round(music.duration * 1000), 0))
        : 0;

    return models.$transaction(async (transaction) => {
        const current = await transaction.playbackSession.findUnique({
            where: { scopeKey: PLAYBACK_SCOPE_KEY }
        });

        if (!current) {
            if (normalized.expectedRevision !== 0) {
                throw new PlaybackSessionServiceError(
                    'Playback session revision is stale because no session exists.',
                    'STALE_PLAYBACK_SESSION_REVISION'
                );
            }

            if (!normalized.claimActive) {
                throw new PlaybackSessionServiceError(
                    'The first playback report must claim the active device.',
                    'PLAYBACK_ACTIVE_DEVICE_REQUIRED'
                );
            }

            const created = await transaction.playbackSession.create({
                data: {
                    scopeKey: PLAYBACK_SCOPE_KEY,
                    state: normalized.state,
                    activeDeviceId: normalized.deviceId,
                    activeDeviceSequence: normalized.sequence,
                    currentMusicId: music?.releaseTrackId ?? null,
                    positionMs,
                    positionUpdatedAt: serverTime,
                    startedAt: normalized.state === PLAYBACK_STATES.playing
                        ? serverTime
                        : null,
                    ...historyUpdateData(
                        normalized.playbackHistory ?? null,
                        music
                    ),
                    revision: 1
                }
            });
            const snapshot = toSnapshot(created, serverTime);

            return {
                type: 'accepted',
                session: snapshot,
                conflict: null,
                changed: true
            };
        }

        const isActiveDevice = current.activeDeviceId === normalized.deviceId;

        if (!isActiveDevice && !normalized.claimActive) {
            return conflictResult(current, 'active-device', serverTime);
        }

        if (isActiveDevice && normalized.sequence < current.activeDeviceSequence) {
            return conflictResult(current, 'stale-sequence', serverTime);
        }

        if (isActiveDevice && normalized.sequence === current.activeDeviceSequence) {
            return {
                type: 'accepted',
                session: toSnapshot(current, serverTime),
                conflict: null,
                changed: false
            };
        }

        if (current.revision !== normalized.expectedRevision) {
            return conflictResult(current, 'stale-revision', serverTime);
        }

        const continuesCurrentPlay = isActiveDevice
            && current.state === PLAYBACK_STATES.playing
            && normalized.state === PLAYBACK_STATES.playing
            && current.currentMusicId === (music?.releaseTrackId ?? null);
        const startedAt = normalized.state === PLAYBACK_STATES.playing
            ? (continuesCurrentPlay ? current.startedAt ?? serverTime : serverTime)
            : (normalized.state === PLAYBACK_STATES.paused ? current.startedAt : null);
        const nextMusicId = music?.releaseTrackId ?? null;
        const playbackHistory = normalized.state === PLAYBACK_STATES.stopped
            ? null
            : normalized.playbackHistory !== undefined
                ? normalized.playbackHistory
                : current.currentMusicId === nextMusicId
                    ? undefined
                    : null;
        const mergedPlaybackHistory = playbackHistory
            && current.historySessionId === playbackHistory.clientSessionId
            && current.historyMusicId === music?.recordingId
            && current.historyReleaseTrackId === music?.releaseTrackId
            && current.historyPhysicalFileId === music?.physicalFileId
            && current.historyBranchId === playbackHistory.branchId
            && current.historyParentBranchId === playbackHistory.parentBranchId
            && current.historyBranchBasePlayedMs
                === playbackHistory.branchBasePlayedMs
            ? {
                ...playbackHistory,
                startedAt: current.historyStartedAt ?? playbackHistory.startedAt,
                accumulatedPlayedMs: Math.max(
                    current.historyPlayedMs,
                    playbackHistory.accumulatedPlayedMs
                ),
                hadSeek: current.historyHadSeek || playbackHistory.hadSeek,
                updatedAt: current.historyUpdatedAt
                    && current.historyUpdatedAt > playbackHistory.updatedAt
                    ? current.historyUpdatedAt
                    : playbackHistory.updatedAt
            }
            : playbackHistory;
        const update = await transaction.playbackSession.updateMany({
            where: {
                id: current.id,
                revision: normalized.expectedRevision,
                activeDeviceId: current.activeDeviceId,
                activeDeviceSequence: current.activeDeviceSequence
            },
            data: {
                state: normalized.state,
                activeDeviceId: normalized.deviceId,
                activeDeviceSequence: normalized.sequence,
                currentMusicId: music?.releaseTrackId ?? null,
                positionMs,
                positionUpdatedAt: serverTime,
                startedAt,
                ...historyUpdateData(mergedPlaybackHistory, music),
                revision: { increment: 1 }
            }
        });

        if (update.count !== 1) {
            const latest = await transaction.playbackSession.findUniqueOrThrow({
                where: { id: current.id }
            });
            return conflictResult(latest, 'stale-revision', serverTime);
        }

        const updated = await transaction.playbackSession.findUniqueOrThrow({
            where: { id: current.id }
        });
        const snapshot = toSnapshot(updated, serverTime);

        return {
            type: 'accepted',
            session: snapshot,
            conflict: null,
            changed: true
        };
    });
};
