import type { HTMLAttributes, ReactNode } from 'react';

import classNames from 'classnames';
import { cva, type VariantProps } from 'class-variance-authority';

import Surface from '../Surface';
import Text from '../Text';

const cx = classNames;

const sectionEmptyStateClass = cva('flex items-center', {
    variants: {
        size: {
            sm: 'min-h-32',
            md: 'min-h-40'
        }
    },
    defaultVariants: {
        size: 'sm'
    }
});

interface SectionEmptyStateProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof sectionEmptyStateClass> {
    children: ReactNode;
}

export default function SectionEmptyState({
    children,
    className,
    size,
    ...props
}: SectionEmptyStateProps) {
    return (
        <Surface
            variant="item"
            radius="lg"
            padding="md"
            className={cx(sectionEmptyStateClass({ size }), className)}
            {...props}>
            <Text as="p" variant="secondary" size="sm">
                {children}
            </Text>
        </Surface>
    );
}
