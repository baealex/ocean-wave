import models, { type PlaybackSession } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

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
    currentMusicId: string | null;
    positionMs: number;
    positionUpdatedAt: string;
    startedAt: string | null;
    revision: number;
    serverTime: string;
}

export interface ReportPlaybackStateInput {
    deviceId: string;
    sequence: number;
    claimActive: boolean;
    state: PlaybackState;
    currentMusicId?: string | null;
    positionMs: number;
    observedAt?: string | null;
}

export type PlaybackSessionConflictReason = 'active-device' | 'stale-sequence';

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

    return {
        deviceId,
        sequence: input.sequence,
        claimActive: input.claimActive === true,
        state,
        currentMusicId,
        positionMs: Math.round(input.positionMs)
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
    const music = normalized.currentMusicId === null
        ? null
        : await models.music.findFirst({
            where: {
                id: normalized.currentMusicId,
                syncStatus: TRACK_SYNC_STATUS.active
            },
            select: { id: true, duration: true }
        });

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
                    currentMusicId: music?.id ?? null,
                    positionMs,
                    positionUpdatedAt: serverTime,
                    startedAt: normalized.state === PLAYBACK_STATES.playing
                        ? serverTime
                        : null,
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

        const continuesCurrentPlay = isActiveDevice
            && current.state === PLAYBACK_STATES.playing
            && normalized.state === PLAYBACK_STATES.playing
            && current.currentMusicId === (music?.id ?? null);
        const startedAt = normalized.state === PLAYBACK_STATES.playing
            ? (continuesCurrentPlay ? current.startedAt ?? serverTime : serverTime)
            : (normalized.state === PLAYBACK_STATES.paused ? current.startedAt : null);
        const updated = await transaction.playbackSession.update({
            where: { id: current.id },
            data: {
                state: normalized.state,
                activeDeviceId: normalized.deviceId,
                activeDeviceSequence: normalized.sequence,
                currentMusicId: music?.id ?? null,
                positionMs,
                positionUpdatedAt: serverTime,
                startedAt,
                revision: { increment: 1 }
            }
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
