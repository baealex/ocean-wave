import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore as useStore } from '~/store/base-store';
import { useNavigate, useParams } from 'react-router-dom';

import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

import {
    ActionBar,
    ActionBarButton,
    IconButton,
    SortableItem,
    Text,
    VerticalSortable
} from '~/components/shared';
import { MusicActionPanelContent, MusicListItem } from '~/components/music';
import { PlaylistPanelContent, PlaylistSummary } from '~/components/playlist';
import * as Icon from '~/icon';
import { Play } from '~/icon';

import { panel } from '~/modules/panel';
import { useResetQueue } from '~/hooks';

import { getPlaylist } from '~/api';
import { queryKeys } from '~/api/query-keys';
import { toast } from '~/modules/toast';
import { openMobilePlayLink } from '~/modules/mobile-deeplink';
import {
    PLAYLIST_ADD_MUSIC,
    PLAYLIST_CHANGE_MUSIC_ORDER,
    PLAYLIST_MOVE_MUSIC,
    PLAYLIST_REMOVE_MUSIC,
    PlaylistListener,
    socket
} from '~/socket';

import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';
import { TwoToneLayout } from '~/components/layout';

export default function PlaylistDetail() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();

    const { id } = useParams<{ id: string }>();

    const queryClient = useQueryClient();

    const playlistQueryKey = queryKeys.playlists.detail(id);

    const { data: playlist } = useQuery({
        queryKey: playlistQueryKey,
        queryFn: () => getPlaylist(id!).then(res => res.data.playlist),
        enabled: !!id
    });

    const [{ musicMap }] = useStore(musicStore);

    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedItems, setSelectedItems] = useState<string[]>([]);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (playlist && over && active.id !== over.id) {
            const oldIndex = playlist.musics.findIndex(({ id }) => id === active.id);
            const newIndex = playlist.musics.findIndex(({ id }) => id === over.id);
            const newMusics = arrayMove(playlist.musics, oldIndex, newIndex);
            PlaylistListener.changeMusicOrder(playlist.id, newMusics.map(({ id }) => id));

            queryClient.setQueryData(playlistQueryKey, () => {
                return {
                    ...playlist,
                    musics: newMusics
                };
            });
        }
    };

    useEffect(() => {
        const invalidateQueries = () => {
            if (!id) {
                return;
            }

            queryClient.invalidateQueries({
                queryKey: queryKeys.playlists.detail(id),
                exact: true
            });
        };

        socket.on(PLAYLIST_ADD_MUSIC, invalidateQueries);
        socket.on(PLAYLIST_MOVE_MUSIC, invalidateQueries);
        socket.on(PLAYLIST_REMOVE_MUSIC, invalidateQueries);
        socket.on(PLAYLIST_CHANGE_MUSIC_ORDER, invalidateQueries);

        return () => {
            socket.off(PLAYLIST_ADD_MUSIC, invalidateQueries);
            socket.off(PLAYLIST_MOVE_MUSIC, invalidateQueries);
            socket.off(PLAYLIST_REMOVE_MUSIC, invalidateQueries);
            socket.off(PLAYLIST_CHANGE_MUSIC_ORDER, invalidateQueries);
        };
    }, [id, queryClient]);

    useEffect(() => {
        setSelectedItems([]);
    }, [isSelectMode]);

    if (!playlist) {
        return null;
    }

    const playlistMusics = playlist.musics ?? [];
    const playlistHeaderMusics = playlist.headerMusics ?? playlistMusics.slice(0, 16);
    const backgroundImage = playlistHeaderMusics
        .map(({ id }) => musicMap.get(id)?.album.cover)
        .find(Boolean) || '';

    return (
        <TwoToneLayout
            backgroundImage={backgroundImage}
            header={(
                <PlaylistSummary {...playlist} />
            )}
            primaryAction={(
                <button onClick={() => void resetQueue(playlistMusics.map(({ id }) => id))}>
                    <Play />
                </button>
            )}>
            <div className="mb-[var(--b-spacing-sm)] flex items-center justify-between gap-[var(--b-spacing-md)] px-[var(--b-spacing-lg)] py-[var(--b-spacing-md)] max-sm:flex-col max-sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Text
                        as="h2"
                        size="title"
                        weight="semibold"
                        className="truncate">
                        {isSelectMode && (
                            <span className="hidden">
                                {selectedItems.length} selected
                            </span>
                        )}
                        <span>Songs</span>
                    </Text>
                    <Text as="p" variant="muted" size="xs" className="truncate">
                        {isSelectMode
                            ? `${selectedItems.length} selected`
                            : `${playlistMusics.length} songs`}
                    </Text>
                </div>

                <div className="inline-flex items-center justify-self-end gap-2">
                    {isSelectMode ? (
                        <>
                            <button
                                type="button"
                                className="min-h-9 rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--b-color-text-secondary)] transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={selectedItems.length === playlistMusics.length}
                                onClick={() => setSelectedItems(playlistMusics.map(({ id }) => id))}>
                                Select all
                            </button>
                            <button
                                type="button"
                                className="min-h-9 rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--b-color-text)] transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                                onClick={() => setIsSelectMode(false)}>
                                Done
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--b-color-text-secondary)] no-underline transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                                onClick={() => openMobilePlayLink('playlist', playlist.id, {
                                    onFallback: () => toast('Android app이 열리지 않으면 Play 버튼으로 웹에서 재생할 수 있어요.')
                                })}>
                                <Icon.Smartphone className="h-3.5 w-3.5" />
                                App
                            </button>
                            <button
                                type="button"
                                className="min-h-9 rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--b-color-text-secondary)] transition-[color,background-color,border-color] duration-150 hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                                onClick={() => setIsSelectMode(true)}>
                                Edit
                            </button>
                        </>
                    )}
                </div>
            </div>
            <div className="min-w-0 flex-1">
                <VerticalSortable items={playlistMusics.map(({ id }) => id)} onDragEnd={handleDragEnd}>
                    {playlistMusics.map(({ id }) => {
                        const music = musicMap.get(id);

                        if (!music) return null;

                        const isSelected = selectedItems.includes(music.id);

                        const onClick = () => {
                            queueStore.add(music.id);
                        };

                        const onSelect = () => {
                            if (selectedItems.includes(music.id)) {
                                setSelectedItems(selectedItems.filter(item => item !== music.id));
                            } else {
                                setSelectedItems([...selectedItems, music.id]);
                            }
                        };

                        return (
                            <SortableItem
                                id={music.id}
                                key={music.id}
                                render={({ listeners }) => (
                                    <div className="grid w-full grid-cols-[48px_minmax(0,1fr)] items-center gap-x-[var(--b-spacing-xs)] px-[var(--b-spacing-md)]">
                                        {isSelectMode ? (
                                            <IconButton
                                                aria-label={isSelected ? `Unselect ${music.name}` : `Select ${music.name}`}
                                                aria-pressed={isSelected}
                                                active={isSelected}
                                                className="justify-self-center"
                                                onClick={() => {
                                                    if (selectedItems.includes(music.id)) {
                                                        setSelectedItems(selectedItems.filter(item => item !== music.id));
                                                    } else {
                                                        setSelectedItems([...selectedItems, music.id]);
                                                    }
                                                }}>
                                                <Icon.CheckBox />
                                            </IconButton>
                                        ) : (
                                            <IconButton
                                                aria-label={`Reorder ${music.name}`}
                                                className="justify-self-center cursor-grab touch-none"
                                                {...listeners}>
                                                <Icon.Menu />
                                            </IconButton>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <MusicListItem
                                                albumName={music.album.name}
                                                albumCover={music.album.cover}
                                                artistName={music.artist.name}
                                                musicName={music.name}
                                                musicCodec={music.codec}
                                                isLiked={music.isLiked}
                                                isHated={music.isHated}
                                                onClick={isSelectMode ? onSelect : onClick}
                                                onLongPress={() => panel.open({
                                                    content: (
                                                        <MusicActionPanelContent
                                                            id={music.id}
                                                            onAlbumClick={() => navigate(`/album/${music.album.id}`)}
                                                            onArtistClick={() => navigate(`/artist/${music.artist.id}`)}
                                                        />
                                                    )
                                                })}
                                            />
                                        </div>
                                    </div>
                                )}
                            />
                        );
                    })}
                </VerticalSortable>
            </div>
            {isSelectMode && selectedItems.length > 0 && (
                <ActionBar>
                    <ActionBarButton
                        onClick={() => {
                            selectedItems.forEach(id => queueStore.add(id));
                            setIsSelectMode(false);
                        }}>
                        <Icon.Play />
                        <span>Play</span>
                    </ActionBarButton>
                    <ActionBarButton
                        onClick={() => panel.open({
                            title: 'Move to playlist',
                            content: (
                                <PlaylistPanelContent
                                    onClick={(id) => {
                                        PlaylistListener.moveMusic(playlist.id, id, selectedItems);
                                        toast('Moved to playlist');
                                        setIsSelectMode(false);
                                    }}
                                />
                            )
                        })}>
                        <Icon.Download />
                        <span>Move</span>
                    </ActionBarButton>
                    <ActionBarButton
                        onClick={async () => {
                            PlaylistListener.removeMusic(playlist.id, selectedItems);
                            setIsSelectMode(false);
                        }}>
                        <Icon.TrashCan />
                        <span>Delete</span>
                    </ActionBarButton>
                </ActionBar>
            )}
        </TwoToneLayout>
    );
}
