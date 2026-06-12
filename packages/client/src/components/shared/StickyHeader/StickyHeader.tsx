import classNames from 'classnames';
import React from 'react';

const cx = classNames;

interface StickyHeaderProps {
    children?: React.ReactNode;
}

interface StickyHeaderActionsProps {
    children?: React.ReactNode;
}

const StickyHeader = ({ children }: StickyHeaderProps) => {
    return (
        <div className={cx('sticky left-0 top-0 z-[5] flex flex-wrap justify-between gap-3 bg-[var(--b-color-background)] px-[var(--b-spacing-md)] pb-3 pt-[var(--b-spacing-md)]')}>
            {children}
        </div>
    );
};

export const StickyHeaderActions = ({ children }: StickyHeaderActionsProps) => {
    return (
        <div className={cx('flex flex-row items-center gap-[var(--b-spacing-sm)] max-sm:w-full max-sm:justify-end')}>
            {children}
        </div>
    );
};

export default StickyHeader;
