import { cva, type VariantProps } from 'class-variance-authority';
import classNames from 'classnames';
import type React from 'react';

const cx = classNames;

const cardVariants = cva('bg-[var(--b-color-background-layer-1)]', {
    variants: {
        variant: {
            elevated: 'shadow-[var(--b-card-shadow-main)]',
            flat: '',
            outlined: 'border border-[var(--b-color-border-subtle)]'
        },
        padding: {
            none: 'p-0',
            sm: 'p-[var(--b-spacing-sm)]',
            md: 'p-[var(--b-spacing-md)]',
            lg: 'p-[var(--b-spacing-lg)]'
        },
        radius: {
            md: 'rounded-[var(--b-radius-md)]',
            lg: 'rounded-[var(--b-radius-lg)]',
            xl: 'rounded-[var(--b-radius-xl)]',
            '2xl': 'rounded-[var(--b-radius-2xl)]'
        },
        overflow: {
            true: 'overflow-hidden',
            false: ''
        }
    },
    defaultVariants: {
        variant: 'elevated',
        padding: 'md',
        radius: 'lg',
        overflow: false
    }
});

interface CardProps extends VariantProps<typeof cardVariants> {
    className?: string;
    children: React.ReactNode;
}

const Card = ({
    variant,
    padding,
    radius,
    overflow,
    className,
    children
}: CardProps) => {
    return (
        <div
            className={cx(cardVariants({ variant, padding, radius, overflow }), className)}>
            {children}
        </div>
    );
};

export default Card;
