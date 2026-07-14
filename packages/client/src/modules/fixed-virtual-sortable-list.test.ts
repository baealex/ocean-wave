import { describe, expect, it } from 'vitest';

import {
    moveArrayItem,
    resolveFixedVirtualSortableDropIndex,
    resolveFixedVirtualSortableDropSlot,
    resolveFixedVirtualSortableIndexes,
    resolveFixedVirtualSortableIndicatorTop,
    resolveFixedVirtualSortableItemTop,
    resolveFixedVirtualSortableLayout,
    resolveFixedVirtualSortableRange,
    resolveFixedVirtualSortableScrollTop
} from './fixed-virtual-sortable-list';

describe('fixed virtual sortable list layout', () => {
    const layout = resolveFixedVirtualSortableLayout({
        itemCount: 2_547,
        itemHeight: 80,
        rowGap: 0
    });

    it('builds a fixed layout for a large playlist', () => {
        expect(layout).toEqual({
            itemCount: 2_547,
            itemHeight: 80,
            rowGap: 0,
            rowStride: 80,
            totalHeight: 203_760
        });
        expect(resolveFixedVirtualSortableItemTop(layout, 2_000)).toBe(160_000);
    });

    it('renders only the viewport and overscan while retaining active rows', () => {
        const range = resolveFixedVirtualSortableRange({
            layout,
            scrollTop: 80_000,
            viewportHeight: 800,
            overscanPx: 400
        });

        expect(range).toEqual({
            startIndex: 995,
            endIndex: 1_015
        });
        expect(resolveFixedVirtualSortableIndexes({
            ...range,
            itemCount: layout.itemCount,
            retainedIndexes: [0, 2_000]
        })).toEqual([
            0,
            ...Array.from({ length: 20 }, (_, index) => index + 995),
            2_000
        ]);
    });

    it('keeps a keyboard-moved row inside the scroll viewport', () => {
        expect(resolveFixedVirtualSortableScrollTop({
            layout,
            listOffsetTop: 637,
            itemIndex: 0,
            scrollTop: 160_000,
            viewportHeight: 832,
            leadingPadding: 80,
            trailingPadding: 24
        })).toBe(557);
        expect(resolveFixedVirtualSortableScrollTop({
            layout,
            listOffsetTop: 637,
            itemIndex: 2_000,
            scrollTop: 0,
            viewportHeight: 832,
            leadingPadding: 80,
            trailingPadding: 24
        })).toBe(159_909);
        expect(resolveFixedVirtualSortableScrollTop({
            layout,
            listOffsetTop: 637,
            itemIndex: 0,
            scrollTop: 0,
            viewportHeight: 832,
            leadingPadding: 80,
            trailingPadding: 24
        })).toBe(0);
    });
});

describe('fixed virtual sortable list reorder', () => {
    const layout = resolveFixedVirtualSortableLayout({
        itemCount: 4,
        itemHeight: 86,
        rowGap: 12
    });

    it('resolves pointer positions into drop slots and target indexes', () => {
        expect(resolveFixedVirtualSortableDropSlot({
            itemCount: 4,
            rowStride: layout.rowStride,
            centerY: 20
        })).toBe(0);
        expect(resolveFixedVirtualSortableDropSlot({
            itemCount: 4,
            rowStride: layout.rowStride,
            centerY: 150
        })).toBe(2);
        expect(resolveFixedVirtualSortableDropSlot({
            itemCount: 4,
            rowStride: layout.rowStride,
            centerY: 1_000
        })).toBe(4);
        expect(resolveFixedVirtualSortableDropIndex(4, 0, 3)).toBe(2);
        expect(resolveFixedVirtualSortableDropIndex(4, 3, 1)).toBe(1);
    });

    it('positions the drop indicator between fixed rows', () => {
        expect(resolveFixedVirtualSortableIndicatorTop(layout, 0)).toBe(0);
        expect(resolveFixedVirtualSortableIndicatorTop(layout, 2)).toBe(190);
        expect(resolveFixedVirtualSortableIndicatorTop(layout, 4)).toBe(380);
    });

    it('moves an item without mutating the source array', () => {
        const items = ['a', 'b', 'c', 'd'];

        expect(moveArrayItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
        expect(items).toEqual(['a', 'b', 'c', 'd']);
        expect(moveArrayItem(items, 2, 2)).toBe(items);
    });
});
