import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import { Image, Text } from '~/components/shared';
import { Disc } from '~/icon';
import { getOriginalImage } from '~/modules/image';
import { getReleaseTypeLabel } from '~/modules/releases';

import type { Album } from '~/models/type';

type AlbumSummaryProps = Pick<
    Album,
    'cover' | 'name' | 'artist' | 'artistCredits' | 'artistDisplayName' | 'publishedYear' | 'releaseType' | 'totalDiscs'
>;

const AlbumSummary = ({
    cover,
    name,
    artist,
    artistCredits,
    artistDisplayName,
    publishedYear,
    releaseType,
    totalDiscs
}: AlbumSummaryProps) => {
    const releaseMeta = [
        publishedYear.trim(),
        totalDiscs && totalDiscs > 1 ? `${totalDiscs} discs` : ''
    ].filter(Boolean);

    return (
        <div className="flex flex-col items-center gap-[var(--b-spacing-lg)] text-center lg:flex-row lg:items-center lg:gap-[var(--b-spacing-xl)] lg:text-left">
            <div className="w-[min(52vw,200px)] shrink-0 lg:w-[180px]">
                <div className="relative aspect-square overflow-hidden rounded-[var(--b-radius-xl)] shadow-[var(--b-shadow-artwork-summary)] after:pointer-events-none after:absolute after:inset-0 after:rounded-[var(--b-radius-xl)] after:shadow-[var(--b-shadow-inset-artwork-ring)] after:content-['']">
                    <Image className="h-full w-full object-cover" src={getOriginalImage(cover)} alt={name} icon={<Disc />} />
                </div>
            </div>
            <div className="flex min-w-0 flex-col items-center gap-2.5 lg:items-start">
                <Text as="span" variant="muted" size="overline" weight="medium">
                    {getReleaseTypeLabel(releaseType)}
                </Text>
                <Text as="h1" size="2xl" weight="bold" className="max-w-full drop-shadow-[var(--b-shadow-summary-title)]">
                    {name}
                </Text>
                <span className="inline-flex min-h-8 flex-wrap items-center justify-center lg:justify-start">
                    {artistCredits?.length ? artistCredits.map(credit => (
                        <Fragment key={`${credit.position}-${credit.artist.id}`}>
                            <Link
                                className="inline-flex min-h-8 items-center rounded-full px-1 no-underline transition-opacity duration-150 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                                to={`/artist/${credit.artist.id}`}>
                                <Text variant="secondary" size="md">
                                    {credit.creditedName || credit.artist.name}
                                </Text>
                            </Link>
                            {credit.joinPhrase && (
                                <Text as="span" variant="secondary" size="md">
                                    {credit.joinPhrase}
                                </Text>
                            )}
                        </Fragment>
                    )) : (
                        <Link
                            className="inline-flex min-h-8 items-center rounded-full px-1 no-underline transition-opacity duration-150 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                            to={`/artist/${artist.id}`}>
                            <Text variant="secondary" size="md">
                                {artistDisplayName}
                            </Text>
                        </Link>
                    )}
                </span>
                {releaseMeta.length > 0 && (
                    <div className="flex flex-wrap items-center justify-center gap-[var(--b-spacing-sm)] lg:justify-start">
                        {releaseMeta.map(value => (
                            <Text key={value} variant="tertiary" size="sm">
                                {value}
                            </Text>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AlbumSummary;
