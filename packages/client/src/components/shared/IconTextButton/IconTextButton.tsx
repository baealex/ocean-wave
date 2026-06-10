import { cva, type VariantProps } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';

const cx = classNames;

const iconTextButtonVariants = cva(
    [
        'inline-flex items-center justify-start gap-2 rounded-[var(--b-radius-md)] border text-left text-xs font-semibold',
        'transition-[color,background-color,border-color,transform] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--b-color-focus)]',
        'active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'
    ],
    {
        variants: {
            variant: {
                primary: 'border-[var(--b-color-point)] bg-[var(--b-color-point)] text-[var(--b-color-background)] hover:enabled:border-[var(--b-color-point-dark)] hover:enabled:bg-[var(--b-color-point-dark)] hover:enabled:text-[var(--b-color-background)]',
                secondary: 'border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] text-[var(--b-color-text-secondary)] hover:enabled:border-[var(--b-color-border)] hover:enabled:bg-[var(--b-color-hover)] hover:enabled:text-[var(--b-color-text)]',
                ghost: 'border-[var(--b-color-border-subtle)] bg-transparent text-[var(--b-color-text-tertiary)] hover:enabled:border-[var(--b-color-border)] hover:enabled:bg-[var(--b-color-hover)] hover:enabled:text-[var(--b-color-text)]'
            },
            size: {
                sm: 'min-h-9 px-3 py-1.5',
                md: 'min-h-10 px-3 py-2',
                lg: 'min-h-11 px-3.5 py-2.5'
            }
        },
        defaultVariants: {
            variant: 'secondary',
            size: 'md'
        }
    }
);

export interface IconTextButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconTextButtonVariants> {
    icon?: React.ReactNode;
    label: React.ReactNode;
    meta?: React.ReactNode;
}

const IconTextButton = React.forwardRef<HTMLButtonElement, IconTextButtonProps>(({
    icon,
    label,
    meta,
    variant,
    size,
    className,
    type = 'button',
    ...props
}, ref) => {
    return (
        <button
            ref={ref}
            type={type}
            className={cx(iconTextButtonVariants({ variant, size }), className)}
            {...props}>
            {icon && <span className="inline-flex shrink-0 items-center justify-start [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-inherit">{label}</span>
                {meta && <span className={cx('truncate text-[11px] font-normal text-[var(--b-color-text-tertiary)]', variant === 'primary' && 'text-black/60')}>{meta}</span>}
            </span>
        </button>
    );
});

IconTextButton.displayName = 'IconTextButton';

export default IconTextButton;
