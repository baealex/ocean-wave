import { useAppStore as useStore } from '~/store/base-store';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
    Loading,
    Button,
    CollectionHeader,
    FixedVirtualSortableList,
    IconButton,
    StateMessage,
    type FixedVirtualSortableRenderProps
} from '~/components/shared';
import { TextEntryDialog } from '~/components/shared/Modal';
import { PlaylistActionPanelContent, PlaylistItem } from '~/components/playlist';
import { ListMusic, Menu } from '~/icon';

import type { Playlist as PlaylistModel } from '~/models/type';

import { PlaylistListener } from '~/socket';

import { playlistStore } from '~/store/playlist';
import { panel } from '~/modules/panel';
import { moveArrayItem } from '~/modules/fixed-virtual-sortable-list';

const PLAYLIST_ROW_HEIGHT = 80;
const PLAYLIST_ROW_GAP = 0;

function PlaylistDndItem({
    playlist,
    onClick,
    onLongPress,
    sortable
}: {
    playlist: PlaylistModel;
    onClick: () => void;
    onLongPress: () => void;
    sortable: FixedVirtualSortableRenderProps;
}) {
    const { handleProps, isDragging, isDragOverlay } = sortable;

    return (
        <div
            className={`relative grid h-full w-full grid-cols-[44px_minmax(0,1fr)] items-center border-b border-[var(--b-color-border-subtle)] transition-[box-shadow,opacity] focus-within:z-[1] focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-[var(--b-color-focus)] ${isDragOverlay ? 'bg-[var(--b-color-background-layer-1)] shadow-[var(--b-shadow-queue-drag)]' : ''} ${isDragging && !isDragOverlay ? 'opacity-15' : ''}`}>
            <IconButton
                {...handleProps}
                size="md"
                tone="muted"
                className="justify-self-center cursor-grab touch-none opacity-55 hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing">
                <Menu />
            </IconButton>
            <div className="min-w-0 flex-1">
                <PlaylistItem
                    {...playlist}
                    layout="reorder"
                    onClick={onClick}
                    onLongPress={onLongPress}
                />
            </div>
        </div>
    );
}

export default function Playlist() {
    const navigate = useNavigate();
    const [{ playlists, loaded }, setState] = useStore(playlistStore);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [createName, setCreateName] = useState('');

    const handleOpenCreateDialog = () => {
        setCreateName('');
        setIsCreateDialogOpen(true);
    };

    const handleCloseCreateDialog = () => {
        setIsCreateDialogOpen(false);
        setCreateName('');
    };

    const handleCreateConfirm = (name: string) => {
        PlaylistListener.create(name);
        handleCloseCreateDialog();
    };

    const handleReorder = (sourceIndex: number, targetIndex: number) => {
        const nextPlaylists = moveArrayItem(playlists, sourceIndex, targetIndex);

        if (nextPlaylists === playlists) {
            return;
        }

        PlaylistListener.changeOrder(nextPlaylists.map((playlist) => playlist.id));
        setState((state) => ({
            ...state,
            playlists: nextPlaylists
        }));
    };

    return (
        <>
            <CollectionHeader
                title="Playlists"
                summary={loaded ? `${playlists.length.toLocaleString()} playlists` : 'Loading playlists'}
                actions={(
                    <Button variant="primary" onClick={handleOpenCreateDialog}>
                        Create
                    </Button>
                )}
            />
            <div className="w-full max-w-[920px]">
                {!loaded && (
                    <Loading />
                )}
                {loaded && playlists.length === 0 && (
                    <StateMessage
                        className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-2xl)]"
                        icon={<ListMusic />}
                        heading="No playlists yet."
                        description="Create a playlist to collect tracks for later."
                        actions={(
                            <Button onClick={handleOpenCreateDialog}>
                                Create playlist
                            </Button>
                        )}
                    />
                )}
                {loaded && playlists.length > 0 && (
                    <FixedVirtualSortableList
                        items={playlists}
                        ariaLabel="Playlists"
                        itemHeight={PLAYLIST_ROW_HEIGHT}
                        rowGap={PLAYLIST_ROW_GAP}
                        getKey={(playlist) => playlist.id}
                        getItemLabel={(playlist) => playlist.name}
                        onReorder={handleReorder}
                        renderItem={(playlist, _index, sortable) => (
                            <PlaylistDndItem
                                playlist={playlist}
                                sortable={sortable}
                                onClick={() => navigate(`/playlist/${playlist.id}`)}
                                onLongPress={() => panel.open({
                                    content: (
                                        <PlaylistActionPanelContent
                                            id={playlist.id}
                                            onPlaylistClick={() => navigate(`/playlist/${playlist.id}`)}
                                        />
                                    )
                                })}
                            />
                        )}
                    />
                )}
            </div>
            <TextEntryDialog
                open={isCreateDialogOpen}
                title="Create playlist"
                description="Give this playlist a short name so you can find it later."
                value={createName}
                placeholder="Playlist name"
                confirmLabel="Create"
                onValueChange={setCreateName}
                onConfirm={handleCreateConfirm}
                onClose={handleCloseCreateDialog}
            />
        </>
    );
}
