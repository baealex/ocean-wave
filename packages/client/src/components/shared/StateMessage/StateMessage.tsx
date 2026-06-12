import type { ReactNode } from 'react';

import classNames from 'classnames';
import { cva, type VariantProps } from 'class-variance-authority';

import Text from '../Text';

const cx = classNames;

const stateMessageClass = cva(
    'mx-auto flex w-full max-w-[448px] flex-col items-center gap-6 text-center text-[var(--b-color-text)]',
    {
        variants: {
            surface: {
                true: 'ow-surface-base ow-surface-panel rounded-[var(--b-radius-2xl)] p-6',
                false: ''
            }
        },
        defaultVariants: {
            surface: false
        }
    }
);

const stateIconClass = cva(
    'flex h-20 w-20 items-center justify-center rounded-[var(--b-radius-xl)] border [&_svg]:h-8 [&_svg]:w-8',
    {
        variants: {
            tone: {
                accent: 'border-[var(--b-color-border)] bg-[var(--b-color-surface-item)] text-[var(--b-color-point-light)]',
                neutral: 'border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] text-[var(--b-color-text-tertiary)]',
                danger: 'border-[var(--b-color-badge-danger-background)] bg-[var(--b-color-badge-danger-background)] text-[var(--b-color-badge-danger-text)]'
            }
        },
        defaultVariants: {
            tone: 'accent'
        }
    }
);

type StateMessageVariantProps = VariantProps<typeof stateMessageClass>;
type StateMessageIconVariantProps = VariantProps<typeof stateIconClass>;

export interface StateMessageProps extends React.HTMLAttributes<HTMLDivElement>, StateMessageVariantProps, StateMessageIconVariantProps {
    actions?: ReactNode;
    description?: ReactNode;
    heading: ReactNode;
    icon?: ReactNode;
}

const StateMessage = ({
    actions,
    className,
    description,
    heading,
    icon,
    surface,
    tone,
    ...props
}: StateMessageProps) => {
    return (
        <div className={cx(stateMessageClass({ surface }), className)} {...props}>
            {icon && (
                <div className={stateIconClass({ tone })} aria-hidden="true">
                    {icon}
                </div>
            )}

            <div className="flex max-w-96 flex-col gap-3">
                <Text as="h1" size="2xl" weight="bold">
                    {heading}
                </Text>
                {description && (
                    <Text as="p" variant="secondary" size="md">
                        {description}
                    </Text>
                )}
            </div>

            {actions && <div className="flex w-full justify-center gap-3 max-sm:flex-col">{actions}</div>}
        </div>
    );
};

export default StateMessage;
