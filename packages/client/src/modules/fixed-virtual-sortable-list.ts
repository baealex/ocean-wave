import { resolveFixedVirtualRange } from './fixed-virtual-list';

export interface FixedVirtualSortableLayout {
    itemCount: number;
    itemHeight: number;
    rowGap: number;
    rowStride: number;
    totalHeight: number;
}

export const resolveFixedVirtualSortableLayout = ({
    itemCount,
    itemHeight,
    rowGap
}: {
    itemCount: number;
    itemHeight: number;
    rowGap: number;
}): FixedVirtualSortableLayout => {
    const safeItemCount = Math.max(Math.floor(itemCount), 0);
    const safeItemHeight = Math.max(itemHeight, 0);
    const safeRowGap = Math.max(rowGap, 0);
    const rowStride = safeItemHeight + safeRowGap;
    const totalHeight = safeItemCount > 0
        ? safeItemCount * safeItemHeight + (safeItemCount - 1) * safeRowGap
        : 0;

    return {
        itemCount: safeItemCount,
        itemHeight: safeItemHeight,
        rowGap: safeRowGap,
        rowStride,
        totalHeight
    };
};

export const resolveFixedVirtualSortableRange = ({
    layout,
    scrollTop,
    viewportHeight,
    overscanPx
}: {
    layout: FixedVirtualSortableLayout;
    scrollTop: number;
    viewportHeight: number;
    overscanPx: number;
}) => {
    const range = resolveFixedVirtualRange({
        count: layout.itemCount,
        rowHeight: layout.rowStride,
        scrollTop,
        viewportHeight,
        overscanPx
    });

    return {
        startIndex: range.startIndex,
        endIndex: range.endIndex
    };
};

export const resolveFixedVirtualSortableIndexes = ({
    startIndex,
    endIndex,
    itemCount,
    retainedIndexes = []
}: {
    startIndex: number;
    endIndex: number;
    itemCount: number;
    retainedIndexes?: Array<number | null>;
}) => {
    const indexes = new Set<number>();
    const safeItemCount = Math.max(Math.floor(itemCount), 0);

    for (
        let index = Math.max(Math.floor(startIndex), 0);
        index < Math.min(Math.ceil(endIndex), safeItemCount);
        index += 1
    ) {
        indexes.add(index);
    }

    retainedIndexes.forEach((index) => {
        if (index !== null && index >= 0 && index < safeItemCount) {
            indexes.add(Math.floor(index));
        }
    });

    return [...indexes].sort((left, right) => left - right);
};

export const resolveFixedVirtualSortableItemTop = (
    layout: FixedVirtualSortableLayout,
    index: number
) => Math.max(Math.floor(index), 0) * layout.rowStride;

export const resolveFixedVirtualSortableDropSlot = ({
    itemCount,
    rowStride,
    centerY
}: {
    itemCount: number;
    rowStride: number;
    centerY: number;
}) => {
    const safeItemCount = Math.max(Math.floor(itemCount), 0);

    if (safeItemCount === 0 || rowStride <= 0) {
        return 0;
    }

    const slot = Math.floor((Math.max(centerY, 0) + rowStride / 2) / rowStride);

    return Math.min(Math.max(slot, 0), safeItemCount);
};

export const resolveFixedVirtualSortableDropIndex = (
    itemCount: number,
    activeIndex: number,
    dropSlot: number
) => {
    if (itemCount <= 0 || activeIndex < 0) {
        return 0;
    }

    const safeDropSlot = Math.min(Math.max(dropSlot, 0), itemCount);
    const nextIndex = safeDropSlot > activeIndex
        ? safeDropSlot - 1
        : safeDropSlot;

    return Math.min(Math.max(nextIndex, 0), itemCount - 1);
};

export const resolveFixedVirtualSortableIndicatorTop = (
    layout: FixedVirtualSortableLayout,
    dropSlot: number
) => {
    if (layout.itemCount === 0) {
        return 0;
    }

    if (dropSlot <= 0) {
        return 0;
    }

    if (dropSlot >= layout.itemCount) {
        return layout.totalHeight;
    }

    return dropSlot * layout.rowStride - layout.rowGap / 2;
};

export const resolveFixedVirtualSortableScrollTop = ({
    layout,
    listOffsetTop,
    itemIndex,
    scrollTop,
    viewportHeight,
    leadingPadding = 0,
    trailingPadding = 0
}: {
    layout: FixedVirtualSortableLayout;
    listOffsetTop: number;
    itemIndex: number;
    scrollTop: number;
    viewportHeight: number;
    leadingPadding?: number;
    trailingPadding?: number;
}) => {
    if (
        layout.itemCount === 0
        || itemIndex < 0
        || itemIndex >= layout.itemCount
        || viewportHeight <= 0
    ) {
        return Math.max(scrollTop, 0);
    }

    const safeScrollTop = Math.max(scrollTop, 0);
    const maxViewportPadding = viewportHeight / 2;
    const safeLeadingPadding = Math.min(
        Math.max(leadingPadding, 0),
        maxViewportPadding
    );
    const safeTrailingPadding = Math.min(
        Math.max(trailingPadding, 0),
        maxViewportPadding
    );
    const itemTop = Math.max(listOffsetTop, 0)
        + resolveFixedVirtualSortableItemTop(layout, itemIndex);
    const itemBottom = itemTop + layout.itemHeight;
    const visibleTop = safeScrollTop + safeLeadingPadding;
    const visibleBottom = safeScrollTop + viewportHeight - safeTrailingPadding;

    if (itemTop < visibleTop) {
        return Math.max(itemTop - safeLeadingPadding, 0);
    }

    if (itemBottom > visibleBottom) {
        return Math.max(
            itemBottom + safeTrailingPadding - viewportHeight,
            0
        );
    }

    return safeScrollTop;
};

export const moveArrayItem = <T>(
    items: T[],
    sourceIndex: number,
    targetIndex: number
) => {
    if (
        sourceIndex < 0
        || sourceIndex >= items.length
        || targetIndex < 0
        || targetIndex >= items.length
        || sourceIndex === targetIndex
    ) {
        return items;
    }

    const nextItems = [...items];
    const [movedItem] = nextItems.splice(sourceIndex, 1);

    nextItems.splice(targetIndex, 0, movedItem);

    return nextItems;
};
