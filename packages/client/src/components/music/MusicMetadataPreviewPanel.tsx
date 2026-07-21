import type {
    MusicMetadataChange,
    MusicMetadataPreview
} from '~/api/music';
import { Badge, Surface, Text } from '~/components/shared';

const OWNER_LABELS = {
    RECORDING: 'Recording',
    RELEASE: 'Release',
    RELEASE_TRACK: 'Release appearance'
} as const;

const ChangeRow = ({ change }: { change: MusicMetadataChange }) => (
    <li className="grid gap-2 border-b border-[var(--b-color-border-subtle)] py-3 last:border-b-0 sm:grid-cols-[minmax(140px,0.7fr)_minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
            <Text as="p" size="sm" weight="semibold">{change.label}</Text>
            <Text as="p" variant="muted" size="xs" className="mt-1">
                {OWNER_LABELS[change.owner]}
            </Text>
        </div>
        <Text as="p" size="sm" className="min-w-0 break-words">
            <span className="text-[var(--b-color-text-muted)]">{change.before}</span>
            <span aria-hidden="true" className="mx-2 text-[var(--b-color-text-muted)]">→</span>
            <span>{change.after}</span>
        </Text>
        <Badge tone={change.storage === 'FILE_AND_DATABASE' ? 'neutral' : 'subtle'}>
            {change.storage === 'FILE_AND_DATABASE' ? 'File + database' : 'Database only'}
        </Badge>
    </li>
);

export default function MusicMetadataPreviewPanel({
    preview
}: {
    preview: MusicMetadataPreview;
}) {
    const blockingIssues = preview.issues.filter(issue => issue.blocking);

    return (
        <Surface
            as="section"
            variant="panel"
            padding="responsive"
            className="grid gap-5"
            aria-labelledby="metadata-preview-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <Text id="metadata-preview-heading" as="h2" size="sectionTitle" weight="semibold">
                        Review metadata changes
                    </Text>
                    <Text as="p" variant="muted" size="xs" className="mt-1 leading-relaxed">
                        Confirm the relationship changes and every audio file before applying them.
                    </Text>
                </div>
                <Badge tone={blockingIssues.length
                    ? 'danger'
                    : preview.hasChanges ? 'success' : 'subtle'}>
                    {blockingIssues.length
                        ? 'Blocked'
                        : preview.hasChanges ? 'Ready to apply' : 'No changes'}
                </Badge>
            </div>

            {preview.issues.length > 0 && (
                <div className="grid gap-2" aria-label="Metadata preview issues">
                    {preview.issues.map(issue => (
                        <div
                            key={`${issue.code}-${issue.fileId ?? 'operation'}`}
                            role={issue.blocking ? 'alert' : 'status'}
                            className="rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge tone={issue.blocking ? 'danger' : 'warning'}>
                                    {issue.blocking ? 'Must fix' : 'Will reconcile'}
                                </Badge>
                                <Text as="span" size="sm">{issue.message}</Text>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div>
                <Text as="h3" size="sm" weight="semibold">Relationship changes</Text>
                {preview.changes.length > 0 ? (
                    <ul className="mt-2">
                        {preview.changes.map(change => (
                            <ChangeRow key={change.field} change={change} />
                        ))}
                    </ul>
                ) : (
                    <Text as="p" variant="muted" size="xs" className="mt-2">
                        Relationship values stay the same. File tags may still need repair.
                    </Text>
                )}
            </div>

            <div className="grid gap-3">
                <Text as="h3" size="sm" weight="semibold">Audio files</Text>
                {preview.files.map(file => (
                    <div
                        key={file.stableId}
                        className="grid gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <Text as="p" size="sm" className="break-all">{file.filePath}</Text>
                                <Text as="p" variant="muted" size="xs" className="mt-1">
                                    Library status: {file.syncStatus}
                                </Text>
                            </div>
                            <Badge tone={file.willWrite ? 'warning' : 'subtle'}>
                                {file.willWrite ? 'Will update file' : 'No file write'}
                            </Badge>
                        </div>
                        {file.changes.length > 0 && (
                            <ul>
                                {file.changes.map(change => (
                                    <ChangeRow key={`${file.stableId}-${change.field}`} change={change} />
                                ))}
                            </ul>
                        )}
                    </div>
                ))}
            </div>

            <div>
                <Text as="h3" size="sm" weight="semibold">Kept unchanged</Text>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-[var(--b-color-text-muted)]">
                    {preview.preservedPolicies.map(policy => (
                        <li key={policy}>{policy}</li>
                    ))}
                </ul>
            </div>
        </Surface>
    );
}
