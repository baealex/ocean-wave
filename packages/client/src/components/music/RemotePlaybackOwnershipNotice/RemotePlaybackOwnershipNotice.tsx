import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';

import { Button, Text } from '~/components/shared';
import * as Icon from '~/icon';
import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';

interface RemotePlaybackOwnershipNoticeProps {
    className?: string;
}

export default function RemotePlaybackOwnershipNotice({
    className
}: RemotePlaybackOwnershipNoticeProps) {
    const navigate = useNavigate();

    return (
        <div
            className={classNames(
                'flex items-center gap-3 rounded-[var(--b-radius-lg)] bg-[var(--b-color-surface-subtle)] px-4 py-3',
                className
            )}>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Icon.Activity
                    className="h-4 w-4 shrink-0 text-[var(--b-color-point-light)]"
                    aria-hidden="true"
                />
                <Text
                    id={REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID}
                    as="p"
                    variant="secondary"
                    size="sm"
                    className="max-sm:text-xs">
                    {REMOTE_PLAYBACK_OWNERSHIP_MESSAGE}
                </Text>
            </div>
            <Button
                size="sm"
                className="shrink-0"
                aria-label="Open controls"
                onClick={() => navigate('/player')}>
                Controls
            </Button>
        </div>
    );
}
