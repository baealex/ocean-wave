import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getAlbum } from '~/api/library';
import { queryKeys } from '~/api/query-keys';
import { AlbumSummary } from '~/components/album';
import { TwoToneLayout, TwoTonePrimaryAction } from '~/components/layout';
import {
    MusicActionPanelContent,
    MusicListItem,
    RemotePlaybackOwnershipNotice
} from '~/components/music';
import { Button, Loading, StateMessage } from '~/components/shared';
import { useRemotePlaybackOwnership, useResetQueue } from '~/hooks';
import { Play } from '~/icon';
import { panel } from '~/modules/panel';
import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';

export default function AlbumDetail() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();
    const remotePlaybackOwnership = useRemotePlaybackOwnership();

    const { id } = useParams<{ id: string }>();

    const { data: album, isError, isLoading } = useQuery({
        queryKey: queryKeys.albums.detail(id),
        queryFn: async () => {
            const { data } = await getAlbum(id!);
            return data.album;
        },
        enabled: !!id
    });

    const [{ musicMap }] = useStore(musicStore);

    if (isLoading) {
        return <Loading />;
    }

    if (isError || !album) {
        return (
            <div className="flex min-h-full items-center justify-center p-[var(--b-spacing-lg)]">
                <StateMessage
                    surface
                    icon={<Play />}
                    heading="Album not found."
                    description="The album could not be loaded. Go back and choose another album."
                    actions={(
                        <Button variant="primary" onClick={() => navigate(-1)}>
                            Go back
                        </Button>
                    )}
                />
            </div>
        );
    }

    return (
        <TwoToneLayout
            header={(
                <AlbumSummary {...album} />
            )}
            primaryAction={(
                <TwoTonePrimaryAction
                    aria-label={remotePlaybackOwnership
                        ? `Play ${album.name} unavailable while another device owns playback`
                        : `Play ${album.name}`}
                    aria-describedby={remotePlaybackOwnership
                        ? REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
                        : undefined}
                    title={remotePlaybackOwnership
                        ? REMOTE_PLAYBACK_OWNERSHIP_MESSAGE
                        : undefined}
                    disabled={album.musics.length === 0 || Boolean(remotePlaybackOwnership)}
                    onClick={() => void resetQueue(album.musics.map(music => music.id))}>
                    <Play />
                </TwoTonePrimaryAction>
            )}>
            {remotePlaybackOwnership && (
                <RemotePlaybackOwnershipNotice className="mx-[var(--b-spacing-lg)] mb-[var(--b-spacing-lg)]" />
            )}
            {album.musics.map(({ id }) => {
                const music = musicMap.get(id);

                if (!music) {
                    return null;
                }

                return (
                    <MusicListItem
                        key={music.id}
                        albumName={music.album.name}
                        artistName={music.artist.name}
                        trackNumber={music.trackNumber}
                        musicName={music.name}
                        musicCodec={music.codec}
                        isLiked={music.isLiked}
                        hideAlbumArt
                        isHated={music.isHated}
                        onClick={() => queueStore.add(music.id)}
                        onLongPress={() => panel.open({
                            title: 'Related to this music',
                            content: (
                                <MusicActionPanelContent
                                    id={music.id}
                                    onArtistClick={() => navigate(`/artist/${music.artist.id}`)}
                                />
                            )
                        })}
                    />
                );
            })}
        </TwoToneLayout>
    );
}
