import { describe, expect, it } from 'vitest';

import {
    resolveFixedVirtualGridLayout,
    resolveFixedVirtualGridRange,
    resolveFixedVirtualGridRowIndexes
} from './fixed-virtual-grid';

const ITEM_HEIGHT_OFFSET = 88;

describe('fixed virtual grid layout', () => {
    it.each([
        [320, 2],
        [390, 2],
        [752, 4],
        [768, 4],
        [1024, 5],
        [1440, 5]
    ])('uses responsive columns at %ipx', (containerWidth, columnCount) => {
        expect(resolveFixedVirtualGridLayout({
            containerWidth,
            count: 851,
            itemHeightOffset: ITEM_HEIGHT_OFFSET
        }).columnCount).toBe(columnCount);
    });

    it('resolves rows and total height for a large desktop collection', () => {
        const layout = resolveFixedVirtualGridLayout({
            containerWidth: 1152,
            count: 851,
            itemHeightOffset: ITEM_HEIGHT_OFFSET
        });

        expect(layout).toMatchObject({
            columnGap: 16,
            columnCount: 5,
            itemWidth: 208,
            itemHeight: 296,
            rowCount: 171,
            rowStride: 320
        });
        expect(layout.totalHeight).toBe(54744);
    });

    it.each([
        [1, 390, 1],
        [4, 390, 2],
        [644, 1152, 129],
        [851, 1152, 171]
    ])('resolves %i items into fixed rows at %ipx', (count, containerWidth, rowCount) => {
        expect(resolveFixedVirtualGridLayout({
            containerWidth,
            count,
            itemHeightOffset: ITEM_HEIGHT_OFFSET
        }).rowCount).toBe(rowCount);
    });

    it('caps artwork width on very wide containers', () => {
        const layout = resolveFixedVirtualGridLayout({
            containerWidth: 1920,
            count: 6,
            itemHeightOffset: ITEM_HEIGHT_OFFSET
        });

        expect(layout.columnCount).toBe(5);
        expect(layout.itemWidth).toBe(232);
        expect(layout.gridWidth).toBe(1224);
        expect(layout.gridOffsetLeft).toBe(348);
        expect(layout.gridOffsetLeft * 2 + layout.gridWidth).toBe(1920);
    });

    it('returns zero content height for an empty collection', () => {
        const layout = resolveFixedVirtualGridLayout({
            containerWidth: 390,
            count: 0,
            itemHeightOffset: ITEM_HEIGHT_OFFSET
        });

        expect(layout.rowCount).toBe(0);
        expect(layout.totalHeight).toBe(0);
    });
});

describe('fixed virtual grid range', () => {
    it('virtualizes collection rows with overscan', () => {
        const layout = resolveFixedVirtualGridLayout({
            containerWidth: 1152,
            count: 851,
            itemHeightOffset: ITEM_HEIGHT_OFFSET
        });

        expect(resolveFixedVirtualGridRange({
            layout,
            scrollTop: 5000,
            viewportHeight: 800,
            overscanPx: 576
        })).toEqual({
            startRow: 13,
            endRow: 20
        });
    });

    it('retains a focused offscreen row', () => {
        expect(resolveFixedVirtualGridRowIndexes({
            startRow: 10,
            endRow: 14,
            focusedItemIndex: 3,
            columnCount: 4,
            rowCount: 20
        })).toEqual([0, 10, 11, 12, 13]);
    });
});
