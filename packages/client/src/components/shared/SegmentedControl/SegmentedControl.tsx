import { cva } from 'class-variance-authority';
import classNames from 'classnames';
import React from 'react';

const cx = classNames;

export interface SegmentedControlOption<TValue extends string> {
    ariaControls?: string;
    icon?: React.ReactNode;
    id?: string;
    value: TValue;
    label: React.ReactNode;
}

interface SegmentedControlProps<TValue extends string> {
    value: TValue;
    options: SegmentedControlOption<TValue>[];
    ariaLabel: string;
    className?: string;
    variant?: 'surface' | 'tabs';
    onChange: (value: TValue) => void;
}

const segmentedControlButtonClass = cva(
    'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
    {
        variants: {
            variant: {
                surface: 'min-h-9 rounded-[var(--b-radius-sm)] px-3 text-xs font-semibold text-[var(--b-color-text-secondary)] hover:text-[var(--b-color-text)]',
                tabs: 'relative flex min-h-10 items-center justify-center gap-2 border-b-2 bg-transparent px-1 text-sm font-semibold appearance-none shadow-none ring-0 hover:bg-transparent active:bg-transparent focus:bg-transparent focus:outline-none focus:ring-0 sm:justify-start sm:px-0 [&_svg]:h-4 [&_svg]:w-4'
            },
            selected: {
                true: '',
                false: ''
            }
        },
        compoundVariants: [
            {
                variant: 'surface',
                selected: true,
                className: 'ow-active-background text-[var(--b-color-text)]'
            },
            {
                variant: 'tabs',
                selected: true,
                className: 'border-[var(--b-color-point)] text-[var(--b-color-point)] [&_svg]:text-[var(--b-color-point)]'
            },
            {
                variant: 'tabs',
                selected: false,
                className: 'border-transparent text-[var(--b-color-text-muted)] hover:text-[var(--b-color-text)]'
            }
        ],
        defaultVariants: {
            variant: 'surface',
            selected: false
        }
    }
);

const segmentedControlRootClass = cva('', {
    variants: {
        variant: {
            surface: 'grid gap-1 rounded-[var(--b-radius-md)] bg-[var(--b-color-surface-subtle)] p-1',
            tabs: 'grid grid-cols-2 gap-6 sm:inline-flex sm:grid-cols-none sm:gap-6'
        }
    },
    defaultVariants: {
        variant: 'surface'
    }
});

const SegmentedControl = <TValue extends string>({
    value,
    options,
    ariaLabel,
    className,
    variant = 'surface',
    onChange
}: SegmentedControlProps<TValue>) => {
    const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
        if (variant !== 'tabs') {
            return;
        }

        const lastIndex = options.length - 1;
        let nextIndex: number | null = null;

        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = lastIndex;
                break;
            default:
                return;
        }

        event.preventDefault();

        const nextOption = options[nextIndex];

        if (!nextOption) {
            return;
        }

        onChange(nextOption.value);
        buttonRefs.current[nextIndex]?.focus();
    };

    return (
        <div
            role={variant === 'tabs' ? 'tablist' : 'group'}
            aria-orientation={variant === 'tabs' ? 'horizontal' : undefined}
            aria-label={ariaLabel}
            className={cx(segmentedControlRootClass({ variant }), className)}
            style={variant === 'surface' ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}>
            {options.map((option, index) => {
                const selected = option.value === value;

                return (
                    <button
                        key={option.value}
                        ref={(element) => {
                            buttonRefs.current[index] = element;
                        }}
                        id={option.id}
                        type="button"
                        role={variant === 'tabs' ? 'tab' : undefined}
                        aria-controls={variant === 'tabs' ? option.ariaControls : undefined}
                        aria-selected={variant === 'tabs' ? selected : undefined}
                        aria-pressed={variant === 'surface' ? selected : undefined}
                        tabIndex={variant === 'tabs' ? selected ? 0 : -1 : undefined}
                        className={segmentedControlButtonClass({ selected, variant })}
                        onKeyDown={(event) => handleTabKeyDown(event, index)}
                        onClick={() => onChange(option.value)}>
                        {option.icon}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
};

export default SegmentedControl;
