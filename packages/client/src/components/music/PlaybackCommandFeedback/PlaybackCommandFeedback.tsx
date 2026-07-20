import classNames from 'classnames';

import { Button, Text } from '~/components/shared';
import { useAppStore as useStore } from '~/store/base-store';
import {
    isRemotePlaybackControlPending,
    remotePlaybackControlStore
} from '~/store/remote-playback-control';

const cx = classNames;

export interface PlaybackCommandFeedbackProps {
    className?: string;
    compact?: boolean;
}

const phaseLabel = {
    accepted: 'Accepted',
    completed: 'Completed',
    reconciling: 'Refreshing state',
    recovering: 'Checking outcome',
    refresh_error: 'Refresh needed',
    rejected: 'Could not complete',
    sending: 'Sending',
    timed_out: 'Timed out'
} as const;

const PlaybackCommandFeedback = ({
    className,
    compact = false
}: PlaybackCommandFeedbackProps) => {
    const [state] = useStore(remotePlaybackControlStore);
    const commandPending = isRemotePlaybackControlPending(state.phase);
    const showControllerReadiness = Boolean(state.controllerMessage)
        && !commandPending
        && (
            state.phase === 'idle'
            || ['completed', 'rejected', 'timed_out'].includes(state.phase)
        );
    const displayPhase: Exclude<typeof state.phase, 'idle'> | 'idle' = showControllerReadiness
        ? state.controllerError ? 'refresh_error' : 'reconciling'
        : state.phase;
    const displayMessage = showControllerReadiness
        ? state.controllerMessage
        : state.message;
    const displayError = showControllerReadiness
        ? state.controllerError
        : state.error;

    if (displayPhase === 'idle' || !displayMessage) {
        return null;
    }

    const controlsBlocked = showControllerReadiness
        ? state.controllerRefreshing || Boolean(state.controllerError)
        : commandPending;
    const pending = controlsBlocked && displayPhase !== 'refresh_error';
    const failed = Boolean(displayError);

    return (
        <div
            className={cx(
                'flex min-w-0 items-center gap-2 rounded-[var(--b-radius-md)] border px-3 py-2',
                failed
                    ? 'border-[var(--b-color-danger-border)] bg-[var(--b-color-badge-danger-background)]'
                    : 'border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)]',
                compact && 'max-sm:flex-wrap max-sm:px-2.5 max-sm:py-1.5',
                className
            )}
            role={failed ? 'alert' : 'status'}
            aria-live={failed ? 'assertive' : 'polite'}>
            <span
                className={cx(
                    'h-2 w-2 shrink-0 rounded-full',
                    pending
                        ? 'animate-pulse bg-[var(--b-color-point)]'
                        : failed
                            ? 'bg-[var(--b-color-badge-danger-text)]'
                            : 'bg-[var(--b-color-point)]'
                )}
                aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col">
                <Text as="span" size="xs" weight="semibold">
                    {phaseLabel[displayPhase]}
                </Text>
                <Text as="span" size="xs" variant={failed ? 'secondary' : 'tertiary'}>
                    {displayMessage}
                </Text>
            </div>

            {!pending && (
                <div className="flex shrink-0 items-center gap-1.5">
                    {displayError?.retryable && (
                        <Button
                            size="xs"
                            variant={failed ? 'danger' : 'secondary'}
                            onClick={() => void (
                                showControllerReadiness
                                    ? remotePlaybackControlStore.retryControllerReadiness()
                                    : remotePlaybackControlStore.retry()
                            )}>
                            {displayPhase === 'refresh_error' ? 'Retry refresh' : 'Retry'}
                        </Button>
                    )}
                    {!showControllerReadiness && displayPhase !== 'refresh_error' && (
                        <Button
                            size="xs"
                            variant="ghost"
                            aria-label="Dismiss playback command status"
                            onClick={() => remotePlaybackControlStore.dismiss()}>
                            Dismiss
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
};

export default PlaybackCommandFeedback;
