import { useAppStore as useStore } from '~/store/base-store';

import { Select, SettingSection, SettingItem } from '~/components/shared';
import { queueStore } from '~/store/queue';

const PLAY_MODES = [
    {
        value: 'immediately',
        label: 'Play immediately'
    },
    {
        value: 'later',
        label: 'Play later'
    }
];

const INSERT_MODES = [
    {
        value: 'first',
        label: 'Add to the top of the queue'
    },
    {
        value: 'last',
        label: 'Add to the bottom of the queue'
    },
    {
        value: 'after',
        label: 'Add to the next of the current music'
    }
];

const MIX_MODES = [
    {
        value: 'none',
        label: 'No transition'
    },
    {
        value: 'mix',
        label: 'Mix (Fade in/out)'
    }
];

const PlayIcon = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
);

export const PlayModeSection = () => {
    const [{ playMode, insertMode, mixMode }] = useStore(queueStore);

    return (
        <SettingSection
            title="Play Mode"
            icon={<PlayIcon />}
            description="Control how selected music enters the queue.">
            <SettingItem
                title="When adding music to the queue"
                description="Choose the playback behavior.">
                <Select
                    ariaLabel="Playback behavior"
                    selected={PLAY_MODES.find(({ value }) => value === playMode)}
                    options={PLAY_MODES}
                    onChange={(value) => queueStore.setPlayMode(value as typeof playMode)}
                />
            </SettingItem>

            <SettingItem
                title="Queue placement"
                description="Choose where new music is placed.">
                <Select
                    ariaLabel="Queue placement"
                    selected={INSERT_MODES.find(({ value }) => value === insertMode)}
                    options={INSERT_MODES}
                    onChange={(value) => queueStore.setInsertMode(value as typeof insertMode)}
                />
            </SettingItem>

            <SettingItem
                title="Transition Effect"
                description="Choose the track transition.">
                <Select
                    ariaLabel="Transition effect"
                    selected={MIX_MODES.find(({ value }) => value === mixMode)}
                    options={MIX_MODES}
                    onChange={(value) => queueStore.setMixMode(value as typeof mixMode)}
                />
            </SettingItem>
        </SettingSection>
    );
};
