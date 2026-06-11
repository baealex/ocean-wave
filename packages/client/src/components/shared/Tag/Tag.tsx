import { cva, type VariantProps } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';

const cx = classNames;

const tagVariants = cva(
    [
        'inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 rounded-full border border-[var(--b-color-border-subtle)]',
        'min-h-8 px-3 py-1.5 text-sm font-semibold leading-tight transition-[border-color,background-color,color,box-shadow,transform] duration-150'
    ],
    {
        variants: {
            tone: {
                neutral: 'bg-[var(--b-color-surface-input)] text-[var(--b-color-text-secondary)]',
                accent: 'bg-[var(--b-color-surface-input)] text-[var(--b-color-point-light)]',
                danger: 'border-[var(--b-color-danger-border)] bg-transparent text-[var(--b-color-badge-danger-text)]'
            },
            selected: {
                true: 'border-[var(--b-color-focus)] ow-active-surface text-[var(--b-color-text)]',
                false: ''
            },
            interactive: {
                true: 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
                false: ''
            }
        },
        compoundVariants: [
            {
                selected: false,
                interactive: true,
                className: 'hover:border-[var(--b-color-focus)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]'
            },
            {
                selected: true,
                interactive: true,
                className: 'hover:border-[var(--b-color-focus)] hover:text-[var(--b-color-text)]'
            }
        ],
        defaultVariants: {
            tone: 'neutral',
            selected: false,
            interactive: false
        }
    }
);

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof tagVariants> {}

const Tag = React.forwardRef<HTMLSpanElement, TagProps>(({
    tone,
    selected,
    interactive,
    className,
    children,
    ...props
}, ref) => {
    return (
        <span
            ref={ref}
            className={cx(tagVariants({ tone, selected, interactive }), className)}
            {...props}>
            {children}
        </span>
    );
});

Tag.displayName = 'Tag';

export interface TagButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof tagVariants> {}

export const TagButton = React.forwardRef<HTMLButtonElement, TagButtonProps>(({
    tone,
    selected,
    interactive = true,
    className,
    type = 'button',
    children,
    ...props
}, ref) => {
    return (
        <button
            ref={ref}
            type={type}
            className={cx(tagVariants({ tone, selected, interactive }), className)}
            {...props}>
            {children}
        </button>
    );
});

TagButton.displayName = 'TagButton';

export default Tag;
