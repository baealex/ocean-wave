import classNames from 'classnames';
import type {
    ButtonHTMLAttributes,
    FocusEvent,
    ReactNode
} from 'react';
import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';

import {
    resolveFixedVirtualSortableDropIndex,
    resolveFixedVirtualSortableDropSlot,
    resolveFixedVirtualSortableIndexes,
    resolveFixedVirtualSortableIndicatorTop,
    resolveFixedVirtualSortableItemTop,
    resolveFixedVirtualSortableLayout,
    resolveFixedVirtualSortableRange,
    resolveFixedVirtualSortableScrollTop
} from '~/modules/fixed-virtual-sortable-list';

const cx = classNames;

export interface FixedVirtualSortableHandleProps {
    'aria-describedby': string;
    'aria-disabled': boolean;
    'aria-keyshortcuts': string;
    'aria-label': string;
    onKeyDown: NonNullable<ButtonHTMLAttributes<HTMLButtonElement>['onKeyDown']>;
    onPointerDown: NonNullable<ButtonHTMLAttributes<HTMLButtonElement>['onPointerDown']>;
}

export interface FixedVirtualSortableRenderProps {
    handleProps: FixedVirtualSortableHandleProps;
    isDragging: boolean;
    isDragOverlay: boolean;
}

interface FixedVirtualSortableListProps<T> {
    ariaLabel: string;
    className?: string;
    disabled?: boolean;
    dragIndicatorClassName?: string;
    dragOverlayClassName?: string;
    getHandleLabel?: (item: T, index: number) => string;
    getItemLabel: (item: T, index: number) => string;
    getKey: (item: T, index: number) => string | number;
    itemHeight: number;
    items: T[];
    onReorder: (sourceIndex: number, targetIndex: number) => void;
    overscanPx?: number;
    renderItem: (
        item: T,
        index: number,
        sortable: FixedVirtualSortableRenderProps
    ) => ReactNode;
    rowGap?: number;
}

interface DragState<T> {
    activeIndex: number;
    activeKey: string | number;
    dropSlot: number;
    grabOffsetY: number;
    item: T;
    pointerClientY: number;
    pointerContentY: number;
    pointerId: number;
}

type DragMeta<T> = Pick<
    DragState<T>,
    'activeIndex' | 'activeKey' | 'grabOffsetY' | 'item' | 'pointerId'
>;

const keyboardTargetIndex = (
    key: string,
    currentIndex: number,
    itemCount: number
) => {
    if (key === 'Home') {
        return 0;
    }

    if (key === 'End') {
        return Math.max(itemCount - 1, 0);
    }

    const direction = {
        ArrowUp: -1,
        ArrowLeft: -1,
        ArrowDown: 1,
        ArrowRight: 1
    }[key];

    if (direction === undefined) {
        return null;
    }

    return Math.min(Math.max(currentIndex + direction, 0), itemCount - 1);
};

export default function FixedVirtualSortableList<T>({
    ariaLabel,
    className,
    disabled = false,
    dragIndicatorClassName,
    dragOverlayClassName,
    getHandleLabel = (item, index) => `Reorder ${getItemLabel(item, index)}`,
    getItemLabel,
    getKey,
    itemHeight,
    items,
    onReorder,
    overscanPx,
    renderItem,
    rowGap = 0
}: FixedVirtualSortableListProps<T>) {
    const instructionsId = useId();
    const listRef = useRef<HTMLDivElement>(null);
    const scrollRootRef = useRef<HTMLElement | null>(null);
    const listOffsetTopRef = useRef(0);
    const dragStateRef = useRef<DragState<T> | null>(null);
    const dragListenersCleanupRef = useRef<(() => void) | null>(null);
    const itemsRef = useRef(items);
    const getKeyRef = useRef(getKey);
    const getItemLabelRef = useRef(getItemLabel);
    const onReorderRef = useRef(onReorder);
    const disabledRef = useRef(disabled);
    const [focusedItemKey, setFocusedItemKey] = useState<string | number | null>(null);
    const [dragState, setDragState] = useState<DragState<T> | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const layout = useMemo(() => resolveFixedVirtualSortableLayout({
        itemCount: items.length,
        itemHeight,
        rowGap
    }), [itemHeight, items.length, rowGap]);
    const resolvedOverscanPx = overscanPx ?? layout.rowStride * 5;
    const [visibleRange, setVisibleRange] = useState(() => (
        resolveFixedVirtualSortableRange({
            layout,
            scrollTop: 0,
            viewportHeight: typeof window === 'undefined' ? layout.rowStride * 8 : window.innerHeight,
            overscanPx: resolvedOverscanPx
        })
    ));

    itemsRef.current = items;
    getKeyRef.current = getKey;
    getItemLabelRef.current = getItemLabel;
    onReorderRef.current = onReorder;
    disabledRef.current = disabled;

    const findIndexByKey = useCallback((key: string | number) => {
        return itemsRef.current.findIndex((item, index) => (
            getKeyRef.current(item, index) === key
        ));
    }, []);
    const focusedItemIndex = useMemo(() => {
        if (focusedItemKey === null) {
            return -1;
        }

        return items.findIndex((item, index) => getKey(item, index) === focusedItemKey);
    }, [focusedItemKey, getKey, items]);
    const draggedItemIndex = useMemo(() => {
        if (!dragState) {
            return -1;
        }

        return items.findIndex((item, index) => getKey(item, index) === dragState.activeKey);
    }, [dragState, getKey, items]);
    const renderedIndexes = resolveFixedVirtualSortableIndexes({
        ...visibleRange,
        itemCount: items.length,
        retainedIndexes: [
            focusedItemIndex >= 0 ? focusedItemIndex : null,
            draggedItemIndex >= 0 ? draggedItemIndex : null
        ]
    });
    const dropIndicatorTop = dragState
        ? resolveFixedVirtualSortableIndicatorTop(layout, dragState.dropSlot)
        : null;
    const dragOverlayTop = dragState
        ? dragState.pointerContentY - dragState.grabOffsetY
        : null;

    const cleanupDragSession = useCallback(() => {
        dragListenersCleanupRef.current?.();
        dragListenersCleanupRef.current = null;
        dragStateRef.current = null;
        setDragState(null);
    }, []);

    const keepKeyboardTargetVisible = useCallback((targetIndex: number) => {
        window.requestAnimationFrame(() => {
            const scrollRootNode = scrollRootRef.current;

            if (!scrollRootNode) {
                return;
            }

            const nextScrollTop = resolveFixedVirtualSortableScrollTop({
                layout,
                listOffsetTop: listOffsetTopRef.current,
                itemIndex: targetIndex,
                scrollTop: scrollRootNode.scrollTop,
                viewportHeight: scrollRootNode.clientHeight,
                leadingPadding: Math.min(layout.itemHeight, scrollRootNode.clientHeight / 4),
                trailingPadding: Math.min(24, layout.itemHeight / 2)
            });

            if (nextScrollTop !== scrollRootNode.scrollTop) {
                scrollRootNode.scrollTop = nextScrollTop;
            }
        });
    }, [layout]);

    const syncDragPointer = useCallback((
        pointerClientY: number,
        meta: DragMeta<T>
    ) => {
        const listNode = listRef.current;

        if (!listNode) {
            return;
        }

        const pointerContentY = pointerClientY - listNode.getBoundingClientRect().top;
        const dragCenterY = pointerContentY - meta.grabOffsetY + layout.itemHeight / 2;
        const nextDragState = {
            ...meta,
            pointerClientY,
            pointerContentY,
            dropSlot: resolveFixedVirtualSortableDropSlot({
                itemCount: itemsRef.current.length,
                rowStride: layout.rowStride,
                centerY: dragCenterY
            })
        } satisfies DragState<T>;

        dragStateRef.current = nextDragState;
        setDragState(nextDragState);
    }, [layout.itemHeight, layout.rowStride]);

    useLayoutEffect(() => {
        scrollRootRef.current = listRef.current?.closest('.main-container') as HTMLElement | null;
    }, []);

    useEffect(() => {
        const listNode = listRef.current;
        const scrollRootNode = scrollRootRef.current;

        if (!listNode || !scrollRootNode) {
            return;
        }

        let animationFrameId = 0;

        const commitVisibleRange = () => {
            const nextRange = resolveFixedVirtualSortableRange({
                layout,
                scrollTop: Math.max(
                    scrollRootNode.scrollTop - listOffsetTopRef.current,
                    0
                ),
                viewportHeight: scrollRootNode.clientHeight,
                overscanPx: resolvedOverscanPx
            });

            setVisibleRange((previousRange) => {
                if (
                    previousRange.startIndex === nextRange.startIndex
                    && previousRange.endIndex === nextRange.endIndex
                ) {
                    return previousRange;
                }

                return nextRange;
            });
        };

        const syncListMetrics = () => {
            const scrollRootRect = scrollRootNode.getBoundingClientRect();
            const listRect = listNode.getBoundingClientRect();
            listOffsetTopRef.current = listRect.top
                - scrollRootRect.top
                + scrollRootNode.scrollTop;
            commitVisibleRange();
        };

        const updateVisibleRange = () => {
            animationFrameId = 0;
            commitVisibleRange();
        };

        const scheduleVisibleRangeUpdate = () => {
            if (animationFrameId !== 0) {
                return;
            }

            animationFrameId = window.requestAnimationFrame(updateVisibleRange);
        };

        syncListMetrics();
        scrollRootNode.addEventListener('scroll', scheduleVisibleRangeUpdate, { passive: true });

        const resizeObserver = new ResizeObserver(syncListMetrics);
        resizeObserver.observe(scrollRootNode);
        resizeObserver.observe(listNode);

        return () => {
            scrollRootNode.removeEventListener('scroll', scheduleVisibleRangeUpdate);
            resizeObserver.disconnect();

            if (animationFrameId !== 0) {
                window.cancelAnimationFrame(animationFrameId);
            }
        };
    }, [layout, resolvedOverscanPx]);

    useEffect(() => {
        if (focusedItemKey !== null && focusedItemIndex === -1) {
            setFocusedItemKey(null);
        }
    }, [focusedItemIndex, focusedItemKey]);

    useEffect(() => {
        const activeDragState = dragStateRef.current;

        if (activeDragState && findIndexByKey(activeDragState.activeKey) === -1) {
            cleanupDragSession();
        }
    }, [cleanupDragSession, findIndexByKey, items]);

    useEffect(() => {
        if (disabled && dragStateRef.current) {
            cleanupDragSession();
        }
    }, [cleanupDragSession, disabled]);

    useEffect(() => {
        return () => {
            dragListenersCleanupRef.current?.();
        };
    }, []);

    const hasActiveDrag = dragState !== null;

    useEffect(() => {
        if (!hasActiveDrag) {
            return;
        }

        const scrollRootNode = scrollRootRef.current;

        if (!scrollRootNode) {
            return;
        }

        let animationFrameId = 0;

        const stepAutoScroll = () => {
            const activeDragState = dragStateRef.current;

            if (!activeDragState) {
                return;
            }

            const containerRect = scrollRootNode.getBoundingClientRect();
            const threshold = Math.min(72, containerRect.height / 3);
            const maxStep = 18;
            let delta = 0;

            if (activeDragState.pointerClientY < containerRect.top + threshold) {
                const progress = 1
                    - (activeDragState.pointerClientY - containerRect.top) / threshold;
                delta = -Math.ceil(Math.min(Math.max(progress, 0), 1) * maxStep);
            } else if (activeDragState.pointerClientY > containerRect.bottom - threshold) {
                const progress = 1
                    - (containerRect.bottom - activeDragState.pointerClientY) / threshold;
                delta = Math.ceil(Math.min(Math.max(progress, 0), 1) * maxStep);
            }

            if (delta !== 0) {
                const maxScrollTop = Math.max(
                    scrollRootNode.scrollHeight - scrollRootNode.clientHeight,
                    0
                );
                const nextScrollTop = Math.min(
                    Math.max(scrollRootNode.scrollTop + delta, 0),
                    maxScrollTop
                );

                if (nextScrollTop !== scrollRootNode.scrollTop) {
                    scrollRootNode.scrollTop = nextScrollTop;
                    syncDragPointer(activeDragState.pointerClientY, activeDragState);
                }
            }

            animationFrameId = window.requestAnimationFrame(stepAutoScroll);
        };

        animationFrameId = window.requestAnimationFrame(stepAutoScroll);

        return () => {
            window.cancelAnimationFrame(animationFrameId);
        };
    }, [hasActiveDrag, syncDragPointer]);

    const moveItemByKeyboard = (
        item: T,
        index: number
    ): FixedVirtualSortableHandleProps['onKeyDown'] => (event) => {
        if (disabledRef.current) {
            return;
        }

        const currentItems = itemsRef.current;
        const activeKey = getKeyRef.current(item, index);
        const currentIndex = findIndexByKey(activeKey);
        const targetIndex = keyboardTargetIndex(
            event.key,
            currentIndex,
            currentItems.length
        );

        if (targetIndex === null || currentIndex < 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const label = getItemLabelRef.current(currentItems[currentIndex], currentIndex);

        if (targetIndex === currentIndex) {
            setAnnouncement(
                `${label} is already at position ${currentIndex + 1} of ${currentItems.length}.`
            );
            return;
        }

        onReorderRef.current(currentIndex, targetIndex);
        keepKeyboardTargetVisible(targetIndex);
        setAnnouncement(
            `${label} moved to position ${targetIndex + 1} of ${currentItems.length}.`
        );
    };

    const startReorderDrag = (
        item: T,
        index: number
    ): FixedVirtualSortableHandleProps['onPointerDown'] => (event) => {
        if (disabledRef.current || event.button !== 0 || !event.isPrimary) {
            return;
        }

        const rowNode = event.currentTarget.closest('[data-virtual-sortable-index]');

        if (!(rowNode instanceof HTMLElement)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        cleanupDragSession();

        const rowRect = rowNode.getBoundingClientRect();
        const meta = {
            activeIndex: index,
            activeKey: getKeyRef.current(item, index),
            grabOffsetY: event.clientY - rowRect.top,
            item,
            pointerId: event.pointerId
        } satisfies DragMeta<T>;

        syncDragPointer(event.clientY, meta);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== meta.pointerId) {
                return;
            }

            moveEvent.preventDefault();
            syncDragPointer(moveEvent.clientY, meta);
        };

        const finishDrag = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== meta.pointerId) {
                return;
            }

            const activeDragState = dragStateRef.current;
            cleanupDragSession();

            if (!activeDragState) {
                return;
            }

            const currentItems = itemsRef.current;
            const currentIndex = findIndexByKey(activeDragState.activeKey);

            if (currentIndex < 0) {
                return;
            }

            const targetIndex = resolveFixedVirtualSortableDropIndex(
                currentItems.length,
                currentIndex,
                activeDragState.dropSlot
            );
            const label = getItemLabelRef.current(currentItems[currentIndex], currentIndex);

            if (targetIndex !== currentIndex) {
                onReorderRef.current(currentIndex, targetIndex);
                setAnnouncement(
                    `${label} moved to position ${targetIndex + 1} of ${currentItems.length}.`
                );
            } else {
                setAnnouncement(
                    `${label} remained at position ${currentIndex + 1} of ${currentItems.length}.`
                );
            }
        };

        const cancelDrag = (cancelEvent?: PointerEvent) => {
            if (cancelEvent && cancelEvent.pointerId !== meta.pointerId) {
                return;
            }

            cleanupDragSession();
            const currentIndex = findIndexByKey(meta.activeKey);

            if (currentIndex >= 0) {
                const currentItems = itemsRef.current;
                const label = getItemLabelRef.current(currentItems[currentIndex], currentIndex);
                setAnnouncement(
                    `Sorting cancelled. ${label} returned to position ${currentIndex + 1} of ${currentItems.length}.`
                );
            }
        };

        const handleCancelKey = (keyEvent: KeyboardEvent) => {
            if (keyEvent.key === 'Escape') {
                keyEvent.preventDefault();
                cancelDrag();
            }
        };

        window.addEventListener('pointermove', handlePointerMove, { passive: false });
        window.addEventListener('pointerup', finishDrag);
        window.addEventListener('pointercancel', cancelDrag);
        window.addEventListener('keydown', handleCancelKey);

        dragListenersCleanupRef.current = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', finishDrag);
            window.removeEventListener('pointercancel', cancelDrag);
            window.removeEventListener('keydown', handleCancelKey);
        };
    };

    const getHandleProps = (item: T, index: number): FixedVirtualSortableHandleProps => ({
        'aria-describedby': instructionsId,
        'aria-disabled': disabled,
        'aria-keyshortcuts': 'ArrowUp ArrowDown ArrowLeft ArrowRight Home End',
        'aria-label': getHandleLabel(item, index),
        onKeyDown: moveItemByKeyboard(item, index),
        onPointerDown: startReorderDrag(item, index)
    });

    const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
        const indexedItem = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-virtual-sortable-index]'
        );

        if (!indexedItem || !event.currentTarget.contains(indexedItem)) {
            return;
        }

        const index = Number(indexedItem.dataset.virtualSortableIndex);

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

    return (
        <>
            <span id={instructionsId} className="sr-only">
                Drag this handle with a pointer, or use arrow keys to move one position. Use Home or End to move to the first or last position.
            </span>
            <div
                ref={listRef}
                role="list"
                aria-label={ariaLabel}
                className={cx('relative w-full', className)}
                style={{
                    height: `${layout.totalHeight}px`,
                    minHeight: `${layout.totalHeight}px`
                }}
                onFocusCapture={handleFocusCapture}
                onBlurCapture={handleBlurCapture}>
                {renderedIndexes.map((index) => {
                    const item = items[index];
                    const key = getKey(item, index);
                    const isDragging = dragState?.activeKey === key;

                    return (
                        <div
                            key={key}
                            role="listitem"
                            aria-posinset={index + 1}
                            aria-setsize={items.length}
                            data-virtual-sortable-index={index}
                            className="absolute inset-x-0 min-w-0"
                            style={{
                                top: `${resolveFixedVirtualSortableItemTop(layout, index)}px`,
                                height: `${layout.itemHeight}px`
                            }}>
                            {renderItem(item, index, {
                                handleProps: getHandleProps(item, index),
                                isDragging,
                                isDragOverlay: false
                            })}
                        </div>
                    );
                })}
                {dropIndicatorTop !== null && (
                    <div
                        aria-hidden="true"
                        className={cx(
                            'pointer-events-none absolute left-[72px] right-2 z-[5] h-[3.2px] -translate-y-1/2 rounded-full bg-[var(--b-color-point-light)] shadow-[0_0_0_1px_var(--b-color-border)]',
                            dragIndicatorClassName
                        )}
                        style={{ top: `${dropIndicatorTop}px` }}
                    />
                )}
                {dragState && dragOverlayTop !== null && (
                    <div
                        aria-hidden="true"
                        inert
                        className={cx(
                            'pointer-events-none absolute inset-x-0 z-[4] drop-shadow-[var(--b-shadow-queue-drag)]',
                            dragOverlayClassName
                        )}
                        style={{
                            top: `${dragOverlayTop}px`,
                            height: `${layout.itemHeight}px`
                        }}>
                        {renderItem(dragState.item, dragState.activeIndex, {
                            handleProps: getHandleProps(dragState.item, dragState.activeIndex),
                            isDragging: true,
                            isDragOverlay: true
                        })}
                    </div>
                )}
            </div>
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {announcement}
            </div>
        </>
    );
}
