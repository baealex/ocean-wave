import {
    type FocusEvent,
    type ReactNode,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';

import {
    resolveFixedVirtualGridLayout,
    resolveFixedVirtualGridRange,
    resolveFixedVirtualGridRowIndexes
} from '~/modules/fixed-virtual-grid';

interface FixedVirtualGridProps<T> {
    ariaLabel: string;
    emptyState?: ReactNode;
    getKey: (item: T, index: number) => string | number;
    itemHeightOffset: number;
    items: T[];
    overscanPx?: number;
    renderItem: (item: T, index: number) => ReactNode;
}

export default function FixedVirtualGrid<T>({
    ariaLabel,
    emptyState = null,
    getKey,
    itemHeightOffset,
    items,
    overscanPx = 576,
    renderItem
}: FixedVirtualGridProps<T>) {
    const gridRef = useRef<HTMLDivElement>(null);
    const scrollRootRef = useRef<HTMLElement | null>(null);
    const gridOffsetTopRef = useRef(0);
    const [containerWidth, setContainerWidth] = useState(() => (
        typeof window === 'undefined' ? 0 : window.innerWidth
    ));
    const [focusedItemKey, setFocusedItemKey] = useState<string | number | null>(null);
    const layout = useMemo(() => resolveFixedVirtualGridLayout({
        containerWidth,
        count: items.length,
        itemHeightOffset
    }), [containerWidth, itemHeightOffset, items.length]);
    const [visibleRange, setVisibleRange] = useState(() => resolveFixedVirtualGridRange({
        layout,
        scrollTop: 0,
        viewportHeight: typeof window === 'undefined' ? 800 : window.innerHeight,
        overscanPx
    }));
    const focusedItemIndex = useMemo(() => {
        if (focusedItemKey === null) {
            return -1;
        }

        return items.findIndex((item, index) => (
            getKey(item, index) === focusedItemKey
        ));
    }, [focusedItemKey, getKey, items]);

    useLayoutEffect(() => {
        const gridNode = gridRef.current;

        if (!gridNode) {
            return;
        }

        scrollRootRef.current = gridNode.closest('.main-container') as HTMLElement | null;
        setContainerWidth(gridNode.clientWidth);
    }, [items.length]);

    useEffect(() => {
        const gridNode = gridRef.current;
        const scrollRootNode = scrollRootRef.current;

        if (!gridNode || !scrollRootNode) {
            return;
        }

        let animationFrameId = 0;

        const commitVisibleRange = (scrollTop: number) => {
            const nextRange = resolveFixedVirtualGridRange({
                layout,
                scrollTop: Math.max(
                    scrollTop
                    - gridOffsetTopRef.current
                    - layout.verticalPaddingTop,
                    0
                ),
                viewportHeight: scrollRootNode.clientHeight,
                overscanPx
            });

            setVisibleRange((previousRange) => {
                if (
                    previousRange.startRow === nextRange.startRow
                    && previousRange.endRow === nextRange.endRow
                ) {
                    return previousRange;
                }

                return nextRange;
            });
        };

        const syncGridMetrics = () => {
            const scrollRootRect = scrollRootNode.getBoundingClientRect();
            const gridRect = gridNode.getBoundingClientRect();
            gridOffsetTopRef.current = gridRect.top
                - scrollRootRect.top
                + scrollRootNode.scrollTop;
            setContainerWidth(gridNode.clientWidth);
            commitVisibleRange(scrollRootNode.scrollTop);
        };

        const updateScrollRange = () => {
            animationFrameId = 0;
            commitVisibleRange(scrollRootNode.scrollTop);
        };

        const scheduleScrollRangeUpdate = () => {
            if (animationFrameId !== 0) {
                return;
            }

            animationFrameId = window.requestAnimationFrame(updateScrollRange);
        };

        syncGridMetrics();
        scrollRootNode.addEventListener('scroll', scheduleScrollRangeUpdate, { passive: true });

        const resizeObserver = new ResizeObserver(syncGridMetrics);
        resizeObserver.observe(scrollRootNode);
        resizeObserver.observe(gridNode);

        return () => {
            scrollRootNode.removeEventListener('scroll', scheduleScrollRangeUpdate);
            resizeObserver.disconnect();

            if (animationFrameId !== 0) {
                window.cancelAnimationFrame(animationFrameId);
            }
        };
    }, [layout, overscanPx]);

    useEffect(() => {
        if (focusedItemKey !== null && focusedItemIndex === -1) {
            setFocusedItemKey(null);
        }
    }, [focusedItemIndex, focusedItemKey]);

    const renderedRows = resolveFixedVirtualGridRowIndexes({
        ...visibleRange,
        focusedItemIndex: focusedItemIndex >= 0 ? focusedItemIndex : null,
        columnCount: layout.columnCount,
        rowCount: layout.rowCount
    });
    const renderedItems = renderedRows.flatMap((rowIndex) => {
        const startIndex = rowIndex * layout.columnCount;

        return items.slice(
            startIndex,
            startIndex + layout.columnCount
        ).map((item, columnIndex) => {
            const index = startIndex + columnIndex;

            return {
                columnIndex,
                index,
                item,
                key: getKey(item, index),
                rowIndex
            };
        });
    });

    const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
        const indexedItem = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-virtual-grid-index]'
        );

        if (!indexedItem || !event.currentTarget.contains(indexedItem)) {
            return;
        }

        const index = Number(indexedItem.dataset.virtualGridIndex);

        if (Number.isInteger(index) && index >= 0 && index < items.length) {
            setFocusedItemKey(getKey(items[index], index));
        }
    };

    const handleBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
        const nextTarget = event.relatedTarget;

        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
            return;
        }

        setFocusedItemKey(null);
    };

    if (items.length === 0) {
        return emptyState;
    }

    return (
        <div
            ref={gridRef}
            role="list"
            aria-label={ariaLabel}
            className="relative w-full"
            style={{
                height: `${layout.totalHeight}px`,
                minHeight: `${layout.totalHeight}px`
            }}
            onFocusCapture={handleFocusCapture}
            onBlurCapture={handleBlurCapture}>
            {renderedItems.map(({
                columnIndex,
                index,
                item,
                key,
                rowIndex
            }) => (
                <div
                    key={key}
                    role="listitem"
                    aria-posinset={index + 1}
                    aria-setsize={items.length}
                    data-virtual-grid-index={index}
                    className="absolute min-w-0"
                    style={{
                        top: `${layout.verticalPaddingTop + rowIndex * layout.rowStride}px`,
                        left: `${layout.horizontalPadding + columnIndex * (layout.itemWidth + layout.columnGap)}px`,
                        width: `${layout.itemWidth}px`,
                        height: `${layout.itemHeight}px`
                    }}>
                    {renderItem(item, index)}
                </div>
            ))}
        </div>
    );
}
