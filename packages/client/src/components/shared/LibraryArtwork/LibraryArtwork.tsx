import classNames from 'classnames';
const cx = classNames;

import GridImage from '../GridImage';
import Image from '../Image';

interface ArtworkBaseProps {
    className?: string;
    alt?: string;
}

interface SingleArtworkProps extends ArtworkBaseProps {
    src?: string;
}

interface PlaylistArtworkProps extends ArtworkBaseProps {
    images: string[];
}

export function AlbumArtwork({
    src,
    alt = '',
    className
}: SingleArtworkProps) {
    return (
        <span className={cx('relative block h-16 w-20 shrink-0 overflow-visible', className)}>
            <span
                aria-hidden="true"
                className={cx(
                    'absolute right-0 top-2 h-12 w-12 rounded-full border border-[var(--b-color-border-subtle)] opacity-75',
                    'bg-[var(--b-color-background-layer-1)]',
                    '[background-image:radial-gradient(circle_at_center,var(--b-color-background)_0_15%,var(--b-color-border)_16%_20%,transparent_21%),linear-gradient(135deg,transparent_0_42%,var(--b-color-border)_43%_47%,transparent_48%_100%)]'
                )}
            />
            <Image
                src={src}
                alt={alt}
                loading="eager"
                className="absolute left-0 top-0 h-16 w-16 rounded-[var(--b-radius-lg)] object-cover shadow-[8px_0_0_var(--b-color-overlay-strong)]"
            />
        </span>
    );
}

export function ArtistArtwork({
    src,
    alt = '',
    className
}: SingleArtworkProps) {
    return (
        <span className={cx('group/art relative block h-16 w-16 shrink-0 rounded-full', className)}>
            <span
                aria-hidden="true"
                className={cx(
                    'absolute -inset-1 rotate-[18deg] rounded-full border border-[var(--b-color-border-subtle)] border-t-[var(--b-color-focus)]'
                )}
            />
            <Image
                src={src}
                alt={alt}
                loading="eager"
                className="relative z-[1] h-full w-full overflow-hidden rounded-full object-cover shadow-[0_0_0_1.5px_var(--b-color-border)]"
            />
        </span>
    );
}

export function TrackArtwork({
    src,
    alt = '',
    className
}: SingleArtworkProps) {
    return (
        <Image
            src={src}
            alt={alt}
            loading="eager"
            className={cx('h-12 w-12 shrink-0 rounded-[var(--b-radius-md)] object-cover', className)}
        />
    );
}


export function PlaylistArtwork({
    images,
    className
}: PlaylistArtworkProps) {
    return (
        <GridImage
            images={images}
            className={cx('h-[60px] w-[60px] shrink-0 overflow-hidden rounded-[var(--b-radius-md)]', className)}
        />
    );
}
