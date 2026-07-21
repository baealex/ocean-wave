import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getPlaylist } from '~/api/library';
import { queryKeys } from '~/api/query-keys';
import { TwoToneLayout, TwoTonePrimaryAction } from '~/components/layout';
import {
    MusicActionPanelContent,
    MusicListItem,
    RemotePlaybackOwnershipNotice
} from '~/components/music';
import {
    PlaylistPanelContent,
    PlaylistSelectionQueueAction,
    PlaylistSummary
} from '~/components/playlist';
import {
    ActionBar,
    ActionBarButton,
    Button,
    FixedVirtualSortableList,
    IconButton,
    ListSelectionToolbar,
    Loading,
    listRowClass,
    SelectionCheckButton,
    StateMessage,
    Text
} from '~/components/shared';
import { useRemotePlaybackOwnership, useResetQueue } from '~/hooks';
import * as Icon from '~/icon';
import { Play } from '~/icon';
import { moveArrayItem } from '~/modules/fixed-virtual-sortable-list';
import { panel } from '~/modules/panel';
import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';
import { toast } from '~/modules/toast';
import {
    PLAYLIST_ADD_MUSIC,
    PLAYLIST_CHANGE_MUSIC_ORDER,
    PLAYLIST_MOVE_MUSIC,
    PLAYLIST_REMOVE_MUSIC,
    PlaylistListener,
    socket
} from '~/socket';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';

const PLAYLIST_TRACK_ROW_HEIGHT = 80;

export default function PlaylistDetail() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();
    const remotePlaybackOwnership = useRemotePlaybackOwnership();

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

    const handleReorder = (sourceIndex: number, targetIndex: number) => {
        if (!playlist) {
            return;
        }

        const nextMusics = moveArrayItem(
            playlist.musics ?? [],
            sourceIndex,
            targetIndex
        );

        if (nextMusics === playlist.musics) {
            return;
        }

        PlaylistListener.changeMusicOrder(
            playlist.id,
            nextMusics.map(({ id }) => id)
        );
        queryClient.setQueryData(playlistQueryKey, () => ({
            ...playlist,
            musics: nextMusics
        }));
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
    return (
        <TwoToneLayout
            header={(
                <PlaylistSummary {...playlist} />
            )}
            primaryAction={(
                <TwoTonePrimaryAction
                    aria-label={remotePlaybackOwnership
                        ? `Play ${playlist.name} unavailable while another device owns playback`
                        : `Play ${playlist.name}`}
                    aria-describedby={remotePlaybackOwnership
                        ? REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
                        : undefined}
                    title={remotePlaybackOwnership
                        ? REMOTE_PLAYBACK_OWNERSHIP_MESSAGE
                        : undefined}
                    disabled={playlistMusics.length === 0 || Boolean(remotePlaybackOwnership)}
                    onClick={() => void resetQueue(
                        playlistMusics.map(({ id }) => id),
                        {
                            type: 'playlist',
                            id: playlist.id,
                            title: playlist.name
                        }
                    )}>
                    <Play />
                </TwoTonePrimaryAction>
            )}>
            {remotePlaybackOwnership && (
                <RemotePlaybackOwnershipNotice className="mx-[var(--b-spacing-lg)] mb-[var(--b-spacing-lg)]" />
            )}
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
                    <FixedVirtualSortableList
                        items={playlistMusics}
                        ariaLabel={`${playlist.name} songs`}
                        disabled={isSelectMode}
                        itemHeight={PLAYLIST_TRACK_ROW_HEIGHT}
                        getKey={({ id }) => id}
                        getItemLabel={({ id }) => musicMap.get(id)?.name ?? 'Track'}
                        onReorder={handleReorder}
                        renderItem={({ id }, _index, sortable) => {
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
                                <div className={`${listRowClass({ layout: 'selection', surface: 'plain', selected: isSelected })} h-full transition-opacity ${sortable.isDragging && !sortable.isDragOverlay ? 'opacity-15' : ''} ${sortable.isDragOverlay ? 'rounded-[var(--b-radius-lg)] border border-transparent bg-[var(--b-color-surface-subtle)] shadow-[var(--b-shadow-queue-drag)]' : ''}`}>
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
                                            {...sortable.handleProps}
                                            aria-label={`Reorder ${music.name}`}
                                            className="justify-self-center cursor-grab touch-none active:cursor-grabbing">
                                            <Icon.Menu />
                                        </IconButton>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <MusicListItem
                                            albumName={music.album.name}
                                            albumCover={music.album.cover}
                                            artistName={music.artistDisplayName}
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
                                                        onArtistClick={(artistId) => navigate(`/artist/${artistId}`)}
                                                    />
                                                )
                                            })}
                                        />
                                    </div>
                                </div>
                            );
                        }}
                    />
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
                    <PlaylistSelectionQueueAction
                        onClick={() => {
                            selectedItems.forEach(id => queueStore.add(id));
                            setIsSelectMode(false);
                        }}
                    />
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
