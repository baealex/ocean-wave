import classNames from 'classnames';
import type { ReactNode } from 'react';
import Text from '../Text';

const cx = classNames;

interface SettingItemProps {
    title: string;
    description?: string;
    divider?: boolean;
    children: ReactNode;
}

export const SettingItem = ({
    title,
    description,
    divider = true,
    children
}: SettingItemProps) => {
    return (
        <div className={cx('py-[var(--b-spacing-md)]', !divider && 'border-b-0', divider && 'border-b border-[var(--b-color-border-subtle)] last:border-b-0')}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[var(--b-spacing-md)] max-[720px]:grid-cols-1 max-[720px]:items-start">
                <div className="min-w-0">
                    <Text as="h4" size="md" weight="medium" className="m-0">
                        {title}
                    </Text>
                    {description && (
                        <Text as="p" variant="tertiary" size="sm" className="mt-1 leading-[1.45]">
                            {description}
                        </Text>
                    )}
                </div>
                <div className="flex justify-end max-[720px]:w-full max-[720px]:justify-start [&>*]:max-w-full">
                    {children}
                </div>
            </div>
        </div>
    );
};

interface SettingSectionProps {
    title: string;
    description?: string;
    icon?: ReactNode;
    children: ReactNode;
}

export const SettingSection = ({ title, description, icon, children }: SettingSectionProps) => {
    return (
        <section className="p-0">
            <div className="mb-[var(--b-spacing-md)] grid grid-cols-1 gap-[var(--b-spacing-xs)]">
                <Text as="h3" size="md" weight="semibold" className="m-0 flex items-center gap-[var(--b-spacing-sm)] text-[var(--b-color-text)] tracking-[-0.015em]">
                    {icon && <span className="flex w-[19.2px] items-center text-[var(--b-color-point-light)] [&_svg]:h-[17.6px] [&_svg]:w-[17.6px]">{icon}</span>}
                    <span>{title}</span>
                </Text>
                {description && (
                    <Text as="p" variant="secondary" size="sm" className="max-w-[672px] leading-[1.45]">
                        {description}
                    </Text>
                )}
            </div>
            <div className="rounded-[var(--b-radius-xl)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-background-layer-1)] px-[var(--b-spacing-lg)]">
                {children}
            </div>
        </section>
    );
};

interface InfoBoxProps {
    children: ReactNode;
    type?: 'info' | 'warning' | 'success';
}

export const InfoBox = ({ children, type = 'info' }: InfoBoxProps) => {
    return (
        <div className={cx(
            'rounded-[var(--b-radius-lg)] border p-[var(--b-spacing-md)] [&_p]:m-0',
            type === 'warning'
                ? 'border-[rgba(245,158,11,0.22)] bg-[rgba(245,158,11,0.08)] [&_p]:text-[rgba(255,210,138,0.95)]'
                : 'border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] [&_p]:text-[var(--b-color-text-secondary)]'
        )}>
            <Text as="p" size="sm" variant="secondary">
                {children}
            </Text>
        </div>
    );
};
