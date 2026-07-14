import type { ReactNode } from 'react';

import Text from '../Text';

interface CollectionHeaderProps {
    title: string;
    summary: string;
    actions?: ReactNode;
    children?: ReactNode;
}

export default function CollectionHeader({
    title,
    summary,
    actions,
    children
}: CollectionHeaderProps) {
    return (
        <header className="sticky left-0 top-0 z-[5] flex flex-col gap-3 border-b border-[var(--b-color-border-subtle)] bg-[var(--b-color-background)] px-[var(--b-spacing-md)] pb-3 pt-[var(--b-spacing-md)]">
            <div className="flex min-w-0 items-end justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                    <Text as="h1" size="xl" weight="bold" truncate>
                        {title}
                    </Text>
                    <Text as="p" variant="tertiary" size="xs" aria-live="polite">
                        {summary}
                    </Text>
                </div>
                {actions && (
                    <div className="flex shrink-0 items-center gap-2">
                        {actions}
                    </div>
                )}
            </div>
            {children && (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    {children}
                </div>
            )}
        </header>
    );
}
