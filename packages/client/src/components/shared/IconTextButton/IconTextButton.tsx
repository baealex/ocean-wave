import { cva, type VariantProps } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';
import { activeFilledIconClassName, activeIconClassName, filledIconClassName } from '../iconStateClass';

const cx = classNames;

const iconTextButtonVariants = cva(
    [
        'inline-flex items-center gap-2 rounded-[var(--b-radius-md)] border text-left text-xs font-semibold',
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
                lg: 'min-h-11 px-3.5 py-2.5',
                menu: 'min-h-[52px] px-3 py-2.5'
            },
            shape: {
                md: 'rounded-[var(--b-radius-md)]',
                pill: 'rounded-full'
            },
            layout: {
                start: 'justify-start',
                between: 'justify-between'
            },
            active: {
                true: `border-[var(--b-color-focus)] ow-active-background ${activeIconClassName}`,
                false: ''
            },
            filled: {
                true: '',
                false: ''
            },
            fullWidth: {
                true: 'w-full',
                false: ''
            }
        },
        compoundVariants: [
            {
                active: false,
                filled: true,
                className: filledIconClassName
            },
            {
                active: true,
                filled: true,
                className: activeFilledIconClassName
            }
        ],
        defaultVariants: {
            variant: 'secondary',
            size: 'md',
            shape: 'md',
            layout: 'start',
            active: false,
            filled: false,
            fullWidth: false
        }
    }
);

const iconTextButtonMetaVariants = cva(
    'truncate text-[var(--b-font-size-caption-compact)] font-normal text-[var(--b-color-text-tertiary)]',
    {
        variants: {
            parentVariant: {
                primary: 'text-[var(--b-color-on-primary-muted)]',
                secondary: '',
                ghost: ''
            }
        },
        defaultVariants: {
            parentVariant: 'secondary'
        }
    }
);

export interface IconTextButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconTextButtonVariants> {
    icon?: React.ReactNode;
    label: React.ReactNode;
    meta?: React.ReactNode;
    trailing?: React.ReactNode;
}

const IconTextButton = React.forwardRef<HTMLButtonElement, IconTextButtonProps>(({
    icon,
    label,
    meta,
    trailing,
    active,
    filled,
    fullWidth,
    layout,
    shape,
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
            className={cx(iconTextButtonVariants({ active, filled, fullWidth, layout, shape, variant, size }), className)}
            {...props}>
            <span className={cx('flex min-w-0 items-center gap-2', layout === 'between' && 'flex-1')}>
                {icon && <span className="inline-flex shrink-0 items-center justify-start [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
                <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-inherit">{label}</span>
                    {meta && <span className={iconTextButtonMetaVariants({ parentVariant: variant })}>{meta}</span>}
                </span>
            </span>
            {trailing && <span className="inline-flex shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">{trailing}</span>}
        </button>
    );
});

IconTextButton.displayName = 'IconTextButton';

export default IconTextButton;
