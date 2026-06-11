import { cva } from 'class-variance-authority';
import React from 'react';

import IconButton from '~/components/shared/IconButton';

const contentClass = cva('relative z-[1]', {
    variants: {
        hasPrimaryAction: {
            true: 'pt-[var(--b-spacing-2xl)]',
            false: ''
        }
    },
    defaultVariants: {
        hasPrimaryAction: false
    }
});

const headerBackdropStyle = (backgroundImage?: string): React.CSSProperties | undefined => {
    if (!backgroundImage) {
        return undefined;
    }

    return {
        backgroundImage: `url(${JSON.stringify(backgroundImage)})`
    };
};

interface TwoToneLayoutProps {
    backgroundImage?: string;
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
        className={className}
        {...props}
    />
));

TwoTonePrimaryAction.displayName = 'TwoTonePrimaryAction';

const TwoToneLayout = ({
    backgroundImage,
    header,
    primaryAction,
    children
}: TwoToneLayoutProps) => {
    return (
        <div className="relative min-h-full bg-[var(--b-color-background)]">
            <div className="relative z-[3] overflow-hidden border-b border-[var(--b-color-border-subtle)]">
                {backgroundImage && (
                    <>
                        <div
                            aria-hidden="true"
                            className="absolute inset-0 z-0 scale-110 bg-cover bg-center opacity-30 blur-2xl"
                            style={headerBackdropStyle(backgroundImage)}
                        />
                        <div className="absolute inset-0 z-0 bg-[var(--b-gradient-detail-header-scrim)]" aria-hidden="true" />
                    </>
                )}
                <div className="relative z-[1] px-[var(--b-spacing-lg)] py-[calc(var(--b-spacing-2xl)+var(--b-spacing-lg))]">
                    {header}
                    {primaryAction && (
                        <div className="absolute bottom-0 right-[var(--b-spacing-lg)] z-10 translate-y-1/2">
                            {primaryAction}
                        </div>
                    )}
                </div>
            </div>

            <div className={contentClass({ hasPrimaryAction: Boolean(primaryAction) })}>
                {children}
            </div>
        </div>
    );
};

export default TwoToneLayout;
