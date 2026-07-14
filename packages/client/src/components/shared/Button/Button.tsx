import classNames from 'classnames';
import { cva, type VariantProps } from 'class-variance-authority';
import { activeFilledIconClassName, activeIconClassName, filledIconClassName } from '../iconStateClass';
const cx = classNames;

import React from 'react';

const buttonVariants = cva(
    [
        'inline-flex items-center justify-center gap-2 rounded-[var(--b-radius-md)] border text-xs font-semibold leading-tight no-underline',
        'transition-[color,background-color,border-color,transform]',
        'focus-visible:border-[var(--b-color-focus)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--b-color-focus-ring)]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40',
        '[&_svg]:h-[15.2px] [&_svg]:w-[15.2px] [&_svg]:shrink-0'
    ],
    {
        variants: {
            variant: {
                primary: 'border-[var(--b-color-point)] bg-[var(--b-color-point)] text-[var(--b-color-background)] hover:border-[var(--b-color-point-dark)] hover:bg-[var(--b-color-point-dark)] hover:text-[var(--b-color-static-white)]',
                secondary: 'border-transparent bg-[var(--b-color-secondary-button)] text-[var(--b-color-text-secondary)] hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]',
                ghost: 'border-transparent bg-transparent text-[var(--b-color-text-secondary)] hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]',
                danger: 'border-transparent bg-[var(--b-color-badge-danger-background)] text-[var(--b-color-badge-danger-text)] hover:bg-[var(--b-color-danger-hover)] hover:text-[var(--b-color-text)]'
            },
            size: {
                xs: 'min-h-9 min-w-9 px-2.5 py-1',
                sm: 'min-h-10 min-w-10 px-2.5 py-1.5',
                md: 'min-h-10 min-w-10 px-3 py-1.5'
            },
            fullWidth: {
                true: 'w-full'
            },
            active: {
                true: `border-[var(--b-color-focus)] ow-active-background ${activeIconClassName}`,
                false: ''
            },
            filled: {
                true: '',
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
            fullWidth: false,
            active: false,
            filled: false
        }
    }
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
    variant,
    size,
    fullWidth,
    active,
    filled,
    className,
    type = 'button',
    children,
    ...props
}, ref) => {
    return (
        <button
            ref={ref}
            type={type}
            className={cx(buttonVariants({ active, filled, variant, size, fullWidth }), className)}
            {...props}>
            {children}
        </button>
    );
});

Button.displayName = 'Button';

export default Button;
