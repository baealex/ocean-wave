import * as Dialog from '@baejino/react-ui/modal/dialog';
import classNames from 'classnames';
import { useRef, useState } from 'react';

import { Button, IconButton, IconTextButton, Text } from '~/components/shared';
import {
    dialogChromeClass,
    dialogContentClass,
    dialogOverlayClass
} from '~/components/shared/Modal/DialogShell';
import * as Icon from '~/icon';
import { PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS } from '~/modules/playback-controller';
import { useAppStore as useStore } from '~/store/base-store';
import {
    playbackDevicesStore,
    resolveActivePlaybackTarget
} from '~/store/playback-devices';

const cx = classNames;

const DevicesIcon = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true">
        <rect x="2" y="3" width="15" height="12" rx="2" />
        <path d="M7 19h5" />
        <path d="M9.5 15v4" />
        <rect x="18" y="8" width="4" height="11" rx="1" />
    </svg>
);

const deviceDialogClass = {
    overlay: dialogOverlayClass({ layer: 'form', tone: 'strong' }),
    content: dialogContentClass({ layer: 'form', width: 'form', padding: 'none' }),
    panel: dialogChromeClass.panel,
    header: dialogChromeClass.stickyHeader,
    heading: dialogChromeClass.header,
    body: dialogChromeClass.body,
    title: dialogChromeClass.title,
    description: dialogChromeClass.description
};

export interface PlaybackDeviceMenuProps {
    className?: string;
    compact?: boolean;
}

const PlaybackDeviceMenu = ({
    className,
    compact = false
}: PlaybackDeviceMenuProps) => {
    const [{ registry, loading, error, errorRetryable }] = useStore(playbackDevicesStore);
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const devices = registry?.devices ?? [];
    const activeTarget = resolveActivePlaybackTarget(registry);
    const activeStatus = activeTarget?.endpoint.online ? 'Online' : 'Offline';
    const activeDeviceName = activeTarget?.device.name ?? 'No active player';
    const triggerLabel = activeTarget
        ? `Playback output: ${activeDeviceName}, ${activeStatus}. Open device list`
        : 'Open playback device list';

    const changeOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen) {
            void playbackDevicesStore.refresh(PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={changeOpen}>
            <Dialog.Trigger asChild>
                {compact ? (
                    <IconButton
                        ref={triggerRef}
                        size="compact"
                        tone="muted"
                        active={open}
                        className={className}
                        aria-label={triggerLabel}
                        aria-haspopup="dialog"
                        aria-expanded={open}>
                        <DevicesIcon />
                    </IconButton>
                ) : (
                    <IconTextButton
                        ref={triggerRef}
                        size="sm"
                        shape="pill"
                        active={open}
                        className={cx('max-w-full', className)}
                        icon={<DevicesIcon />}
                        label={activeDeviceName}
                        meta={activeTarget ? activeStatus : undefined}
                        aria-label={triggerLabel}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                    />
                )}
            </Dialog.Trigger>

            <Dialog.Portal>
                <Dialog.Overlay className={deviceDialogClass.overlay} />
                <Dialog.Content
                    className={deviceDialogClass.content}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        window.setTimeout(() => triggerRef.current?.focus(), 0);
                    }}>
                    <div className={deviceDialogClass.panel}>
                        <header className={deviceDialogClass.header}>
                            <div className={deviceDialogClass.heading}>
                                <Dialog.Title asChild>
                                    <Text as="h2" size="md" weight="semibold" className={deviceDialogClass.title}>
                                        Playback output
                                    </Text>
                                </Dialog.Title>
                                <Dialog.Description asChild>
                                    <Text as="p" variant="secondary" size="sm" className={deviceDialogClass.description}>
                                        Review the active output and available registered web players.
                                    </Text>
                                </Dialog.Description>
                            </div>
                            <Dialog.Close asChild>
                                <IconButton
                                    size="utility"
                                    tone="muted"
                                    className="shrink-0"
                                    aria-label="Close playback output">
                                    <Icon.Close />
                                </IconButton>
                            </Dialog.Close>
                        </header>

                        <div className={deviceDialogClass.body}>
                            {activeTarget && (
                                <div className="mb-3 rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-3 py-2.5">
                                    <Text as="p" size="xs" variant="muted" weight="medium">
                                        ACTIVE OUTPUT
                                    </Text>
                                    <div className="mt-1 flex min-w-0 items-center gap-2">
                                        <span
                                            className={cx(
                                                'h-2 w-2 shrink-0 rounded-full',
                                                activeTarget.endpoint.online
                                                    ? 'bg-[var(--b-color-point)]'
                                                    : 'bg-[var(--b-color-text-muted)]'
                                            )}
                                            aria-hidden="true"
                                        />
                                        <Text as="span" size="sm" weight="semibold" truncate>
                                            {activeTarget.device.name}
                                        </Text>
                                        <Text as="span" size="xs" variant="tertiary" className="shrink-0">
                                            {activeStatus}
                                        </Text>
                                    </div>
                                </div>
                            )}

                            {loading && !registry && (
                                <Text as="p" size="sm" variant="muted" className="py-3">
                                    Loading playback devices…
                                </Text>
                            )}

                            {loading && registry && (
                                <Text
                                    as="p"
                                    size="xs"
                                    variant="muted"
                                    className="mb-3"
                                    role="status"
                                    aria-live="polite">
                                    Refreshing playback devices…
                                </Text>
                            )}

                            {error && (
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--b-radius-md)] border border-[var(--b-color-danger-border)] px-3 py-2.5" role="alert">
                                    <Text as="p" size="sm" variant="secondary" className="text-[var(--b-color-badge-danger-text)]">
                                        {error}
                                    </Text>
                                    {errorRetryable && (
                                        <Button
                                            size="xs"
                                            disabled={loading}
                                            onClick={() => void playbackDevicesStore.refresh(
                                                PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS
                                            )}>
                                            Retry
                                        </Button>
                                    )}
                                </div>
                            )}

                            {!loading && !error && devices.length === 0 && (
                                <Text as="p" size="sm" variant="muted" className="py-3">
                                    No playback devices have registered yet.
                                </Text>
                            )}

                            {devices.length > 0 && (
                                <ul className="m-0 flex list-none flex-col p-0" aria-label="Playback devices">
                                    {devices.map((device) => {
                                        const isCurrentDevice = device.id === playbackDevicesStore.currentDeviceId;
                                        const isActiveDevice = activeTarget?.device.id === device.id;

                                        return (
                                            <li
                                                key={device.id}
                                                className="flex min-w-0 items-center gap-3 border-b border-[var(--b-color-border-subtle)] py-3 last:border-b-0">
                                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--b-color-surface-input)] text-[var(--b-color-text-secondary)] [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
                                                    {device.type === 'mobile-web' ? <Icon.Smartphone /> : <DevicesIcon />}
                                                </span>

                                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <Text as="span" size="sm" weight="semibold" truncate>
                                                            {device.name}
                                                        </Text>
                                                        {isActiveDevice && (
                                                            <span className="shrink-0 text-[var(--b-color-point-light)]" aria-label="Active player">
                                                                <Icon.Check aria-hidden="true" className="h-4 w-4" />
                                                            </span>
                                                        )}
                                                    </div>
                                                    <Text as="span" size="xs" variant="tertiary" truncate>
                                                        {isCurrentDevice ? 'This browser · ' : ''}
                                                        {isActiveDevice ? 'Active player · ' : ''}
                                                        {device.online ? 'Online' : 'Offline'}
                                                    </Text>
                                                </div>

                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};

export default PlaybackDeviceMenu;
