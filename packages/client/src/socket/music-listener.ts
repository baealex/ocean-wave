import type { GraphQueryErrorResponse } from '~/api/graphql';
import {
    recordPlayback,
    setMusicHated,
    setMusicLiked
} from '~/api/music';
import type { Tag } from '~/models/type';
import {
    deletePlaybackCheckpoint,
    listPlaybackCheckpoints
} from '~/modules/playback-checkpoint-store';
import { toast } from '~/modules/toast';
import type { Listener } from './listener';
import {
    isOwnRealtimeNotification,
    type OriginClientNotificationPayload,
    socket
} from './socket';

export const MUSIC_LIKE = 'music:like-updated';
export const MUSIC_HATE = 'music:hate-updated';
export const MUSIC_COUNT = 'music:play-count-updated';
export const MUSIC_TAGS_UPDATED = 'music:tags-updated';
export const MUSIC_UPDATED = 'music:updated';
const PLAYBACK_RECORD_TIMEOUT_MS = 5_000;

const getGraphQueryErrorMessage = (response: GraphQueryErrorResponse) => {
    return response.errors[0]?.message ?? 'Music preference update failed';
};

export interface CountPayload {
    id: string;
    playedMs: number;
    completionRate?: number;
    startedAt: string;
    endedAt: string;
    endReason: 'ended' | 'skipped' | 'stopped' | 'handoff' | 'unload' | 'recovery';
    hadSeek: boolean;
    source?: string;
    clientSessionId?: string;
    branchId?: string;
    parentBranchId?: string | null;
    branchBasePlayedMs?: number;
}

interface Like extends OriginClientNotificationPayload {
    id: string;
    isLiked: boolean;
}

interface Hate extends OriginClientNotificationPayload {
    id: string;
    isHated: boolean;
}

interface Count extends OriginClientNotificationPayload {
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
    outcome: 'listen' | 'skip' | 'complete' | 'legacy';
}

interface TagsUpdated extends OriginClientNotificationPayload {
    musicId: string;
    tags: Tag[];
}

interface MusicUpdated extends OriginClientNotificationPayload {
    musicId: string;
}

interface MusicListenerEventHandler {
    onLike: (data: Like) => void;
    onHate: (data: Hate) => void;
    onCount: (data: Count) => void;
    onTagsUpdated?: (data: TagsUpdated) => void;
    onUpdated?: (data: MusicUpdated) => void;
}

export class MusicListener implements Listener {
    static pendingCountEvents: CountPayload[] = [];
    static isFlushing = false;
    static isRecovering = false;
    private static handlers = new Set<MusicListenerEventHandler>();

    handler: MusicListenerEventHandler | null;
    private socketHandler: MusicListenerEventHandler | null;

    constructor() {
        this.handler = null;
        this.socketHandler = null;
    }

    connect(handler: MusicListenerEventHandler) {
        if (this.handler !== null) {
            this.disconnect();
        }
        this.handler = handler;
        this.socketHandler = this.createSocketHandler(handler);
        MusicListener.handlers.add(handler);

        socket.on(MUSIC_LIKE, this.socketHandler.onLike);
        socket.on(MUSIC_HATE, this.socketHandler.onHate);
        socket.on(MUSIC_COUNT, this.socketHandler.onCount);
        if (this.socketHandler.onTagsUpdated) {
            socket.on(MUSIC_TAGS_UPDATED, this.socketHandler.onTagsUpdated);
        }
        if (this.socketHandler.onUpdated) {
            socket.on(MUSIC_UPDATED, this.socketHandler.onUpdated);
        }
    }

    static like(id: string, isLiked: boolean) {
        void this.commitLikedState(id, isLiked);
    }

    static hate(id: string, isHated: boolean) {
        void this.commitHatedState(id, isHated);
    }

    static async count(payload?: CountPayload) {
        if (payload) {
            this.pendingCountEvents.push(payload);
        }

        if (this.isFlushing) {
            return false;
        }

        this.isFlushing = true;
        let deliveredPayload = payload === undefined;

        try {
            while (this.pendingCountEvents.length > 0) {
                const item = this.pendingCountEvents.shift();

                if (!item) {
                    break;
                }

                const delivered = await this.commitPlaybackRecord(item);

                if (!delivered) {
                    this.pendingCountEvents.unshift(item);
                    break;
                }

                if (item === payload) {
                    deliveredPayload = true;
                }
            }
        } finally {
            this.isFlushing = false;
        }

        return deliveredPayload;
    }

    static async recoverPlaybackCheckpoints() {
        if (this.isRecovering) {
            return;
        }

        this.isRecovering = true;

        try {
            const checkpoints = await listPlaybackCheckpoints();

            for (const checkpoint of checkpoints) {
                const delivered = await this.commitPlaybackRecord({
                    id: checkpoint.trackId,
                    playedMs: checkpoint.accumulatedPlayedMs,
                    startedAt: checkpoint.startedAt,
                    endedAt: checkpoint.endedAt ?? checkpoint.updatedAt,
                    endReason: checkpoint.endReason ?? 'recovery',
                    hadSeek: checkpoint.hadSeek ?? false,
                    source: checkpoint.endReason
                        ? checkpoint.source
                        : 'queue-recovery',
                    clientSessionId: checkpoint.clientSessionId,
                    branchId: checkpoint.branchId,
                    parentBranchId: checkpoint.parentBranchId,
                    branchBasePlayedMs: checkpoint.branchBasePlayedMs
                });

                if (delivered) {
                    await deletePlaybackCheckpoint(checkpoint);
                }
            }
        } finally {
            this.isRecovering = false;
        }
    }

    disconnect() {
        if (this.handler === null || this.socketHandler === null) return;

        socket.off(MUSIC_LIKE, this.socketHandler.onLike);
        socket.off(MUSIC_HATE, this.socketHandler.onHate);
        socket.off(MUSIC_COUNT, this.socketHandler.onCount);
        if (this.socketHandler.onTagsUpdated) {
            socket.off(MUSIC_TAGS_UPDATED, this.socketHandler.onTagsUpdated);
        }
        if (this.socketHandler.onUpdated) {
            socket.off(MUSIC_UPDATED, this.socketHandler.onUpdated);
        }
        MusicListener.handlers.delete(this.handler);

        this.handler = null;
        this.socketHandler = null;
    }

    private createSocketHandler(handler: MusicListenerEventHandler): MusicListenerEventHandler {
        return {
            onLike: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onLike(data);
                }
            },
            onHate: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onHate(data);
                }
            },
            onCount: (data) => {
                if (!isOwnRealtimeNotification(data)) {
                    handler.onCount(data);
                }
            },
            onTagsUpdated: handler.onTagsUpdated
                ? (data) => {
                    if (!isOwnRealtimeNotification(data)) {
                        handler.onTagsUpdated?.(data);
                    }
                }
                : undefined,
            onUpdated: handler.onUpdated
                ? (data) => {
                    if (!isOwnRealtimeNotification(data)) {
                        handler.onUpdated?.(data);
                    }
                }
                : undefined
        };
    }

    private static async commitLikedState(id: string, isLiked: boolean) {
        const response = await setMusicLiked({ id, isLiked });

        if (response.type === 'error') {
            toast.error(getGraphQueryErrorMessage(response));
            return false;
        }

        this.notifyLike(response.setMusicLiked);
        return true;
    }

    private static async commitHatedState(id: string, isHated: boolean) {
        const response = await setMusicHated({ id, isHated });

        if (response.type === 'error') {
            toast.error(getGraphQueryErrorMessage(response));
            return false;
        }

        this.notifyHate(response.setMusicHated);
        return true;
    }

    private static notifyLike(data: Like) {
        for (const handler of this.handlers) {
            handler.onLike(data);
        }
    }

    private static notifyHate(data: Hate) {
        for (const handler of this.handlers) {
            handler.onHate(data);
        }
    }

    private static async commitPlaybackRecord(payload: CountPayload) {
        const response = await this.recordPlaybackWithTimeout(payload);

        if (!response || response.type === 'error' || !response.recordPlayback) {
            return false;
        }

        this.notifyCount(response.recordPlayback);
        return true;
    }

    private static async recordPlaybackWithTimeout(payload: CountPayload) {
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

        try {
            return await Promise.race([
                recordPlayback(payload),
                new Promise<null>((resolve) => {
                    timeoutId = globalThis.setTimeout(() => {
                        resolve(null);
                    }, PLAYBACK_RECORD_TIMEOUT_MS);
                })
            ]);
        } finally {
            if (timeoutId !== undefined) {
                globalThis.clearTimeout(timeoutId);
            }
        }
    }

    private static notifyCount(data: Count) {
        for (const handler of this.handlers) {
            handler.onCount(data);
        }
    }
}
