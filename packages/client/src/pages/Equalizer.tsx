import { useAppStore as useStore } from '~/store/base-store';
import {
    useMemo,
    type ChangeEvent
} from 'react';

import { Badge, Button, Card, Text } from '~/components/shared';
import EqualizerPreset from '~/components/shared/EqualizerPreset';
import type { Preset } from '~/components/shared/EqualizerPreset';
import EqualizerSlider from '~/components/shared/EqualizerSlider';
import {
    EQUALIZER_BAND_IDS,
    createFlatEqualizerState,
    equalizerStore
} from '~/store/equalizer';

type EqualizerValues = Preset['values'];
type EqualizerBand = keyof EqualizerValues;

const layoutClass = {
    status: 'bg-[var(--b-color-glow-ambient)]',
    panel: 'min-w-0 bg-[var(--b-color-surface-subtle)]',
    panelBody: 'flex flex-col gap-4',
    panelHeader: 'flex items-start justify-between gap-3 max-[640px]:flex-col',
    rangeLabel: 'shrink-0 max-[640px]:self-start',
    eqDeck: 'overflow-x-auto rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)]',
    eqDeckInner: 'min-w-[672px] p-4',
    sliderGroup: 'grid min-h-[384px] grid-cols-7 gap-3'
};

const EQUALIZER_BANDS = [
    {
        id: 'lowBass',
        label: 'Low Bass',
        frequency: '63 Hz',
        tone: 'Depth'
    },
    {
        id: 'bass',
        label: 'Bass',
        frequency: '125 Hz',
        tone: 'Punch'
    },
    {
        id: 'lowMid',
        label: 'Low Mid',
        frequency: '250 Hz',
        tone: 'Warmth'
    },
    {
        id: 'mid',
        label: 'Mid',
        frequency: '500 Hz',
        tone: 'Body'
    },
    {
        id: 'highMid',
        label: 'High Mid',
        frequency: '1 kHz',
        tone: 'Focus'
    },
    {
        id: 'presence',
        label: 'Presence',
        frequency: '4 kHz',
        tone: 'Clarity'
    },
    {
        id: 'treble',
        label: 'Treble',
        frequency: '10 kHz',
        tone: 'Air'
    }
] as const satisfies ReadonlyArray<{
    id: EqualizerBand;
    label: string;
    frequency: string;
    tone: string;
}>;

const FLAT_VALUES: EqualizerValues = createFlatEqualizerState();

const DEFAULT_PRESETS: Preset[] = [
    {
        id: 'studio-flat',
        name: 'Studio Flat',
        values: FLAT_VALUES
    },
    {
        id: 'v-curve',
        name: 'V Curve',
        values: {
            ...FLAT_VALUES,
            lowBass: 4,
            bass: 3,
            lowMid: -1,
            mid: -2,
            highMid: -1,
            presence: 3,
            treble: 4
        }
    },
    {
        id: 'bass-boost',
        name: 'Bass Boost',
        values: {
            ...FLAT_VALUES,
            lowBass: 6,
            bass: 5,
            lowMid: 2,
            presence: -1,
            treble: 1
        }
    },
    {
        id: 'warm',
        name: 'Warm',
        values: {
            ...FLAT_VALUES,
            lowBass: 2,
            bass: 3,
            lowMid: 3,
            mid: 1,
            highMid: -1,
            presence: -2,
            treble: -1
        }
    },
    {
        id: 'vocal-focus',
        name: 'Vocal Focus',
        values: {
            ...FLAT_VALUES,
            lowBass: -2,
            bass: -1,
            lowMid: 1,
            mid: 3,
            highMid: 4,
            presence: 3,
            treble: -1
        }
    },
    {
        id: 'bright-air',
        name: 'Bright Air',
        values: {
            ...FLAT_VALUES,
            lowBass: -2,
            bass: -1,
            mid: 1,
            highMid: 2,
            presence: 4,
            treble: 5
        }
    },
    {
        id: 'punch',
        name: 'Punch',
        values: {
            ...FLAT_VALUES,
            lowBass: 3,
            bass: 4,
            lowMid: -1,
            mid: 1,
            highMid: 3,
            presence: 2,
            treble: 1
        }
    },
    {
        id: 'late-night',
        name: 'Late Night',
        values: {
            ...FLAT_VALUES,
            lowBass: -3,
            bass: -2,
            lowMid: 1,
            highMid: -1,
            presence: -2,
            treble: -3
        }
    }
];

const isSameCurve = (a: EqualizerValues, b: EqualizerValues) => {
    return EQUALIZER_BAND_IDS.every((id) => a[id] === b[id]);
};

const getToneSummary = (values: EqualizerValues) => {
    const lowEnergy = values.lowBass + values.bass + values.lowMid;
    const highEnergy = values.presence + values.treble;
    const totalAbsGain = EQUALIZER_BAND_IDS.reduce((sum, id) => sum + Math.abs(values[id]), 0);

    if (totalAbsGain <= 2) {
        return 'Balanced';
    }

    if (lowEnergy - highEnergy >= 4) {
        return 'Warm';
    }

    if (highEnergy - lowEnergy >= 4) {
        return 'Bright';
    }

    if (values.highMid + values.presence >= 5) {
        return 'Forward';
    }

    return 'Custom';
};

const Equalizer = () => {
    const [equalizerState, setEqState] = useStore(equalizerStore);

    const activePreset = useMemo(() => {
        return DEFAULT_PRESETS.find((preset) => isSameCurve(preset.values, equalizerState)) ?? null;
    }, [equalizerState]);
    const isFlat = isSameCurve(equalizerState, FLAT_VALUES);
    const toneSummary = getToneSummary(equalizerState);

    const handleSliderChange = (name: EqualizerBand) => (e: ChangeEvent<HTMLInputElement>) => {
        setEqState((state) => ({
            ...state,
            [name]: Number(e.currentTarget.value)
        }));
    };

    const handlePresetSelect = (preset: Preset) => {
        setEqState(() => ({ ...preset.values }));
    };

    const handleBandReset = (name: EqualizerBand) => {
        setEqState((state) => ({
            ...state,
            [name]: 0
        }));
    };

    const handleResetCurve = () => {
        setEqState(() => ({ ...FLAT_VALUES }));
    };


    return (
        <>
            <section aria-labelledby="equalizer-presets-title">
                <Card variant="outlined" padding="md" radius="lg" className={layoutClass.panel}>
                    <div className={layoutClass.panelBody}>
                        <div className={layoutClass.panelHeader}>
                            <div>
                                <Text as="span" variant="muted" size="xs" weight="semibold" className="tracking-normal uppercase">
                                    Preset
                                </Text>
                                <Text as="h2" id="equalizer-presets-title" size="title" weight="semibold" className="mt-1 mb-0">
                                    {activePreset?.name ?? 'Custom curve'}
                                </Text>
                                <Text as="p" variant="tertiary" size="sm" className="mt-1 mb-0">
                                    {toneSummary}
                                </Text>
                            </div>
                        </div>
                        <EqualizerPreset
                            presets={DEFAULT_PRESETS}
                            activePresetId={activePreset?.id ?? null}
                            onSelectPreset={handlePresetSelect}
                        />
                    </div>
                </Card>
            </section>

            <section aria-labelledby="equalizer-bands-title">
                <Card variant="outlined" padding="md" radius="lg" className={layoutClass.panel}>
                    <div className={layoutClass.panelBody}>
                        <div className={layoutClass.panelHeader}>
                            <div>
                                <Text as="span" variant="muted" size="xs" weight="semibold" className="tracking-normal uppercase">
                                    7-band EQ
                                </Text>
                                <Text as="h2" id="equalizer-bands-title" size="title" weight="semibold" className="mt-1 mb-0">
                                    Frequency bands
                                </Text>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge tone="subtle" className={layoutClass.rangeLabel}>-10 dB · +10 dB</Badge>
                                <Button
                                    size="sm"
                                    disabled={isFlat}
                                    onClick={handleResetCurve}>
                                    Reset curve
                                </Button>
                            </div>
                        </div>

                        <div className={layoutClass.eqDeck}>
                            <div className={layoutClass.eqDeckInner}>
                                <div className={layoutClass.sliderGroup}>
                                    {EQUALIZER_BANDS.map(({ id, label, frequency, tone }) => (
                                        <EqualizerSlider
                                            key={id}
                                            name={id}
                                            label={label}
                                            frequency={frequency}
                                            tone={tone}
                                            value={equalizerState[id]}
                                            orientation="vertical"
                                            onChange={handleSliderChange(id)}
                                            onReset={() => handleBandReset(id)}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            </section>
        </>
    );
};

export default Equalizer;
