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
        [768, 4],
        [1024, 5],
        [1440, 6]
    ])('uses responsive columns at %ipx', (containerWidth, columnCount) => {
        expect(resolveFixedVirtualGridLayout({
            containerWidth,
            count: 851,
            itemHeightOffset: ITEM_HEIGHT_OFFSET
        }).columnCount).toBe(columnCount);
    });

    it('resolves rows and total height for a large desktop collection', () => {
        const layout = resolveFixedVirtualGridLayout({
            containerWidth: 1184,
            count: 851,
            itemHeightOffset: ITEM_HEIGHT_OFFSET
        });

        expect(layout).toMatchObject({
            columnGap: 16,
            columnCount: 6,
            itemWidth: 176,
            itemHeight: 264,
            rowCount: 142,
            rowStride: 288,
            totalHeight: 40920
        });
    });

    it.each([
        [1, 390, 1],
        [4, 390, 2],
        [644, 1184, 108],
        [851, 1184, 142]
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

        expect(layout.columnCount).toBe(6);
        expect(layout.itemWidth).toBe(232);
        expect(layout.gridWidth).toBe(1472);
        expect(layout.gridOffsetLeft).toBe(224);
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
            containerWidth: 1184,
            count: 851,
            itemHeightOffset: ITEM_HEIGHT_OFFSET
        });

        expect(resolveFixedVirtualGridRange({
            layout,
            scrollTop: 5000,
            viewportHeight: 800,
            overscanPx: 576
        })).toEqual({
            startRow: 15,
            endRow: 23
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
