import { useState } from 'react';

import { useAppStore as useStore } from '~/store/base-store';

import { Button, PanelContent } from '~/components/shared';
import { TextEntryDialog } from '~/components/shared/Modal';

import PlaylistItem from './PlaylistItem';

import { panel } from '~/modules/panel';
import { toast } from '~/modules/toast';

import { playlistStore } from '~/store/playlist';
import { PlaylistListener } from '~/socket';
import * as Icon from '~/icon';

interface PlaylistPanelContentProps {
    onClick: (id: string) => void;
    createAndAddMusicIds?: string[];
}

export default function PlaylistPanelContent({ onClick, createAndAddMusicIds }: PlaylistPanelContentProps) {
    const [{ playlists }] = useStore(playlistStore);
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
        PlaylistListener.create(name, createAndAddMusicIds);
        handleCloseCreateDialog();
        panel.close();
        toast(createAndAddMusicIds?.length ? 'Playlist created and track added' : 'Playlist created');
    };

    return (
        <>
            <PanelContent
                footer={(
                    <>
                        {createAndAddMusicIds?.length ? (
                            <Button fullWidth variant="secondary" onClick={handleOpenCreateDialog}>
                                <Icon.Plus /> New playlist
                            </Button>
                        ) : null}

                        {playlists.map(playlist => (
                            <PlaylistItem
                                key={playlist.id}
                                {...playlist}
                                onClick={() => {
                                    onClick(playlist.id);
                                    panel.close();
                                }}
                            />
                        ))}
                    </>
                )}
            />

            <TextEntryDialog
                open={isCreateDialogOpen}
                title="Create playlist"
                description="Name the playlist. This track will be added right away."
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
