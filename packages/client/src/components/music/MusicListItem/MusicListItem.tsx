import classNames from 'classnames';
const cx = classNames;

import { IconButton, TrackArtwork } from '~/components/shared';
import { activeFilledIconClassName } from '~/components/shared/iconStateClass';
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
    return (
        <div
            className={cx(
                'group/row flex h-full w-full items-center text-[var(--b-color-text)] transition-[background-color,opacity]',
                'hover:bg-[image:var(--b-gradient-row-hover)]',
                { 'opacity-40': isHated }
            )}>
            <button
                type="button"
                className="ow-active-press flex min-w-0 flex-1 self-stretch items-center gap-4 px-6 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--b-color-focus)]"
                onClick={onClick}
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
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex min-w-0 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-[var(--b-color-text)]">
                            {!!trackNumber && !hideAlbumArt && (
                                <span className="min-w-6 text-xs text-[var(--b-color-text-muted)]">{trackNumber}.</span>
                            )}
                            <span className="truncate">{musicName}</span>
                            {musicCodec?.toLowerCase() === 'flac' && (
                                <span className="inline-flex min-h-[12px] shrink-0 items-center rounded-full border border-[rgba(139,92,246,0.28)] bg-[rgba(139,92,246,0.08)] px-1 text-[8px] font-normal leading-none text-[var(--b-color-point-light)]">
                                    {musicCodec.toUpperCase()}
                                </span>
                            )}
                        </span>
                        <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">
                            {artistName}
                        </span>
                    </span>
                    {isLiked && (
                        <span
                            className={cx(
                                'inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--b-color-point)] [&_svg]:h-4 [&_svg]:w-4',
                                activeFilledIconClassName
                            )}
                            aria-hidden="true">
                            <Heart />
                        </span>
                    )}
                </span>
            </button>
            {onLongPress && (
                <IconButton
                    size="compact"
                    className="mr-4"
                    aria-label={`Open actions for ${musicName}`}
                    onClick={onLongPress}>
                    <VerticalDots />
                </IconButton>
            )}
        </div>
    );
};

export default MusicListItem;
