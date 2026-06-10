import classNames from 'classnames';
import { cva, type VariantProps } from 'class-variance-authority';
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
                primary: 'border-[var(--b-color-point)] bg-[var(--b-color-point)] text-[var(--b-color-background)] hover:border-[var(--b-color-point-dark)] hover:bg-[var(--b-color-point-dark)] hover:text-[var(--b-color-background)]',
                secondary: 'border-transparent bg-[var(--b-color-secondary-button)] text-[var(--b-color-text-secondary)] hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]',
                ghost: 'border-transparent bg-transparent text-[var(--b-color-text-secondary)] hover:border-[var(--b-color-border-subtle)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]',
                danger: 'border-transparent bg-red-500/15 text-red-100/90 hover:bg-red-400/20 hover:text-[var(--b-color-text)]'
            },
            size: {
                sm: 'min-h-9 min-w-9 px-2.5 py-1.5',
                md: 'min-h-9 min-w-9 px-3 py-1.5'
            },
            fullWidth: {
                true: 'w-full'
            }
        },
        defaultVariants: {
            variant: 'secondary',
            size: 'md',
            fullWidth: false
        }
    }
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
    variant,
    size,
    fullWidth,
    className,
    type = 'button',
    children,
    ...props
}, ref) => {
    return (
        <button
            ref={ref}
            type={type}
            className={cx(buttonVariants({ variant, size, fullWidth }), className)}
            {...props}>
            {children}
        </button>
    );
});

Button.displayName = 'Button';

export default Button;
