import { useAppStore as useStore } from '~/store/base-store';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { MusicActionPanelContent, MusicListItem } from '~/components/music';
import { TwoToneLayout, TwoTonePrimaryAction } from '~/components/layout';
import { AlbumSummary } from '~/components/album';
import { Button, Loading, StateMessage } from '~/components/shared';
import { Play } from '~/icon';

import { getAlbum } from '~/api/library';
import { queryKeys } from '~/api/query-keys';

import { getOriginalImage } from '~/modules/image';
import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';
import { panel } from '~/modules/panel';
import { useResetQueue } from '~/hooks';

export default function AlbumDetail() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();

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
            backgroundImage={album.cover ? getOriginalImage(album.cover) : undefined}
            header={(
                <AlbumSummary {...album} />
            )}
            primaryAction={(
                <TwoTonePrimaryAction
                    aria-label={`Play ${album.name}`}
                    disabled={album.musics.length === 0}
                    onClick={() => void resetQueue(album.musics.map(music => music.id))}>
                    <Play />
                </TwoTonePrimaryAction>
            )}>
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
