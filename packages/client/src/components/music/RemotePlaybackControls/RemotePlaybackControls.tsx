import classNames from 'classnames';

import type { PlaybackCapability } from '~/api/playback-devices';
import { IconButton } from '~/components/shared';
import * as Icon from '~/icon';

const cx = classNames;

export type RemotePlaybackButtonCommand = Exclude<PlaybackCapability, 'seek'>;

export interface RemotePlaybackControlsProps {
    canSend: (command: RemotePlaybackButtonCommand) => boolean;
    className?: string;
    deviceName: string;
    layout?: 'detail' | 'mini';
    onCommand: (command: RemotePlaybackButtonCommand) => void;
    state: 'playing' | 'paused' | 'stopped';
}

const RemotePlaybackControls = ({
    canSend,
    className,
    deviceName,
    layout = 'mini',
    onCommand,
    state
}: RemotePlaybackControlsProps) => {
    const toggleCommand = state === 'playing' ? 'pause' : 'play';
    const controlSize = layout === 'detail' ? 'control' : 'compact';
    const toggleSize = layout === 'detail' ? 'controlLg' : 'play';

    return (
        <div className={cx(
            layout === 'detail'
                ? 'mx-auto grid w-full max-w-[360px] grid-cols-3 items-center gap-2.5 max-sm:gap-2'
                : 'flex items-center gap-[var(--b-spacing-xs)]',
            className
        )} role="group" aria-label={`Remote playback controls for ${deviceName}`}>
            <IconButton
                size={controlSize}
                tone="muted"
                aria-label={`Previous track on ${deviceName}`}
                disabled={!canSend('previous')}
                onClick={() => onCommand('previous')}>
                <Icon.SkipBack />
            </IconButton>

            <IconButton
                size={toggleSize}
                tone={layout === 'detail' ? 'gradient' : 'primary'}
                aria-label={state === 'playing'
                    ? `Pause playback on ${deviceName}`
                    : state === 'paused'
                        ? `Resume playback on ${deviceName}`
                        : `Play on ${deviceName}`}
                disabled={!canSend(toggleCommand)}
                onClick={() => onCommand(toggleCommand)}>
                {state === 'playing' ? <Icon.Pause /> : <Icon.Play />}
            </IconButton>

            <IconButton
                size={controlSize}
                tone="muted"
                aria-label={`Next track on ${deviceName}`}
                disabled={!canSend('next')}
                onClick={() => onCommand('next')}>
                <Icon.SkipForward />
            </IconButton>
        </div>
    );
};

export default RemotePlaybackControls;
