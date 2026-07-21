import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getArtist } from '~/api/library';
import { queryKeys } from '~/api/query-keys';
import { AlbumListItem } from '~/components/album';
import { ArtistSummary } from '~/components/artist';
import { TwoToneLayout, TwoTonePrimaryAction } from '~/components/layout';
import {
    MusicActionPanelContent,
    MusicListItem,
    RemotePlaybackOwnershipNotice
} from '~/components/music';
import { Button, Loading, StateMessage, Text } from '~/components/shared';
import { useRemotePlaybackOwnership, useResetQueue } from '~/hooks';
import { Play } from '~/icon';
import { panel } from '~/modules/panel';
import { getReleaseTypeLabel } from '~/modules/releases';
import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';
import type { Album } from '~/models/type';

const ReleaseShelf = ({
    title,
    albums,
    onAlbumClick
}: {
    title: string;
    albums: Album[];
    onAlbumClick: (albumId: string) => void;
}) => {
    if (!albums.length) return null;

    return (
        <section className="mb-[var(--b-spacing-2xl)] last:mb-0">
            <div className="mb-[var(--b-spacing-sm)] flex items-center justify-between gap-[var(--b-spacing-md)] px-[var(--b-spacing-lg)] py-[var(--b-spacing-md)]">
                <div className="flex items-center gap-[var(--b-spacing-sm)]">
                    <Text as="h2" size="xl" weight="semibold">
                        {title}
                    </Text>
                    <Text variant="tertiary" size="sm">
                        {albums.length}
                    </Text>
                </div>
            </div>
            <div className="overflow-x-auto px-[var(--b-spacing-lg)] pb-[var(--b-spacing-sm)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="grid w-max auto-cols-[minmax(240px,320px)] grid-flow-col gap-[var(--b-spacing-sm)] [scroll-snap-type:x_proximity]">
                    {albums.map(album => (
                        <div key={album.id} className="min-w-0 overflow-hidden rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-transparent [scroll-snap-align:start]">
                            <AlbumListItem
                                albumCover={album.cover}
                                albumName={album.name}
                                artistName={album.artistDisplayName}
                                publishedYear={album.publishedYear}
                                releaseType={getReleaseTypeLabel(album.releaseType)}
                                musicCount={album.musics?.length}
                                compact
                                onClick={() => onAlbumClick(album.id)}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default function ArtistDetail() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();
    const remotePlaybackOwnership = useRemotePlaybackOwnership();

    const { id } = useParams<{ id: string }>();

    const { data: artist, isError, isLoading } = useQuery({
        queryKey: queryKeys.artists.detail(id),
        queryFn: async () => {
            const { data } = await getArtist(id!);
            return data.artist;
        },
        enabled: !!id
    });

    const [{ musicMap }] = useStore(musicStore);

    if (isLoading) {
        return <Loading />;
    }

    if (isError || !artist) {
        return (
            <div className="flex min-h-full items-center justify-center p-[var(--b-spacing-lg)]">
                <StateMessage
                    surface
                    icon={<Play />}
                    heading="Artist not found."
                    description="The artist could not be loaded. Go back and choose another artist."
                    actions={(
                        <Button variant="primary" onClick={() => navigate(-1)}>
                            Go back
                        </Button>
                    )}
                />
            </div>
        );
    }

    const listenedCount = artist.musics.reduce((acc, { id }) => acc += musicMap.get(id)?.playCount || 0, 0);

    return (
        <TwoToneLayout
            header={(
                <ArtistSummary
                    name={artist.name}
                    cover={artist.latestAlbum?.cover || ''}
                    listenedCount={listenedCount}
                />
            )}
            primaryAction={(
                <TwoTonePrimaryAction
                    aria-label={remotePlaybackOwnership
                        ? `Play ${artist.name} unavailable while another device owns playback`
                        : `Play ${artist.name}`}
                    aria-describedby={remotePlaybackOwnership
                        ? REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
                        : undefined}
                    title={remotePlaybackOwnership
                        ? REMOTE_PLAYBACK_OWNERSHIP_MESSAGE
                        : undefined}
                    disabled={artist.musics.length === 0 || Boolean(remotePlaybackOwnership)}
                    onClick={() => void resetQueue(artist.musics.map(music => music.id))}>
                    <Play />
                </TwoTonePrimaryAction>
            )}>
            {remotePlaybackOwnership && (
                <RemotePlaybackOwnershipNotice className="mx-[var(--b-spacing-lg)] mb-[var(--b-spacing-lg)]" />
            )}
            <ReleaseShelf
                title="Releases"
                albums={artist.albums}
                onAlbumClick={(albumId) => navigate(`/album/${albumId}`)}
            />
            <ReleaseShelf
                title="Appears On"
                albums={artist.appearsOn}
                onAlbumClick={(albumId) => navigate(`/album/${albumId}`)}
            />

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
                                artistName={music.artistDisplayName}
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
