import { PanelContent } from '~/components/shared';
import * as Icon from '~/icon';
import { panel } from '~/modules/panel';
import {
    SMART_MUSIC_FILTER_OPTIONS,
    type SmartMusicFilterId
} from '~/modules/smart-music-filters';

interface SmartMusicFilterPanelContentProps {
    activeFilterId: SmartMusicFilterId;
    onSelect: (filterId: SmartMusicFilterId) => void;
}

export default function SmartMusicFilterPanelContent({
    activeFilterId,
    onSelect
}: SmartMusicFilterPanelContentProps) {
    return (
        <PanelContent
            items={SMART_MUSIC_FILTER_OPTIONS.map(option => ({
                icon: option.id === activeFilterId ? <Icon.Check /> : <Icon.Filter />,
                text: option.label,
                description: option.description,
                isActive: option.id === activeFilterId,
                onClick: () => {
                    onSelect(option.id);
                    panel.close();
                }
            }))}
        />
    );
}
