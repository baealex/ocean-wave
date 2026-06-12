import classNames from 'classnames';
import { cva, type VariantProps } from 'class-variance-authority';
const cx = classNames;

import React from 'react';

type SurfaceElement = 'div' | 'section' | 'article' | 'aside';

const surfaceVariants = cva('', {
    variants: {
        variant: {
            subtle: 'ow-surface-base ow-surface-subtle',
            panel: 'ow-surface-base ow-surface-panel',
            modal: 'ow-surface-base ow-surface-modal',
            item: 'ow-surface-base bg-[var(--b-color-surface-item)]',
            bare: ''
        },
        radius: {
            none: 'rounded-none',
            lg: 'rounded-[var(--b-radius-lg)]',
            xl: 'rounded-[var(--b-radius-xl)]',
            '2xl': 'rounded-[var(--b-radius-2xl)]'
        },
        padding: {
            none: '',
            md: 'p-4',
            lg: 'p-6',
            responsive: 'p-[clamp(16px,2.4vw,20px)]',
            hero: 'p-[clamp(16px,3vw,24px)]'
        }
    },
    defaultVariants: {
        variant: 'subtle',
        radius: 'xl',
        padding: 'none'
    }
});

type SurfaceVariantProps = VariantProps<typeof surfaceVariants>;

export interface SurfaceProps extends React.HTMLAttributes<HTMLElement>, SurfaceVariantProps {
    as?: SurfaceElement;
}

const Surface = ({
    as = 'div',
    variant,
    radius,
    padding,
    className,
    children,
    ...props
}: SurfaceProps) => React.createElement(
    as,
    {
        className: cx(surfaceVariants({ variant, radius, padding }), className),
        ...props
    },
    children
);

export default Surface;
