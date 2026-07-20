import { useState } from 'react';

import { useAppStore as useStore } from '~/store/base-store';

import {
    Button,
    SettingSection,
    Tag,
    TagButton,
    Text
} from '~/components/shared';
import { TextEntryDialog } from '~/components/shared/Modal';
import { appCopy } from '~/config/copy';
import { playbackDevicesStore } from '~/store/playback-devices';

const DevicesIcon = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round">
        <rect
            x="2"
            y="3"
            width="20"
            height="14"
            rx="2"
            ry="2"
        />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
);

const formatDeviceType = (type: 'desktop-web' | 'mobile-web') => {
    return type === 'mobile-web' ? 'Mobile web' : 'Desktop web';
};

const formatLastSeen = (lastSeenAt: string) => {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(lastSeenAt));
};

export const PlaybackDevicesSection = () => {
    const [{ registry, loading, renamingDeviceId, error }] = useStore(playbackDevicesStore);
    const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const devices = registry?.devices ?? [];
    const editingDevice = devices.find((device) => device.id === editingDeviceId) ?? null;

    const closeRename = () => {
        if (renamingDeviceId) {
            return;
        }
        setEditingDeviceId(null);
        setEditingName('');
    };

    return (
        <SettingSection
            title="Playback Devices"
            icon={<DevicesIcon />}
            description={appCopy.playbackDevices.description}>
            <div className="flex flex-col">
                {loading && !registry && (
                    <Text as="p" size="sm" variant="muted" className="py-[var(--b-spacing-md)]">
                        Loading playback devices…
                    </Text>
                )}

                {error && (
                    <div className="flex flex-wrap items-center justify-between gap-3 py-[var(--b-spacing-md)]">
                        <Text
                            as="p"
                            size="sm"
                            variant="secondary"
                            className="text-[var(--b-color-badge-danger-text)]">
                            {error}
                        </Text>
                        <Button size="xs" onClick={() => void playbackDevicesStore.refresh()}>
                            Retry
                        </Button>
                    </div>
                )}

                {!loading && !error && devices.length === 0 && (
                    <Text as="p" size="sm" variant="muted" className="py-[var(--b-spacing-md)]">
                        No playback devices have registered yet.
                    </Text>
                )}

                {devices.map((device) => {
                    const onlineEndpointCount = device.endpoints.filter((endpoint) => endpoint.online).length;
                    const isCurrentDevice = device.id === playbackDevicesStore.currentDeviceId;

                    return (
                        <div
                            key={device.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[var(--b-spacing-md)] border-b border-[var(--b-color-border-subtle)] py-[var(--b-spacing-md)] last:border-b-0 max-[720px]:grid-cols-1 max-[720px]:items-start">
                            <div className="flex min-w-0 flex-col gap-2">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <Text as="span" size="sm" weight="semibold" className="truncate">
                                        {device.name}
                                    </Text>
                                    {isCurrentDevice && (
                                        <Tag className="w-fit bg-transparent px-2.5 py-1 text-xs">
                                            This browser
                                        </Tag>
                                    )}
                                    {device.active && (
                                        <Tag tone="accent" className="w-fit px-2.5 py-1 text-xs">
                                            Active player
                                        </Tag>
                                    )}
                                    <Tag
                                        tone={device.online ? 'accent' : 'neutral'}
                                        className="w-fit px-2.5 py-1 text-xs">
                                        {device.online ? 'Online' : 'Offline'}
                                    </Tag>
                                </div>
                                <Text as="span" size="xs" variant="muted">
                                    {formatDeviceType(device.type)} · {onlineEndpointCount} online {onlineEndpointCount === 1 ? 'tab' : 'tabs'} · Last seen {formatLastSeen(device.lastSeenAt)}
                                </Text>
                            </div>

                            <TagButton
                                className="w-fit px-2.5 py-1 text-xs"
                                aria-label={`Rename ${device.name}`}
                                onClick={() => {
                                    setEditingDeviceId(device.id);
                                    setEditingName(device.name);
                                }}>
                                Rename
                            </TagButton>
                        </div>
                    );
                })}
            </div>

            <TextEntryDialog
                open={Boolean(editingDevice)}
                title="Rename playback device"
                description="Use a name that is easy to recognize from another browser."
                value={editingName}
                placeholder="Playback device name"
                confirmLabel="Save name"
                pending={Boolean(renamingDeviceId)}
                onValueChange={(value) => setEditingName(value.slice(0, 80))}
                onConfirm={(name) => {
                    if (!editingDevice) {
                        return;
                    }

                    void playbackDevicesStore.rename(editingDevice.id, name).then((renamed) => {
                        if (renamed) {
                            setEditingDeviceId(null);
                            setEditingName('');
                        }
                    });
                }}
                onClose={closeRename}
            />
        </SettingSection>
    );
};
