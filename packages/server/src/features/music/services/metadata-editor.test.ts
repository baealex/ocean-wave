import fs from 'fs';
import os from 'os';
import path from 'path';

import models from '~/models';
import type {
    PreparedTrackMetadataFile,
    WritableTrackMetadata
} from '~/modules/audio-metadata-writer';
import { resolveMusicFilePath } from '~/modules/storage-paths';

jest.mock('~/modules/music-metadata', () => ({
    parseBuffer: jest.fn(async () => ({
        format: {
            container: 'WAVE',
            codec: 'PCM',
            bitrate: 128_000,
            duration: 0.1,
            sampleRate: 8_000
        },
        common: {
            title: 'File Track',
            artist: 'File Artist',
            artists: ['File Artist'],
            album: 'File Album',
            albumartist: 'File Album Artist',
            albumartists: ['File Album Artist'],
            year: 2024,
            track: { no: 1, of: null },
            disk: { no: 1, of: 1 },
            genre: ['File Genre']
        },
        native: {}
    }))
}));

import { createTrackContentHash, TRACK_CONTENT_HASH_VERSION } from '~/modules/track-hash';

import {
    listMusicMetadataOperations,
    MusicMetadataServiceError,
    previewMusicMetadataUpdate,
    recoverMusicMetadataOperation,
    retryMusicMetadataOperation,
    type UpdateMusicMetadataInput,
    updateMusicMetadata
} from './metadata-editor';

const createSilentWav = () => {
    const sampleRate = 8_000;
    const sampleCount = 800;
    const dataSize = sampleCount * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
};

const createAudioFile = (relativeFilePath: string) => {
    const filePath = resolveMusicFilePath(relativeFilePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, createSilentWav());
    return filePath;
};

const createMusic = async (suffix: string) => {
    const relativeFilePath = `library/${suffix}.wav`;
    createAudioFile(relativeFilePath);
    const artist = await models.artist.create({
        data: { name: `Original Artist ${suffix}` }
    });
    const album = await models.album.create({
        data: {
            name: `Original Album ${suffix}`,
            cover: '',
            publishedYear: '2025',
            artistId: artist.id
        }
    });

    const music = await models.music.create({
        data: {
            name: `Original Track ${suffix}`,
            artistId: artist.id,
            albumId: album.id,
            filePath: relativeFilePath,
            duration: 0.1,
            codec: 'wav',
            container: 'wav',
            bitrate: 128_000,
            sampleRate: 8_000,
            trackNumber: 1
        }
    });

    return {
        ...music,
        Artist: artist,
        Album: {
            ...album,
            Artist: artist
        }
    };
};

const inputFor = (
    music: Awaited<ReturnType<typeof createMusic>>,
    overrides: Partial<UpdateMusicMetadataInput> = {}
): UpdateMusicMetadataInput => ({
    id: music.id.toString(),
    title: music.name,
    titleOverride: null,
    recordingVersionTitle: null,
    recordingArtistCredits: [{
        name: music.Artist?.name ?? '',
        role: 'PRIMARY',
        joinPhrase: ''
    }],
    releaseTrackArtistCredits: null,
    album: music.Album?.name ?? '',
    albumArtistCredits: [{
        name: music.Album?.Artist?.name ?? '',
        role: 'PRIMARY',
        joinPhrase: ''
    }],
    publishedYear: music.Album?.publishedYear ?? '2025',
    releaseType: 'UNKNOWN',
    totalDiscs: 1,
    releaseVersionTitle: null,
    discNumber: 1,
    trackNumber: music.trackNumber,
    genres: [],
    ...overrides
});

const createFileDependencies = ({
    failPrepareAt,
    failInstallAt
}: {
    failPrepareAt?: number;
    failInstallAt?: number;
} = {}) => {
    let prepareCount = 0;
    let installCount = 0;

    return {
        prepareFile: async (
            filePath: string,
            metadata: WritableTrackMetadata,
            operationId: string
        ): Promise<PreparedTrackMetadataFile> => {
            prepareCount += 1;

            if (prepareCount === failPrepareAt) {
                throw new Error(`prepare failed at ${prepareCount}`);
            }

            const original = fs.readFileSync(filePath);
            const extension = path.extname(filePath);
            const stagingPath = `${filePath}.${operationId}.stage${extension}`;
            const backupPath = `${filePath}.${operationId}.backup${extension}`;
            const rewritten = Buffer.concat([
                original,
                Buffer.from(JSON.stringify({
                    title: metadata.title,
                    album: metadata.album,
                    releaseType: metadata.releaseType
                }))
            ]);
            fs.writeFileSync(stagingPath, rewritten);

            return {
                filePath,
                stagingPath,
                backupPath,
                oldContentHash: createTrackContentHash(original),
                newContentHash: createTrackContentHash(rewritten),
                hashVersion: TRACK_CONTENT_HASH_VERSION,
                oldFileSizeBytes: BigInt(original.length),
                newFileSizeBytes: BigInt(rewritten.length)
            };
        },
        installFile: async (prepared: PreparedTrackMetadataFile) => {
            installCount += 1;
            fs.renameSync(prepared.filePath, prepared.backupPath);

            if (installCount === failInstallAt) {
                throw new Error(`install failed at ${installCount}`);
            }

            fs.renameSync(prepared.stagingPath, prepared.filePath);
        },
        restoreFile: async (prepared: PreparedTrackMetadataFile) => {
            if (fs.existsSync(prepared.backupPath)) {
                fs.rmSync(prepared.filePath, { force: true });
                fs.renameSync(prepared.backupPath, prepared.filePath);
            }
        },
        discardFile: async (prepared: Pick<
        PreparedTrackMetadataFile,
        'stagingPath' | 'backupPath' | 'filePath'
        >) => {
            fs.rmSync(prepared.stagingPath, { force: true });
        },
        validateCleanupFile: async () => undefined,
        cleanupFile: async (prepared: PreparedTrackMetadataFile) => {
            fs.rmSync(prepared.backupPath, { force: true });
            fs.rmSync(prepared.stagingPath, { force: true });
        }
    };
};

describe('relational music metadata editor', () => {
    const tempDirectories: string[] = [];
    const originalMusicPath = process.env.OCEAN_WAVE_MUSIC_PATH;

    beforeEach(() => {
        const musicPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-metadata-library-'));
        tempDirectories.push(musicPath);
        process.env.OCEAN_WAVE_MUSIC_PATH = musicPath;
    });

    afterEach(() => {
        if (originalMusicPath === undefined) {
            delete process.env.OCEAN_WAVE_MUSIC_PATH;
        } else {
            process.env.OCEAN_WAVE_MUSIC_PATH = originalMusicPath;
        }

        while (tempDirectories.length > 0) {
            fs.rmSync(tempDirectories.pop()!, { recursive: true, force: true });
        }
    });

    it('shows owner-level and per-file changes before applying them', async () => {
        const music = await createMusic('preview');
        const input = inputFor(music, {
            title: 'Previewed Track',
            titleOverride: 'Appearance Title',
            recordingArtistCredits: [{
                name: `Original Artist preview`,
                role: 'PRIMARY',
                creditedName: 'Preview Alias',
                joinPhrase: ''
            }],
            releaseType: 'EP',
            totalDiscs: 2,
            discNumber: 2,
            trackNumber: 4
        });
        const preview = await previewMusicMetadataUpdate(input);

        expect(preview.issues).toEqual([]);
        expect(preview.hasChanges).toBe(true);
        expect(preview.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                field: 'recording.title',
                storage: 'FILE_AND_DATABASE'
            }),
            expect.objectContaining({
                field: 'recording.artistPresentation',
                storage: 'DATABASE_ONLY',
                after: expect.stringContaining('Preview Alias')
            }),
            expect.objectContaining({ field: 'release.type' }),
            expect.objectContaining({ field: 'releaseTrack.discNumber' })
        ]));
        expect(preview.files).toEqual([
            expect.objectContaining({
                filePath: music.filePath,
                willWrite: true,
                changes: expect.arrayContaining([
                    expect.objectContaining({
                        field: 'file.title',
                        owner: 'RELEASE_TRACK'
                    }),
                    expect.objectContaining({ field: 'file.releaseType' })
                ])
            })
        ]);
        expect(preview.preservedPolicies.join(' ')).toContain('artwork');
    });

    it('attributes repaired printed tags to their release appearance overrides', async () => {
        const music = await createMusic('appearance-owner');
        await models.releaseTrack.update({
            where: { id: music.releaseTrackId },
            data: { titleOverride: 'Printed Title' }
        });
        await models.artistCredit.create({
            data: {
                artistId: music.artistId,
                releaseTrackId: music.releaseTrackId,
                role: 'primary',
                position: 0
            }
        });
        const preview = await previewMusicMetadataUpdate(inputFor(music, {
            titleOverride: 'Printed Title',
            releaseTrackArtistCredits: [{
                name: music.Artist.name,
                role: 'PRIMARY',
                joinPhrase: ''
            }]
        }));

        expect(preview.files[0]?.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'file.title', owner: 'RELEASE_TRACK' }),
            expect.objectContaining({ field: 'file.artists', owner: 'RELEASE_TRACK' })
        ]));
    });

    it('labels a same-name appearance credit override as database-only', async () => {
        const music = await createMusic('appearance-presentation');
        const preview = await previewMusicMetadataUpdate(inputFor(music, {
            releaseTrackArtistCredits: [{
                name: music.Artist.name,
                role: 'PRIMARY',
                creditedName: 'Printed Alias',
                joinPhrase: ''
            }]
        }));

        expect(preview.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                field: 'releaseTrack.artistPresentation',
                storage: 'DATABASE_ONLY',
                after: expect.stringContaining('Printed Alias')
            })
        ]));
        expect(preview.changes).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'releaseTrack.artistNames' })
        ]));
    });

    it('allows total discs to follow a lower disc number on the edited appearance', async () => {
        const music = await createMusic('lower-disc-count');
        await models.releaseTrack.update({
            where: { id: music.releaseTrackId },
            data: { discNumber: 3 }
        });
        await models.release.update({
            where: { id: music.albumId },
            data: { totalDiscs: 3 }
        });

        await expect(previewMusicMetadataUpdate(inputFor(music, {
            discNumber: 1,
            totalDiscs: 1
        }))).resolves.toMatchObject({
            hasChanges: true,
            changes: expect.arrayContaining([
                expect.objectContaining({ field: 'release.totalDiscs' }),
                expect.objectContaining({ field: 'releaseTrack.discNumber' })
            ])
        });
    });

    it('updates every active file in the affected recording and release atomically', async () => {
        const music = await createMusic('multi-file');
        const alternatePath = 'library/multi-file-alternate.wav';
        createAudioFile(alternatePath);
        await models.physicalFile.create({
            data: {
                releaseTrackId: music.releaseTrackId,
                filePath: alternatePath,
                durationMs: 100,
                codec: 'wav',
                container: 'wav',
                bitrate: 128_000,
                sampleRate: 8_000,
                syncStatus: 'active'
            }
        });
        const otherAlbum = await models.album.create({
            data: {
                name: 'Other Release',
                cover: '',
                publishedYear: '2024',
                artistId: music.artistId
            }
        });
        const appearance = await models.releaseTrack.create({
            data: {
                recordingId: music.recordingId,
                releaseId: otherAlbum.id,
                discNumber: 1,
                trackNumber: 2
            }
        });
        const appearancePath = 'library/multi-file-appearance.wav';
        createAudioFile(appearancePath);
        await models.physicalFile.create({
            data: {
                releaseTrackId: appearance.id,
                filePath: appearancePath,
                durationMs: 100,
                codec: 'wav',
                container: 'wav',
                bitrate: 128_000,
                sampleRate: 8_000,
                syncStatus: 'active'
            }
        });
        const input = inputFor(music, {
            title: 'Edited Recording',
            recordingVersionTitle: 'Live',
            recordingArtistCredits: [
                { name: 'Edited Artist', role: 'PRIMARY', joinPhrase: ' feat. ' },
                { name: 'Guest Artist', role: 'FEATURED', joinPhrase: '' }
            ],
            album: 'Edited Release',
            albumArtistCredits: [{
                name: 'Various Artists',
                role: 'PRIMARY',
                joinPhrase: ''
            }],
            publishedYear: '2026-07-21',
            releaseType: 'LIVE',
            totalDiscs: 2,
            releaseVersionTitle: '2026 Remaster',
            discNumber: 2,
            trackNumber: 7,
            genres: ['Ambient', 'Electronic']
        });
        const preview = await previewMusicMetadataUpdate(input);
        const result = await updateMusicMetadata(
            input,
            preview.token,
            createFileDependencies()
        );

        expect(result).toMatchObject({ status: 'cleaned', music: { name: 'Edited Recording' } });
        expect(result.targets).toHaveLength(3);
        expect(result.targets.every(target => target.status === 'cleaned')).toBe(true);

        const recording = await models.recording.findUniqueOrThrow({
            where: { id: music.recordingId },
            include: {
                ArtistCredit: { include: { Artist: true }, orderBy: { position: 'asc' } },
                RecordingGenre: { include: { Genre: true } }
            }
        });
        const release = await models.release.findUniqueOrThrow({
            where: { id: music.albumId },
            include: { ArtistCredit: { include: { Artist: true } } }
        });
        const track = await models.releaseTrack.findUniqueOrThrow({
            where: { id: music.releaseTrackId }
        });
        const files = await models.physicalFile.findMany({
            where: { id: { in: [
                music.physicalFileId,
                ...(await models.physicalFile.findMany({
                    where: { filePath: { in: [alternatePath, appearancePath] } },
                    select: { id: true }
                })).map(file => file.id)
            ] } }
        });

        expect(recording).toMatchObject({
            title: 'Edited Recording',
            versionTitle: 'Live',
            metadataRevision: 1
        });
        expect(recording.ArtistCredit.map(credit => credit.Artist.name))
            .toEqual(['Edited Artist', 'Guest Artist']);
        expect(recording.RecordingGenre.map(({ Genre }) => Genre.name).sort())
            .toEqual(['Ambient', 'Electronic']);
        expect(release).toMatchObject({
            title: 'Edited Release',
            releaseDate: '2026-07-21',
            releaseType: 'live',
            totalDiscs: 2,
            metadataRevision: 1
        });
        expect(track).toMatchObject({
            versionTitle: '2026 Remaster',
            discNumber: 2,
            trackNumber: 7,
            metadataRevision: 1
        });
        expect(files).toHaveLength(3);
        expect(files.every(file => (
            file.metadataRevision === 1
            && file.metadataSyncStatus === 'current'
            && file.contentHash
        ))).toBe(true);
        await expect(listMusicMetadataOperations(appearance.id.toString()))
            .resolves.toEqual(expect.arrayContaining([
                expect.objectContaining({ operationId: result.operationId })
            ]));
    });

    it('keeps originals and relational rows unchanged when staging one target fails', async () => {
        const music = await createMusic('prepare-failure');
        const secondPath = 'library/prepare-failure-second.wav';
        createAudioFile(secondPath);
        await models.physicalFile.create({
            data: {
                releaseTrackId: music.releaseTrackId,
                filePath: secondPath,
                durationMs: 100,
                codec: 'wav',
                container: 'wav',
                bitrate: 128_000,
                sampleRate: 8_000,
                syncStatus: 'active'
            }
        });
        const firstData = fs.readFileSync(resolveMusicFilePath(music.filePath));
        const secondData = fs.readFileSync(resolveMusicFilePath(secondPath));
        const input = inputFor(music, { title: 'Should Not Commit' });
        const preview = await previewMusicMetadataUpdate(input);
        const result = await updateMusicMetadata(
            input,
            preview.token,
            createFileDependencies({ failPrepareAt: 2 })
        );

        expect(result).toMatchObject({ status: 'rolled-back', retryable: true });
        expect(result.targets).toEqual(expect.arrayContaining([
            expect.objectContaining({ status: 'restored' }),
            expect.objectContaining({ status: 'failed' })
        ]));
        expect(fs.readFileSync(resolveMusicFilePath(music.filePath))).toEqual(firstData);
        expect(fs.readFileSync(resolveMusicFilePath(secondPath))).toEqual(secondData);
        await expect(models.recording.findUniqueOrThrow({ where: { id: music.recordingId } }))
            .resolves.toMatchObject({ title: music.name, metadataRevision: 0 });
    });

    it('restores every replaced file if a later installation fails', async () => {
        const music = await createMusic('install-failure');
        const secondPath = 'library/install-failure-second.wav';
        createAudioFile(secondPath);
        await models.physicalFile.create({
            data: {
                releaseTrackId: music.releaseTrackId,
                filePath: secondPath,
                durationMs: 100,
                codec: 'wav',
                container: 'wav',
                bitrate: 128_000,
                sampleRate: 8_000,
                syncStatus: 'active'
            }
        });
        const originals = [music.filePath, secondPath].map(filePath => (
            fs.readFileSync(resolveMusicFilePath(filePath))
        ));
        const input = inputFor(music, { title: 'Rollback Recording' });
        const preview = await previewMusicMetadataUpdate(input);
        const result = await updateMusicMetadata(
            input,
            preview.token,
            createFileDependencies({ failInstallAt: 2 })
        );

        expect(result).toMatchObject({ status: 'rolled-back', retryable: true });
        expect(fs.readFileSync(resolveMusicFilePath(music.filePath))).toEqual(originals[0]);
        expect(fs.readFileSync(resolveMusicFilePath(secondPath))).toEqual(originals[1]);
        await expect(models.recording.findUniqueOrThrow({ where: { id: music.recordingId } }))
            .resolves.toMatchObject({ title: music.name, metadataRevision: 0 });
    });

    it('validates every committed target before deleting any recovery evidence', async () => {
        const music = await createMusic('cleanup-validation');
        const secondPath = 'library/cleanup-validation-second.wav';
        createAudioFile(secondPath);
        await models.physicalFile.create({
            data: {
                releaseTrackId: music.releaseTrackId,
                filePath: secondPath,
                durationMs: 100,
                codec: 'wav',
                container: 'wav',
                bitrate: 128_000,
                sampleRate: 8_000,
                syncStatus: 'active'
            }
        });
        const input = inputFor(music, { title: 'Committed But Uncleaned' });
        const preview = await previewMusicMetadataUpdate(input);
        const dependencies = createFileDependencies();
        let validationCount = 0;
        let cleanupCount = 0;
        dependencies.validateCleanupFile = async () => {
            validationCount += 1;
            if (validationCount === 2) throw new Error('second target changed');
        };
        const cleanupFile = dependencies.cleanupFile;
        dependencies.cleanupFile = async (prepared) => {
            cleanupCount += 1;
            return cleanupFile(prepared);
        };

        const result = await updateMusicMetadata(input, preview.token, dependencies);
        const targets = await models.musicMetadataOperationTarget.findMany({
            where: { operationId: result.operationId },
            orderBy: { id: 'asc' }
        });

        expect(result.status).toBe('reconcile-required');
        expect(validationCount).toBe(2);
        expect(cleanupCount).toBe(0);
        expect(targets).toHaveLength(2);
        expect(targets.every(target => (
            target.backupPath !== null && fs.existsSync(target.backupPath)
        ))).toBe(true);
        expect(targets[1]).toMatchObject({ status: 'reconcile-required' });
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { stableId: targets[1].physicalFileStableId }
        })).resolves.toMatchObject({ metadataSyncStatus: 'reconcile-required' });
    });

    it('rejects a stale preview before creating an operation journal', async () => {
        const music = await createMusic('stale-preview');
        const input = inputFor(music, { title: 'Stale Edit' });
        const preview = await previewMusicMetadataUpdate(input);
        await models.recording.update({
            where: { id: music.recordingId },
            data: { metadataRevision: { increment: 1 } }
        });

        await expect(updateMusicMetadata(
            input,
            preview.token,
            createFileDependencies()
        )).rejects.toEqual(expect.objectContaining<Partial<MusicMetadataServiceError>>({
            code: 'MUSIC_METADATA_PREVIEW_STALE'
        }));
    });

    it('rolls back when a file changes between planning and preparation', async () => {
        const music = await createMusic('prepare-race');
        const input = inputFor(music, { title: 'Race-safe Edit' });
        const preview = await previewMusicMetadataUpdate(input);
        const dependencies = createFileDependencies();
        const prepareFile = dependencies.prepareFile;
        let changedData: Buffer | null = null;

        dependencies.prepareFile = async (...args: Parameters<typeof prepareFile>) => {
            fs.appendFileSync(args[0], 'external change');
            changedData = fs.readFileSync(args[0]);
            return prepareFile(...args);
        };

        const result = await updateMusicMetadata(
            input,
            preview.token,
            dependencies
        );

        expect(result).toMatchObject({
            status: 'rolled-back',
            errorCode: 'AUDIO_METADATA_SOURCE_CHANGED'
        });
        expect(fs.readFileSync(resolveMusicFilePath(music.filePath))).toEqual(changedData);
        await expect(models.recording.findUniqueOrThrow({ where: { id: music.recordingId } }))
            .resolves.toMatchObject({ title: music.name, metadataRevision: 0 });
    });

    it('marks unavailable targets stale without allowing their tags to replace canonical metadata', async () => {
        const music = await createMusic('missing-target');
        const missingPath = 'library/missing-target-second.wav';
        const missingFile = await models.physicalFile.create({
            data: {
                releaseTrackId: music.releaseTrackId,
                filePath: missingPath,
                durationMs: 100,
                codec: 'wav',
                container: 'wav',
                bitrate: 128_000,
                sampleRate: 8_000,
                legacyMetadataOverride: JSON.stringify({ title: 'Legacy Missing Title' }),
                syncStatus: 'missing',
                missingSinceAt: new Date()
            }
        });
        const input = inputFor(music, { title: 'Canonical While Missing' });
        const preview = await previewMusicMetadataUpdate(input);

        expect(preview.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'MUSIC_FILE_METADATA_STALE',
                blocking: false,
                fileId: missingFile.id.toString()
            })
        ]));
        const result = await updateMusicMetadata(
            input,
            preview.token,
            createFileDependencies()
        );

        expect(result.status).toBe('cleaned');
        await expect(models.physicalFile.findUniqueOrThrow({ where: { id: missingFile.id } }))
            .resolves.toMatchObject({
                legacyMetadataOverride: null,
                metadataSyncStatus: 'stale',
                metadataRevision: 1
            });
    });

    it('does not mark an unavailable title-override appearance stale for a recording title edit', async () => {
        const music = await createMusic('missing-override');
        const otherRelease = await models.album.create({
            data: {
                name: 'Printed Release',
                cover: '',
                publishedYear: '2024',
                artistId: music.artistId
            }
        });
        const appearance = await models.releaseTrack.create({
            data: {
                recordingId: music.recordingId,
                releaseId: otherRelease.id,
                titleOverride: 'Printed Title',
                discNumber: 1,
                trackNumber: 1
            }
        });
        const missingFile = await models.physicalFile.create({
            data: {
                releaseTrackId: appearance.id,
                filePath: 'library/missing-override-appearance.wav',
                durationMs: 100,
                codec: 'wav',
                container: 'wav',
                bitrate: 128_000,
                sampleRate: 8_000,
                syncStatus: 'missing',
                missingSinceAt: new Date()
            }
        });
        const input = inputFor(music, { title: 'Edited Recording Title' });
        const preview = await previewMusicMetadataUpdate(input);

        expect(preview.issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ fileId: missingFile.id.toString() })
        ]));
        const result = await updateMusicMetadata(
            input,
            preview.token,
            createFileDependencies()
        );
        expect(result.status).toBe('cleaned');
        await expect(models.physicalFile.findUniqueOrThrow({ where: { id: missingFile.id } }))
            .resolves.toMatchObject({ metadataSyncStatus: 'current', metadataRevision: 0 });
    });

    it('re-previews and retries a safely failed operation', async () => {
        const music = await createMusic('retry');
        const input = inputFor(music, { title: 'Retried Track' });
        const preview = await previewMusicMetadataUpdate(input);
        const failed = await updateMusicMetadata(
            input,
            preview.token,
            createFileDependencies({ failPrepareAt: 1 })
        );
        const retried = await retryMusicMetadataOperation(
            failed.operationId,
            createFileDependencies()
        );

        expect(failed.status).toBe('failed');
        expect(retried).toMatchObject({
            status: 'cleaned',
            music: { name: 'Retried Track' }
        });
        await expect(models.musicMetadataOperation.findUniqueOrThrow({
            where: { id: retried.operationId }
        })).resolves.toMatchObject({ retryOfId: failed.operationId });
    });

    it('retries after successful recovery rebases only the restored target revision', async () => {
        const music = await createMusic('recovered-retry');
        const input = inputFor(music, { title: 'Recovered Retry Track' });
        const preview = await previewMusicMetadataUpdate(input);
        const failingDependencies = createFileDependencies({ failInstallAt: 1 });
        failingDependencies.restoreFile = async () => {
            throw new Error('restore temporarily unavailable');
        };
        const failed = await updateMusicMetadata(
            input,
            preview.token,
            failingDependencies
        );

        expect(failed.status).toBe('reconcile-required');
        const recovered = await recoverMusicMetadataOperation(failed.operationId);
        expect(recovered).toMatchObject({ status: 'rolled-back', retryable: true });
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: music.physicalFileId }
        })).resolves.toMatchObject({ metadataRevision: 2, metadataSyncStatus: 'current' });

        const retried = await retryMusicMetadataOperation(
            failed.operationId,
            createFileDependencies()
        );

        expect(retried).toMatchObject({
            status: 'cleaned',
            music: { name: 'Recovered Retry Track' }
        });
    });

    it('rejects retry when a protected owner changed after the failed operation', async () => {
        const music = await createMusic('stale-retry');
        const input = inputFor(music, { title: 'Old Requested Title' });
        const preview = await previewMusicMetadataUpdate(input);
        const failed = await updateMusicMetadata(
            input,
            preview.token,
            createFileDependencies({ failPrepareAt: 1 })
        );
        await models.recording.update({
            where: { id: music.recordingId },
            data: {
                title: 'Newer Title',
                metadataRevision: { increment: 1 }
            }
        });

        await expect(retryMusicMetadataOperation(
            failed.operationId,
            createFileDependencies()
        )).rejects.toMatchObject({ code: 'MUSIC_METADATA_PREVIEW_STALE' });
        await expect(models.recording.findUniqueOrThrow({
            where: { id: music.recordingId }
        })).resolves.toMatchObject({ title: 'Newer Title' });
    });

    it('rejects retry when a target file changed after the failed operation', async () => {
        const music = await createMusic('stale-file-retry');
        const input = inputFor(music, { title: 'Old Requested Title' });
        const preview = await previewMusicMetadataUpdate(input);
        const failed = await updateMusicMetadata(
            input,
            preview.token,
            createFileDependencies({ failPrepareAt: 1 })
        );
        fs.appendFileSync(resolveMusicFilePath(music.filePath), 'external change');

        await expect(retryMusicMetadataOperation(
            failed.operationId,
            createFileDependencies()
        )).rejects.toMatchObject({ code: 'MUSIC_METADATA_PREVIEW_STALE' });
        await expect(models.recording.findUniqueOrThrow({
            where: { id: music.recordingId }
        })).resolves.toMatchObject({ title: music.name, metadataRevision: 0 });
    });
});
