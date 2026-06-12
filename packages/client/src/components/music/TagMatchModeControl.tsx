import { SegmentedControl, type SegmentedControlOption } from '~/components/shared';
import type { MusicTagFilterMode } from '~/modules/music-tags';

interface TagMatchModeControlProps {
    value: MusicTagFilterMode;
    onChange: (value: MusicTagFilterMode) => void;
}

const TAG_MATCH_MODE_OPTIONS: SegmentedControlOption<MusicTagFilterMode>[] = [
    { value: 'all', label: 'Match all' },
    { value: 'any', label: 'Match any' }
];

export default function TagMatchModeControl({
    value,
    onChange
}: TagMatchModeControlProps) {
    return (
        <SegmentedControl
            value={value}
            options={TAG_MATCH_MODE_OPTIONS}
            ariaLabel="Tag matching mode"
            onChange={onChange}
        />
    );
}
