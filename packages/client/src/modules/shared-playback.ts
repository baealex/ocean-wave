import type { PlaybackSessionSnapshot } from '~/api/playback-session';

export const isNewerPlaybackSnapshot = (
    current: PlaybackSessionSnapshot | null,
    candidate: PlaybackSessionSnapshot
) => {
    return current === null || candidate.revision > current.revision;
};

export const resolveSharedPlaybackPositionMs = ({
    snapshot,
    receivedAtMs,
    nowMs,
    durationMs
}: {
    snapshot: PlaybackSessionSnapshot;
    receivedAtMs: number;
    nowMs: number;
    durationMs?: number;
}) => {
    let positionMs = Math.max(snapshot.positionMs, 0);

    if (snapshot.state === 'playing') {
        const serverTimeMs = Date.parse(snapshot.serverTime);
        const positionUpdatedAtMs = Date.parse(snapshot.positionUpdatedAt);
        const elapsedBeforeReceipt = Number.isFinite(serverTimeMs)
            && Number.isFinite(positionUpdatedAtMs)
            ? Math.max(serverTimeMs - positionUpdatedAtMs, 0)
            : 0;
        const elapsedAfterReceipt = Math.max(nowMs - receivedAtMs, 0);

        positionMs += elapsedBeforeReceipt + elapsedAfterReceipt;
    }

    if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
        return Math.min(positionMs, Math.max(durationMs, 0));
    }

    return positionMs;
};
