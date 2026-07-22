import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getArtist } from '~/api/library';
import { queryKeys } from '~/api/query-keys';
import { ArtistSummary } from '~/components/artist';
import { TwoToneLayout, TwoTonePrimaryAction } from '~/components/layout';
import {
    MusicActionPanelContent,
    MusicListItem,
    RemotePlaybackOwnershipNotice
} from '~/components/music';
import { Button, Image, Loading, StateMessage, Text } from '~/components/shared';
import {
    usePlaybackSignal,
    useRemotePlaybackOwnership,
    useResetQueue
} from '~/hooks';
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
        <section className="mb-[var(--b-spacing-2xl)] last:mb-0 lg:mb-[var(--b-spacing-xl)] lg:last:mb-0">
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
                <div className="grid w-max auto-cols-[148px] grid-flow-col gap-[var(--b-spacing-md)] sm:auto-cols-[168px] [scroll-snap-type:x_proximity]">
                    {albums.map(album => (
                        <button
                            key={album.id}
                            type="button"
                            className="group/release min-w-0 text-left [scroll-snap-align:start] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                            onClick={() => onAlbumClick(album.id)}>
                            <span className="relative block aspect-square w-full overflow-hidden rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-subtle)] shadow-[var(--b-shadow-artwork-placeholder)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[var(--b-shadow-inset-artwork-ring)] after:content-['']">
                                <Image
                                    src={album.cover}
                                    alt=""
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                />
                            </span>
                            <span className="mt-2.5 block truncate text-sm font-semibold text-[var(--b-color-text)] transition-colors duration-150 group-hover/release:text-[var(--b-color-point-light)]">
                                {album.name}
                            </span>
                            <span className="mt-1 block truncate text-xs text-[var(--b-color-text-tertiary)]">
                                {[album.publishedYear, getReleaseTypeLabel(album.releaseType)]
                                    .filter(Boolean).join(' · ')}
                            </span>
                        </button>
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
    const playbackSignal = usePlaybackSignal();

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

            <div className="mb-[var(--b-spacing-2xl)] last:mb-0 lg:mb-[var(--b-spacing-xl)] lg:last:mb-0">
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
                                versionTitle={[
                                    music.recordingVersionTitle,
                                    music.releaseVersionTitle
                                ].filter(Boolean).join(' · ')}
                                musicCodec={music.codec}
                                isLiked={music.isLiked}
                                isHated={music.isHated}
                                playbackSignal={playbackSignal?.musicId === music.id ? playbackSignal : undefined}
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
