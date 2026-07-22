import { useAppStore as useStore } from '~/store/base-store';
import { useState } from 'react';

import { useModal } from '~/components/app/ModalProvider';
import { GridImage, PanelContent } from '~/components/shared';
import { PanelHeaderAction, panelContentClass } from '~/components/shared/PanelContent';
import { TextEntryDialog } from '~/components/shared/Modal';
import * as Icon from '~/icon';

import { panel } from '~/modules/panel';

import { PlaylistListener } from '~/socket';

import { musicStore } from '~/store/music';
import { playlistStore } from '~/store/playlist';

interface PlaylistActionPanelContentProps {
    id: string;
    onPlaylistClick?: () => void;
}

export default function PlaylistActionPanelContent({
    id,
    onPlaylistClick
}: PlaylistActionPanelContentProps) {
    const { confirm } = useModal();
    const [{ musicMap }] = useStore(musicStore);
    const [{ playlists }] = useStore(playlistStore);
    const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
    const [renameValue, setRenameValue] = useState('');

    const playlist = playlists.find(playlist => playlist.id === id);

    if (!playlist) {
        return null;
    }

    const handleCloseRenameDialog = () => {
        setIsRenameDialogOpen(false);
        setRenameValue('');
        panel.close();
    };

    const handleRenamePlaylist = (name: string) => {
        PlaylistListener.update(id, name);
        handleCloseRenameDialog();
    };

    return (
        <>
            <PanelContent
                header={onPlaylistClick && (
                    <PanelHeaderAction
                        layout="album"
                        onClick={() => {
                            panel.close(onPlaylistClick);
                        }}>
                        <GridImage
                            className={panelContentClass.coverGrid}
                            images={playlist.headerMusics.map(music => musicMap.get(music.id)?.album.cover ?? '')}
                        />
                        <div>
                            <div className={panelContentClass.subTitle}>
                                {playlist.musicCount} songs
                            </div>
                            <div className={panelContentClass.subContent}>
                                {playlist.name}
                            </div>
                        </div>
                    </PanelHeaderAction>

                )}
                items={[
                    {
                        icon: <Icon.Pencil />,
                        text: 'Rename',
                        onClick: () => {
                            setRenameValue(playlist.name);
                            setIsRenameDialogOpen(true);
                        }
                    },
                    {
                        icon: <Icon.TrashCan />,
                        text: 'Delete',
                        onClick: async () => {
                            if (!(await confirm({
                                title: 'Delete playlist?',
                                description: `“${playlist.name}” will be removed from your library.`,
                                confirmLabel: 'Delete playlist',
                                tone: 'danger'
                            }))) {
                                return;
                            }
                            PlaylistListener.delete(id);
                            panel.close();
                        }
                    }
                ]}
            />
            <TextEntryDialog
                open={isRenameDialogOpen}
                title="Rename playlist"
                description="Update the playlist name shown in your library."
                value={renameValue}
                placeholder="Playlist name"
                confirmLabel="Rename"
                onValueChange={setRenameValue}
                onConfirm={handleRenamePlaylist}
                onClose={handleCloseRenameDialog}
            />
        </>
    );
}
