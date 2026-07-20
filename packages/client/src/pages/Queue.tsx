import { cva } from 'class-variance-authority';

import type {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent
} from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MusicActionPanelContent,
    PlaybackQueueConflictNotice,
    RemotePlaybackOwnershipNotice
} from '~/components/music';
import { PlaylistPanelContent } from '~/components/playlist';
import { ActionBar, ActionBarButton, Button, IconButton, ListSelectionToolbar, PageContainer, StateMessage, Text } from '~/components/shared';
import { useBack, useRemotePlaybackOwnership, useStoreValue } from '~/hooks';
import * as Icon from '~/icon';
import type { Music } from '~/models/type';
import { panel } from '~/modules/panel';
import {
    buildQueueVirtualLayout,
    findQueueDropSlot,
    findQueueTrackRow,
    getQueueDropIndicatorTop,
    getQueueTrackRows,
    getVisibleQueueVirtualRows,
    QUEUE_TRACK_CARD_HEIGHT,
    QUEUE_TRACK_ROW_GAP,
    QUEUE_VIRTUAL_OVERSCAN_PX,
    resolveQueueDropIndex
} from '~/modules/queue-virtual-rows';
import { toast } from '~/modules/toast';

import { PlaylistListener } from '~/socket';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';
import type { QueueTone } from './Queue/QueueDndItem';
import QueueItem from './Queue/QueueItem';


interface QueueDragState {
    activeId: string;
    activeIndex: number;
    dropSlot: number;
    grabOffsetY: number;
    music: Music;
    pointerClientY: number;
    pointerContentY: number;
    tone: QueueTone;
}

const queueSectionRowClass = cva(
    'absolute left-0 w-full box-border px-1 pt-2 pb-0.5 text-[var(--b-font-size-caption-compact)] font-medium uppercase tracking-normal text-[var(--b-color-text-muted)] max-sm:pt-2',
    {
        variants: {
            current: {
                true: 'text-[var(--b-color-text-tertiary)]',
                false: ''
            }
        },
        defaultVariants: {
            current: false
        }
    }
);

const queueVirtualItemClass = cva(
    'absolute left-0 w-full',
    {
        variants: {
            dragging: {
                true: 'opacity-15',
                false: ''
            }
        },
        defaultVariants: {
            dragging: false
        }
    }
);

export default function Queue() {
    const back = useBack();
    const navigate = useNavigate();
    const remotePlaybackOwnership = useRemotePlaybackOwnership();

    const [items] = useStoreValue(queueStore, 'items');
    const [selected] = useStoreValue(queueStore, 'selected');
    const [{ musicMap }] = useStore(musicStore);

    const scrollRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const listOffsetTopRef = useRef(0);
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [listViewport, setListViewport] = useState({
        scrollTop: 0,
        height: 0
    });
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [dragState, setDragState] = useState<QueueDragState | null>(null);
    const dragStateRef = useRef<QueueDragState | null>(null);
    const dragListenersCleanupRef = useRef<(() => void) | null>(null);

    const currentIndex = selected ?? -1;
    const queueSummary = currentIndex >= 0
        ? `${currentIndex + 1} of ${items.length} · ${Math.max(items.length - currentIndex - 1, 0)} up next`
        : `${items.length} tracks in session`;

    const virtualLayout = useMemo(() => {
        return buildQueueVirtualLayout(items, currentIndex);
    }, [currentIndex, items]);
    const trackRows = useMemo(() => {
        return getQueueTrackRows(virtualLayout.rows);
    }, [virtualLayout.rows]);
    const virtualRowsRef = useRef(virtualLayout.rows);
    const trackRowsRef = useRef(trackRows);
    const visibleVirtualRows = useMemo(() => {
        return getVisibleQueueVirtualRows(
            virtualLayout.rows,
            listViewport.scrollTop,
            listViewport.height,
            QUEUE_VIRTUAL_OVERSCAN_PX
        );
    }, [listViewport.height, listViewport.scrollTop, virtualLayout.rows]);
    const selectedVirtualRow = useMemo(() => {
        if (selected === null) {
            return null;
        }

        return findQueueTrackRow(virtualLayout.rows, selected);
    }, [selected, virtualLayout.rows]);
    const dragIndicatorTop = dragState
        ? getQueueDropIndicatorTop(virtualLayout.rows, dragState.dropSlot)
        : null;
    const dragOverlayTop = dragState
        ? dragState.pointerContentY - dragState.grabOffsetY
        : null;

    const cleanupDragSession = () => {
        dragListenersCleanupRef.current?.();
        dragListenersCleanupRef.current = null;
        dragStateRef.current = null;
        setDragState(null);
    };

    const syncListViewport = useCallback(() => {
        const scrollNode = scrollRef.current;

        if (!scrollNode) {
            return;
        }

        setListViewport({
            scrollTop: Math.max(scrollNode.scrollTop - listOffsetTopRef.current, 0),
            height: scrollNode.clientHeight
        });
    }, []);

    const syncListMetrics = useCallback(() => {
        const scrollNode = scrollRef.current;
        const listNode = listRef.current;

        if (!scrollNode || !listNode) {
            return;
        }

        const containerRect = scrollNode.getBoundingClientRect();
        const listRect = listNode.getBoundingClientRect();
        listOffsetTopRef.current = listRect.top - containerRect.top + scrollNode.scrollTop;
        syncListViewport();
    }, [syncListViewport]);

    const syncDragPointer = (
        pointerClientY: number,
        meta: Pick<QueueDragState, 'activeId' | 'activeIndex' | 'grabOffsetY' | 'music' | 'tone'>
    ) => {
        const listNode = listRef.current;

        if (!listNode) {
            return;
        }

        const pointerContentY = pointerClientY - listNode.getBoundingClientRect().top;
        const dragCenterY = pointerContentY - meta.grabOffsetY + QUEUE_TRACK_CARD_HEIGHT / 2;
        const nextDragState = {
            ...meta,
            pointerClientY,
            pointerContentY,
            dropSlot: findQueueDropSlot(virtualRowsRef.current, dragCenterY)
        } satisfies QueueDragState;

        dragStateRef.current = nextDragState;
        setDragState(nextDragState);
    };

    useEffect(() => {
        setSelectedItems([]);
    }, [isSelectMode]);

    useEffect(() => {
        virtualRowsRef.current = virtualLayout.rows;
        trackRowsRef.current = trackRows;
    }, [trackRows, virtualLayout.rows]);

    useEffect(() => {
        dragStateRef.current = dragState;
    }, [dragState]);

    useEffect(() => {
        setSelectedItems((prev) => prev.filter((id) => items.includes(id)));
    }, [items]);

    useEffect(() => {
        if (isSelectMode) {
            cleanupDragSession();
        }
    }, [isSelectMode]);

    useEffect(() => {
        return () => {
            dragListenersCleanupRef.current?.();
        };
    }, []);

    useEffect(() => {
        const scrollNode = scrollRef.current;
        const listNode = listRef.current;

        if (!scrollNode || !listNode) {
            return;
        }

        let animationFrameId = 0;

        const updateViewport = () => {
            animationFrameId = 0;
            syncListViewport();
        };

        const scheduleViewportUpdate = () => {
            if (animationFrameId !== 0) {
                return;
            }

            animationFrameId = window.requestAnimationFrame(updateViewport);
        };

        syncListMetrics();

        scrollNode.addEventListener('scroll', scheduleViewportUpdate, { passive: true });

        const resizeObserver = new ResizeObserver(() => {
            syncListMetrics();
        });

        resizeObserver.observe(scrollNode);
        resizeObserver.observe(listNode);

        return () => {
            scrollNode.removeEventListener('scroll', scheduleViewportUpdate);
            resizeObserver.disconnect();

            if (animationFrameId !== 0) {
                window.cancelAnimationFrame(animationFrameId);
            }
        };
    }, [items.length, isSelectMode, syncListMetrics, syncListViewport]);

    useLayoutEffect(() => {
        const scrollNode = scrollRef.current;

        if (selected === null || !scrollNode) {
            return;
        }

        if (!selectedVirtualRow) {
            return;
        }

        const nextTop = Math.max(
            0,
            listOffsetTopRef.current + selectedVirtualRow.top - 80
        );
        scrollNode.scrollTop = nextTop;
        syncListViewport();
    }, [selectedVirtualRow?.top, syncListViewport]);

    useEffect(() => {
        if (!dragState) {
            return;
        }

        let animationFrameId = 0;
        const scrollNode = scrollRef.current;

        if (!scrollNode) {
            return;
        }

        const stepAutoScroll = () => {
            const activeDragState = dragStateRef.current;

            if (!activeDragState) {
                return;
            }

            const containerRect = scrollNode.getBoundingClientRect();
            const threshold = 72;
            const maxStep = 18;
            let delta = 0;

            if (activeDragState.pointerClientY < containerRect.top + threshold) {
                const progress = 1 - (activeDragState.pointerClientY - containerRect.top) / threshold;
                delta = -Math.ceil(Math.max(progress, 0) * maxStep);
            } else if (activeDragState.pointerClientY > containerRect.bottom - threshold) {
                const progress = 1 - (containerRect.bottom - activeDragState.pointerClientY) / threshold;
                delta = Math.ceil(Math.max(progress, 0) * maxStep);
            }

            if (delta !== 0) {
                const nextScrollTop = Math.min(
                    Math.max(scrollNode.scrollTop + delta, 0),
                    scrollNode.scrollHeight - scrollNode.clientHeight
                );

                if (nextScrollTop !== scrollNode.scrollTop) {
                    scrollNode.scrollTop = nextScrollTop;
                    syncDragPointer(activeDragState.pointerClientY, activeDragState);
                }
            }

            animationFrameId = window.requestAnimationFrame(stepAutoScroll);
        };

        animationFrameId = window.requestAnimationFrame(stepAutoScroll);

        return () => {
            window.cancelAnimationFrame(animationFrameId);
        };
    }, [dragState]);

    const openMusicActions = (music: Music) => {
        panel.open({
            content: (
                <MusicActionPanelContent
                    id={music.id}
                    onAlbumClick={() => navigate(`/album/${music.album.id}`)}
                    onArtistClick={() => navigate(`/artist/${music.artist.id}`)}
                />
            )
        });
    };

    const startReorderDrag = (
        id: string,
        index: number,
        tone: QueueTone,
        music: Music
    ) => (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (isSelectMode || event.button !== 0) {
            return;
        }

        const rowNode = event.currentTarget.closest('[data-queue-index]');

        if (!(rowNode instanceof HTMLElement)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const rowRect = rowNode.getBoundingClientRect();
        const meta = {
            activeId: id,
            activeIndex: index,
            grabOffsetY: event.clientY - rowRect.top,
            music,
            tone
        };

        syncDragPointer(event.clientY, meta);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            moveEvent.preventDefault();
            syncDragPointer(moveEvent.clientY, meta);
        };

        const finishDrag = () => {
            const activeDragState = dragStateRef.current;

            cleanupDragSession();

            if (!activeDragState) {
                return;
            }

            const targetIndex = resolveQueueDropIndex(
                trackRowsRef.current.length,
                activeDragState.activeIndex,
                activeDragState.dropSlot
            );

            queueStore.reorderToIndex(activeDragState.activeId, targetIndex);
        };

        const cancelDrag = () => {
            cleanupDragSession();
        };

        window.addEventListener('pointermove', handlePointerMove, { passive: false });
        window.addEventListener('pointerup', finishDrag, { once: true });
        window.addEventListener('pointercancel', cancelDrag, { once: true });

        dragListenersCleanupRef.current = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', finishDrag);
            window.removeEventListener('pointercancel', cancelDrag);
        };
    };

    const moveQueueItemByKeyboard = (
        id: string,
        index: number
    ) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        const direction = {
            ArrowUp: -1,
            ArrowLeft: -1,
            ArrowDown: 1,
            ArrowRight: 1
        }[event.key];

        if (direction === undefined) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        queueStore.reorderToIndex(id, Math.max(index + direction, 0));
    };

    const toggleSelectedItem = (id: string) => {
        setSelectedItems((prev) => prev.includes(id)
            ? prev.filter((item) => item !== id)
            : [...prev, id]);
    };

    const renderQueueItem = (
        id: string,
        index: number,
        tone: QueueTone,
        options?: {
            className?: string;
            style?: CSSProperties;
        }
    ) => {
        const music = musicMap.get(id);

        if (!music) {
            return null;
        }

        const sharedProps = {
            music,
            index,
            tone,
            isSelectMode,
            className: options?.className,
            isSelected: selectedItems.includes(id),
            playbackDisabled: Boolean(remotePlaybackOwnership),
            onSelect: () => toggleSelectedItem(id),
            onClick: () => {
                if (!remotePlaybackOwnership) {
                    queueStore.select(index);
                }
            },
            onOpenActions: () => openMusicActions(music),
            onReorderKeyDown: moveQueueItemByKeyboard(id, index),
            onReorderPointerDown: startReorderDrag(id, index, tone, music),
            style: options?.style
        };

        return (
            <QueueItem
                key={id}
                {...sharedProps}
            />
        );
    };

    const renderVirtualRows = () => {
        return (
            <>
                {visibleVirtualRows.map((row) => {
                    if (row.type === 'section') {
                        return (
                            <li
                                key={row.key}
                                className={queueSectionRowClass({ current: row.current })}
                                style={{
                                    top: `${row.top}px`,
                                    height: `${row.height}px`
                                }}>
                                {row.label}
                            </li>
                        );
                    }

                    return renderQueueItem(row.id, row.index, row.tone, {
                        className: queueVirtualItemClass({ dragging: dragState?.activeId === row.id }),
                        style: {
                            top: `${row.top + QUEUE_TRACK_ROW_GAP / 2}px`,
                            height: `${QUEUE_TRACK_CARD_HEIGHT}px`
                        }
                    });
                })}
                {dragIndicatorTop !== null && (
                    <li
                        className="pointer-events-none absolute left-[72px] right-2 z-[3] mt-[-0.16px] h-[3.2px] list-none rounded-full bg-[var(--b-color-point-light)] shadow-[0_0_0_1px_var(--b-color-border)]"
                        style={{ top: `${dragIndicatorTop}px` }}
                    />
                )}
                {dragState && dragOverlayTop !== null && (
                    <QueueItem
                        key={`drag-overlay-${dragState.activeId}`}
                        className="pointer-events-none absolute left-0 z-[4] w-full drop-shadow-[var(--b-shadow-queue-drag)]"
                        music={dragState.music}
                        index={dragState.activeIndex}
                        tone={dragState.tone}
                        isSelectMode={false}
                        isSelected={false}
                        onSelect={() => {}}
                        onClick={() => {}}
                        onOpenActions={() => {}}
                        style={{
                            top: `${dragOverlayTop}px`,
                            height: `${QUEUE_TRACK_CARD_HEIGHT}px`
                        }}
                    />
                )}
            </>
        );
    };

    return (
        <div className="flex h-full min-h-full w-full flex-col overflow-y-auto overflow-x-hidden" ref={scrollRef}>
            <div className="sticky top-0 z-[3] w-full shrink-0 bg-[var(--b-color-background)] px-4 pb-3.5 pt-[calc(env(safe-area-inset-top)+14px)] max-lg:px-3 max-lg:py-2">
                <div className="grid w-full min-w-0 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 max-lg:grid-cols-[40px_minmax(0,1fr)_auto] max-lg:gap-2">
                    <IconButton
                        size="utility"
                        tone="muted"
                        className="justify-self-start"
                        aria-label="Go back"
                        onClick={back}>
                        <Icon.ChevronLeft />
                    </IconButton>

                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 max-lg:justify-center max-lg:gap-0">
                        <Text
                            as="h1"
                            size="md"
                            weight="semibold"
                            className="truncate leading-[1.2] max-lg:text-sm">
                            <span>Queue</span>
                        </Text>
                        <Text as="p" variant="muted" size="xs" className="truncate max-lg:hidden">
                            {queueSummary}
                        </Text>
                    </div>

                </div>
                {items.length > 0 && (
                    <ListSelectionToolbar
                        className="mx-auto mt-2 w-[min(100%,608px)] px-4 max-sm:px-3.5"
                        isSelecting={isSelectMode}
                        selectedCount={selectedItems.length}
                        totalCount={items.length}
                        selectLabel="Select"
                        selectedLabel="queue items"
                        onStartSelect={() => setIsSelectMode(true)}
                        onStopSelect={() => setIsSelectMode(false)}
                        onSelectAll={() => setSelectedItems(items)}
                        onClear={() => setSelectedItems([])}
                    />
                )}
            </div>

            <PageContainer width="narrow" padding="focus" className="flex min-h-0 flex-col gap-4">
                <PlaybackQueueConflictNotice />
                {remotePlaybackOwnership && <RemotePlaybackOwnershipNotice />}
                {items.length > 0 ? (
                    <>
                        <div className="pb-2" ref={listRef}>
                            <ul
                                className="relative m-0 list-none p-0"
                                style={{ height: `${virtualLayout.totalHeight}px` }}>
                                {renderVirtualRows()}
                            </ul>
                        </div>
                    </>
                ) : (
                    <StateMessage
                        className="my-auto"
                        icon={<Icon.ListMusic />}
                        heading="Queue is empty."
                        description="Add music from your library to shape the next listening session."
                        actions={(
                            <Button
                                variant="primary"
                                className="max-sm:w-full"
                                onClick={() => navigate('/')}>
                                <Icon.Music />
                                <span>Open library</span>
                            </Button>
                        )}
                    />
                )}

                {isSelectMode && selectedItems.length > 0 && (
                    <ActionBar>
                        <ActionBarButton
                            variant="primary"
                            onClick={() => panel.open({
                                title: 'Move to playlist',
                                content: (
                                    <PlaylistPanelContent
                                        onClick={(id) => {
                                            PlaylistListener.addMusic(id, selectedItems);
                                            toast('Added to playlist');
                                            setSelectedItems([]);
                                            setIsSelectMode(false);
                                        }}
                                    />
                                )
                            })}>
                            <Icon.Download />
                            <span>Save</span>
                        </ActionBarButton>

                        <ActionBarButton
                            variant="danger"
                            onClick={() => {
                                queueStore.removeItems(selectedItems);
                                setSelectedItems([]);
                                setIsSelectMode(false);
                            }}>
                            <Icon.TrashCan />
                            <span>Delete</span>
                        </ActionBarButton>
                    </ActionBar>
                )}
            </PageContainer>
        </div>
    );
}
