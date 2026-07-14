import { useEffect, useState } from 'react';

import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { playbackSessionStore } from '~/store/playback-session';
import { resolveSharedPlaybackPositionMs } from '~/modules/shared-playback';
import { makePlayTime } from '~/modules/time';

const statusCopy = {
    playing: 'Playing on another web player',
    paused: 'Paused on another web player',
    stopped: 'Stopped on another web player'
} as const;

export default function SharedPlaybackStatus() {
    const [{ snapshot, receivedAtMs }] = useStore(playbackSessionStore);
    const [{ musicMap }] = useStore(musicStore);
    const [nowMs, setNowMs] = useState(Date.now());

    useEffect(() => {
        if (snapshot?.state !== 'playing') {
            return;
        }

        const timer = setInterval(() => setNowMs(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, [snapshot?.state, snapshot?.revision]);

    if (
        !snapshot
        || !snapshot.activeDeviceId
        || snapshot.activeDeviceId === playbackSessionStore.deviceId
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

    return (
        <div
            className="flex min-w-0 items-center gap-3 border-t border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-[var(--b-spacing-md)] py-2 text-sm lg:col-span-2 lg:px-[var(--b-spacing-lg)]"
            role="status"
            aria-live="polite">
            <span
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--b-color-point)]"
                aria-hidden="true"
            />
            <span className="shrink-0 text-xs font-medium text-[var(--b-color-text-tertiary)]">
                {statusCopy[snapshot.state]}
            </span>
            <span className="min-w-0 truncate font-medium text-[var(--b-color-text)]">
                {music.name}
            </span>
            <span className="hidden min-w-0 truncate text-[var(--b-color-text-tertiary)] sm:inline">
                {music.artist.name}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-xs text-[var(--b-color-text-tertiary)]">
                {makePlayTime(positionMs / 1000)}
            </span>
        </div>
    );
}
