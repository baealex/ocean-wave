import {
    DEFAULT_FIXED_VIRTUAL_OVERSCAN_PX,
    resolveFixedVirtualRange
} from './fixed-virtual-list';

const COMPACT_BREAKPOINT = 640;
const COMPACT_HORIZONTAL_PADDING = 16;
const REGULAR_HORIZONTAL_PADDING = 24;
const COMPACT_COLUMN_GAP = 12;
const REGULAR_COLUMN_GAP = 16;
const COMPACT_ROW_GAP = 20;
const REGULAR_ROW_GAP = 24;
const COMPACT_MIN_ITEM_WIDTH = 136;
const REGULAR_MIN_ITEM_WIDTH = 168;
const MAX_ITEM_WIDTH = 232;
const MAX_COLUMN_COUNT = 6;
const VERTICAL_PADDING_TOP = 16;
const VERTICAL_PADDING_BOTTOM = 32;

export interface FixedVirtualGridLayout {
    columnGap: number;
    columnCount: number;
    gridOffsetLeft: number;
    gridWidth: number;
    itemHeight: number;
    itemWidth: number;
    rowCount: number;
    rowGap: number;
    rowStride: number;
    totalHeight: number;
    verticalPaddingTop: number;
}

export const resolveFixedVirtualGridLayout = ({
    containerWidth,
    count,
    itemHeightOffset
}: {
    containerWidth: number;
    count: number;
    itemHeightOffset: number;
}): FixedVirtualGridLayout => {
    const safeContainerWidth = Math.max(containerWidth, 0);
    const safeCount = Math.max(Math.floor(count), 0);
    const safeItemHeightOffset = Math.max(itemHeightOffset, 0);
    const compact = safeContainerWidth < COMPACT_BREAKPOINT;
    const horizontalPadding = compact
        ? COMPACT_HORIZONTAL_PADDING
        : REGULAR_HORIZONTAL_PADDING;
    const columnGap = compact ? COMPACT_COLUMN_GAP : REGULAR_COLUMN_GAP;
    const rowGap = compact ? COMPACT_ROW_GAP : REGULAR_ROW_GAP;
    const minItemWidth = compact
        ? COMPACT_MIN_ITEM_WIDTH
        : REGULAR_MIN_ITEM_WIDTH;
    const maxColumnCount = compact ? 2 : MAX_COLUMN_COUNT;
    const availableWidth = Math.max(safeContainerWidth - horizontalPadding * 2, 0);
    const fittedColumnCount = Math.floor(
        (availableWidth + columnGap) / (minItemWidth + columnGap)
    );
    const columnCount = Math.max(1, Math.min(fittedColumnCount, maxColumnCount));
    const maximumGridWidth = columnCount * MAX_ITEM_WIDTH
        + (columnCount - 1) * columnGap;
    const gridWidth = Math.min(availableWidth, maximumGridWidth);
    const gridOffsetLeft = horizontalPadding
        + Math.max((availableWidth - gridWidth) / 2, 0);
    const itemWidth = Math.max(
        (gridWidth - (columnCount - 1) * columnGap) / columnCount,
        0
    );
    const itemHeight = itemWidth + safeItemHeightOffset;
    const rowStride = itemHeight + rowGap;
    const rowCount = Math.ceil(safeCount / columnCount);
    const contentHeight = rowCount > 0
        ? rowCount * itemHeight + (rowCount - 1) * rowGap
        : 0;
    const totalHeight = rowCount > 0
        ? VERTICAL_PADDING_TOP + contentHeight + VERTICAL_PADDING_BOTTOM
        : 0;

    return {
        columnGap,
        columnCount,
        gridOffsetLeft,
        gridWidth,
        itemHeight,
        itemWidth,
        rowCount,
        rowGap,
        rowStride,
        totalHeight,
        verticalPaddingTop: VERTICAL_PADDING_TOP
    };
};

export const resolveFixedVirtualGridRange = ({
    layout,
    scrollTop,
    viewportHeight,
    overscanPx = DEFAULT_FIXED_VIRTUAL_OVERSCAN_PX
}: {
    layout: FixedVirtualGridLayout;
    scrollTop: number;
    viewportHeight: number;
    overscanPx?: number;
}) => {
    const range = resolveFixedVirtualRange({
        count: layout.rowCount,
        rowHeight: layout.rowStride,
        scrollTop,
        viewportHeight,
        overscanPx
    });

    return {
        startRow: Math.min(range.startIndex, layout.rowCount),
        endRow: Math.min(range.endIndex, layout.rowCount)
    };
};

export const resolveFixedVirtualGridRowIndexes = ({
    startRow,
    endRow,
    focusedItemIndex,
    columnCount,
    rowCount
}: {
    startRow: number;
    endRow: number;
    focusedItemIndex: number | null;
    columnCount: number;
    rowCount: number;
}) => {
    const rows = new Set<number>();

    for (let row = Math.max(startRow, 0); row < Math.min(endRow, rowCount); row++) {
        rows.add(row);
    }

    if (focusedItemIndex !== null && focusedItemIndex >= 0 && columnCount > 0) {
        const focusedRow = Math.floor(focusedItemIndex / columnCount);

        if (focusedRow < rowCount) {
            rows.add(focusedRow);
        }
    }

    return [...rows].sort((left, right) => left - right);
};
