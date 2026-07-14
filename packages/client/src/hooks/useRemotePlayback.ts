import { useEffect, useState } from 'react';

import type { SharedPlaybackState } from '~/api/playback-session';
import type { Music } from '~/models/type';
import { resolveSharedPlaybackPositionMs } from '~/modules/shared-playback';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { playbackSessionStore } from '~/store/playback-session';

export interface RemotePlaybackSummary {
    music: Music;
    positionMs: number;
    progress: number;
    state: Exclude<SharedPlaybackState, 'stopped'>;
}

export default function useRemotePlayback(): RemotePlaybackSummary | null {
    const [{ snapshot, receivedAtMs }] = useStore(playbackSessionStore);
    const [{ musicMap }] = useStore(musicStore);
    const [nowMs, setNowMs] = useState(Date.now());
    const isRemotePlayback = Boolean(
        snapshot
        && snapshot.state !== 'stopped'
        && snapshot.activeDeviceId
        && snapshot.activeDeviceId !== playbackSessionStore.deviceId
        && snapshot.currentMusicId
    );

    useEffect(() => {
        if (!isRemotePlayback || snapshot?.state !== 'playing') {
            return;
        }

        const timer = setInterval(() => setNowMs(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, [isRemotePlayback, snapshot?.revision, snapshot?.state]);

    if (
        !isRemotePlayback
        || !snapshot
        || snapshot.state === 'stopped'
        || !snapshot.currentMusicId
    ) {
        return null;
    }

    const music = musicMap.get(snapshot.currentMusicId);

    if (!music) {
        return null;
    }

    const positionMs = resolveSharedPlaybackPositionMs({
        snapshot,
        receivedAtMs,
        nowMs,
        durationMs: music.duration * 1000
    });

    return {
        music,
        positionMs,
        progress: music.duration > 0
            ? Math.min(positionMs / (music.duration * 1000) * 100, 100)
            : 0,
        state: snapshot.state
    };
}
