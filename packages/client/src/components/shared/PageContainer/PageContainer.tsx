import type { ReactNode } from 'react';

import classNames from 'classnames';

const cx = classNames;

export type PageContainerWidth = 'compact' | 'narrow' | 'standard' | 'wide' | 'full';
export type PageContainerPadding = 'page' | 'content' | 'focus' | 'none';

export interface PageContainerProps {
    width?: PageContainerWidth;
    padding?: PageContainerPadding;
    className?: string;
    children: ReactNode;
}

const WIDTH_MAP: Record<PageContainerWidth, string> = {
    compact: 'w-[min(100%,480px)]',
    narrow: 'w-[min(100%,608px)]',
    standard: 'w-full max-w-[860px]',
    wide: 'w-[min(100%,1152px)]',
    full: 'w-full'
};

const PADDING_MAP: Record<PageContainerPadding, string> = {
    page: 'p-[clamp(16px,3vw,32px)] pb-[calc(clamp(16px,3vw,32px)+env(safe-area-inset-bottom))] max-sm:p-[var(--b-spacing-md)] max-sm:pb-[calc(var(--b-spacing-md)+env(safe-area-inset-bottom))]',
    content: 'px-4 py-6 sm:px-6 sm:py-10 lg:px-10 lg:py-12',
    focus: 'px-4 pb-[calc(24px+env(safe-area-inset-bottom))] max-sm:px-3.5',
    none: ''
};

const PageContainer = ({
    width = 'standard',
    padding = 'page',
    className,
    children
}: PageContainerProps) => {
    return (
        <div className={cx('mx-auto text-[var(--b-color-text)]', WIDTH_MAP[width], PADDING_MAP[padding], className)}>
            {children}
        </div>
    );
};

export default PageContainer;
