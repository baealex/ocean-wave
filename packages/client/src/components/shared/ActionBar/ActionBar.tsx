import { cva } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';

const cx = classNames;

interface ActionBarProps {
    children?: React.ReactNode;
}

export interface ActionBarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children?: React.ReactNode;
}

const actionBarButtonClass = cva([
    'inline-flex min-h-11 flex-row items-center justify-center gap-2 rounded-[var(--b-radius-lg)] border border-transparent px-3 py-2 text-xs font-semibold',
    'text-[var(--b-color-text-secondary)] transition-[color,background-color,border-color,transform] duration-150',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] active:scale-[0.98]',
    'hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] [&_svg]:h-[15.2px] [&_svg]:w-[15.2px] [&_svg]:shrink-0',
    'first:border-[var(--b-color-point)] first:bg-[var(--b-color-point)] first:text-[var(--b-color-background)] last:text-[rgba(254,202,202,0.92)]'
]);

const ActionBar = ({ children }: ActionBarProps) => {
    return (
        <div className={cx('sticky bottom-[max(12px,env(safe-area-inset-bottom))] z-[8] mx-auto mt-[var(--b-spacing-lg)] grid w-[min(544px,calc(100%_-_32px))] grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1.5 rounded-[var(--b-radius-xl)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-modal)] p-1.5')}>
            {children}
        </div>
    );
};

export const ActionBarButton = React.forwardRef<HTMLButtonElement, ActionBarButtonProps>(({
    className,
    type = 'button',
    children,
    ...props
}, ref) => {
    return (
        <button
            ref={ref}
            type={type}
            className={cx(actionBarButtonClass(), className)}
            {...props}>
            {children}
        </button>
    );
});

ActionBarButton.displayName = 'ActionBarButton';

export default ActionBar;
