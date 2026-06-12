import * as Slider from '@radix-ui/react-slider';
import { cva } from 'class-variance-authority';
import type { ChangeEvent } from 'react';
import Button from '../Button';

interface EqualizerSliderProps {
    name: string;
    label?: string;
    frequency?: string;
    tone?: string;
    value: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    orientation?: 'horizontal' | 'vertical';
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    onReset?: () => void;
}

const sliderRootClass = cva(
    'relative flex touch-none select-none items-center data-[disabled]:opacity-50',
    {
        variants: {
            orientation: {
                horizontal: 'h-8 w-full',
                vertical: 'h-40 w-8 flex-col'
            }
        },
        defaultVariants: {
            orientation: 'horizontal'
        }
    }
);

const sliderTrackClass = cva(
    'relative grow overflow-hidden rounded-full bg-[var(--b-color-hover)]',
    {
        variants: {
            orientation: {
                horizontal: 'h-1.5 w-full',
                vertical: 'h-full w-1.5'
            }
        },
        defaultVariants: {
            orientation: 'horizontal'
        }
    }
);

const sliderRangeClass = cva('absolute rounded-full bg-[var(--b-color-point)]', {
    variants: {
        orientation: {
            horizontal: 'h-full',
            vertical: 'w-full'
        }
    },
    defaultVariants: {
        orientation: 'horizontal'
    }
});

const EqualizerSlider = ({
    name,
    label,
    frequency,
    tone,
    value,
    min = -10,
    max = 10,
    disabled = false,
    orientation = 'horizontal',
    onChange,
    onReset
}: EqualizerSliderProps) => {
    const displayName = label ?? name
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase());
    const valueLabel = value > 0 ? `+${value} dB` : `${value} dB`;
    const isVertical = orientation === 'vertical';

    const emitChange = (nextValue: number) => {
        onChange({
            target: {
                name,
                value: String(nextValue)
            },
            currentTarget: {
                name,
                value: String(nextValue)
            }
        } as ChangeEvent<HTMLInputElement>);
    };

    const slider = (
        <Slider.Root
            className={sliderRootClass({ orientation })}
            name={name}
            min={min}
            max={max}
            step={1}
            value={[value]}
            disabled={disabled}
            orientation={orientation}
            aria-label={`${displayName} gain`}
            onValueChange={([nextValue]) => emitChange(nextValue)}>
            <Slider.Track
                className={sliderTrackClass({ orientation })}>
                <Slider.Range
                    className={sliderRangeClass({ orientation })}
                />
            </Slider.Track>
            <Slider.Thumb className="block h-4 w-4 rounded-full border-2 border-[var(--b-color-background)] bg-[var(--b-color-point)] outline-none transition-[box-shadow,transform] duration-150 focus-visible:shadow-[0_0_0_3px_var(--b-color-focus-ring)] active:scale-110" />
        </Slider.Root>
    );

    if (isVertical) {
        return (
            <div className="flex h-full min-h-[352px] min-w-0 flex-col items-center justify-between gap-3 rounded-[var(--b-radius-lg)] px-1 py-2">
                <div className="flex min-w-0 flex-col items-center gap-1 text-center">
                    <span className="max-w-full truncate text-sm font-semibold text-[var(--b-color-text)]">{displayName}</span>
                    <span className="max-w-full truncate text-xs text-[var(--b-color-text-muted)]">
                        {frequency}
                        {tone && ` · ${tone}`}
                    </span>
                </div>

                {slider}

                <div className="flex flex-col items-center justify-center gap-2">
                    <span className="text-center text-xs font-semibold text-[var(--b-color-text-secondary)]">{valueLabel}</span>
                    <Button
                        size="xs"
                        variant="ghost"
                        className="rounded-full"
                        disabled={disabled || value === 0}
                        onClick={onReset}>
                        Reset
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-[minmax(112px,0.8fr)_minmax(128px,1.5fr)_auto] items-center gap-4 py-3 max-md:grid-cols-1 max-md:gap-2">
            <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold text-[var(--b-color-text)]">{displayName}</span>
                <span className="text-xs text-[var(--b-color-text-muted)]">
                    {frequency}
                    {tone && ` · ${tone}`}
                </span>
            </div>
            <div className="min-w-0">
                {slider}
            </div>
            <div className="flex items-center justify-end gap-2">
                <span className="min-w-14 text-right text-xs font-semibold text-[var(--b-color-text-secondary)]">{valueLabel}</span>
                <Button
                    size="xs"
                    variant="ghost"
                    className="rounded-full"
                    disabled={disabled || value === 0}
                    onClick={onReset}>
                    Reset
                </Button>
            </div>
        </div>
    );
};

export default EqualizerSlider;
