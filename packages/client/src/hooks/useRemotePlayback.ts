import { useEffect, useState } from 'react';

import type { PlaybackQueueSnapshot } from '~/api/playback-queue';
import type {
    PlaybackSessionSnapshot,
    SharedPlaybackState
} from '~/api/playback-session';
import type { Music } from '~/models/type';
import { resolveSharedPlaybackPositionMs } from '~/modules/shared-playback';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { playbackQueueStore } from '~/store/playback-queue';
import { playbackSessionStore } from '~/store/playback-session';
import { resolveRemotePlaybackOwnership } from './useRemotePlaybackOwnership';

export interface RemotePlaybackSummary {
    music: Music | null;
    positionMs: number;
    progress: number;
    state: SharedPlaybackState;
    targetEndpointId: string;
}

export const resolveRemotePlaybackMusicId = (
    session: PlaybackSessionSnapshot | null,
    queue: PlaybackQueueSnapshot | null
) => {
    if (!session) {
        return null;
    }

    if (session.state !== 'stopped') {
        return session.currentMusicId;
    }

    const queueIndex = queue?.currentIndex;
    const queueMusicId = queueIndex === null || queueIndex === undefined
        ? null
        : queue?.musicIds[queueIndex] ?? null;
    return queueMusicId ?? session.currentMusicId;
};

export default function useRemotePlayback(): RemotePlaybackSummary | null {
    const [{ snapshot, receivedAtMs, endpointId }] = useStore(playbackSessionStore);
    const [{ snapshot: queueSnapshot }] = useStore(playbackQueueStore);
    const [{ musicMap }] = useStore(musicStore);
    const [nowMs, setNowMs] = useState(Date.now());
    const remoteMusicId = resolveRemotePlaybackMusicId(snapshot, queueSnapshot);
    const ownership = resolveRemotePlaybackOwnership(snapshot, endpointId);

    useEffect(() => {
        if (!ownership || snapshot?.state !== 'playing') {
            return;
        }

        const timer = setInterval(() => setNowMs(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, [ownership?.targetEndpointId, snapshot?.revision, snapshot?.state]);

    if (
        !ownership
        || !snapshot
    ) {
        return null;
    }

    const music = remoteMusicId
        ? musicMap.get(remoteMusicId) ?? null
        : null;

    const positionMs = snapshot.state === 'stopped'
        ? 0
        : resolveSharedPlaybackPositionMs({
            snapshot,
            receivedAtMs,
            nowMs,
            durationMs: music ? music.duration * 1000 : undefined
        });

    return {
        music,
        positionMs,
        progress: music && music.duration > 0
            ? Math.min(positionMs / (music.duration * 1000) * 100, 100)
            : 0,
        state: snapshot.state,
        targetEndpointId: ownership.targetEndpointId
    };
}
