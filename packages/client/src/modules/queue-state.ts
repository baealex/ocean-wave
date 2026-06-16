export interface QueueDerivedState {
    selected: number | null;
    currentTrackId: string | null;
    queueLength: number;
}

export interface QueueRestoreState extends QueueDerivedState {
    items: string[];
    sourceItems: string[];
    currentTime: number;
    progress: number;
}

export interface QueueRestoreSnapshot {
    selected?: unknown;
    currentTrackId?: unknown;
    currentTime?: unknown;
    items?: unknown;
    sourceItems?: unknown;
}

const RESUME_ENDING_GRACE_SECONDS = 3;

const isValidSelectedIndex = (items: string[], selected: number | null) => {
    return selected !== null && selected >= 0 && selected < items.length;
};

export const getCurrentTrackId = (items: string[], selected: number | null) => {
    if (selected === null) {
        return null;
    }

    if (!isValidSelectedIndex(items, selected)) {
        return null;
    }

    return items[selected];
};

export const getSelectedIndexForTrack = (items: string[], trackId: string | null) => {
    if (!trackId) {
        return null;
    }

    const index = items.indexOf(trackId);

    return index >= 0 ? index : null;
};

export const deriveQueueState = (items: string[], selected: number | null): QueueDerivedState => {
    const currentTrackId = getCurrentTrackId(items, selected);

    return {
        selected: currentTrackId === null ? null : selected,
        currentTrackId,
        queueLength: items.length
    };
};

export const deriveQueueStateFromTrack = (items: string[], trackId: string | null) => {
    return deriveQueueState(items, getSelectedIndexForTrack(items, trackId));
};

const getStringItems = (value: unknown) => {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
};

export const getSafeResumeTime = (time: unknown, duration: number | undefined) => {
    if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) {
        return 0;
    }

    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        return time;
    }

    if (time >= duration - RESUME_ENDING_GRACE_SECONDS) {
        return 0;
    }

    return Math.min(time, duration);
};

export const restoreQueueState = (
    snapshot: QueueRestoreSnapshot,
    isTrackAvailable: (id: string) => boolean,
    getTrackDuration: (id: string) => number | undefined
): QueueRestoreState => {
    const items = getStringItems(snapshot.items).filter(isTrackAvailable);
    const sourceItems = getStringItems(snapshot.sourceItems).filter(isTrackAvailable);
    const selectedTrackId = typeof snapshot.currentTrackId === 'string'
        ? snapshot.currentTrackId
        : null;
    const selectedFromTrack = getSelectedIndexForTrack(items, selectedTrackId);
    const selectedFromSnapshot = typeof snapshot.selected === 'number'
        ? snapshot.selected
        : null;
    const selected = selectedTrackId ? selectedFromTrack : selectedFromSnapshot;
    const queueState = deriveQueueState(items, selected);
    const currentTime = queueState.currentTrackId
        ? getSafeResumeTime(snapshot.currentTime, getTrackDuration(queueState.currentTrackId))
        : 0;

    return {
        ...queueState,
        items,
        sourceItems,
        currentTime,
        progress: 0
    };
};

export const reorderQueueItems = (items: string[], activeId: string, overId: string) => {
    const oldIndex = items.indexOf(activeId);
    const newIndex = items.indexOf(overId);

    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
        return items;
    }

    return moveQueueItemToIndex(items, activeId, newIndex);
};

export const moveQueueItemToIndex = (items: string[], activeId: string, targetIndex: number) => {
    const oldIndex = items.indexOf(activeId);

    if (oldIndex < 0) {
        return items;
    }

    const safeTargetIndex = Math.min(Math.max(targetIndex, 0), items.length - 1);

    if (oldIndex === safeTargetIndex) {
        return items;
    }

    const nextItems = [...items];
    const [movedItem] = nextItems.splice(oldIndex, 1);

    nextItems.splice(safeTargetIndex, 0, movedItem);

    return nextItems;
};
