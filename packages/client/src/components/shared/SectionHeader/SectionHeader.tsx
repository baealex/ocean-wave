import classNames from 'classnames';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import Text from '../Text';

const cx = classNames;

const sectionHeaderClass = cva('flex items-start justify-between gap-4', {
    variants: {
        compact: {
            true: '',
            false: ''
        }
    },
    defaultVariants: {
        compact: false
    }
});

const sectionHeaderActionClass = cva(
    'inline-flex min-h-9 items-center justify-center bg-transparent px-1.5 py-1.5 text-sm font-medium no-underline transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
    {
        variants: {
            disabled: {
                true: 'cursor-not-allowed text-[var(--b-color-text-muted)] opacity-50',
                false: 'text-[var(--b-color-text-tertiary)] hover:text-[var(--b-color-point-light)]'
            }
        },
        defaultVariants: {
            disabled: false
        }
    }
);

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof sectionHeaderClass> {
    actions?: ReactNode;
    eyebrow?: ReactNode;
    heading: ReactNode;
    headingId?: string;
}

type SectionHeaderActionProps =
    | (React.ButtonHTMLAttributes<HTMLButtonElement> & { to?: undefined })
    | (React.AnchorHTMLAttributes<HTMLAnchorElement> & { disabled?: false; to: string });

export const SectionHeaderAction = (props: SectionHeaderActionProps) => {
    if (props.to) {
        const { children, className, disabled, to, ...linkProps } = props;

        return (
            <Link
                to={to}
                className={cx(sectionHeaderActionClass({ disabled }), className)}
                {...linkProps}>
                {children}
            </Link>
        );
    }

    const { children, className, disabled, type = 'button', ...buttonProps } = props as React.ButtonHTMLAttributes<HTMLButtonElement>;

    return (
        <button
            type={type}
            disabled={disabled}
            className={cx(sectionHeaderActionClass({ disabled }), className)}
            {...buttonProps}>
            {children}
        </button>
    );
};

const SectionHeader = ({
    actions,
    className,
    compact,
    eyebrow,
    heading,
    headingId,
    ...props
}: SectionHeaderProps) => {
    return (
        <div className={cx(sectionHeaderClass({ compact }), className)} {...props}>
            <div className="min-w-0">
                {eyebrow && (
                    <Text as="span" variant="muted" size="overline" weight="medium">
                        {eyebrow}
                    </Text>
                )}
                <Text as="h2" id={headingId} size="sectionTitle">
                    {heading}
                </Text>
            </div>

            {actions && <div className="shrink-0">{actions}</div>}
        </div>
    );
};

export default SectionHeader;
