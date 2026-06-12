import { cva } from 'class-variance-authority';

import { AlbumArtwork, Badge, libraryRowClass } from '~/components/shared';

interface AlbumListItemProps {
    albumCover: string;
    albumName: string;
    artistName: string;
    musicCount?: number;
    publishedYear?: string;
    onClick: () => void;
    compact?: boolean;
}

const metaContainerClass = cva('flex items-center justify-end gap-1 whitespace-nowrap max-sm:hidden', {
    variants: {
        hidden: {
            true: 'hidden',
            false: ''
        }
    },
    defaultVariants: {
        hidden: false
    }
});

const AlbumListItem = ({
    albumCover,
    albumName,
    artistName,
    musicCount,
    publishedYear,
    onClick,
    compact = false
}: AlbumListItemProps) => {
    return (
        <button
            type="button"
            className={libraryRowClass({ layout: compact ? 'albumCompact' : 'album' })}
            onClick={onClick}>
            <AlbumArtwork src={albumCover} alt={albumName} />
            <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium">{albumName}</span>
                <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">{artistName}</span>
            </div>
            <div className={metaContainerClass({ hidden: compact })}>
                {publishedYear && <Badge tone="subtle">{publishedYear}</Badge>}
                {typeof musicCount === 'number' && <Badge tone="subtle">{musicCount} tracks</Badge>}
            </div>
        </button>
    );
};

export default AlbumListItem;
