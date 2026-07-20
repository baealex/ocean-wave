import classNames from 'classnames';

import { Button, Text } from '~/components/shared';
import { useAppStore as useStore } from '~/store/base-store';
import { playbackQueueStore } from '~/store/playback-queue';
import { queueStore } from '~/store/queue';

const cx = classNames;

export interface PlaybackQueueConflictNoticeProps {
    className?: string;
}

const PlaybackQueueConflictNotice = ({
    className
}: PlaybackQueueConflictNoticeProps) => {
    const [{ conflict }] = useStore(playbackQueueStore);

    if (!conflict) {
        return null;
    }

    return (
        <div
            className={cx(
                'flex flex-wrap items-center gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-danger-border)] bg-[var(--b-color-badge-danger-background)] px-4 py-3',
                className
            )}
            role="alert"
            aria-live="assertive">
            <div className="min-w-0 flex-1">
                <Text as="p" size="sm" weight="semibold">
                    A newer queue is already saved
                </Text>
                <Text as="p" size="xs" variant="secondary" className="mt-1">
                    Current playback will continue until you choose. Keep the newer
                    queue, or replace it with this browser&apos;s queue.
                </Text>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => queueStore.acceptServerQueueConflict()}>
                    Keep newer queue
                </Button>
                <Button
                    size="xs"
                    variant="danger"
                    onClick={() => playbackQueueStore.retryConflict()}>
                    Replace with this queue
                </Button>
            </div>
        </div>
    );
};

export default PlaybackQueueConflictNotice;
