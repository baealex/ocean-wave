import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cva } from 'class-variance-authority';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { queryKeys } from '~/api/query-keys';
import { getLatestSyncReport } from '~/api/sync';
import { Badge, Button, SettingItem, SettingSection, Text } from '~/components/shared';
import type { SyncReport } from '~/models/type';
import { toast } from '~/modules/toast';
import { socket } from '~/socket';


export interface SynchronizationSectionProps {
    onSyncMusic: (force: boolean) => Promise<void>;
}

const SyncIcon = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
    </svg>
);

const formatTimestamp = (value: string | null) => {
    if (!value) {
        return 'Unavailable';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Unavailable';
    }

    return date.toLocaleString();
};

const syncStatusTone = (status: SyncReport['status']) => {
    return status === 'success' ? 'success' : 'danger';
};

const progressBarClass = cva(
    'h-full w-[30%] rounded-full bg-[var(--b-gradient-primary)]',
    {
        variants: {
            syncing: {
                true: 'animate-[progress_1.5s_ease-in-out_infinite]',
                false: ''
            }
        },
        defaultVariants: {
            syncing: false
        }
    }
);

export const SynchronizationSection = ({ onSyncMusic }: SynchronizationSectionProps) => {
    const [progressMessage, setProgressMessage] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const queryClient = useQueryClient();
    const { data: latestSyncReport } = useQuery({
        queryKey: queryKeys.syncReports.latest(),
        queryFn: () => getLatestSyncReport().then((response) => response.data.latestSyncReport)
    });

    useEffect(() => {
        const handleSyncMusic = (serverMessage: string | 'done' | 'error') => {
            if (serverMessage === 'done' || serverMessage === 'error') {
                if (serverMessage === 'done') {
                    toast.success('Completed sync music');
                } else if (serverMessage === 'error') {
                    toast.error('Error while sync music');
                }

                setIsSyncing(false);
                queryClient.invalidateQueries({
                    queryKey: queryKeys.syncReports.listAll(),
                    exact: false
                });
                setTimeout(() => {
                    setProgressMessage('');
                }, 1000);
            } else {
                setIsSyncing(true);
            }
            setProgressMessage(serverMessage);
        };

        socket.on('sync-music', handleSyncMusic);

        return () => {
            socket.off('sync-music', handleSyncMusic);
        };
    }, [queryClient]);

    const handleSync = async (force: boolean) => {
        setIsSyncing(true);
        await onSyncMusic(force);
    };

    return (
        <SettingSection
            title="Synchronization"
            icon={<SyncIcon />}
            description="Update the local library from the server.">
            <SettingItem
                title="Sync Music from Server"
                description="Run a normal sync, or force one when needed."
                divider={!latestSyncReport}>
                <div>
                    {progressMessage && (
                        <div className="mb-[var(--b-spacing-sm)] w-[min(288px,100%)]">
                            <div className="mb-[var(--b-spacing-sm)] h-[3px] overflow-hidden rounded-full bg-[var(--b-color-hover)]">
                                <div
                                    className={progressBarClass({ syncing: isSyncing })}
                                />
                            </div>
                            <Text as="p" size="sm" variant="secondary" className="m-0">
                                {progressMessage}
                            </Text>
                        </div>
                    )}

                    <div className="flex justify-end gap-[var(--b-spacing-sm)] max-[720px]:justify-start">
                        <Button disabled={isSyncing} onClick={() => handleSync(false)}>
                            Sync
                        </Button>
                        <Button disabled={isSyncing} onClick={() => handleSync(true)}>
                            Force Sync
                        </Button>
                    </div>
                </div>
            </SettingItem>

            {latestSyncReport && (
                <div className="flex min-h-[68px] items-center justify-between gap-[var(--b-spacing-md)] border-b border-[var(--b-color-border-subtle)] py-[var(--b-spacing-md)] max-[720px]:flex-col max-[720px]:items-start">
                    <div className="flex min-w-0 flex-col gap-1">
                        <Text as="span" size="sm" weight="semibold">
                            Latest sync
                        </Text>
                        <Text as="span" size="xs" variant="muted">
                            {latestSyncReport.scannedFiles} scanned · {latestSyncReport.indexedFiles} indexed · {latestSyncReport.completedAt ? `Completed ${formatTimestamp(latestSyncReport.completedAt)}` : 'Completion unavailable'}
                        </Text>
                        {latestSyncReport.reconcileCount > 0 && (
                            <div className="grid gap-1.5 pt-1">
                                <Text
                                    as="span"
                                    size="xs"
                                    variant="secondary"
                                    className="text-[var(--b-color-badge-danger-text)]">
                                    {latestSyncReport.reconcileCount} file{latestSyncReport.reconcileCount === 1 ? '' : 's'} need metadata reconciliation
                                </Text>
                                {latestSyncReport.reconcile.slice(0, 5).map(item => (
                                    <div
                                        key={item.id}
                                        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                        <span className="min-w-0 break-all text-[var(--b-color-text-muted)]">
                                            {item.filePath}
                                        </span>
                                        {item.musicId && (
                                            <Link
                                                to={`/music/${item.musicId}/edit`}
                                                className="font-semibold text-[var(--b-color-point-light)] hover:underline">
                                                Review
                                            </Link>
                                        )}
                                    </div>
                                ))}
                                {latestSyncReport.reconcileCount > 5 && (
                                    <Text as="span" size="xs" variant="muted">
                                        +{latestSyncReport.reconcileCount - 5} more
                                    </Text>
                                )}
                            </div>
                        )}
                    </div>
                    <Badge tone={syncStatusTone(latestSyncReport.status)}>
                        {latestSyncReport.status}
                    </Badge>
                </div>
            )}
        </SettingSection>
    );
};
