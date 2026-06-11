import { cva, type VariantProps } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';

const cx = classNames;

const badgeVariants = cva(
    'inline-flex w-fit max-w-full items-center justify-center whitespace-nowrap rounded-full border border-transparent text-xs font-semibold leading-tight',
    {
        variants: {
            tone: {
                neutral: 'border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-input)] text-[var(--b-color-text-secondary)]',
                subtle: 'border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] text-[var(--b-color-text-tertiary)]',
                accent: 'border-[var(--b-color-focus)] ow-active-background text-[var(--b-color-point-light)]',
                success: 'bg-[var(--b-color-badge-success-background)] text-[var(--b-color-badge-success-text)]',
                warning: 'bg-[var(--b-color-badge-warning-background)] text-[var(--b-color-badge-warning-text)]',
                danger: 'bg-[var(--b-color-badge-danger-background)] text-[var(--b-color-badge-danger-text)]'
            },
            size: {
                sm: 'min-h-6 px-2.5 py-1',
                md: 'min-h-7 px-3 py-1 text-sm'
            }
        },
        defaultVariants: {
            tone: 'neutral',
            size: 'sm'
        }
    }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({
    tone,
    size,
    className,
    children,
    ...props
}, ref) => {
    return (
        <span
            ref={ref}
            className={cx(badgeVariants({ tone, size }), className)}
            {...props}>
            {children}
        </span>
    );
});

Badge.displayName = 'Badge';

export default Badge;
