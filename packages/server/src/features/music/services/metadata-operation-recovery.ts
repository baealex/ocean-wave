import models, { type MusicMetadataOperationTarget } from '~/models';
import {
    cleanupPreparedTrackMetadata,
    discardPreparedTrackMetadata,
    type PreparedTrackMetadataFile,
    restorePreparedTrackMetadata,
    validatePreparedTrackMetadataCleanup
} from '~/modules/audio-metadata-writer';

const RECOVERABLE_STATUSES = [
    'preparing',
    'prepared',
    'replacing',
    'replaced',
    'committed',
    'reconcile-required'
];

interface MetadataRecoveryDependencies {
    restoreFile: typeof restorePreparedTrackMetadata;
    discardFile: typeof discardPreparedTrackMetadata;
    validateCleanupFile: typeof validatePreparedTrackMetadataCleanup;
    cleanupFile: typeof cleanupPreparedTrackMetadata;
}

const defaultDependencies: MetadataRecoveryDependencies = {
    restoreFile: restorePreparedTrackMetadata,
    discardFile: discardPreparedTrackMetadata,
    validateCleanupFile: validatePreparedTrackMetadataCleanup,
    cleanupFile: cleanupPreparedTrackMetadata
};

const toPreparedFile = (
    target: MusicMetadataOperationTarget
): PreparedTrackMetadataFile | null => {
    if (
        !target.stagingPath
        || !target.backupPath
        || !target.newContentHash
        || target.newFileSizeBytes === null
    ) {
        return null;
    }

    return {
        filePath: target.filePath,
        stagingPath: target.stagingPath,
        backupPath: target.backupPath,
        oldContentHash: target.oldContentHash,
        newContentHash: target.newContentHash,
        hashVersion: target.hashVersion,
        oldFileSizeBytes: target.oldFileSizeBytes ?? 0n,
        newFileSizeBytes: target.newFileSizeBytes
    };
};

const errorDetails = (error: unknown) => ({
    errorCode: error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'AUDIO_METADATA_RECOVERY_FAILED',
    errorMessage: error instanceof Error
        ? error.message
        : 'Metadata recovery failed.'
});

const markReconciliationRequired = async ({
    operationId,
    target,
    error
}: {
    operationId: string;
    target: MusicMetadataOperationTarget;
    error: unknown;
}) => {
    const details = errorDetails(error);

    await models.musicMetadataOperationTarget.update({
        where: { id: target.id },
        data: {
            status: 'reconcile-required',
            ...details
        }
    });
    await models.physicalFile.updateMany({
        where: {
            stableId: target.physicalFileStableId,
            metadataSyncStatus: { not: 'reconcile-required' }
        },
        data: {
            metadataSyncStatus: 'reconcile-required',
            metadataSyncError: details.errorMessage,
            metadataRevision: { increment: 1 }
        }
    });
    await models.musicMetadataOperation.update({
        where: { id: operationId },
        data: {
            status: 'reconcile-required',
            ...details,
            completedAt: new Date()
        }
    });
};

const restorePhysicalFileSyncState = async (
    target: MusicMetadataOperationTarget
) => {
    await models.physicalFile.updateMany({
        where: {
            stableId: target.physicalFileStableId,
            metadataSyncStatus: 'reconcile-required'
        },
        data: {
            metadataSyncStatus: target.oldMetadataSyncStatus,
            metadataSyncError: target.oldMetadataSyncError,
            metadataRevision: { increment: 1 }
        }
    });
};

const markPhysicalFileMetadataCurrent = async (
    target: MusicMetadataOperationTarget
) => {
    await models.physicalFile.updateMany({
        where: {
            stableId: target.physicalFileStableId,
            metadataSyncStatus: 'reconcile-required'
        },
        data: {
            metadataSyncStatus: 'current',
            metadataSyncError: null,
            metadataRevision: { increment: 1 }
        }
    });
};

const rebaseRecoveredTargetRevisions = async (
    operationId: string,
    targets: MusicMetadataOperationTarget[]
) => {
    const operation = await models.musicMetadataOperation.findUnique({
        where: { id: operationId },
        select: { expectedRevisionsJson: true }
    });

    if (!operation) return null;

    const expected = JSON.parse(operation.expectedRevisionsJson) as {
        files?: Array<{ stableId: string; revision: number }>;
        [key: string]: unknown;
    };

    if (!Array.isArray(expected.files)) return operation.expectedRevisionsJson;

    const targetStableIds = new Set(targets.map(target => target.physicalFileStableId));
    const currentFiles = await models.physicalFile.findMany({
        where: { stableId: { in: [...targetStableIds] } },
        select: { stableId: true, metadataRevision: true }
    });
    const currentRevisionByStableId = new Map(currentFiles.map(file => [
        file.stableId,
        file.metadataRevision
    ]));

    return JSON.stringify({
        ...expected,
        files: expected.files.map((file) => {
            const revision = currentRevisionByStableId.get(file.stableId);

            return revision === undefined || !targetStableIds.has(file.stableId)
                ? file
                : { ...file, revision };
        })
    });
};

const recoverPreCommitOperation = async (
    operationId: string,
    targets: MusicMetadataOperationTarget[],
    dependencies: MetadataRecoveryDependencies
) => {
    for (const target of [...targets].reverse()) {
        const prepared = toPreparedFile(target);

        if (!prepared) {
            if (target.status === 'pending' || target.status === 'failed') {
                try {
                    if (Boolean(target.stagingPath) !== Boolean(target.backupPath)) {
                        throw new Error('The metadata journal contains incomplete cleanup paths.');
                    }

                    if (target.stagingPath && target.backupPath) {
                        await dependencies.discardFile({
                            filePath: target.filePath,
                            stagingPath: target.stagingPath,
                            backupPath: target.backupPath
                        });
                    }

                    await restorePhysicalFileSyncState(target);

                    await models.musicMetadataOperationTarget.update({
                        where: { id: target.id },
                        data: {
                            status: 'restored',
                            errorCode: null,
                            errorMessage: null
                        }
                    });
                } catch (error) {
                    await markReconciliationRequired({ operationId, target, error });
                    return;
                }
                continue;
            }

            await markReconciliationRequired({
                operationId,
                target,
                error: new Error('The metadata journal is missing recovery paths or hashes.')
            });
            return;
        }

        try {
            await dependencies.restoreFile(prepared);
            await dependencies.discardFile(prepared);
            await restorePhysicalFileSyncState(target);
            await models.musicMetadataOperationTarget.update({
                where: { id: target.id },
                data: {
                    status: 'restored',
                    errorCode: null,
                    errorMessage: null
                }
            });
        } catch (error) {
            await markReconciliationRequired({ operationId, target, error });
            return;
        }
    }

    const expectedRevisionsJson = await rebaseRecoveredTargetRevisions(
        operationId,
        targets
    );

    await models.musicMetadataOperation.update({
        where: { id: operationId },
        data: {
            status: 'rolled-back',
            errorCode: 'AUDIO_METADATA_OPERATION_RECOVERED',
            errorMessage: 'Startup recovery restored every original audio file.',
            ...(expectedRevisionsJson ? { expectedRevisionsJson } : {}),
            completedAt: new Date()
        }
    });
};

const recoverCommittedOperation = async (
    operationId: string,
    targets: MusicMetadataOperationTarget[],
    dependencies: MetadataRecoveryDependencies
) => {
    const preparedTargets: Array<{
        target: MusicMetadataOperationTarget;
        prepared: PreparedTrackMetadataFile;
    }> = [];

    for (const target of targets) {
        if (target.status === 'cleaned') continue;

        const prepared = toPreparedFile(target);

        if (!prepared) {
            await markReconciliationRequired({
                operationId,
                target,
                error: new Error('The committed metadata journal is missing cleanup evidence.')
            });
            return;
        }

        preparedTargets.push({ target, prepared });
    }

    for (const { target, prepared } of preparedTargets) {
        try {
            await dependencies.validateCleanupFile(prepared);
        } catch (error) {
            await markReconciliationRequired({ operationId, target, error });
            return;
        }
    }

    for (const { target, prepared } of preparedTargets) {
        try {
            await dependencies.cleanupFile(prepared);
            await markPhysicalFileMetadataCurrent(target);
            await models.musicMetadataOperationTarget.update({
                where: { id: target.id },
                data: {
                    status: 'cleaned',
                    errorCode: null,
                    errorMessage: null
                }
            });
        } catch (error) {
            await markReconciliationRequired({ operationId, target, error });
            return;
        }
    }

    await models.musicMetadataOperation.update({
        where: { id: operationId },
        data: {
            status: 'cleaned',
            errorCode: null,
            errorMessage: null,
            completedAt: new Date()
        }
    });
};

export const configureMetadataOperationDurability = async () => {
    await models.$executeRawUnsafe('PRAGMA synchronous = FULL');
};

export const recoverMusicMetadataOperationJournal = async (
    operationId: string,
    dependencies: MetadataRecoveryDependencies = defaultDependencies
) => {
    const operation = await models.musicMetadataOperation.findUnique({
        where: { id: operationId },
        include: { Target: { orderBy: { id: 'asc' } } }
    });

    if (!operation) return null;
    if (!RECOVERABLE_STATUSES.includes(operation.status)) return operation;

    const committed = operation.committedAt !== null
        || operation.status === 'committed';

    if (committed) {
        await recoverCommittedOperation(operation.id, operation.Target, dependencies);
    } else {
        await recoverPreCommitOperation(operation.id, operation.Target, dependencies);
    }

    return models.musicMetadataOperation.findUnique({
        where: { id: operationId },
        include: { Target: { orderBy: { id: 'asc' } } }
    });
};

export const recoverMusicMetadataOperationJournals = async (
    dependencies: MetadataRecoveryDependencies = defaultDependencies
) => {
    await configureMetadataOperationDurability();
    const operations = await models.musicMetadataOperation.findMany({
        where: { status: { in: RECOVERABLE_STATUSES } },
        select: { id: true },
        orderBy: { createdAt: 'asc' }
    });

    for (const operation of operations) {
        await recoverMusicMetadataOperationJournal(operation.id, dependencies);
    }

    return operations.length;
};
