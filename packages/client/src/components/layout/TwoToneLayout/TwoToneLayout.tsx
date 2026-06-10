import classNames from 'classnames';
import React from 'react';

const cx = classNames;

interface TwoToneLayoutProps {
    backgroundImage?: string;
    header: React.ReactNode;
    primaryAction?: React.ReactNode;
    children: React.ReactNode;
}

const TwoToneLayout = ({
    header,
    primaryAction,
    children
}: TwoToneLayoutProps) => {
    return (
        <div className="relative min-h-full bg-[var(--b-color-background)]">
            <div className="relative z-[3] border-b border-[var(--b-color-border-subtle)]">
                <div className="relative z-[1] px-[var(--b-spacing-lg)] py-[calc(var(--b-spacing-2xl)+var(--b-spacing-lg))]">
                    {header}
                    {primaryAction && (
                        <div className="absolute bottom-0 right-[var(--b-spacing-lg)] z-10 translate-y-1/2 [&_button]:flex [&_button]:h-16 [&_button]:w-16 [&_button]:cursor-pointer [&_button]:items-center [&_button]:justify-center [&_button]:rounded-full [&_button]:border-0 [&_button]:bg-[var(--b-color-point)] [&_button]:text-black [&_button]:shadow-none [&_button]:transition-colors [&_button]:duration-150 hover:[&_button]:bg-[var(--b-color-point-dark)] active:[&_button]:scale-95 [&_button_svg]:h-7 [&_button_svg]:w-7">
                            {primaryAction}
                        </div>
                    )}
                </div>
            </div>

            <div className={cx('relative z-[1]', Boolean(primaryAction) && 'pt-[var(--b-spacing-2xl)]')}>
                {children}
            </div>
        </div>
    );
};

export default TwoToneLayout;
