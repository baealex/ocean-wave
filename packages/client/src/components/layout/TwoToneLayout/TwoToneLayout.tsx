import { cva } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';

import IconButton from '~/components/shared/IconButton';

const cx = classNames;

const contentClass = cva('relative z-[1]', {
    variants: {
        hasPrimaryAction: {
            true: 'pt-[var(--b-spacing-2xl)] lg:pt-[var(--b-spacing-xl)]',
            false: ''
        }
    },
    defaultVariants: {
        hasPrimaryAction: false
    }
});

interface TwoToneLayoutProps {
    header: React.ReactNode;
    primaryAction?: React.ReactNode;
    children: React.ReactNode;
}

export interface TwoTonePrimaryActionProps extends Omit<React.ComponentProps<typeof IconButton>, 'size' | 'tone'> {}

export const TwoTonePrimaryAction = React.forwardRef<HTMLButtonElement, TwoTonePrimaryActionProps>(({
    className,
    type = 'button',
    ...props
}, ref) => (
    <IconButton
        ref={ref}
        size="floating"
        tone="primary"
        type={type}
        className={cx('lg:h-14 lg:w-14 lg:[&_svg]:h-6 lg:[&_svg]:w-6', className)}
        {...props}
    />
));

TwoTonePrimaryAction.displayName = 'TwoTonePrimaryAction';

const TwoToneLayout = ({
    header,
    primaryAction,
    children
}: TwoToneLayoutProps) => {
    return (
        <div className="relative min-h-full">
            <div className="relative z-[2]">
                <div className="relative mx-auto w-full max-w-[1024px] px-[var(--b-spacing-lg)] py-[var(--b-spacing-xl)] lg:py-10">
                    {header}
                    {primaryAction && (
                        <div className="absolute bottom-0 right-[var(--b-spacing-lg)] z-20 translate-y-1/2">
                            {primaryAction}
                        </div>
                    )}
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-px bg-[var(--b-color-border-subtle)]" aria-hidden="true" />
            </div>

            <div className={contentClass({ hasPrimaryAction: Boolean(primaryAction) })}>
                <div className="mx-auto w-full max-w-[1024px] pb-[var(--b-spacing-2xl)]">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default TwoToneLayout;
