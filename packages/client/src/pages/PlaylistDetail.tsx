import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore as useStore } from '~/store/base-store';
import { useNavigate, useParams } from 'react-router-dom';

import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

import {
    ActionBar,
    ActionBarButton,
    Button,
    IconButton,
    ListSelectionToolbar,
    listRowClass,
    Loading,
    SelectionCheckButton,
    SortableItem,
    StateMessage,
    Text,
    VerticalSortable
} from '~/components/shared';
import { MusicActionPanelContent, MusicListItem } from '~/components/music';
import { PlaylistPanelContent, PlaylistSummary } from '~/components/playlist';
import * as Icon from '~/icon';
import { Play } from '~/icon';

import { panel } from '~/modules/panel';
import { useResetQueue } from '~/hooks';

import { getPlaylist } from '~/api/library';
import { queryKeys } from '~/api/query-keys';
import { toast } from '~/modules/toast';
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
import { TwoToneLayout, TwoTonePrimaryAction } from '~/components/layout';

export default function PlaylistDetail() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();

    const { id } = useParams<{ id: string }>();

    const queryClient = useQueryClient();

    const playlistQueryKey = queryKeys.playlists.detail(id);

    const { data: playlist, isError, isLoading } = useQuery({
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

    if (isLoading) {
        return <Loading />;
    }

    if (isError || !playlist) {
        return (
            <div className="flex min-h-full items-center justify-center p-[var(--b-spacing-lg)]">
                <StateMessage
                    surface
                    icon={<Icon.ListMusic />}
                    heading="Playlist not found."
                    description="The playlist could not be loaded. Go back and choose another playlist."
                    actions={(
                        <Button variant="primary" onClick={() => navigate(-1)}>
                            Go back
                        </Button>
                    )}
                />
            </div>
        );
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
                <TwoTonePrimaryAction
                    aria-label={`Play ${playlist.name}`}
                    disabled={playlistMusics.length === 0}
                    onClick={() => void resetQueue(playlistMusics.map(({ id }) => id))}>
                    <Play />
                </TwoTonePrimaryAction>
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

            </div>
            {playlistMusics.length > 0 && (
                <ListSelectionToolbar
                    sticky
                    className="top-0 px-[var(--b-spacing-lg)] pb-[var(--b-spacing-sm)] pt-1"
                    isSelecting={isSelectMode}
                    selectedCount={selectedItems.length}
                    totalCount={playlistMusics.length}
                    selectLabel="Select"
                    selectedLabel="playlist songs"
                    onStartSelect={() => setIsSelectMode(true)}
                    onStopSelect={() => setIsSelectMode(false)}
                    onSelectAll={() => setSelectedItems(playlistMusics.map(({ id }) => id))}
                    onClear={() => setSelectedItems([])}
                />
            )}
            <div className="min-w-0 flex-1">
                {playlistMusics.length > 0 ? (
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
                                        <div className={listRowClass({ layout: 'selection', surface: 'plain', selected: isSelected })}>
                                            {isSelectMode ? (
                                                <SelectionCheckButton
                                                    selected={isSelected}
                                                    className="justify-self-center"
                                                    aria-label={isSelected ? `Unselect ${music.name}` : `Select ${music.name}`}
                                                    aria-pressed={isSelected}
                                                    onClick={onSelect}
                                                />
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
                ) : (
                    <StateMessage
                        className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-2xl)]"
                        icon={<Icon.ListMusic />}
                        heading="No songs in this playlist."
                        description="Add songs from your library to make this playlist playable."
                    />
                )}
            </div>
            {isSelectMode && selectedItems.length > 0 && (
                <ActionBar>
                    <ActionBarButton
                        variant="primary"
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
                        variant="danger"
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
