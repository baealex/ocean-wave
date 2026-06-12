import classNames from 'classnames';
import { cva } from 'class-variance-authority';
import React from 'react';
import Text from '../Text';

const cx = classNames;

const toggleRootClass = cva(
    'group/switch inline-flex min-h-10 cursor-pointer items-center justify-center gap-2.5 rounded-full bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none'
);

const toggleTrackClass = cva(
    [
        'relative h-6 w-11 shrink-0 rounded-full border transition-[background-color,border-color,box-shadow] duration-200',
        'group-focus-visible/switch:border-[var(--b-color-focus)] group-focus-visible/switch:shadow-[0_0_0_3px_var(--b-color-focus-ring)]'
    ],
    {
        variants: {
            value: {
                true: 'border-transparent bg-[var(--b-color-point)]',
                false: 'border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-input)]'
            }
        },
        defaultVariants: {
            value: false
        }
    }
);

const toggleThumbClass = cva(
    'absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full transition-[transform,background-color] duration-200',
    {
        variants: {
            value: {
                true: 'translate-x-5 bg-[var(--b-color-background)]',
                false: 'translate-x-0 bg-[var(--b-color-text-secondary)]'
            }
        },
        defaultVariants: {
            value: false
        }
    }
);

interface ToggleProps {
    value: boolean;
    onChange: (value: boolean) => void;
    children?: React.ReactNode;
    ariaLabel?: string;
    disabled?: boolean;
    className?: string;
}

const Toggle = ({
    value,
    onChange,
    children,
    ariaLabel,
    disabled = false,
    className
}: ToggleProps) => {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={value}
            aria-label={ariaLabel}
            disabled={disabled}
            className={cx(toggleRootClass(), className)}
            onClick={() => onChange(!value)}>
            <span className={toggleTrackClass({ value })}>
                <span className={toggleThumbClass({ value })} />
            </span>
            {children && (
                <Text
                    as="span"
                    variant="secondary"
                    size="sm">
                    {children}
                </Text>
            )}
        </button>
    );
};

export default Toggle;
