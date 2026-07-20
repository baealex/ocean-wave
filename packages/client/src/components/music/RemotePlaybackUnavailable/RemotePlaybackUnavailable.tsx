import type { SharedPlaybackState } from '~/api/playback-session';
import { IconTextButton, StateMessage } from '~/components/shared';
import * as Icon from '~/icon';

import RemotePlaybackControls from '../RemotePlaybackControls';

const playbackStateLabel = {
    playing: 'Playing',
    paused: 'Paused',
    stopped: 'Stopped'
} as const;

type RemotePlaybackCommand = 'play' | 'pause' | 'seek' | 'next' | 'previous';

interface RemotePlaybackUnavailableProps {
    canSend: (command: RemotePlaybackCommand) => boolean;
    deviceName: string;
    deviceStatus: string;
    onCommand: (command: Exclude<RemotePlaybackCommand, 'seek'>) => void;
    onOpenQueue: () => void;
    state: SharedPlaybackState;
}

export default function RemotePlaybackUnavailable({
    canSend,
    deviceName,
    deviceStatus,
    onCommand,
    onOpenQueue,
    state
}: RemotePlaybackUnavailableProps) {
    return (
        <StateMessage
            surface
            className="m-auto"
            icon={<Icon.Activity />}
            heading="Remote playback item unavailable."
            description={`${playbackStateLabel[state]} on ${deviceName} · ${deviceStatus}. The current item cannot be resolved here, and local playback is disabled until ownership changes.`}
            actions={(
                <>
                    <div className="max-sm:w-full">
                        <RemotePlaybackControls
                            canSend={canSend}
                            deviceName={deviceName}
                            layout="detail"
                            onCommand={onCommand}
                            state={state}
                        />
                    </div>
                    <IconTextButton
                        size="lg"
                        shape="pill"
                        className="max-sm:w-full"
                        icon={<Icon.ListMusic />}
                        label="Open queue"
                        onClick={onOpenQueue}
                    />
                </>
            )}
        />
    );
}
