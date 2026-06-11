import { useAppStore as useStore } from '~/store/base-store';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import {
    Loading,
    Button,
    StickyHeader,
    VerticalSortable,
    Flex,
    IconButton,
    StateMessage
} from '~/components/shared';
import { TextEntryDialog } from '~/components/shared/Modal';
import { PlaylistActionPanelContent, PlaylistItem } from '~/components/playlist';
import { ListMusic, Menu } from '~/icon';

import type { Playlist as PlaylistModel } from '~/models/type';

import { PlaylistListener } from '~/socket';

import { playlistStore } from '~/store/playlist';
import { panel } from '~/modules/panel';

function PlaylistDndItem({
    playlist,
    onClick,
    onLongPress
}: {
    playlist: PlaylistModel;
    onClick: () => void;
    onLongPress: () => void;
}) {
    const {
        attributes, listeners, setNodeRef, transform, transition
    } = useSortable({ id: playlist.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    };

    return (
        <Flex
            ref={setNodeRef}
            direction="row"
            align="center"
            className="grid w-full grid-cols-[48px_minmax(0,1fr)] items-center gap-x-[var(--b-spacing-xs)] px-[var(--b-spacing-md)]"
            style={style}
            {...attributes}>
            <IconButton
                aria-label={`Reorder ${playlist.name}`}
                className="justify-self-center cursor-grab touch-none"
                {...listeners}>
                <Menu />
            </IconButton>
            <div className="min-w-0 flex-1">
                <PlaylistItem
                    key={playlist.id}
                    {...playlist}
                    onClick={onClick}
                    onLongPress={onLongPress}
                />
            </div>
        </Flex>
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

    const handleDragEnd = (e: DragEndEvent) => {
        const { active, over } = e;

        if (over && active.id !== over.id) {
            const oldIndex = playlists.findIndex((playlist) => playlist.id === active.id);
            const newIndex = playlists.findIndex((playlist) => playlist.id === over.id);
            const newPlaylists = arrayMove(playlists, oldIndex, newIndex);
            PlaylistListener.changeOrder(newPlaylists.map((playlist) => playlist.id));

            setState((state) => ({
                ...state,
                playlists: newPlaylists
            }));
        }
    };

    return (
        <>
            <StickyHeader>
                <div />
                <Button onClick={handleOpenCreateDialog}>
                    Create
                </Button>
            </StickyHeader>
            <VerticalSortable items={playlists.map((playlist) => playlist.id)} onDragEnd={handleDragEnd}>
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
                {loaded && playlists?.map((playlist) => (
                    <PlaylistDndItem
                        key={playlist.id}
                        playlist={playlist}
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
                ))}
            </VerticalSortable>
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
