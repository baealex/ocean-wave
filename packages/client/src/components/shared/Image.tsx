import classNames from 'classnames';
import { cva } from 'class-variance-authority';
import {
    useState, useEffect, type ImgHTMLAttributes, type ReactNode, type ReactEventHandler
} from 'react';

import { DEFAULT_ALBUM_ART } from '~/modules/image';

const cx = classNames;

const imageClass = cva(
    'bg-[var(--b-color-surface-subtle)] text-transparent opacity-0 transition-opacity duration-300 motion-reduce:transition-none',
    {
        variants: {
            loaded: {
                true: 'opacity-100',
                false: ''
            }
        },
        defaultVariants: {
            loaded: false
        }
    }
);

interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
    src?: string;
    loading?: 'lazy' | 'eager';
    icon?: ReactNode;
}

export default function Image({
    src,
    loading = 'eager',
    icon,
    className,
    style,
    onError,
    onLoad,
    ...props
}: ImageProps) {
    void icon;

    const [failed, setFailed] = useState(false);
    const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    const effectiveSrc = !src || failed ? DEFAULT_ALBUM_ART : src;
    const loaded = loadedSrc === effectiveSrc;

    const handleError: ReactEventHandler<HTMLImageElement> = (event) => {
        onError?.(event);

        if (effectiveSrc !== DEFAULT_ALBUM_ART) {
            setFailed(true);
        }
    };

    const handleLoad: ReactEventHandler<HTMLImageElement> = (event) => {
        setLoadedSrc(effectiveSrc);
        onLoad?.(event);
    };

    return (
        <img
            src={effectiveSrc}
            loading={loading}
            className={cx(imageClass({ loaded }), className)}
            style={style}
            onError={handleError}
            onLoad={handleLoad}
            {...props}
        />
    );
}
