import { useAppStore as useStore } from '~/store/base-store';

import { SettingSection, Tag, TagButton, Text } from '~/components/shared';
import { appCopy } from '~/config/copy';
import { ConnectorListener, socket } from '~/socket';
import { connectorStore } from '~/store/connector';


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

export const ConnectorsSection = () => {
    const [{ connectors }] = useStore(connectorStore);

    return (
        <SettingSection
            title="Connected Devices"
            icon={<DevicesIcon />}
            description={appCopy.connectors.description}>
            <div className="flex flex-col">
                {connectors.map((connector) => (
                    <div key={connector.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[var(--b-spacing-md)] border-b border-[var(--b-color-border-subtle)] py-[var(--b-spacing-md)] last:border-b-0 max-[720px]:grid-cols-1 max-[720px]:items-start">
                        <div className="flex min-w-0 flex-col gap-1">
                            <Text as="span" size="sm" className="truncate">
                                {connector.userAgent}
                            </Text>
                            <Text as="span" size="xs" variant="muted">
                                Connected {new Date(connector.connectedAt).toLocaleDateString()}
                            </Text>
                        </div>
                        {connector.id === socket.id ? (
                            <Tag className="w-fit bg-transparent px-2.5 py-1 text-xs">This device</Tag>
                        ) : (
                            <TagButton
                                tone="danger"
                                className="w-fit px-2.5 py-1 text-xs"
                                onClick={() => ConnectorListener.remove(connector.id)}>
                                Remove
                            </TagButton>
                        )}
                    </div>
                ))}
            </div>
        </SettingSection>
    );
};
