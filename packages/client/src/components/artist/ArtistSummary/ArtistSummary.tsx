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
        <div className="flex flex-col items-center gap-[var(--b-spacing-md)] text-center">
            <div className="mb-[var(--b-spacing-sm)] w-[260px] max-w-[76%]">
                <div className="relative aspect-square overflow-hidden rounded-full shadow-[var(--b-shadow-artist-summary)] after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:shadow-[var(--b-shadow-inset-artwork-ring)] after:content-['']">
                    <Image className="h-full w-full object-cover" src={cover} alt={name} icon={<User />} />
                </div>
            </div>
            <Text as="h1" size="xl" weight="bold" className="drop-shadow-[var(--b-shadow-summary-title)]">
                {name}
            </Text>
            {listenedCount > 0 && (
                <Text variant="tertiary" size="sm">
                    {listenedCount} plays
                </Text>
            )}
        </div>
    );
};

export default ArtistSummary;
