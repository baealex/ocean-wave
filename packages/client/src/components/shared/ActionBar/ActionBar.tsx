import { cva } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';

import Button from '../Button';

const cx = classNames;

interface ActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
    layout?: 'grid' | 'stack';
}

const actionBarClass = cva(
    [
        'sticky bottom-[max(12px,env(safe-area-inset-bottom))] z-[8] mx-auto mt-[var(--b-spacing-lg)]',
        'w-[min(544px,calc(100%_-_32px))] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-modal)]'
    ],
    {
        variants: {
            layout: {
                grid: 'grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1.5 rounded-[var(--b-radius-xl)] p-1.5',
                stack: 'flex flex-col gap-2 rounded-[var(--b-radius-xl)] p-2'
            }
        },
        defaultVariants: {
            layout: 'grid'
        }
    }
);

type ActionBarButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ActionBarButtonProps extends Omit<React.ComponentProps<typeof Button>, 'variant' | 'size' | 'fullWidth'> {
    variant?: ActionBarButtonVariant;
    children?: React.ReactNode;
}

const getButtonVariant = (variant: ActionBarButtonVariant = 'secondary') => (
    variant === 'secondary' ? 'ghost' : variant
);

const ActionBar = ({
    children,
    className,
    layout,
    ...props
}: ActionBarProps) => {
    return (
        <div className={cx(actionBarClass({ layout }), className)} {...props}>
            {children}
        </div>
    );
};

export const ActionBarButton = React.forwardRef<HTMLButtonElement, ActionBarButtonProps>(({
    variant,
    className,
    type = 'button',
    children,
    ...props
}, ref) => {
    return (
        <Button
            ref={ref}
            variant={getButtonVariant(variant)}
            size="md"
            fullWidth
            type={type}
            className={cx('min-h-11 rounded-[var(--b-radius-lg)] px-3 py-2', className)}
            {...props}>
            {children}
        </Button>
    );
});

ActionBarButton.displayName = 'ActionBarButton';

export default ActionBar;
