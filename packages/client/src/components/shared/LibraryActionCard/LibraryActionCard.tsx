import { cva, type VariantProps } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';
import { Link } from 'react-router-dom';

const cx = classNames;

const libraryActionCardClass = cva(
    [
        'flex w-full min-w-0 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)]',
        'bg-[var(--b-color-surface-item)] p-3.5 text-[var(--b-color-text)] no-underline',
        'transition-[color,background-color,border-color,transform,opacity] duration-150',
        'hover:border-[var(--b-color-border)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
        'disabled:cursor-not-allowed disabled:opacity-40'
    ],
    {
        variants: {
            layout: {
                shortcut: 'min-h-21 flex-col items-start justify-between gap-4',
                action: 'min-h-28 flex-col justify-between gap-4 text-left'
            }
        },
        defaultVariants: {
            layout: 'shortcut'
        }
    }
);

const libraryActionCardIconClass = cva(
    'inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--b-color-surface-subtle)] text-[var(--b-color-text-muted)]',
    {
        variants: {
            layout: {
                shortcut: 'h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]',
                action: 'h-9 w-9 text-[var(--b-color-text-secondary)] [&_svg]:h-4 [&_svg]:w-4'
            }
        },
        defaultVariants: {
            layout: 'shortcut'
        }
    }
);

type LibraryActionCardVariantProps = VariantProps<typeof libraryActionCardClass>;

interface LibraryActionCardProps extends LibraryActionCardVariantProps {
    title: React.ReactNode;
    description?: React.ReactNode;
    meta?: React.ReactNode;
    icon?: React.ReactNode;
    to?: string;
    disabled?: boolean;
    className?: string;
    onClick?: () => void;
}

const LibraryActionCard = ({
    title,
    description,
    meta,
    icon,
    layout,
    to,
    disabled,
    className,
    onClick
}: LibraryActionCardProps) => {
    const resolvedLayout = layout ?? 'shortcut';
    const cardClassName = cx(libraryActionCardClass({ layout: resolvedLayout }), className);
    const iconNode = icon ? (
        <span className={libraryActionCardIconClass({ layout: resolvedLayout })}>
            {icon}
        </span>
    ) : null;

    const content = resolvedLayout === 'action' ? (
        <>
            <span className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-semibold">{title}</span>
                    {description && (
                        <span className="line-clamp-2 text-xs leading-[1.45] text-[var(--b-color-text-tertiary)]">
                            {description}
                        </span>
                    )}
                </span>
                {iconNode}
            </span>
            {meta && <span className="text-xs font-medium text-[var(--b-color-text-muted)]">{meta}</span>}
        </>
    ) : (
        <>
            {iconNode}
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-[var(--b-color-text)]">{title}</span>
                {meta && <span className="truncate text-xs text-[var(--b-color-text-tertiary)]">{meta}</span>}
            </span>
        </>
    );

    if (to && !disabled) {
        return (
            <Link to={to} className={cardClassName}>
                {content}
            </Link>
        );
    }

    return (
        <button
            type="button"
            disabled={disabled}
            className={cardClassName}
            onClick={onClick}>
            {content}
        </button>
    );
};

export default LibraryActionCard;
