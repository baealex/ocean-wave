import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';

import { Button, Surface, Text, TrackArtwork } from '~/components/shared';
import {
    resolveLibraryPlaybackSurface,
    type LibraryPlaybackSurface as LibraryPlaybackSurfaceModel
} from '~/modules/library-playback-surface';
import { REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID } from '~/modules/playback-ownership';
import { useAppStore as useStore } from '~/store/base-store';
import { musicStore } from '~/store/music';
import { playbackDevicesStore } from '~/store/playback-devices';
import {
    isPlaybackHandoffPending,
    playbackHandoffStore
} from '~/store/playback-handoff';
import { playbackQueueStore } from '~/store/playback-queue';
import { playbackSessionStore } from '~/store/playback-session';
import { queueStore } from '~/store/queue';
import {
    isRemotePlaybackControllerReady,
    isRemotePlaybackControlPending,
    remotePlaybackControlStore
} from '~/store/remote-playback-control';

import PlaybackCommandFeedback from '../PlaybackCommandFeedback';
import RemotePlaybackControls, {
    type RemotePlaybackButtonCommand
} from '../RemotePlaybackControls/RemotePlaybackControls';

const cx = classNames;

const contextLabel = {
    album: 'album',
    playlist: 'playlist',
    queue: 'queue'
} as const;

const stateLabel = {
    paused: 'Paused',
    playing: 'Playing',
    stopped: 'Stopped'
} as const;

const getEyebrow = (model: LibraryPlaybackSurfaceModel) => {
    if (model.kind === 'recovery') {
        return 'Continue listening';
    }

    if (model.kind === 'output') {
        return 'Playback output';
    }

    return model.isRemote
        ? `${stateLabel[model.state]} on ${model.deviceName}`
        : `${stateLabel[model.state]} here`;
};

const getTitle = (model: LibraryPlaybackSurfaceModel) => {
    if (model.music) {
        return model.music.name;
    }

    if (model.kind === 'recovery') {
        return model.contextTitle;
    }

    return `${model.deviceName} is ready`;
};

const getDescription = (model: LibraryPlaybackSurfaceModel) => {
    if (model.kind === 'recovery') {
        const source = model.contextType === 'queue'
            ? model.contextTitle
            : `${model.contextTitle} ${contextLabel[model.contextType]}`;
        return `${source} · ${model.queuePosition} of ${model.queueLength} tracks`;
    }

    if (model.music) {
        return `${model.music.artistDisplayName} · ${model.music.album.name}`;
    }

    return 'No recent track is available.';
};

const getOutputStatus = (model: LibraryPlaybackSurfaceModel) => {
    if (!model.isRemote) {
        return `${model.deviceName} · Ready`;
    }

    const connection = model.deviceOnline === null
        ? 'Checking connection'
        : model.deviceOnline ? 'Online' : 'Offline';

    return `${model.deviceName} · ${connection}`;
};

const HandoffFeedback = () => {
    const [handoff] = useStore(playbackHandoffStore);
    const pending = isPlaybackHandoffPending(handoff.phase);

    if (handoff.phase === 'idle' || !handoff.message) {
        return null;
    }

    return (
        <div
            className={cx(
                'mt-3 flex flex-wrap items-center gap-2 rounded-[var(--b-radius-md)] border px-3 py-2',
                handoff.error
                    ? 'border-[var(--b-color-danger-border)] bg-[var(--b-color-badge-danger-background)]'
                    : 'border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)]'
            )}
            role={handoff.error ? 'alert' : 'status'}
            aria-live={handoff.error ? 'assertive' : 'polite'}>
            <Text
                as="p"
                size="xs"
                variant={handoff.error ? 'secondary' : 'tertiary'}
                className="min-w-0 flex-1">
                {handoff.message}
            </Text>
            {!pending && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {handoff.forceAvailable && (
                        <Button
                            size="xs"
                            onClick={() => void playbackHandoffStore.forcePlayHere()}>
                            Force Play Here
                        </Button>
                    )}
                    {handoff.retryAvailable && !handoff.forceAvailable && (
                        <Button
                            size="xs"
                            onClick={() => void playbackHandoffStore.retry()}>
                            Retry
                        </Button>
                    )}
                    {handoff.resumeAvailable && (
                        <Button
                            size="xs"
                            onClick={() => void playbackHandoffStore.resumeHere()}>
                            Resume here
                        </Button>
                    )}
                    <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => playbackHandoffStore.dismiss()}>
                        Dismiss
                    </Button>
                </div>
            )}
        </div>
    );
};

const LibraryPlaybackSurface = () => {
    const navigate = useNavigate();
    const [{ musicMap }] = useStore(musicStore);
    const [{ registry }] = useStore(playbackDevicesStore);
    const [{ snapshot: queueSnapshot }] = useStore(playbackQueueStore);
    const [{ snapshot: sessionSnapshot, endpointId: localEndpointId }] = useStore(
        playbackSessionStore
    );
    const [{ currentTrackId }] = useStore(queueStore);
    const [remoteControl] = useStore(remotePlaybackControlStore);
    const [handoff] = useStore(playbackHandoffStore);
    const model = resolveLibraryPlaybackSurface({
        localEndpointId,
        musicMap,
        nowMs: Date.now(),
        queue: queueSnapshot,
        registry,
        session: sessionSnapshot
    });

    if (!model) {
        return null;
    }

    const remoteCommandPending = isRemotePlaybackControlPending(remoteControl.phase);
    const handoffPending = isPlaybackHandoffPending(handoff.phase);
    const controllerReady = isRemotePlaybackControllerReady();
    const localRecoveryReady = model.kind === 'recovery'
        && currentTrackId === model.music.id;
    const canSendRemoteCommand = (command: RemotePlaybackButtonCommand) => (
        model.isRemote
        && model.deviceOnline === true
        && controllerReady
        && !remoteCommandPending
        && model.capabilities.includes(command)
        && !(
            model.state === 'stopped'
            && (
                command === 'pause'
                || (!model.music && model.queueLength === 0)
            )
        )
    );
    const sendRemoteCommand = (command: RemotePlaybackButtonCommand) => {
        if (canSendRemoteCommand(command)) {
            void remotePlaybackControlStore.send({ type: command });
        }
    };
    const remoteGuidance = model.deviceOnline === false
        ? model.canTransfer
            ? `${model.deviceName} is offline. Remote controls are unavailable; Play Here can recover the saved queue.`
            : `${model.deviceName} is offline. Remote controls are unavailable, and there is no saved queue to move here.`
        : model.deviceOnline === null
            ? model.canTransfer
                ? `Checking ${model.deviceName}. Remote controls will become available after it reconnects; Play Here remains separate.`
                : `Checking ${model.deviceName}. No transferable saved queue is available yet.`
            : model.canTransfer
                ? `Remote controls affect ${model.deviceName}. Play Here moves playback to this browser.`
                : `Remote controls affect ${model.deviceName}. No saved queue is available to move here.`;

    return (
        <Surface
            as="section"
            id={model.isRemote ? REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID : undefined}
            variant="panel"
            radius="xl"
            className="mx-[var(--b-spacing-lg)] mb-[var(--b-spacing-md)] overflow-hidden p-3 sm:p-4"
            aria-label="Current playback and continue listening">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <TrackArtwork
                        src={model.music?.album.cover}
                        alt=""
                        className="h-14 w-14"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Text
                            as="p"
                            size="overline"
                            variant="muted"
                            weight="semibold">
                            {getEyebrow(model)}
                        </Text>
                        <Text as="h2" size="sm" weight="semibold" truncate>
                            {getTitle(model)}
                        </Text>
                        <Text as="p" size="xs" variant="tertiary" truncate>
                            {getDescription(model)}
                        </Text>
                        <Text
                            as="p"
                            size="xs"
                            variant="secondary"
                            className="mt-0.5 flex items-center gap-1.5"
                            role="status"
                            aria-live="polite">
                            <span
                                className={cx(
                                    'h-1.5 w-1.5 shrink-0 rounded-full',
                                    model.deviceOnline === true
                                        ? 'bg-[var(--b-color-point)]'
                                        : 'bg-[var(--b-color-text-muted)]'
                                )}
                                aria-hidden="true"
                            />
                            {getOutputStatus(model)}
                        </Text>
                    </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    {model.isRemote && (
                        <RemotePlaybackControls
                            canSend={canSendRemoteCommand}
                            deviceName={model.deviceName}
                            onCommand={sendRemoteCommand}
                            state={model.state}
                        />
                    )}
                    {model.isRemote && model.canTransfer && (
                        <Button
                            size="sm"
                            variant="primary"
                            disabled={handoffPending}
                            onClick={() => void playbackHandoffStore.playHere()}>
                            {handoffPending ? 'Moving…' : 'Play Here'}
                        </Button>
                    )}
                    {!model.isRemote && model.kind === 'recovery' && (
                        <Button
                            size="sm"
                            variant="primary"
                            disabled={!localRecoveryReady}
                            title={localRecoveryReady
                                ? undefined
                                : 'Waiting for the saved queue to sync'}
                            onClick={() => queueStore.play()}>
                            Resume here
                        </Button>
                    )}
                    <Button
                        size="sm"
                        onClick={() => navigate(model.kind === 'recovery' ? '/queue' : '/player')}>
                        {model.kind === 'recovery' ? 'Open queue' : 'Open controls'}
                    </Button>
                </div>
            </div>

            {model.isRemote && (
                <Text
                    as="p"
                    size="xs"
                    variant="tertiary"
                    className="mt-2.5">
                    {remoteGuidance}
                </Text>
            )}
            {model.isRemote && <PlaybackCommandFeedback compact className="mt-3" />}
            <HandoffFeedback />
        </Surface>
    );
};

export default LibraryPlaybackSurface;
