import type {
    PlaybackCapability,
    PlaybackDeviceRegistrySnapshot,
    PlaybackEndpointSnapshot
} from '~/api/playback-devices';
import type { PlaybackQueueContextType, PlaybackQueueSnapshot } from '~/api/playback-queue';
import type { PlaybackSessionSnapshot, SharedPlaybackState } from '~/api/playback-session';
import type { Music } from '~/models/type';

const DAY_MS = 24 * 60 * 60 * 1_000;
const RECOVERY_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export const RECENT_PLAYBACK_RECOVERY_MAX_AGE_MS = 30 * DAY_MS;

interface PlaybackTargetSummary {
    capabilities: PlaybackCapability[];
    deviceName: string;
    deviceOnline: boolean | null;
    isRemote: boolean;
    targetEndpointId: string | null;
}

interface LibraryPlaybackSurfaceBase extends PlaybackTargetSummary {
    canTransfer: boolean;
    music: Music | null;
    queueLength: number;
    queuePosition: number | null;
    state: SharedPlaybackState;
}

export interface ActiveLibraryPlaybackSurface extends LibraryPlaybackSurfaceBase {
    kind: 'active';
    state: 'playing' | 'paused';
}

export interface RecoveryLibraryPlaybackSurface extends LibraryPlaybackSurfaceBase {
    contextId: string | null;
    contextTitle: string;
    contextType: PlaybackQueueContextType;
    kind: 'recovery';
    music: Music;
    queuePosition: number;
    state: 'stopped';
    updatedAt: string;
}

export interface OutputLibraryPlaybackSurface extends LibraryPlaybackSurfaceBase {
    kind: 'output';
    state: 'stopped';
}

export type LibraryPlaybackSurface =
    | ActiveLibraryPlaybackSurface
    | RecoveryLibraryPlaybackSurface
    | OutputLibraryPlaybackSurface;

export interface ResolveLibraryPlaybackSurfaceInput {
    localEndpointId: string | null;
    musicMap: ReadonlyMap<string, Music>;
    nowMs: number;
    queue: PlaybackQueueSnapshot | null;
    registry: PlaybackDeviceRegistrySnapshot | null;
    session: PlaybackSessionSnapshot | null;
}

const findEndpoint = (
    registry: PlaybackDeviceRegistrySnapshot | null,
    endpointId: string | null
): { deviceName: string; endpoint: PlaybackEndpointSnapshot } | null => {
    if (!registry || !endpointId) {
        return null;
    }

    for (const device of registry.devices) {
        const endpoint = device.endpoints.find(candidate => candidate.id === endpointId);

        if (endpoint) {
            return { deviceName: device.name, endpoint };
        }
    }

    return null;
};

const resolveTarget = ({
    activeEndpointId,
    localEndpointId,
    registry
}: {
    activeEndpointId: string | null;
    localEndpointId: string | null;
    registry: PlaybackDeviceRegistrySnapshot | null;
}): PlaybackTargetSummary => {
    const target = findEndpoint(registry, activeEndpointId);
    const isRemote = Boolean(
        activeEndpointId
        && localEndpointId
        && activeEndpointId !== localEndpointId
    );
    const isLocal = Boolean(
        activeEndpointId
        && localEndpointId
        && activeEndpointId === localEndpointId
    );

    return {
        capabilities: target?.endpoint.capabilities ?? [],
        deviceName: isLocal
            ? 'This browser'
            : target?.deviceName ?? (isRemote ? 'Another browser' : 'This browser'),
        deviceOnline: target?.endpoint.online ?? (
            isLocal || !activeEndpointId
                ? true
                : registry ? false : null
        ),
        isRemote,
        targetEndpointId: activeEndpointId
    };
};

const parseTimestamp = (value: string) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
};

const resolveRecoveryActivity = (
    queue: PlaybackQueueSnapshot,
    session: PlaybackSessionSnapshot | null,
    selectedMusicId: string,
    nowMs: number
) => {
    const timestamps = [parseTimestamp(queue.updatedAt)];

    if (
        session?.state === 'stopped'
        && session.currentMusicId === selectedMusicId
    ) {
        timestamps.push(parseTimestamp(session.positionUpdatedAt));
    }

    const validTimestamps = timestamps.filter(
        (timestamp): timestamp is number => timestamp !== null
    );
    const updatedAtMs = validTimestamps.length > 0
        ? Math.max(...validTimestamps)
        : null;

    if (
        updatedAtMs === null
        || updatedAtMs > nowMs + RECOVERY_CLOCK_SKEW_MS
        || nowMs - updatedAtMs > RECENT_PLAYBACK_RECOVERY_MAX_AGE_MS
    ) {
        return null;
    }

    return new Date(updatedAtMs).toISOString();
};

const resolveContextTitle = (
    queue: PlaybackQueueSnapshot,
    music: Music
) => {
    const storedTitle = queue.contextTitle?.trim();

    if (storedTitle) {
        return storedTitle;
    }

    switch (queue.contextType) {
        case 'album': return music.album.name;
        case 'playlist': return 'Playlist';
        case 'queue': return 'Saved queue';
    }
};

const resolveQueuePosition = (queue: PlaybackQueueSnapshot | null) => {
    if (
        !queue
        || queue.currentIndex === null
        || !Number.isInteger(queue.currentIndex)
        || queue.currentIndex < 0
        || queue.currentIndex >= queue.musicIds.length
    ) {
        return null;
    }

    return queue.currentIndex;
};

const isNaturalQueueCompletion = ({
    musicMap,
    queue,
    queueIndex,
    session
}: {
    musicMap: ReadonlyMap<string, Music>;
    queue: PlaybackQueueSnapshot | null;
    queueIndex: number | null;
    session: PlaybackSessionSnapshot | null;
}) => {
    if (
        session?.state !== 'stopped'
        || !queue
        || queueIndex === null
        || queue.repeatMode !== 'none'
        || queueIndex !== queue.musicIds.length - 1
        || queue.musicIds[queueIndex] !== session.currentMusicId
    ) {
        return false;
    }

    const music = session.currentMusicId
        ? musicMap.get(session.currentMusicId)
        : null;
    const durationMs = music
        ? Math.max(Math.round(music.duration * 1_000), 0)
        : 0;

    return durationMs > 0
        && session.positionMs >= Math.max(durationMs - 250, 0);
};

export const resolveLibraryPlaybackSurface = ({
    localEndpointId,
    musicMap,
    nowMs,
    queue,
    registry,
    session
}: ResolveLibraryPlaybackSurfaceInput): LibraryPlaybackSurface | null => {
    const activeEndpointId = session?.activeDeviceId ?? null;
    const target = resolveTarget({
        activeEndpointId,
        localEndpointId,
        registry
    });
    const queueIndex = resolveQueuePosition(queue);
    const queueMusicId = queueIndex === null ? null : queue?.musicIds[queueIndex] ?? null;
    const localTarget = findEndpoint(registry, localEndpointId);
    const canTransfer = Boolean(
        target.isRemote
        && target.targetEndpointId
        && target.capabilities.includes('handoff')
        && localTarget?.endpoint.online
        && localTarget.endpoint.capabilities.includes('handoff')
        && session?.currentMusicId
        && queue
        && queueIndex !== null
        && queueMusicId === session.currentMusicId
        && queue.musicIds.length > 0
        && queue.musicIds.every(id => musicMap.has(id))
    );

    if (
        session?.activeDeviceId
        && (session.state === 'playing' || session.state === 'paused')
    ) {
        const music = session.currentMusicId
            ? musicMap.get(session.currentMusicId) ?? null
            : null;

        return {
            ...target,
            canTransfer,
            kind: 'active',
            music,
            queueLength: queue?.musicIds.length ?? 0,
            queuePosition: queueIndex === null ? null : queueIndex + 1,
            state: session.state
        };
    }

    const naturallyCompleted = isNaturalQueueCompletion({
        musicMap,
        queue,
        queueIndex,
        session
    });

    if (!naturallyCompleted && queue && queueIndex !== null && queueMusicId) {
        const music = musicMap.get(queueMusicId) ?? null;
        const updatedAt = music
            ? resolveRecoveryActivity(queue, session, queueMusicId, nowMs)
            : null;

        if (music && updatedAt) {
            return {
                ...target,
                canTransfer,
                contextId: queue.contextId,
                contextTitle: resolveContextTitle(queue, music),
                contextType: queue.contextType,
                kind: 'recovery',
                music,
                queueLength: queue.musicIds.length,
                queuePosition: queueIndex + 1,
                state: 'stopped',
                updatedAt
            };
        }
    }

    if (session?.state === 'stopped' && target.isRemote) {
        const music = session.currentMusicId
            ? musicMap.get(session.currentMusicId) ?? null
            : null;

        return {
            ...target,
            canTransfer,
            kind: 'output',
            music,
            queueLength: queue?.musicIds.length ?? 0,
            queuePosition: queueIndex === null ? null : queueIndex + 1,
            state: 'stopped'
        };
    }

    return null;
};
