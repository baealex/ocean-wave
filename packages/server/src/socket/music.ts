import type { Socket } from 'socket.io';

import {
    recordPlayback,
    type PlaybackRecordInput,
    type PlaybackRecordResult
} from '~/features/music/services/playback-records';
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

export const musicListener = (socket: Socket) => {
    socket.on(MUSIC_LIKE, like);
    socket.on(MUSIC_HATE, hate);
    socket.on(MUSIC_COUNT, async (
        payload: PlaybackRecordInput,
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

export const count = async (payload: PlaybackRecordInput): Promise<PlaybackRecordResult | null> => {
    const result = await recordPlayback(payload);

    if (result && !result.deduped) {
        void connectors.broadcast(MUSIC_COUNT, result).catch(console.error);
    }

    return result;
};
