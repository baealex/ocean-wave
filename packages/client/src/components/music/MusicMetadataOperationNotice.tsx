import type { MusicMetadataOperation } from '~/api/music';
import { Badge, Button, Surface, Text } from '~/components/shared';

const RETRYABLE_STATUSES = new Set(['failed', 'rolled-back']);
const RECOVERABLE_STATUSES = new Set([
    'preparing',
    'prepared',
    'replacing',
    'replaced',
    'committed',
    'reconcile-required'
]);

const statusTone = (status: string) => {
    if (status === 'cleaned') return 'success' as const;
    if (status === 'failed' || status === 'reconcile-required') return 'danger' as const;
    return 'warning' as const;
};

export const metadataOperationNeedsAttention = (status: string) => (
    RETRYABLE_STATUSES.has(status) || RECOVERABLE_STATUSES.has(status)
);

export default function MusicMetadataOperationNotice({
    operation,
    busy = false,
    onRecover,
    onRetry
}: {
    operation: MusicMetadataOperation;
    busy?: boolean;
    onRecover: (operationId: string) => void;
    onRetry: (operationId: string) => void;
}) {
    const canRetry = RETRYABLE_STATUSES.has(operation.status);
    const canRecover = RECOVERABLE_STATUSES.has(operation.status);

    if (!metadataOperationNeedsAttention(operation.status)) return null;

    return (
        <Surface
            as="section"
            variant="panel"
            padding="responsive"
            className="grid gap-4"
            aria-labelledby={`metadata-operation-${operation.operationId}`}
            aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Text
                        id={`metadata-operation-${operation.operationId}`}
                        as="h2"
                        size="sectionTitle"
                        weight="semibold">
                        Metadata update needs attention
                    </Text>
                    <Text as="p" variant="muted" size="xs" className="mt-1 leading-relaxed">
                        Operation {operation.operationId}
                    </Text>
                </div>
                <Badge tone={statusTone(operation.status)}>{operation.status}</Badge>
            </div>

            {(operation.errorMessage || operation.errorCode) && (
                <div role="alert" className="rounded-[var(--b-radius-md)] bg-[var(--b-color-badge-danger-background)] p-3">
                    <Text as="p" size="sm">{operation.errorMessage ?? 'The metadata update did not finish.'}</Text>
                    {operation.errorCode && (
                        <Text as="p" variant="muted" size="xs" className="mt-1">
                            {operation.errorCode}
                        </Text>
                    )}
                </div>
            )}

            <div className="grid gap-2">
                {operation.targets.map(target => (
                    <div
                        key={target.fileId}
                        className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--b-color-border-subtle)] py-2 last:border-b-0">
                        <div className="min-w-0">
                            <Text as="p" size="sm" className="break-all">{target.filePath}</Text>
                            {target.errorMessage && (
                                <Text as="p" variant="muted" size="xs" className="mt-1">
                                    {target.errorMessage}
                                </Text>
                            )}
                        </div>
                        <Badge tone={statusTone(target.status)}>{target.status}</Badge>
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
                {canRecover && (
                    <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => onRecover(operation.operationId)}>
                        {busy ? 'Recovering…' : 'Recover files'}
                    </Button>
                )}
                {canRetry && (
                    <Button
                        variant="primary"
                        disabled={busy || !operation.retryable}
                        onClick={() => onRetry(operation.operationId)}>
                        {busy ? 'Retrying…' : 'Retry metadata update'}
                    </Button>
                )}
            </div>
        </Surface>
    );
}
