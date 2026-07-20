import type { PlaybackSessionCheckpoint } from './playback-session';

const PLAYBACK_CHECKPOINT_DATABASE_NAME = 'ocean-wave-playback';
const PLAYBACK_CHECKPOINT_DATABASE_VERSION = 2;
const LEGACY_PLAYBACK_CHECKPOINT_STORE_NAME = 'playback-checkpoints';
const BRANCHED_PLAYBACK_CHECKPOINT_STORE_NAME = 'playback-checkpoint-branches';
const PLAYBACK_RESUME_CHECKPOINT_KEY = 'ocean-wave-playback-resume';

const memoryCheckpointStore = new Map<string, PlaybackSessionCheckpoint>();
const checkpointWriteQueue = new Map<string, Promise<void>>();

interface PersistedPlaybackCheckpoint extends PlaybackSessionCheckpoint {
    checkpointKey: string;
}

const checkpointBranchId = (checkpoint: PlaybackSessionCheckpoint) => {
    return checkpoint.branchId ?? checkpoint.clientSessionId;
};

const checkpointKey = (clientSessionId: string, branchId: string) => {
    return JSON.stringify([clientSessionId, branchId]);
};

const keyForCheckpoint = (checkpoint: PlaybackSessionCheckpoint) => {
    return checkpointKey(
        checkpoint.clientSessionId,
        checkpointBranchId(checkpoint)
    );
};

const checkpointSnapshot = (checkpoint: PlaybackSessionCheckpoint) => ({
    clientSessionId: checkpoint.clientSessionId,
    branchId: checkpointBranchId(checkpoint),
    parentBranchId: checkpoint.parentBranchId ?? null,
    branchBasePlayedMs: checkpoint.branchBasePlayedMs ?? 0,
    trackId: checkpoint.trackId,
    startedAt: checkpoint.startedAt,
    accumulatedPlayedMs: checkpoint.accumulatedPlayedMs,
    hadSeek: checkpoint.hadSeek === true,
    lastResumedAt: checkpoint.lastResumedAt ?? null,
    active: checkpoint.active,
    updatedAt: checkpoint.updatedAt,
    source: checkpoint.source,
    endedAt: checkpoint.endedAt ?? null,
    endReason: checkpoint.endReason ?? null
});

const matchesCheckpointSnapshot = (
    current: PlaybackSessionCheckpoint,
    expected: PlaybackSessionCheckpoint
) => {
    return JSON.stringify(checkpointSnapshot(current))
        === JSON.stringify(checkpointSnapshot(expected));
};

const fromPersistedCheckpoint = (
    persisted: PersistedPlaybackCheckpoint
): PlaybackSessionCheckpoint => {
    const { checkpointKey: _checkpointKey, ...checkpoint } = persisted;
    return checkpoint;
};

const cloneCheckpoint = (checkpoint: PlaybackSessionCheckpoint) => {
    return JSON.parse(JSON.stringify(checkpoint)) as PlaybackSessionCheckpoint;
};

const hasIndexedDb = () => {
    return typeof indexedDB !== 'undefined';
};

const getSessionStorage = () => {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
};

export const savePlaybackResumeCheckpoint = (
    checkpoint: PlaybackSessionCheckpoint
) => {
    try {
        getSessionStorage()?.setItem(
            PLAYBACK_RESUME_CHECKPOINT_KEY,
            JSON.stringify(checkpoint)
        );
    } catch {
        // IndexedDB remains the durable delivery fallback when storage is blocked.
    }
};

export const readPlaybackResumeCheckpoint = () => {
    try {
        const serialized = getSessionStorage()?.getItem(
            PLAYBACK_RESUME_CHECKPOINT_KEY
        );

        return serialized
            ? JSON.parse(serialized) as PlaybackSessionCheckpoint
            : null;
    } catch {
        return null;
    }
};

export const clearPlaybackResumeCheckpoint = (clientSessionId?: string) => {
    try {
        const storage = getSessionStorage();
        if (!storage) {
            return;
        }

        if (clientSessionId) {
            const checkpoint = readPlaybackResumeCheckpoint();
            if (checkpoint?.clientSessionId !== clientSessionId) {
                return;
            }
        }

        storage.removeItem(PLAYBACK_RESUME_CHECKPOINT_KEY);
    } catch {
        // Resume lineage is best effort and must never block audio playback.
    }
};

const openPlaybackCheckpointDatabase = async () => {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(
            PLAYBACK_CHECKPOINT_DATABASE_NAME,
            PLAYBACK_CHECKPOINT_DATABASE_VERSION
        );

        request.onupgradeneeded = () => {
            const database = request.result;

            if (
                !database.objectStoreNames.contains(
                    LEGACY_PLAYBACK_CHECKPOINT_STORE_NAME
                )
            ) {
                database.createObjectStore(
                    LEGACY_PLAYBACK_CHECKPOINT_STORE_NAME,
                    { keyPath: 'clientSessionId' }
                );
            }
            if (
                !database.objectStoreNames.contains(
                    BRANCHED_PLAYBACK_CHECKPOINT_STORE_NAME
                )
            ) {
                database.createObjectStore(
                    BRANCHED_PLAYBACK_CHECKPOINT_STORE_NAME,
                    { keyPath: 'checkpointKey' }
                );
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(
            request.error ?? new Error('Unable to open playback checkpoint database.')
        );
    });
};

const withPlaybackCheckpointStore = async <T>(
    storeName: string,
    mode: IDBTransactionMode,
    handler: (store: IDBObjectStore) => IDBRequest<T> | void
) => {
    const database = await openPlaybackCheckpointDatabase();

    try {
        return await new Promise<T | void>((resolve, reject) => {
            const transaction = database.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = handler(store);

            transaction.oncomplete = () => resolve(request?.result);
            transaction.onerror = () => reject(
                transaction.error ?? new Error('Playback checkpoint transaction failed.')
            );

            if (request) {
                request.onerror = () => reject(
                    request.error ?? new Error('Playback checkpoint request failed.')
                );
            }
        });
    } finally {
        database.close();
    }
};

const writePlaybackCheckpoint = async (checkpoint: PlaybackSessionCheckpoint) => {
    const key = keyForCheckpoint(checkpoint);
    if (!hasIndexedDb()) {
        memoryCheckpointStore.set(key, cloneCheckpoint(checkpoint));
        return;
    }

    await withPlaybackCheckpointStore(
        BRANCHED_PLAYBACK_CHECKPOINT_STORE_NAME,
        'readwrite',
        (store) => store.put({
            ...checkpoint,
            checkpointKey: key
        } satisfies PersistedPlaybackCheckpoint)
    );
};

export const savePlaybackCheckpoint = async (checkpoint: PlaybackSessionCheckpoint) => {
    const key = keyForCheckpoint(checkpoint);
    const previousWrite = checkpointWriteQueue.get(key)
        ?? Promise.resolve();
    const currentWrite = previousWrite
        .catch(() => undefined)
        .then(() => writePlaybackCheckpoint(checkpoint));
    checkpointWriteQueue.set(key, currentWrite);

    try {
        await currentWrite;
    } finally {
        if (checkpointWriteQueue.get(key) === currentWrite) {
            checkpointWriteQueue.delete(key);
        }
    }
};

export const listPlaybackCheckpoints = async () => {
    if (!hasIndexedDb()) {
        return Array.from(memoryCheckpointStore.values())
            .map((checkpoint) => cloneCheckpoint(checkpoint))
            .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    }

    const legacyCheckpoints = await withPlaybackCheckpointStore<
        PlaybackSessionCheckpoint[]
    >(
        LEGACY_PLAYBACK_CHECKPOINT_STORE_NAME,
        'readonly',
        (store) => store.getAll()
    );
    const branchedCheckpoints = await withPlaybackCheckpointStore<
        PersistedPlaybackCheckpoint[]
    >(
        BRANCHED_PLAYBACK_CHECKPOINT_STORE_NAME,
        'readonly',
        (store) => store.getAll()
    );
    const checkpointsByKey = new Map<string, PlaybackSessionCheckpoint>();
    for (const checkpoint of legacyCheckpoints ?? []) {
        checkpointsByKey.set(keyForCheckpoint(checkpoint), checkpoint);
    }
    for (const persisted of branchedCheckpoints ?? []) {
        const checkpoint = fromPersistedCheckpoint(persisted);
        checkpointsByKey.set(keyForCheckpoint(checkpoint), checkpoint);
    }

    return Array.from(checkpointsByKey.values())
        .map((checkpoint) => cloneCheckpoint(checkpoint))
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
};

export const getPlaybackCheckpoint = async (
    clientSessionId: string,
    branchId?: string
) => {
    const checkpoints = await listPlaybackCheckpoints();
    const matches = checkpoints.filter(checkpoint => (
        checkpoint.clientSessionId === clientSessionId
        && (
            branchId === undefined
            || checkpointBranchId(checkpoint) === branchId
        )
    ));

    return matches[matches.length - 1] ?? null;
};

const deleteMatchingIndexedDbCheckpoint = async (
    storeName: string,
    key: IDBValidKey,
    expected: PlaybackSessionCheckpoint
) => {
    const database = await openPlaybackCheckpointDatabase();

    try {
        return await new Promise<boolean>((resolve, reject) => {
            const transaction = database.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            let deleted = false;

            request.onsuccess = () => {
                const stored = request.result as
                    | PlaybackSessionCheckpoint
                    | PersistedPlaybackCheckpoint
                    | undefined;
                if (!stored) {
                    return;
                }

                const current = 'checkpointKey' in stored
                    ? fromPersistedCheckpoint(stored)
                    : stored;
                if (!matchesCheckpointSnapshot(current, expected)) {
                    return;
                }

                const deleteRequest = store.delete(key);
                deleteRequest.onsuccess = () => {
                    deleted = true;
                };
                deleteRequest.onerror = () => reject(
                    deleteRequest.error
                    ?? new Error('Unable to delete playback checkpoint.')
                );
            };
            request.onerror = () => reject(
                request.error
                ?? new Error('Unable to read playback checkpoint before deletion.')
            );
            transaction.oncomplete = () => resolve(deleted);
            transaction.onerror = () => reject(
                transaction.error
                ?? new Error('Playback checkpoint deletion transaction failed.')
            );
        });
    } finally {
        database.close();
    }
};

export const deletePlaybackCheckpoint = async (
    expected: PlaybackSessionCheckpoint
) => {
    const key = keyForCheckpoint(expected);
    if (!hasIndexedDb()) {
        const current = memoryCheckpointStore.get(key);
        if (current && matchesCheckpointSnapshot(current, expected)) {
            memoryCheckpointStore.delete(key);
        }
        return;
    }

    await deleteMatchingIndexedDbCheckpoint(
        LEGACY_PLAYBACK_CHECKPOINT_STORE_NAME,
        expected.clientSessionId,
        expected
    );
    await deleteMatchingIndexedDbCheckpoint(
        BRANCHED_PLAYBACK_CHECKPOINT_STORE_NAME,
        key,
        expected
    );
};

export const clearPlaybackCheckpoints = async () => {
    if (!hasIndexedDb()) {
        memoryCheckpointStore.clear();
        return;
    }

    await withPlaybackCheckpointStore(
        LEGACY_PLAYBACK_CHECKPOINT_STORE_NAME,
        'readwrite',
        (store) => store.clear()
    );
    await withPlaybackCheckpointStore(
        BRANCHED_PLAYBACK_CHECKPOINT_STORE_NAME,
        'readwrite',
        (store) => store.clear()
    );
};
