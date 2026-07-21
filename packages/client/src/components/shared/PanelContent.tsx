import { cva } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { activeFilledIconClassName, activeIconClassName, filledIconClassName } from './iconStateClass';

interface PanelContentProps {
    header?: ReactNode;
    items?: {
        id?: string;
        icon: ReactNode;
        text: string;
        description?: string;
        descriptionRole?: 'alert' | 'status';
        disabled?: boolean;
        filled?: boolean;
        active?: boolean;
        onClick: () => void;
    }[];
    footer?: ReactNode;
}

export const panelContentClass = {
    cover: 'h-[60px] w-[60px] rounded-[var(--b-radius-lg)] object-cover',
    coverGrid: 'h-[60px] w-[60px]',
    subTitle: 'mb-1 text-sm text-[var(--b-color-text-muted)]',
    subContent: 'text-sm font-bold'
};

const panelHeaderActionClass = cva(
    'relative w-full border-0 bg-transparent pr-10 text-left font-inherit text-inherit after:absolute after:right-4 after:top-1/2 after:h-2.5 after:w-2.5 after:-translate-y-1/2 after:rotate-45 after:border-r-2 after:border-t-2 after:border-[var(--b-color-text-muted)] after:content-[""]',
    {
        variants: {
            layout: {
                album: 'flex flex-row items-center gap-4 overflow-hidden rounded-[var(--b-radius-lg)]',
                artist: 'flex flex-col'
            }
        },
        defaultVariants: {
            layout: 'album'
        }
    }
);

interface PanelHeaderActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    layout?: 'album' | 'artist';
}

export const PanelHeaderAction = ({
    layout = 'album',
    className,
    type = 'button',
    ...props
}: PanelHeaderActionProps) => (
    <button
        type={type}
        className={panelHeaderActionClass({ layout, className })}
        {...props}
    />
);

const panelActionClass = cva(
    [
        'flex w-full items-start gap-4 rounded-[var(--b-radius-lg)] border-0 bg-transparent py-3.5 text-left font-inherit text-[var(--b-color-text)]',
        'transition-[background-color,color]',
        '[&_svg]:mt-0.5 [&_svg]:h-[18px] [&_svg]:w-[18px]'
    ],
    {
        variants: {
            active: {
                true: `ow-active-background ${activeIconClassName}`,
                false: ''
            },
            filled: {
                true: '',
                false: ''
            }
        },
        compoundVariants: [
            {
                active: false,
                filled: true,
                className: filledIconClassName
            },
            {
                active: true,
                filled: true,
                className: activeFilledIconClassName
            }
        ],
        defaultVariants: {
            active: false,
            filled: false
        }
    }
);

export default function PanelContent({ header, items, footer }: PanelContentProps) {
    return (
        <div>
            {header && (
                <div className="mt-6 flex flex-col gap-6 border-b border-[var(--b-color-border)] pb-6">
                    {header}
                </div>
            )}
            {items && (
                <div className="m-0 flex list-none flex-col border-b border-[var(--b-color-border)] py-4">
                    {items.map(({ id, icon, text, description, descriptionRole, disabled, filled, active, onClick }) => (
                        <button
                            key={id ?? text}
                            className={panelActionClass({ active, filled })}
                            aria-pressed={active}
                            disabled={disabled}
                            onClick={onClick}>
                            {icon}
                            <span className="flex min-w-0 flex-col gap-1">
                                <span className="min-w-0 truncate text-base font-medium">{text}</span>
                                {description && (
                                    <span
                                        className="text-sm leading-snug text-[var(--b-color-text-muted)]"
                                        role={descriptionRole}
                                        aria-live={descriptionRole ? 'assertive' : undefined}>
                                        {description}
                                    </span>
                                )}
                            </span>
                        </button>
                    ))}
                </div>
            )}
            {footer && (
                <div className="flex flex-row flex-wrap items-center gap-2 pt-4 text-sm text-[var(--b-color-text-muted)]">
                    {footer}
                </div>
            )}
        </div>
    );
}
