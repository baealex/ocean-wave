import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import models from '~/models';
import { createTrackContentHash, TRACK_CONTENT_HASH_VERSION } from '~/modules/track-hash';

import {
    recoverMusicMetadataOperationJournal,
    recoverMusicMetadataOperationJournals
} from './metadata-operation-recovery';

const createTarget = async ({
    status,
    committed
}: {
    status: 'replaced' | 'committed';
    committed: boolean;
}) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-recovery-'));
    const filePath = path.join(directory, 'track.wav');
    const stagingPath = path.join(directory, '.track.operation.ocean-wave.stage');
    const backupPath = path.join(directory, '.track.operation.ocean-wave.backup');
    const oldData = Buffer.from('original audio');
    const newData = Buffer.from('rewritten audio');
    fs.writeFileSync(filePath, newData);
    fs.writeFileSync(backupPath, oldData);

    const artist = await models.artist.create({ data: { name: `Recovery Artist ${randomUUID()}` } });
    const recording = await models.recording.create({
        data: {
            title: 'Recovery Track',
            ArtistCredit: {
                create: { artistId: artist.id, role: 'primary', position: 0 }
            }
        }
    });
    const release = await models.release.create({
        data: {
            title: 'Recovery Release',
            releaseDate: '2026',
            releaseType: 'album',
            cover: '',
            ArtistCredit: {
                create: { artistId: artist.id, role: 'primary', position: 0 }
            }
        }
    });
    const track = await models.releaseTrack.create({
        data: {
            recordingId: recording.id,
            releaseId: release.id,
            discNumber: 1,
            trackNumber: 1
        }
    });
    const physicalFile = await models.physicalFile.create({
        data: {
            releaseTrackId: track.id,
            filePath: `recovery/${randomUUID()}.wav`,
            contentHash: committed
                ? createTrackContentHash(newData)
                : createTrackContentHash(oldData),
            hashVersion: TRACK_CONTENT_HASH_VERSION,
            durationMs: 100,
            codec: 'wav',
            container: 'wav',
            bitrate: 128_000,
            sampleRate: 8_000,
            syncStatus: 'active'
        }
    });
    const operation = await models.musicMetadataOperation.create({
        data: {
            id: randomUUID(),
            selectedReleaseTrackStableId: track.stableId,
            status,
            previewToken: 'preview',
            requestedJson: '{}',
            oldRelationalJson: '{}',
            expectedRevisionsJson: '{}',
            committedAt: committed ? new Date() : null,
            Target: {
                create: {
                    physicalFileStableId: physicalFile.stableId,
                    releaseTrackStableId: track.stableId,
                    filePath,
                    status: 'replaced',
                    oldContentHash: createTrackContentHash(oldData),
                    newContentHash: createTrackContentHash(newData),
                    hashVersion: TRACK_CONTENT_HASH_VERSION,
                    oldFileSizeBytes: BigInt(oldData.length),
                    newFileSizeBytes: BigInt(newData.length),
                    stagingPath,
                    backupPath
                }
            }
        }
    });

    return {
        directory,
        filePath,
        stagingPath,
        backupPath,
        oldData,
        newData,
        physicalFile,
        operation
    };
};

describe('metadata operation startup recovery', () => {
    const directories: string[] = [];

    afterEach(() => {
        while (directories.length) {
            fs.rmSync(directories.pop()!, { recursive: true, force: true });
        }
    });

    it('restores every original for an operation that did not commit', async () => {
        const fixture = await createTarget({ status: 'replaced', committed: false });
        directories.push(fixture.directory);

        const recovered = await recoverMusicMetadataOperationJournal(fixture.operation.id);

        expect(recovered).toMatchObject({ status: 'rolled-back' });
        expect(fs.readFileSync(fixture.filePath)).toEqual(fixture.oldData);
        expect(fs.existsSync(fixture.backupPath)).toBe(false);
        expect(fs.existsSync(fixture.stagingPath)).toBe(false);
        expect(recovered?.Target).toEqual([
            expect.objectContaining({ status: 'restored' })
        ]);
    });

    it('restores the previous stale state after a transient rollback failure', async () => {
        const fixture = await createTarget({ status: 'replaced', committed: false });
        directories.push(fixture.directory);
        await models.physicalFile.update({
            where: { id: fixture.physicalFile.id },
            data: {
                metadataSyncStatus: 'stale',
                metadataSyncError: 'The original tags were stale.'
            }
        });
        await models.musicMetadataOperationTarget.updateMany({
            where: { operationId: fixture.operation.id },
            data: {
                oldMetadataSyncStatus: 'stale',
                oldMetadataSyncError: 'The original tags were stale.'
            }
        });

        const failed = await recoverMusicMetadataOperationJournal(fixture.operation.id, {
            restoreFile: async () => {
                throw new Error('temporary restore failure');
            },
            discardFile: async () => undefined,
            validateCleanupFile: async () => undefined,
            cleanupFile: async () => undefined
        });

        expect(failed).toMatchObject({ status: 'reconcile-required' });
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: fixture.physicalFile.id }
        })).resolves.toMatchObject({ metadataSyncStatus: 'reconcile-required' });

        const recovered = await recoverMusicMetadataOperationJournal(fixture.operation.id);

        expect(recovered).toMatchObject({ status: 'rolled-back' });
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: fixture.physicalFile.id }
        })).resolves.toMatchObject({
            metadataSyncStatus: 'stale',
            metadataSyncError: 'The original tags were stale.'
        });
    });

    it('recovers staged targets when a later target failed before producing file evidence', async () => {
        const fixture = await createTarget({ status: 'replaced', committed: false });
        directories.push(fixture.directory);
        await models.musicMetadataOperationTarget.create({
            data: {
                operationId: fixture.operation.id,
                physicalFileStableId: randomUUID(),
                releaseTrackStableId: fixture.operation.selectedReleaseTrackStableId,
                filePath: path.join(fixture.directory, 'untouched.wav'),
                status: 'failed',
                oldContentHash: createTrackContentHash(Buffer.from('untouched audio')),
                hashVersion: TRACK_CONTENT_HASH_VERSION,
                errorCode: 'AUDIO_METADATA_WRITE_FAILED',
                errorMessage: 'Staging failed before the source file changed.'
            }
        });

        const recovered = await recoverMusicMetadataOperationJournal(fixture.operation.id);

        expect(recovered).toMatchObject({ status: 'rolled-back' });
        expect(fs.readFileSync(fixture.filePath)).toEqual(fixture.oldData);
        expect(recovered?.Target).toEqual([
            expect.objectContaining({ status: 'restored' }),
            expect.objectContaining({
                status: 'restored',
                errorCode: null,
                errorMessage: null
            })
        ]);
    });

    it('removes an unjournaled stage left by a crash during preparation', async () => {
        const fixture = await createTarget({ status: 'replaced', committed: false });
        directories.push(fixture.directory);
        fs.writeFileSync(fixture.filePath, fixture.oldData);
        fs.rmSync(fixture.backupPath, { force: true });
        fs.writeFileSync(fixture.stagingPath, fixture.newData);
        await models.musicMetadataOperationTarget.updateMany({
            where: { operationId: fixture.operation.id },
            data: {
                status: 'pending',
                newContentHash: null,
                newFileSizeBytes: null
            }
        });

        const recovered = await recoverMusicMetadataOperationJournal(fixture.operation.id);

        expect(recovered).toMatchObject({ status: 'rolled-back' });
        expect(fs.readFileSync(fixture.filePath)).toEqual(fixture.oldData);
        expect(fs.existsSync(fixture.stagingPath)).toBe(false);
        expect(recovered?.Target).toEqual([
            expect.objectContaining({ status: 'restored' })
        ]);
    });

    it('finishes cleanup only after a committed file matches the new hash', async () => {
        const fixture = await createTarget({ status: 'committed', committed: true });
        directories.push(fixture.directory);

        await expect(recoverMusicMetadataOperationJournals()).resolves.toBeGreaterThanOrEqual(1);
        const recovered = await models.musicMetadataOperation.findUniqueOrThrow({
            where: { id: fixture.operation.id },
            include: { Target: true }
        });

        expect(recovered).toMatchObject({ status: 'cleaned' });
        expect(recovered.Target).toEqual([
            expect.objectContaining({ status: 'cleaned' })
        ]);
        expect(fs.readFileSync(fixture.filePath)).toEqual(fixture.newData);
        expect(fs.existsSync(fixture.backupPath)).toBe(false);
    });

    it('retains backup evidence and blocks later edits when a committed file mismatches', async () => {
        const fixture = await createTarget({ status: 'committed', committed: true });
        directories.push(fixture.directory);
        fs.writeFileSync(fixture.filePath, 'unexpected external data');

        const recovered = await recoverMusicMetadataOperationJournal(fixture.operation.id);

        expect(recovered).toMatchObject({ status: 'reconcile-required' });
        expect(fs.existsSync(fixture.backupPath)).toBe(true);
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: fixture.physicalFile.id }
        })).resolves.toMatchObject({
            metadataSyncStatus: 'reconcile-required',
            metadataRevision: 1
        });

        fs.writeFileSync(fixture.filePath, fixture.newData);
        const cleaned = await recoverMusicMetadataOperationJournal(fixture.operation.id);

        expect(cleaned).toMatchObject({ status: 'cleaned' });
        expect(fs.existsSync(fixture.backupPath)).toBe(false);
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: fixture.physicalFile.id }
        })).resolves.toMatchObject({
            metadataSyncStatus: 'current',
            metadataSyncError: null,
            metadataRevision: 2
        });
    });

    it('validates all committed targets before cleaning the first backup', async () => {
        const fixture = await createTarget({ status: 'committed', committed: true });
        directories.push(fixture.directory);
        const secondFilePath = path.join(fixture.directory, 'track-two.wav');
        const secondStagingPath = path.join(
            fixture.directory,
            '.track-two.operation.ocean-wave.stage'
        );
        const secondBackupPath = path.join(
            fixture.directory,
            '.track-two.operation.ocean-wave.backup'
        );
        const secondOldData = Buffer.from('second original audio');
        const secondNewData = Buffer.from('second rewritten audio');
        fs.writeFileSync(secondFilePath, 'unexpected second target data');
        fs.writeFileSync(secondBackupPath, secondOldData);
        const secondPhysicalFile = await models.physicalFile.create({
            data: {
                releaseTrackId: fixture.physicalFile.releaseTrackId,
                filePath: `recovery/${randomUUID()}.wav`,
                contentHash: createTrackContentHash(secondNewData),
                hashVersion: TRACK_CONTENT_HASH_VERSION,
                durationMs: 100,
                codec: 'wav',
                container: 'wav',
                bitrate: 128_000,
                sampleRate: 8_000,
                syncStatus: 'active'
            }
        });
        await models.musicMetadataOperationTarget.create({
            data: {
                operationId: fixture.operation.id,
                physicalFileStableId: secondPhysicalFile.stableId,
                releaseTrackStableId: fixture.operation.selectedReleaseTrackStableId,
                filePath: secondFilePath,
                status: 'replaced',
                oldContentHash: createTrackContentHash(secondOldData),
                newContentHash: createTrackContentHash(secondNewData),
                hashVersion: TRACK_CONTENT_HASH_VERSION,
                oldFileSizeBytes: BigInt(secondOldData.length),
                newFileSizeBytes: BigInt(secondNewData.length),
                stagingPath: secondStagingPath,
                backupPath: secondBackupPath
            }
        });

        const recovered = await recoverMusicMetadataOperationJournal(fixture.operation.id);

        expect(recovered).toMatchObject({ status: 'reconcile-required' });
        expect(fs.existsSync(fixture.backupPath)).toBe(true);
        expect(fs.existsSync(secondBackupPath)).toBe(true);
        expect(recovered?.Target[0]).not.toMatchObject({ status: 'cleaned' });
    });
});
