import classNames from 'classnames';
import type { EqualizerState } from '~/store/equalizer';

const cx = classNames;

export interface Preset {
    id: string;
    name: string;
    values: EqualizerState;
}

interface EqualizerPresetProps {
    presets: Preset[];
    activePresetId?: string | null;
    disabled?: boolean;
    onSelectPreset: (preset: Preset) => void;
}

const buttonClass = 'block min-h-9 w-full border-0 bg-transparent px-3 py-2 text-left text-xs font-semibold text-[var(--b-color-text-secondary)] transition-[color,background-color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-[var(--b-color-hover)] enabled:hover:text-[var(--b-color-text)]';

const EqualizerPreset = ({
    presets,
    activePresetId = null,
    disabled = false,
    onSelectPreset
}: EqualizerPresetProps) => {
    const handlePresetClick = (preset: Preset) => {
        onSelectPreset(preset);
    };


    return (
        <div className="w-full">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2 max-sm:grid-cols-1">
                {presets.map((preset) => (
                    <div key={preset.id} className="min-w-0 overflow-hidden rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] transition-[border-color,background-color] duration-150 hover:border-[var(--b-color-border)]">
                        <button
                            type="button"
                            className={cx(buttonClass, 'truncate', activePresetId === preset.id && 'bg-[var(--b-color-active)] !text-[var(--b-color-point)]')}
                            aria-pressed={activePresetId === preset.id}
                            disabled={disabled}
                            onClick={() => handlePresetClick(preset)}>
                            {preset.name}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default EqualizerPreset;
