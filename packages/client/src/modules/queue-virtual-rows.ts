import type { QueueTone } from '~/pages/Queue/QueueDndItem';
import { resolveFixedVirtualSortableDropIndex } from './fixed-virtual-sortable-list';

export const QUEUE_TRACK_CARD_HEIGHT = 68;
export const QUEUE_TRACK_ROW_GAP = 0;
export const QUEUE_TRACK_ROW_HEIGHT = QUEUE_TRACK_CARD_HEIGHT + QUEUE_TRACK_ROW_GAP;
export const QUEUE_SECTION_ROW_HEIGHT = 36;
export const QUEUE_VIRTUAL_OVERSCAN_PX = QUEUE_TRACK_ROW_HEIGHT * 5;

interface QueueVirtualRowBase {
    key: string;
    top: number;
    height: number;
}

export interface QueueVirtualSectionRow extends QueueVirtualRowBase {
    type: 'section';
    current?: boolean;
    label: string;
}

export interface QueueVirtualTrackRow extends QueueVirtualRowBase {
    type: 'track';
    id: string;
    index: number;
    tone: QueueTone;
}

export type QueueVirtualRow = QueueVirtualSectionRow | QueueVirtualTrackRow;

export interface QueueVirtualLayout {
    rows: QueueVirtualRow[];
    totalHeight: number;
}

const appendSectionRow = (
    rows: QueueVirtualRow[],
    key: string,
    label: string,
    top: number,
    current = false
) => {
    rows.push({
        type: 'section',
        key,
        label,
        current,
        top,
        height: QUEUE_SECTION_ROW_HEIGHT
    });

    return top + QUEUE_SECTION_ROW_HEIGHT;
};

const appendTrackRows = (
    rows: QueueVirtualRow[],
    items: string[],
    startIndex: number,
    endIndex: number,
    tone: QueueTone,
    top: number
) => {
    let nextTop = top;

    for (let index = startIndex; index < endIndex; index += 1) {
        rows.push({
            type: 'track',
            key: items[index],
            id: items[index],
            index,
            tone,
            top: nextTop,
            height: QUEUE_TRACK_ROW_HEIGHT
        });
        nextTop += QUEUE_TRACK_ROW_HEIGHT;
    }

    return nextTop;
};

export const buildQueueVirtualLayout = (items: string[], currentIndex: number) => {
    const rows: QueueVirtualRow[] = [];
    let top = 0;

    if (currentIndex > 0) {
        top = appendSectionRow(rows, 'section-earlier', 'Earlier', top);
        top = appendTrackRows(rows, items, 0, currentIndex, 'past', top);
    }

    if (currentIndex >= 0 && currentIndex < items.length) {
        top = appendTrackRows(rows, items, currentIndex, currentIndex + 1, 'current', top);

        if (currentIndex + 1 < items.length) {
            top = appendSectionRow(rows, 'section-up-next', 'Up next', top);
            top = appendTrackRows(rows, items, currentIndex + 1, items.length, 'upcoming', top);
        }
    } else if (items.length > 0) {
        top = appendSectionRow(rows, 'section-queue', 'Queue', top);
        top = appendTrackRows(rows, items, 0, items.length, 'upcoming', top);
    }

    return {
        rows,
        totalHeight: top
    } satisfies QueueVirtualLayout;
};

export const getVisibleQueueVirtualRows = (
    rows: QueueVirtualRow[],
    scrollTop: number,
    viewportHeight: number,
    overscanPx = QUEUE_VIRTUAL_OVERSCAN_PX
) => {
    const safeScrollTop = Math.max(scrollTop, 0);
    const safeViewportHeight = Math.max(viewportHeight, 0);
    const rangeStart = Math.max(safeScrollTop - Math.max(overscanPx, 0), 0);
    const rangeEnd = safeScrollTop + safeViewportHeight + Math.max(overscanPx, 0);

    return rows.filter((row) => {
        const rowBottom = row.top + row.height;
        return rowBottom >= rangeStart && row.top <= rangeEnd;
    });
};

export const findQueueTrackRow = (rows: QueueVirtualRow[], trackIndex: number) => {
    return rows.find((row): row is QueueVirtualTrackRow => {
        return row.type === 'track' && row.index === trackIndex;
    }) ?? null;
};

export const getQueueTrackRows = (rows: QueueVirtualRow[]) => {
    return rows.filter((row): row is QueueVirtualTrackRow => row.type === 'track');
};

export const findQueueDropSlot = (rows: QueueVirtualRow[], centerY: number) => {
    const trackRows = getQueueTrackRows(rows);

    if (trackRows.length === 0) {
        return 0;
    }

    for (let slotIndex = 0; slotIndex < trackRows.length; slotIndex += 1) {
        const row = trackRows[slotIndex];
        const rowMidpoint = row.top + row.height / 2;

        if (centerY < rowMidpoint) {
            return slotIndex;
        }
    }

    return trackRows.length;
};

export const getQueueDropIndicatorTop = (rows: QueueVirtualRow[], dropSlot: number) => {
    const trackRows = getQueueTrackRows(rows);

    if (trackRows.length === 0) {
        return 0;
    }

    if (dropSlot <= 0) {
        return trackRows[0].top + QUEUE_TRACK_ROW_GAP / 2;
    }

    if (dropSlot >= trackRows.length) {
        const lastTrackRow = trackRows[trackRows.length - 1];
        return lastTrackRow.top + lastTrackRow.height - QUEUE_TRACK_ROW_GAP / 2;
    }

    return trackRows[dropSlot].top;
};

export const resolveQueueDropIndex = resolveFixedVirtualSortableDropIndex;
