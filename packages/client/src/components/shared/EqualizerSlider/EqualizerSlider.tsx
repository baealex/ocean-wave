import * as Slider from '@radix-ui/react-slider';
import classNames from 'classnames';
import type { ChangeEvent } from 'react';

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

const cx = classNames;

const resetButtonClass = 'rounded-full border border-[var(--b-color-border-subtle)] bg-transparent px-2.5 py-1 text-xs font-semibold text-[var(--b-color-text-tertiary)] transition-[color,background-color,border-color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:border-[var(--b-color-border)] enabled:hover:bg-[var(--b-color-hover)] enabled:hover:text-[var(--b-color-text)]';

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
            className={cx(
                'relative flex touch-none select-none items-center data-[disabled]:opacity-50',
                isVertical ? 'h-40 w-8 flex-col' : 'h-8 w-full'
            )}
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
                className={cx(
                    'relative grow overflow-hidden rounded-full bg-[var(--b-color-hover)]',
                    isVertical ? 'h-full w-1.5' : 'h-1.5 w-full'
                )}>
                <Slider.Range
                    className={cx(
                        'absolute rounded-full bg-[var(--b-color-point)]',
                        isVertical ? 'w-full' : 'h-full'
                    )}
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
                    <button
                        type="button"
                        className={resetButtonClass}
                        disabled={disabled || value === 0}
                        onClick={onReset}>
                        Reset
                    </button>
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
                <button
                    type="button"
                    className={resetButtonClass}
                    disabled={disabled || value === 0}
                    onClick={onReset}>
                    Reset
                </button>
            </div>
        </div>
    );
};

export default EqualizerSlider;
