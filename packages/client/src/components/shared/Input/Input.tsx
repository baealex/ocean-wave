import { cva, type VariantProps } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';

const cx = classNames;

const inputVariants = cva(
    [
        'min-w-0 rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)]',
        'bg-[var(--b-color-surface-subtle)] text-xs font-semibold leading-tight text-[var(--b-color-text-secondary)]',
        'transition-[border-color,background-color,box-shadow,color] duration-150',
        'placeholder:text-[var(--b-color-text-muted)]',
        'focus:outline-none focus-visible:border-[var(--b-color-focus)] focus-visible:bg-[var(--b-color-hover)]',
        'focus-visible:text-[var(--b-color-text)] focus-visible:shadow-[0_0_0_3px_var(--b-color-focus-ring)]',
        'enabled:hover:text-[var(--b-color-text)]',
        'disabled:cursor-not-allowed disabled:opacity-50'
    ],
    {
        variants: {
            inputSize: {
                md: 'min-h-9 px-3',
                lg: 'min-h-11 px-3.5'
            },
            tone: {
                default: '',
                panel: 'bg-[var(--b-color-surface-subtle)]'
            },
            fullWidth: {
                true: 'w-full',
                false: ''
            }
        },
        defaultVariants: {
            inputSize: 'md',
            tone: 'default',
            fullWidth: true
        }
    }
);

type InputVariantProps = VariantProps<typeof inputVariants>;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>, InputVariantProps {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({
    inputSize,
    tone,
    fullWidth,
    className,
    ...props
}, ref) => {
    return (
        <input
            ref={ref}
            className={cx(inputVariants({ inputSize, tone, fullWidth }), className)}
            {...props}
        />
    );
});

Input.displayName = 'Input';

export default Input;
