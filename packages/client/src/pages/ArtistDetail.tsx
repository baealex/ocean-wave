import { useAppStore as useStore } from '~/store/base-store';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { AlbumListItem } from '~/components/album';
import { ArtistSummary } from '~/components/artist';
import { TwoToneLayout } from '~/components/layout';
import { MusicActionPanelContent, MusicListItem } from '~/components/music';
import { Text } from '~/components/shared';
import { Play } from '~/icon';

import { getArtist } from '~/api/library';
import { queryKeys } from '~/api/query-keys';

import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';
import { panel } from '~/modules/panel';
import { useResetQueue } from '~/hooks';

export default function ArtistDetail() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();

    const { id } = useParams<{ id: string }>();

    const { data: artist } = useQuery({
        queryKey: queryKeys.artists.detail(id),
        queryFn: async () => {
            const { data } = await getArtist(id!);
            return data.artist;
        },
        enabled: !!id
    });

    const [{ musicMap }] = useStore(musicStore);

    if (!artist) {
        return null;
    }

    const listenedCount = artist.musics.reduce((acc, { id }) => acc += musicMap.get(id)?.playCount || 0, 0);

    return (
        <TwoToneLayout
            backgroundImage={artist.latestAlbum?.cover || ''}
            header={(
                <ArtistSummary
                    name={artist.name}
                    cover={artist.latestAlbum?.cover || ''}
                    listenedCount={listenedCount}
                />
            )}
            primaryAction={(
                <button onClick={() => void resetQueue(artist.musics.map(music => music.id))}>
                    <Play />
                </button>
            )}>
            <div className="mb-[var(--b-spacing-2xl)] last:mb-0">
                <div className="mb-[var(--b-spacing-sm)] flex items-center justify-between gap-[var(--b-spacing-md)] px-[var(--b-spacing-lg)] py-[var(--b-spacing-md)]">
                    <div className="flex items-center gap-[var(--b-spacing-sm)]">
                        <Text as="h2" size="xl" weight="semibold">
                            Albums
                        </Text>
                        <Text variant="tertiary" size="sm">
                            {artist.albums.length}
                        </Text>
                    </div>
                </div>
                <div className="overflow-x-auto px-[var(--b-spacing-lg)] pb-[var(--b-spacing-sm)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="grid w-max auto-cols-[minmax(240px,320px)] grid-flow-col gap-[var(--b-spacing-sm)] [scroll-snap-type:x_proximity]">
                        {artist.albums.map(album => (
                            <div key={album.id} className="min-w-0 overflow-hidden rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent [scroll-snap-align:start]">
                                <AlbumListItem
                                    albumCover={album.cover}
                                    albumName={album.name}
                                    artistName={artist.name}
                                    publishedYear={album.publishedYear}
                                    musicCount={album.musics?.length}
                                    compact
                                    onClick={() => navigate(`/album/${album.id}`)}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mb-[var(--b-spacing-2xl)] last:mb-0">
                <div className="mb-[var(--b-spacing-sm)] flex items-center justify-between gap-[var(--b-spacing-md)] px-[var(--b-spacing-lg)] py-[var(--b-spacing-md)]">
                    <div className="flex items-center gap-[var(--b-spacing-sm)]">
                        <Text as="h2" size="xl" weight="semibold">
                            Songs
                        </Text>
                        <Text variant="tertiary" size="sm">
                            {artist.musics.length}
                        </Text>
                    </div>
                </div>
                <div className="flex flex-col">
                    {artist.musics.map(({ id }) => {
                        const music = musicMap.get(id);

                        if (!music) return null;

                        return (
                            <MusicListItem
                                key={music.id}
                                artistName={music.artist.name}
                                albumCover={music.album.cover}
                                albumName={music.album.name}
                                musicName={music.name}
                                musicCodec={music.codec}
                                isLiked={music.isLiked}
                                isHated={music.isHated}
                                onClick={() => queueStore.add(music.id)}
                                onLongPress={() => panel.open({
                                    title: 'Related to this music',
                                    content: (
                                        <MusicActionPanelContent
                                            id={music.id}
                                            onAlbumClick={() => navigate(`/album/${music.album.id}`)}
                                        />
                                    )
                                })}
                            />
                        );
                    })}
                </div>
            </div>
        </TwoToneLayout>
    );
}
