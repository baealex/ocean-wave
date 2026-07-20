export interface PlaybackSessionTrack {
    id: string;
    durationMs: number;
}

export interface PlaybackSessionCheckpoint {
    clientSessionId: string;
    branchId?: string;
    parentBranchId?: string | null;
    branchBasePlayedMs?: number;
    trackId: string;
    startedAt: string;
    accumulatedPlayedMs: number;
    hadSeek?: boolean;
    lastResumedAt: string | null;
    active: boolean;
    updatedAt: string;
    source: string;
    endedAt?: string;
    endReason?: PlaybackSessionEndReason;
}

export interface PlaybackSessionCommit {
    clientSessionId: string;
    branchId: string;
    parentBranchId: string | null;
    branchBasePlayedMs: number;
    id: string;
    playedMs: number;
    completionRate: number;
    startedAt: string;
    endedAt: string;
    endReason: PlaybackSessionEndReason;
    hadSeek: boolean;
}

export type PlaybackSessionEndReason =
    | 'ended'
    | 'skipped'
    | 'stopped'
    | 'handoff'
    | 'unload';

const normalizeDurationMs = (durationMs: number) => {
    return Number.isFinite(durationMs) && durationMs > 0
        ? Math.max(Math.round(durationMs), 1)
        : 30_000;
};

const createPlaybackSessionId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `playback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export class PlaybackSessionTracker {
    private clientSessionId: string | null = null;
    private branchId: string | null = null;
    private parentBranchId: string | null = null;
    private branchBasePlayedMs = 0;
    private trackId: string | null = null;
    private durationMs = 0;
    private listenedMs = 0;
    private startedAtMs: number | null = null;
    private lastTickAtMs: number | null = null;
    private lastResumedAtMs: number | null = null;
    private active = false;
    private hadSeek = false;

    play(track: PlaybackSessionTrack, now = Date.now()) {
        this.ensureTrack(track, now);

        if (!this.active) {
            this.active = true;
            this.lastTickAtMs = now;
            this.lastResumedAtMs = now;
        }
    }

    tick(now = Date.now()) {
        this.syncActiveListening(now);
    }

    pause(now = Date.now()) {
        if (!this.active) {
            return;
        }

        this.tick(now);
        this.active = false;
        this.lastTickAtMs = null;
    }

    markSeek() {
        if (this.clientSessionId && this.trackId) {
            this.hadSeek = true;
        }
    }

    hasSession() {
        return this.clientSessionId !== null && this.trackId !== null;
    }

    creditListenedMs(playedMs: number) {
        if (
            !this.hasSession()
            || !Number.isFinite(playedMs)
            || playedMs <= 0
        ) {
            return;
        }

        this.listenedMs += playedMs;
    }

    restore(
        checkpoint: PlaybackSessionCheckpoint,
        track: PlaybackSessionTrack
    ) {
        const branchId = checkpoint.branchId ?? checkpoint.clientSessionId;
        const parentBranchId = checkpoint.parentBranchId ?? null;
        const branchBasePlayedMs = checkpoint.branchBasePlayedMs ?? 0;
        const startedAtMs = new Date(checkpoint.startedAt).getTime();
        const updatedAtMs = new Date(checkpoint.updatedAt).getTime();
        const lastResumedAtMs = checkpoint.lastResumedAt
            ? new Date(checkpoint.lastResumedAt).getTime()
            : null;
        if (
            checkpoint.trackId !== track.id
            || !checkpoint.clientSessionId
            || checkpoint.clientSessionId.trim() !== checkpoint.clientSessionId
            || checkpoint.clientSessionId.length > 128
            || !branchId
            || branchId.trim() !== branchId
            || branchId.length > 128
            || (
                parentBranchId !== null
                && (
                    !parentBranchId
                    || parentBranchId.trim() !== parentBranchId
                    || parentBranchId.length > 128
                    || parentBranchId === branchId
                    || parentBranchId !== checkpoint.clientSessionId
                )
            )
            || !Number.isSafeInteger(branchBasePlayedMs)
            || branchBasePlayedMs < 0
            || (parentBranchId === null && branchBasePlayedMs !== 0)
            || (
                parentBranchId === null
                && branchId !== checkpoint.clientSessionId
            )
            || !Number.isFinite(checkpoint.accumulatedPlayedMs)
            || checkpoint.accumulatedPlayedMs < 0
            || checkpoint.accumulatedPlayedMs < branchBasePlayedMs
            || !Number.isFinite(startedAtMs)
            || !Number.isFinite(updatedAtMs)
            || startedAtMs > updatedAtMs
            || (lastResumedAtMs !== null && !Number.isFinite(lastResumedAtMs))
        ) {
            return false;
        }

        this.clientSessionId = checkpoint.clientSessionId;
        this.branchId = branchId;
        this.parentBranchId = parentBranchId;
        this.branchBasePlayedMs = branchBasePlayedMs;
        this.trackId = checkpoint.trackId;
        this.durationMs = normalizeDurationMs(track.durationMs);
        this.listenedMs = Math.round(checkpoint.accumulatedPlayedMs);
        this.startedAtMs = startedAtMs;
        this.lastTickAtMs = null;
        this.lastResumedAtMs = lastResumedAtMs;
        this.active = false;
        this.hadSeek = checkpoint.hadSeek === true;
        return true;
    }

    getAccumulatedPlayedMs(now = Date.now()) {
        if (!this.active || this.lastTickAtMs === null) {
            return Math.max(Math.round(this.listenedMs), 0);
        }

        return Math.max(Math.round(
            this.listenedMs + Math.max(now - this.lastTickAtMs, 0)
        ), 0);
    }

    createCheckpoint(
        source: string,
        now = Date.now(),
        includeEmpty = false
    ): PlaybackSessionCheckpoint | null {
        if (!this.clientSessionId || !this.trackId || this.startedAtMs === null) {
            return null;
        }

        this.syncActiveListening(now);

        const accumulatedPlayedMs = Math.max(Math.round(this.listenedMs), 0);
        const updatedAtMs = Math.max(now, this.startedAtMs);

        if (!includeEmpty && accumulatedPlayedMs <= 0) {
            return null;
        }

        return {
            clientSessionId: this.clientSessionId,
            branchId: this.branchId ?? this.clientSessionId,
            parentBranchId: this.parentBranchId,
            branchBasePlayedMs: this.branchBasePlayedMs,
            trackId: this.trackId,
            startedAt: new Date(this.startedAtMs).toISOString(),
            accumulatedPlayedMs,
            hadSeek: this.hadSeek,
            lastResumedAt: this.lastResumedAtMs === null
                ? null
                : new Date(this.lastResumedAtMs).toISOString(),
            active: this.active,
            updatedAt: new Date(updatedAtMs).toISOString(),
            source
        };
    }

    commit(
        endReason: PlaybackSessionEndReason,
        now = Date.now()
    ): PlaybackSessionCommit | null {
        this.pause(now);

        if (!this.clientSessionId || !this.trackId || this.startedAtMs === null) {
            this.reset();
            return null;
        }

        const playedMs = Math.max(Math.round(this.listenedMs), 0);

        if (playedMs <= 0 && endReason !== 'skipped') {
            this.reset();
            return null;
        }

        const payload: PlaybackSessionCommit = {
            clientSessionId: this.clientSessionId,
            branchId: this.branchId ?? this.clientSessionId,
            parentBranchId: this.parentBranchId,
            branchBasePlayedMs: this.branchBasePlayedMs,
            id: this.trackId,
            playedMs,
            completionRate: Math.min(playedMs / normalizeDurationMs(this.durationMs), 1),
            startedAt: new Date(this.startedAtMs).toISOString(),
            endedAt: new Date(now).toISOString(),
            endReason,
            hadSeek: this.hadSeek
        };

        this.reset();

        return payload;
    }

    reset() {
        this.clientSessionId = null;
        this.branchId = null;
        this.parentBranchId = null;
        this.branchBasePlayedMs = 0;
        this.trackId = null;
        this.durationMs = 0;
        this.listenedMs = 0;
        this.startedAtMs = null;
        this.lastTickAtMs = null;
        this.lastResumedAtMs = null;
        this.active = false;
        this.hadSeek = false;
    }

    private ensureTrack(track: PlaybackSessionTrack, now: number) {
        if (this.trackId !== track.id) {
            this.clientSessionId = createPlaybackSessionId();
            this.branchId = this.clientSessionId;
            this.parentBranchId = null;
            this.branchBasePlayedMs = 0;
            this.trackId = track.id;
            this.durationMs = normalizeDurationMs(track.durationMs);
            this.listenedMs = 0;
            this.startedAtMs = now;
            this.lastTickAtMs = null;
            this.lastResumedAtMs = null;
            this.active = false;
            this.hadSeek = false;
            return;
        }

        this.durationMs = normalizeDurationMs(track.durationMs);

        if (this.clientSessionId === null) {
            this.clientSessionId = createPlaybackSessionId();
        }

        if (this.branchId === null) {
            this.branchId = this.clientSessionId;
            this.parentBranchId = null;
            this.branchBasePlayedMs = 0;
        }

        if (this.startedAtMs === null) {
            this.startedAtMs = now;
        }
    }

    private syncActiveListening(now: number) {
        if (!this.active || this.lastTickAtMs === null) {
            return;
        }

        this.listenedMs += Math.max(now - this.lastTickAtMs, 0);
        this.lastTickAtMs = now;
    }
}
