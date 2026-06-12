import { PanelContent } from '~/components/shared';
import * as Icon from '~/icon';
import { panel } from '~/modules/panel';

interface ItemSortPanelContentProps {
    items: {
        text: string;
        isActive?: boolean;
        onClick: () => void;
    }[];
}

export default function ItemSortPanelContent({ items }: ItemSortPanelContentProps) {
    return (
        <PanelContent
            items={items.map(item => ({
                icon: <Icon.Sort />,
                text: item.text,
                active: item.isActive,
                onClick: () => {
                    item.onClick();
                    panel.close();
                }
            }))}
        />
    );
}
