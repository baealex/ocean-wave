import { CollectionCard, Image } from '~/components/shared';

interface AlbumCollectionCardProps {
    albumCover: string;
    albumId: string;
    albumName: string;
    artistName: string;
    musicCount?: number;
    publishedYear?: string;
    releaseType?: string;
}

export default function AlbumCollectionCard({
    albumCover,
    albumId,
    albumName,
    artistName,
    musicCount,
    publishedYear,
    releaseType
}: AlbumCollectionCardProps) {
    const meta = [
        publishedYear?.trim(),
        releaseType?.trim(),
        typeof musicCount === 'number'
            ? `${musicCount} ${musicCount === 1 ? 'track' : 'tracks'}`
            : ''
    ].filter(Boolean).join(' · ');

    return (
        <CollectionCard
            to={`/album/${albumId}`}
            title={albumName}
            description={artistName}
            meta={meta}
            artwork={(
                <span className="relative block h-full w-full overflow-hidden rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-item)] shadow-[var(--b-shadow-artwork-placeholder)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[var(--b-shadow-inset-artwork-ring)] after:content-['']">
                    <Image
                        src={albumCover}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                    />
                </span>
            )}
        />
    );
}
