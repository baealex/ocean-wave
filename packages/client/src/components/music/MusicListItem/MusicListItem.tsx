import classNames from 'classnames';
const cx = classNames;

import { IconButton, TrackArtwork } from '~/components/shared';
import { Heart, VerticalDots } from '~/icon';

interface MusicListItemProps {
    id?: number;
    albumName: string;
    albumCover?: string;
    artistName: string;
    trackNumber?: number;
    musicName: string;
    musicCodec?: string;
    isLiked?: boolean;
    isHated?: boolean;
    hideAlbumArt?: boolean;
    onClick?: () => void;
    onLongPress?: () => void;
}

const MusicListItem = ({
    albumName,
    albumCover,
    artistName,
    trackNumber,
    musicName,
    musicCodec,
    isLiked,
    isHated,
    hideAlbumArt,
    onClick,
    onLongPress
}: MusicListItemProps) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Enter' && e.key !== ' ') {
            return;
        }

        e.preventDefault();
        onClick?.();
    };

    return (
        <div
            role="button"
            tabIndex={0}
            className={cx(
                'group/row flex w-full cursor-pointer flex-row items-center gap-4 px-6 py-4 text-left text-[var(--b-color-text)] transition-colors',
                'hover:bg-[image:var(--b-gradient-row-hover)] active:bg-[var(--b-color-active)]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                { 'opacity-40': isHated }
            )}
            onClick={onClick}
            onKeyDown={handleKeyDown}
            onContextMenu={(e) => {
                e.preventDefault();
                onLongPress?.();
            }}>
            {hideAlbumArt ? (
                <span className="w-12 shrink-0 text-center text-xs text-[var(--b-color-text-muted)]">
                    {trackNumber ?? '·'}
                </span>
            ) : (
                <TrackArtwork src={albumCover} alt={albumName} />
            )}
            <span className="flex min-w-0 flex-1 flex-row items-center justify-between gap-2">
                <span className={cx('flex min-w-0 flex-1 flex-col gap-1', { 'max-w-[calc(100%-40px-var(--b-spacing-md))]': typeof onLongPress === 'function' })}>
                    <span className="flex min-w-0 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-[var(--b-color-text)]">
                        {!!trackNumber && !hideAlbumArt && (
                            <span className="min-w-6 text-xs text-[var(--b-color-text-muted)]">{trackNumber}.</span>
                        )}
                        <span className="truncate">{musicName}</span>
                        {musicCodec && musicCodec.toLowerCase() === 'flac' && (
                            <span className="shrink-0 text-[0.625rem] font-semibold uppercase tracking-[0.04em] text-[var(--b-color-point)]">{musicCodec}</span>
                        )}
                    </span>
                    <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">
                        {artistName}
                    </span>
                </span>
                {onLongPress && (
                    <IconButton
                        aria-label={`Open actions for ${musicName}`}
                        active={isLiked}
                        className={cx(
                            'h-10 w-10',
                            isLiked && '[&_svg]:!fill-[var(--b-color-point)] [&_svg]:!stroke-[var(--b-color-point)]'
                        )}
                        onClick={(e) => {
                            e.stopPropagation();
                            onLongPress?.();
                        }}>
                        {isLiked ? <Heart /> : <VerticalDots />}
                    </IconButton>
                )}
            </span>
        </div>
    );
};

export default MusicListItem;
