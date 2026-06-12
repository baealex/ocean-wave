import { Link } from 'react-router-dom';

import { Image, Text } from '~/components/shared';
import { Disc } from '~/icon';
import { getOriginalImage } from '~/modules/image';

import type { Album } from '~/models/type';

type AlbumSummaryProps = Pick<Album, 'cover' | 'name' | 'artist' | 'publishedYear'>;

const AlbumSummary = ({
    cover,
    name,
    artist,
    publishedYear
}: AlbumSummaryProps) => {
    return (
        <div className="flex flex-col items-center gap-[var(--b-spacing-md)] text-center">
            <div className="mb-[var(--b-spacing-sm)] w-[260px] max-w-[76%]">
                <div className="relative aspect-square overflow-hidden rounded-[var(--b-radius-xl)] shadow-[var(--b-shadow-artwork-summary)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[var(--b-radius-xl)] after:shadow-[var(--b-shadow-inset-artwork-ring)] after:content-['']">
                    <Image className="h-full w-full object-cover" src={getOriginalImage(cover)} alt={name} icon={<Disc />} />
                </div>
            </div>
            <Text as="h1" size="xl" weight="bold" className="drop-shadow-[var(--b-shadow-summary-title)]">
                {name}
            </Text>
            <div className="flex items-center gap-[var(--b-spacing-sm)]">
                <Link
                    className="inline-flex min-h-8 items-center rounded-full px-1 no-underline transition-opacity duration-150 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                    to={`/artist/${artist.id}`}>
                    <Text variant="secondary" size="md">
                        {artist.name}
                    </Text>
                </Link>
                <Text variant="muted" size="md">•</Text>
                <Text variant="tertiary" size="md">
                    {publishedYear}
                </Text>
            </div>
        </div>
    );
};

export default AlbumSummary;
