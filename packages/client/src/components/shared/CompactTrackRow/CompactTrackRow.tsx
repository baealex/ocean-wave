import { cva, type VariantProps } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';
import { Link } from 'react-router-dom';

import * as Icon from '~/icon';
import type { Music } from '~/models/type';

import Image from '../Image';

const cx = classNames;

const compactTrackRowClass = cva(
    [
        'grid min-h-15 min-w-0 items-center gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)]',
        'bg-[var(--b-color-surface-item)] p-2.5 text-[var(--b-color-text)] transition-[color,background-color,border-color,transform] duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
        'disabled:cursor-not-allowed disabled:opacity-40'
    ],
    {
        variants: {
            layout: {
                plain: 'grid-cols-[3rem_minmax(0,1fr)]',
                ranked: 'grid-cols-[1.5rem_3rem_minmax(0,1fr)]',
                trailing: 'grid-cols-[3rem_minmax(0,1fr)_auto]'
            },
            interactive: {
                true: 'w-full text-left no-underline hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]',
                false: ''
            }
        },
        defaultVariants: {
            layout: 'plain',
            interactive: false
        }
    }
);

const compactTrackMeterFillClass = cva('block h-full rounded-[inherit]', {
    variants: {
        tone: {
            primary: 'bg-[var(--b-color-point)] opacity-80',
            neutral: 'bg-[var(--b-color-text-muted)] opacity-45'
        }
    },
    defaultVariants: {
        tone: 'neutral'
    }
});

type CompactTrackRowVariantProps = VariantProps<typeof compactTrackRowClass>;
type CompactTrackMeterTone = NonNullable<VariantProps<typeof compactTrackMeterFillClass>['tone']>;

interface CompactTrackRowProps {
    music: Music;
    rank?: React.ReactNode;
    subtitle?: React.ReactNode;
    trailing?: React.ReactNode;
    meter?: {
        ratio: number;
        tone?: CompactTrackMeterTone;
    };
    to?: string;
    disabled?: boolean;
    ariaLabel?: string;
    className?: string;
    onClick?: () => void;
}

const clampRatio = (ratio: number) => Math.max(Math.min(ratio, 1), 0);

const getLayout = ({
    rank,
    trailing
}: Pick<CompactTrackRowProps, 'rank' | 'trailing'>): CompactTrackRowVariantProps['layout'] => {
    if (rank !== undefined) {
        return 'ranked';
    }

    if (trailing !== undefined) {
        return 'trailing';
    }

    return 'plain';
};

const CompactTrackRow = ({
    music,
    rank,
    subtitle,
    trailing,
    meter,
    to,
    disabled,
    ariaLabel,
    className,
    onClick
}: CompactTrackRowProps) => {
    const interactive = Boolean(to || onClick);
    const layout = getLayout({ rank, trailing });
    const rowClassName = cx(compactTrackRowClass({ layout, interactive }), className);
    const meterWidth = meter ? Math.max(clampRatio(meter.ratio) * 100, 8) : 0;

    const content = (
        <>
            {rank !== undefined && (
                <span className="text-center text-xs font-medium text-[var(--b-color-text-muted)]">
                    {rank}
                </span>
            )}
            <Image
                className="h-12 w-12 shrink-0 overflow-hidden rounded-[var(--b-radius-md)] object-cover"
                src={music.album.cover}
                alt={music.album.name}
                icon={<Icon.Disc />}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-[var(--b-color-text)]">{music.name}</span>
                <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">
                    {subtitle ?? music.artistDisplayName}
                </span>
                {meter && (
                    <span className="mt-0.5 h-1 overflow-hidden rounded-full bg-[var(--b-color-border-subtle)]" aria-hidden="true">
                        <span
                            className={compactTrackMeterFillClass({ tone: meter.tone })}
                            style={{ width: `${meterWidth}%` }}
                        />
                    </span>
                )}
            </span>
            {trailing !== undefined && (
                <span className="shrink-0 text-xs text-[var(--b-color-text-muted)] [&_svg]:h-4 [&_svg]:w-4">
                    {trailing}
                </span>
            )}
        </>
    );

    if (to && !disabled) {
        return (
            <Link to={to} className={rowClassName} aria-label={ariaLabel}>
                {content}
            </Link>
        );
    }

    if (interactive) {
        return (
            <button
                type="button"
                className={rowClassName}
                disabled={disabled}
                aria-label={ariaLabel}
                onClick={onClick}>
                {content}
            </button>
        );
    }

    return (
        <div className={rowClassName} aria-label={ariaLabel}>
            {content}
        </div>
    );
};

export default CompactTrackRow;
