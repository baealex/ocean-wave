import { ArtistArtwork, libraryRowClass } from '~/components/shared';

interface ArtistListItemProps {
    artistName: string;
    artistCover: string;
    albumCount: number;
    musicCount: number;
    onClick: () => void;
}

const ArtistListItem = ({
    artistName,
    artistCover,
    albumCount,
    musicCount,
    onClick
}: ArtistListItemProps) => {
    return (
        <button
            type="button"
            className={libraryRowClass()}
            onClick={onClick}>
            <ArtistArtwork src={artistCover} alt={artistName} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium text-[var(--b-color-text)]">{artistName}</span>
                <span className="flex gap-2 text-xs text-[var(--b-color-text-tertiary)]">
                    <span>{albumCount} {albumCount === 1 ? 'album' : 'albums'}</span>
                    <span className="text-[var(--b-color-text-muted)]">·</span>
                    <span>{musicCount} {musicCount === 1 ? 'song' : 'songs'}</span>
                </span>
            </div>
        </button>
    );
};

export default ArtistListItem;
