import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface CollectionCardProps {
    artwork: ReactNode;
    description?: ReactNode;
    meta?: ReactNode;
    title: ReactNode;
    to: string;
}

export const COLLECTION_CARD_HEIGHT_OFFSET = 88;

export default function CollectionCard({
    artwork,
    description,
    meta,
    title,
    to
}: CollectionCardProps) {
    return (
        <Link
            to={to}
            className="group/card ow-active-press flex h-full min-w-0 flex-col rounded-[var(--b-radius-xl)] border border-transparent p-2 text-left text-[var(--b-color-text)] transition-[background-color,border-color,transform] duration-150 hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]">
            <span className="relative aspect-square w-full shrink-0 transition-transform duration-150 group-hover/card:scale-[1.015] motion-reduce:transition-none">
                {artwork}
            </span>
            <span
                className="flex min-w-0 flex-1 flex-col gap-1 px-1 pt-3"
                style={{ minHeight: COLLECTION_CARD_HEIGHT_OFFSET }}>
                <span className="line-clamp-2 text-sm font-semibold leading-[1.35]">
                    {title}
                </span>
                {description && (
                    <span className="truncate text-xs text-[var(--b-color-text-secondary)]">
                        {description}
                    </span>
                )}
                {meta && (
                    <span className="mt-auto truncate text-xs text-[var(--b-color-text-tertiary)]">
                        {meta}
                    </span>
                )}
            </span>
        </Link>
    );
}
