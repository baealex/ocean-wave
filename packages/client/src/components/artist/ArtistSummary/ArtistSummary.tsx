import { Image, Text } from '~/components/shared';
import { User } from '~/icon';

interface ArtistSummaryProps {
    name: string;
    cover: string;
    listenedCount: number;
}

const ArtistSummary = ({
    name,
    cover,
    listenedCount
}: ArtistSummaryProps) => {
    return (
        <div className="flex flex-col items-center gap-[var(--b-spacing-lg)] text-center lg:flex-row lg:items-center lg:gap-[var(--b-spacing-xl)] lg:text-left">
            <div className="w-[min(52vw,200px)] shrink-0 lg:w-[180px]">
                <div className="relative aspect-square overflow-hidden rounded-full shadow-[var(--b-shadow-artist-summary)] after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:shadow-[var(--b-shadow-inset-artwork-ring)] after:content-['']">
                    <Image className="h-full w-full object-cover" src={cover} alt={name} icon={<User />} />
                </div>
            </div>
            <div className="flex min-w-0 flex-col items-center gap-2.5 lg:items-start">
                <Text as="span" variant="muted" size="overline" weight="medium">
                    Artist
                </Text>
                <Text as="h1" size="2xl" weight="bold" className="max-w-full drop-shadow-[var(--b-shadow-summary-title)]">
                    {name}
                </Text>
                {listenedCount > 0 && (
                    <Text variant="tertiary" size="sm">
                        {listenedCount.toLocaleString()} plays
                    </Text>
                )}
            </div>
        </div>
    );
};

export default ArtistSummary;
