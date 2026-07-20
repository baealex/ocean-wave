import { ActionBarButton } from '~/components/shared';
import * as Icon from '~/icon';

interface PlaylistSelectionQueueActionProps {
    onClick: () => void;
}

export default function PlaylistSelectionQueueAction({
    onClick
}: PlaylistSelectionQueueActionProps) {
    return (
        <ActionBarButton variant="primary" onClick={onClick}>
            <Icon.ListMusic />
            <span>Add to Queue</span>
        </ActionBarButton>
    );
}
