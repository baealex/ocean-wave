import { CollectionCard, Image } from '~/components/shared';
import * as Icon from '~/icon';

interface ArtistCollectionCardProps {
    albumCount: number;
    artistCover: string;
    artistId: string;
    artistName: string;
    musicCount: number;
}

export default function ArtistCollectionCard({
    albumCount,
    artistCover,
    artistId,
    artistName,
    musicCount
}: ArtistCollectionCardProps) {
    return (
        <CollectionCard
            to={`/artist/${artistId}`}
            title={artistName}
            description={`${albumCount} ${albumCount === 1 ? 'album' : 'albums'}`}
            meta={`${musicCount} ${musicCount === 1 ? 'song' : 'songs'}`}
            artwork={(
                <span className="relative block h-full w-full rounded-full border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-item)] p-1 shadow-[var(--b-shadow-artist-summary)]">
                    {artistCover ? (
                        <Image
                            src={artistCover}
                            alt=""
                            loading="lazy"
                            className="h-full w-full rounded-full object-cover"
                        />
                    ) : (
                        <span className="flex h-full w-full items-center justify-center rounded-full bg-[var(--b-color-background-layer-1)] text-[var(--b-color-text-muted)] [&_svg]:h-1/4 [&_svg]:w-1/4">
                            <Icon.User aria-hidden="true" />
                        </span>
                    )}
                    <span
                        className="pointer-events-none absolute inset-0 rounded-full border border-transparent border-t-[var(--b-color-focus)] opacity-65"
                        aria-hidden="true"
                    />
                </span>
            )}
        />
    );
}
