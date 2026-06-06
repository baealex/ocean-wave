import {
    recordPlayback,
    setMusicHated,
    setMusicLiked
} from '~/api/music';
import type { GraphQueryErrorResponse } from '~/api/graphql';
import { toast } from '~/modules/toast';

import { socket } from './socket';
import type { Listener } from './listener';
import {
    deletePlaybackCheckpoint,
    listPlaybackCheckpoints
} from '~/modules/playback-checkpoint-store';

export const MUSIC_LIKE = 'music-like';
export const MUSIC_HATE = 'music-hate';
export const MUSIC_COUNT = 'music-count';
const PLAYBACK_RECORD_TIMEOUT_MS = 5_000;

const getGraphQueryErrorMessage = (response: GraphQueryErrorResponse) => {
    return response.errors[0]?.message ?? 'Music preference update failed';
};

export interface CountPayload {
    id: string;
    playedMs: number;
    completionRate?: number;
    startedAt: string;
    source?: string;
    clientSessionId?: string;
}

interface Like {
    id: string;
    isLiked: boolean;
}

interface Hate {
    id: string;
    isHated: boolean;
}

interface Count {
    id: string;
    playCount: number;
    lastPlayedAt: string | null;
    totalPlayedMs: number;
    countedAsPlay: boolean;
}

interface MusicListenerEventHandler {
    onLike: (data: Like) => void;
    onHate: (data: Hate) => void;
    onCount: (data: Count) => void;
}

export class MusicListener implements Listener {
    static pendingCountEvents: CountPayload[] = [];
    static isFlushing = false;
    static isRecovering = false;
    private static handlers = new Set<MusicListenerEventHandler>();

    handler: MusicListenerEventHandler | null;

    constructor() {
        this.handler = null;
    }

    connect(handler: MusicListenerEventHandler) {
        if (this.handler !== null) {
            this.disconnect();
        }
        this.handler = handler;
        MusicListener.handlers.add(handler);

        socket.on(MUSIC_LIKE, this.handler.onLike);
        socket.on(MUSIC_HATE, this.handler.onHate);
        socket.on(MUSIC_COUNT, this.handler.onCount);
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
                    source: 'queue-recovery',
                    clientSessionId: checkpoint.clientSessionId
                });

                if (delivered) {
                    await deletePlaybackCheckpoint(checkpoint.clientSessionId);
                }
            }
        } finally {
            this.isRecovering = false;
        }
    }

    disconnect() {
        if (this.handler === null) return;

        socket.off(MUSIC_LIKE, this.handler.onLike);
        socket.off(MUSIC_HATE, this.handler.onHate);
        socket.off(MUSIC_COUNT, this.handler.onCount);
        MusicListener.handlers.delete(this.handler);

        this.handler = null;
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
