import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseBuffer } from '../modules/music-metadata';

import models from '~/models';
import { musicResolvers } from '~/features/music/graphql';
import { albumResolvers } from '~/schema/album';
import { artistResolvers } from '~/schema/artist';

jest.mock('../modules/file', () => ({ walk: jest.fn() }));

jest.mock('../modules/music-metadata', () => ({ parseBuffer: jest.fn() }));

jest.mock('sharp', () => {
    return jest.fn(() => ({
        resize: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockImplementation(async (outputPath: string) => {
            fs.writeFileSync(outputPath, 'resized-artwork');
        })
    }));
});

import { walk } from '../modules/file';
import { resolveCachePath } from '../modules/storage-paths';
import { TRACK_CONTENT_HASH_VERSION, createTrackContentHash } from '../modules/track-hash';
import { SYNC_REPORT_KIND, SYNC_REPORT_STATUS } from '../modules/sync-report';
import { TRACK_SYNC_STATUS } from '../modules/track-identity';
import { syncMusic } from './sync';

const walkMock = jest.mocked(walk);
const parseBufferMock = jest.mocked(parseBuffer);

const restoreEnvValue = (key: string, value: string | undefined) => {
    if (value === undefined) {
        delete process.env[key];
        return;
    }

    process.env[key] = value;
};

const createTrackFixture = (overrides?: {
    title?: string;
    artist?: string;
    artists?: string[];
    album?: string;
    albumArtist?: string;
    albumArtists?: string[];
    year?: string;
    trackNumber?: number;
    discNumber?: number;
    totalDiscs?: number;
    releaseTypes?: string[];
    compilation?: boolean;
    fingerprint?: string;
    picture?: string;
    subtitle?: string;
}) => {
    const title = overrides?.title ?? 'Track A';
    const artist = overrides?.artist ?? 'Artist A';
    const artists = overrides?.artists?.join('~') ?? '';
    const album = overrides?.album ?? 'Album A';
    const albumArtist = overrides?.albumArtist ?? '';
    const albumArtists = overrides?.albumArtists?.join('~') ?? '';
    const year = overrides?.year ?? '2026';
    const trackNumber = overrides?.trackNumber ?? 1;
    const discNumber = overrides?.discNumber?.toString() ?? '';
    const totalDiscs = overrides?.totalDiscs?.toString() ?? '';
    const releaseTypes = overrides?.releaseTypes?.join('~') ?? '';
    const compilation = overrides?.compilation ? 'true' : 'false';
    const fingerprint = overrides?.fingerprint ?? 'fingerprint-a';
    const picture = overrides?.picture ?? '';
    const subtitle = overrides?.subtitle ?? '';

    return `title=${title}|artist=${artist}|artists=${artists}|album=${album}|albumArtist=${albumArtist}|albumArtists=${albumArtists}|year=${year}|track=${trackNumber}|disc=${discNumber}|totalDiscs=${totalDiscs}|releaseTypes=${releaseTypes}|compilation=${compilation}|fingerprint=${fingerprint}|picture=${picture}|subtitle=${subtitle}`;
};

const createTempTrackFile = ({
    directory,
    relativePath,
    contents
}: {
    directory: string;
    relativePath: string;
    contents: string;
}) => {
    const absolutePath = path.join(directory, relativePath);

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);

    return absolutePath;
};

const createExistingMusic = async ({
    filePath,
    contents,
    syncStatus = TRACK_SYNC_STATUS.active,
    withHash = true
}: {
    filePath: string;
    contents: string;
    syncStatus?: typeof TRACK_SYNC_STATUS[keyof typeof TRACK_SYNC_STATUS];
    withHash?: boolean;
}) => {
    const artist = await models.artist.create({ data: { name: 'Artist A' } });
    const album = await models.album.create({
        data: {
            name: 'Album A',
            cover: '',
            publishedYear: '2026',
            artistId: artist.id
        }
    });

    return models.music.create({
        data: {
            name: 'Track A',
            artistId: artist.id,
            albumId: album.id,
            filePath,
            contentHash: withHash ? createTrackContentHash(Buffer.from(contents)) : null,
            hashVersion: withHash ? TRACK_CONTENT_HASH_VERSION : null,
            duration: 180,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320,
            sampleRate: 44100,
            trackNumber: 1,
            syncStatus
        }
    });
};

describe('sync music identity', () => {
    const tempDirectories: string[] = [];
    const workspaceDirectories: string[] = [];
    const originalCachePath = process.env.OCEAN_WAVE_CACHE_PATH;
    const originalMusicPath = process.env.OCEAN_WAVE_MUSIC_PATH;

    beforeEach(async () => {
        jest.restoreAllMocks();
        walkMock.mockReset();
        parseBufferMock.mockReset();
        parseBufferMock.mockImplementation(async (data) => {
            const entries = Object.fromEntries(
                data.toString().split('|').map((entry) => entry.split('='))
            );

            return {
                format: {
                    container: 'mp3',
                    codec: 'mp3',
                    bitrate: 320,
                    duration: 180,
                    sampleRate: 44100
                },
                common: {
                    title: entries.title,
                    artist: entries.artist,
                    artists: entries.artists?.split('~').filter(Boolean),
                    album: entries.album,
                    albumartist: entries.albumArtist || undefined,
                    albumartists: entries.albumArtists?.split('~').filter(Boolean),
                    picture: entries.picture
                        ? [
                            {
                                data: Buffer.from(entries.picture),
                                format: 'image/jpeg'
                            }
                        ]
                        : [],
                    genre: [],
                    year: Number(entries.year),
                    track: { no: entries.track ? Number(entries.track) : null },
                    disk: {
                        no: entries.disc ? Number(entries.disc) : null,
                        of: entries.totalDiscs ? Number(entries.totalDiscs) : null
                    },
                    releasetype: entries.releaseTypes?.split('~').filter(Boolean),
                    compilation: entries.compilation === 'true',
                    subtitle: entries.subtitle ? [entries.subtitle] : undefined
                }
            } as never;
        });

        const workspaceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-workspace-'));
        workspaceDirectories.push(workspaceDirectory);
        process.env.OCEAN_WAVE_CACHE_PATH = path.join(workspaceDirectory, 'cache');

        await models.playbackEvent.deleteMany();
        await models.syncReportItem.deleteMany();
        await models.syncReport.deleteMany();
        await models.playlistMusic.deleteMany();
        await models.playlist.deleteMany();
        await models.musicLike.deleteMany();
        await models.musicHate.deleteMany();
        await models.music.deleteMany();
        await models.album.deleteMany();
        await models.artist.deleteMany();
        await models.genre.deleteMany();
    });

    afterEach(async () => {
        await models.playbackEvent.deleteMany();
        await models.syncReportItem.deleteMany();
        await models.syncReport.deleteMany();
        await models.playlistMusic.deleteMany();
        await models.playlist.deleteMany();
        await models.musicLike.deleteMany();
        await models.musicHate.deleteMany();
        await models.music.deleteMany();
        await models.album.deleteMany();
        await models.artist.deleteMany();
        await models.genre.deleteMany();

        restoreEnvValue('OCEAN_WAVE_CACHE_PATH', originalCachePath);
        restoreEnvValue('OCEAN_WAVE_MUSIC_PATH', originalMusicPath);

        while (tempDirectories.length > 0) {
            fs.rmSync(tempDirectories.pop()!, {
                recursive: true,
                force: true
            });
        }

        while (workspaceDirectories.length > 0) {
            fs.rmSync(workspaceDirectories.pop()!, {
                recursive: true,
                force: true
            });
        }
    });

    it('ignores current and legacy metadata journal files during scans', async () => {
        const contents = createTrackFixture({ fingerprint: 'journal-filter' });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-journal-'));
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;
        const trackPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/track.mp3',
            contents
        });
        const legacyStagePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/.track.operation.ocean-wave.stage.mp3',
            contents
        });
        const legacyBackupPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/.track.operation.ocean-wave.backup.mp3',
            contents
        });
        const currentStagePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/.track.operation.ocean-wave.stage',
            contents
        });
        walkMock.mockResolvedValue([
            legacyStagePath,
            trackPath,
            currentStagePath,
            legacyBackupPath
        ]);

        const result = await syncMusic({ emit: jest.fn() } as never);

        expect(result).toMatchObject({ scannedFiles: 1, indexedFiles: 1 });
        expect(result?.created).toHaveLength(1);
        expect(parseBufferMock).toHaveBeenCalledTimes(1);
        await expect(models.physicalFile.findMany()).resolves.toEqual([
            expect.objectContaining({ filePath: 'library/track.mp3' })
        ]);
    });

    it('moves a track to a new path without losing linked data', async () => {
        const contents = createTrackFixture();
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-move-'));
        const movedRelativePath = 'library/new/track-a.mp3';
        const previousRelativePath = 'library/old/track-a.mp3';
        const previousPath = path.join(tempDirectory, previousRelativePath);
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;

        const movedPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: movedRelativePath,
            contents
        });
        const existingMusic = await createExistingMusic({
            filePath: previousPath,
            contents
        });
        const playlist = await models.playlist.create({ data: { name: 'Favorites' } });
        await models.musicLike.create({ data: { musicId: existingMusic.id } });
        await models.playlistMusic.create({
            data: {
                playlistId: playlist.id,
                musicId: existingMusic.id
            }
        });

        walkMock.mockResolvedValue([movedPath]);

        const result = await syncMusic({ emit: jest.fn() } as never);
        const movedMusic = await models.music.findUniqueOrThrow({ where: { id: existingMusic.id } });
        const like = await models.musicLike.findFirst({ where: { musicId: existingMusic.id } });
        const playlistLink = await models.playlistMusic.findFirst({ where: { musicId: existingMusic.id } });
        const report = await models.syncReport.findFirstOrThrow({
            orderBy: { createdAt: 'desc' },
            include: { Item: true }
        });

        expect(result).toMatchObject({
            moved: [{
                musicId: existingMusic.id,
                filePath: movedRelativePath
            }]
        });
        expect(movedMusic.filePath).toBe(movedRelativePath);
        expect(movedMusic.syncStatus).toBe(TRACK_SYNC_STATUS.active);
        expect(movedMusic.missingSinceAt).toBeNull();
        expect(like).not.toBeNull();
        expect(playlistLink).not.toBeNull();
        expect(report).toMatchObject({
            status: SYNC_REPORT_STATUS.success,
            movedCount: 1,
            createdCount: 0,
            duplicateCount: 0,
            missingCount: 0
        });
        expect(report.Item).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: SYNC_REPORT_KIND.moved,
                musicId: existingMusic.id,
                musicName: movedMusic.name,
                filePath: movedRelativePath,
                previousFilePath: previousRelativePath
            })
        ]));
    });

    it('keeps canonical metadata when a stale missing file returns at a new path', async () => {
        const contents = createTrackFixture({ fingerprint: 'stale-move' });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-stale-move-'));
        const previousPath = path.join(tempDirectory, 'library/old/track-a.mp3');
        const movedRelativePath = 'library/new/track-a.mp3';
        const movedPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: movedRelativePath,
            contents
        });
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;
        const music = await createExistingMusic({ filePath: previousPath, contents });
        await models.recording.update({
            where: { id: music.recordingId },
            data: {
                title: 'Canonical Track',
                metadataRevision: { increment: 1 }
            }
        });
        await models.physicalFile.update({
            where: { id: music.physicalFileId },
            data: {
                syncStatus: TRACK_SYNC_STATUS.missing,
                missingSinceAt: new Date(),
                metadataSyncStatus: 'stale',
                metadataSyncError: 'Canonical metadata changed while unavailable.'
            }
        });
        walkMock.mockResolvedValue([movedPath]);

        const result = await syncMusic({ emit: jest.fn() } as never);

        expect(result).toMatchObject({
            moved: [expect.objectContaining({ filePath: movedRelativePath })],
            reconcile: [expect.objectContaining({
                physicalFileId: music.physicalFileId,
                filePath: movedRelativePath
            })]
        });
        await expect(models.recording.findUniqueOrThrow({
            where: { id: music.recordingId }
        })).resolves.toMatchObject({ title: 'Canonical Track' });
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: music.physicalFileId }
        })).resolves.toMatchObject({
            filePath: movedRelativePath,
            syncStatus: TRACK_SYNC_STATUS.active,
            metadataSyncStatus: 'stale'
        });
    });

    it('attaches an exact duplicate to the same release track while keeping it hidden', async () => {
        const contents = createTrackFixture({ fingerprint: 'duplicate-hash' });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-duplicate-'));
        const originalRelativePath = 'library/original/track-a.mp3';
        const copyRelativePath = 'library/copy/track-a.mp3';
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;

        const originalPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: originalRelativePath,
            contents
        });
        const copyPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: copyRelativePath,
            contents
        });
        const originalMusic = await createExistingMusic({
            filePath: originalPath,
            contents,
            withHash: false
        });

        walkMock.mockResolvedValue([originalPath, copyPath]);

        const result = await syncMusic({ emit: jest.fn() } as never);
        const musics = await models.music.findMany({ orderBy: { id: 'asc' } });
        const physicalFiles = await models.physicalFile.findMany({
            where: { releaseTrackId: originalMusic.releaseTrackId },
            orderBy: { id: 'asc' }
        });
        const visibleMusics = await (musicResolvers.Query as { allMusics: () => Promise<{ id: number }[]> }).allMusics();
        const report = await models.syncReport.findFirstOrThrow({
            orderBy: { createdAt: 'desc' },
            include: { Item: true }
        });

        expect(result).toMatchObject({
            duplicate: [{
                musicId: originalMusic.id,
                filePath: copyRelativePath
            }]
        });
        expect(musics).toHaveLength(1);
        expect(musics[0]).toMatchObject({
            id: originalMusic.id,
            filePath: originalRelativePath,
            syncStatus: TRACK_SYNC_STATUS.active
        });
        expect(musics[0].contentHash).toBe(createTrackContentHash(Buffer.from(contents)));
        expect(physicalFiles).toHaveLength(2);
        expect(physicalFiles[1]).toMatchObject({
            filePath: copyRelativePath,
            syncStatus: TRACK_SYNC_STATUS.duplicate
        });
        expect(visibleMusics.map((music) => music.id)).toEqual([originalMusic.id]);
        expect(report).toMatchObject({
            status: SYNC_REPORT_STATUS.success,
            createdCount: 0,
            movedCount: 0,
            duplicateCount: 1,
            missingCount: 0
        });
        expect(report.Item).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: SYNC_REPORT_KIND.duplicate,
                filePath: copyRelativePath,
                musicName: musics[0].name
            })
        ]));

        await syncMusic({ emit: jest.fn() }, true);

        await expect(models.physicalFile.findMany({
            where: { releaseTrackId: originalMusic.releaseTrackId },
            orderBy: { id: 'asc' },
            select: { syncStatus: true, isExplicitlyActivated: true }
        })).resolves.toEqual([
            { syncStatus: TRACK_SYNC_STATUS.active, isExplicitlyActivated: false },
            { syncStatus: TRACK_SYNC_STATUS.duplicate, isExplicitlyActivated: false }
        ]);
    });

    it('keeps manually grouped alternate files attached across later rescans', async () => {
        const originalContents = createTrackFixture({ fingerprint: 'group-original' });
        const alternateContents = createTrackFixture({ fingerprint: 'group-alternate' });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-group-'));
        const originalPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/signal.flac',
            contents: originalContents
        });
        const alternatePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/signal.mp3',
            contents: alternateContents
        });
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;

        const music = await createExistingMusic({
            filePath: originalPath,
            contents: originalContents
        });
        await models.physicalFile.create({
            data: {
                releaseTrackId: music.releaseTrackId,
                filePath: 'library/signal.mp3',
                contentHash: createTrackContentHash(Buffer.from(alternateContents)),
                hashVersion: TRACK_CONTENT_HASH_VERSION,
                durationMs: 180_000,
                codec: 'mp3',
                container: 'mp3',
                bitrate: 320_000,
                sampleRate: 44_100,
                syncStatus: TRACK_SYNC_STATUS.active
            }
        });
        walkMock.mockResolvedValue([originalPath, alternatePath]);

        const result = await syncMusic({ emit: jest.fn() } as never);

        expect(result).toMatchObject({ created: [], moved: [], duplicate: [] });
        await expect(models.releaseTrack.count()).resolves.toBe(1);
        await expect(models.physicalFile.findMany({
            where: { releaseTrackId: music.releaseTrackId },
            orderBy: { id: 'asc' }
        })).resolves.toEqual([
            expect.objectContaining({ syncStatus: TRACK_SYNC_STATUS.active }),
            expect.objectContaining({
                filePath: 'library/signal.mp3',
                syncStatus: TRACK_SYNC_STATUS.active
            })
        ]);
    });

    it('repairs missing cached album artwork for unchanged tracks during normal sync', async () => {
        const contents = createTrackFixture({
            fingerprint: 'cover-repair-hash',
            picture: 'cover-art-a'
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-cover-repair-'));
        const existingRelativePath = 'library/track-a.mp3';
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;

        const existingPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: existingRelativePath,
            contents
        });
        const existingMusic = await createExistingMusic({
            filePath: existingPath,
            contents
        });

        await models.album.update({
            where: { id: existingMusic.albumId },
            data: { cover: `/cache/resized/${existingMusic.albumId}.jpg` }
        });

        walkMock.mockResolvedValue([existingPath]);

        const result = await syncMusic({ emit: jest.fn() } as never);
        const album = await models.album.findUniqueOrThrow({ where: { id: existingMusic.albumId } });
        const repairedMusic = await models.music.findUniqueOrThrow({ where: { id: existingMusic.id } });

        expect(result).toMatchObject({
            created: [],
            moved: [],
            duplicate: [],
            missing: []
        });
        expect(repairedMusic.filePath).toBe(existingRelativePath);
        expect(parseBufferMock).toHaveBeenCalledTimes(1);
        expect(album.cover).toBe(`/cache/resized/${existingMusic.albumId}.jpg`);
        expect(fs.existsSync(path.join(resolveCachePath(), `${existingMusic.albumId}.jpg`))).toBe(true);
        expect(fs.existsSync(path.join(resolveCachePath(), 'resized', `${existingMusic.albumId}.jpg`))).toBe(true);
    });

    it('keeps manually edited metadata during a force sync', async () => {
        const contents = createTrackFixture({
            title: 'File Track',
            artist: 'File Artist',
            album: 'File Album',
            year: '2024',
            trackNumber: 2,
            fingerprint: 'manual-metadata-hash'
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-manual-metadata-'));
        const relativePath = 'library/manual-track.mp3';
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;

        const filePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath,
            contents
        });
        const music = await createExistingMusic({ filePath, contents });
        await models.music.update({
            where: { id: music.id },
            data: {
                metadataOverride: JSON.stringify({
                    title: 'Manual Track',
                    artist: 'Manual Artist',
                    album: 'Manual Album',
                    albumArtist: 'Manual Album Artist',
                    year: '2026',
                    trackNumber: 7,
                    genres: ['Ambient']
                })
            }
        });
        walkMock.mockResolvedValue([filePath]);

        await syncMusic({ emit: jest.fn() }, true);

        const updated = await models.music.findUniqueOrThrow({
            where: { id: music.id },
            include: {
                Artist: true,
                Album: { include: { Artist: true } },
                Recording: {
                    include: {
                        RecordingGenre: { include: { Genre: true } }
                    }
                }
            }
        });
        expect(updated).toMatchObject({
            name: 'Manual Track',
            trackNumber: 7,
            Artist: { name: 'Manual Artist' },
            Album: {
                name: 'Manual Album',
                publishedYear: '2026',
                Artist: { name: 'Manual Album Artist' }
            }
        });
        expect(updated.Recording.RecordingGenre
            .map(({ Genre: genre }) => genre.name)).toEqual(['Ambient']);
    });

    it('reports external version evidence without overwriting canonical metadata', async () => {
        const contents = createTrackFixture({
            title: 'Signal',
            subtitle: 'Live at the Harbor',
            fingerprint: 'legacy-live-version'
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-version-'));
        const filePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/signal-live.mp3',
            contents
        });
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;
        const music = await createExistingMusic({ filePath, contents });
        walkMock.mockResolvedValue([filePath]);

        const result = await syncMusic({ emit: jest.fn() }, true);

        await expect(models.recording.findUniqueOrThrow({
            where: { id: music.recordingId }
        })).resolves.toMatchObject({ versionTitle: null });
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: music.physicalFileId }
        })).resolves.toMatchObject({
            tagSnapshotJson: expect.stringContaining('Live at the Harbor'),
            metadataSyncStatus: 'stale'
        });
        expect(result?.reconcile).toEqual([
            expect.objectContaining({ physicalFileId: music.physicalFileId })
        ]);
    });

    it('does not clear an unresolved operation recovery during a forced scan', async () => {
        const contents = createTrackFixture({
            albumArtist: 'Artist A',
            albumArtists: ['Artist A'],
            fingerprint: 'recovery-blocked'
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-recovery-'));
        const filePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/recovery-blocked.mp3',
            contents
        });
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;
        const music = await createExistingMusic({ filePath, contents });
        await models.physicalFile.update({
            where: { id: music.physicalFileId },
            data: {
                metadataSyncStatus: 'reconcile-required',
                metadataSyncError: 'Restore the retained audio backup.'
            }
        });
        walkMock.mockResolvedValue([filePath]);

        const result = await syncMusic({ emit: jest.fn() }, true);

        expect(result?.reconcile).toEqual([
            expect.objectContaining({ physicalFileId: music.physicalFileId })
        ]);
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: music.physicalFileId }
        })).resolves.toMatchObject({
            metadataSyncStatus: 'reconcile-required',
            metadataSyncError: 'Restore the retained audio backup.'
        });
    });

    it('clears a stale marker when forced-scan tags match inferred canonical credits', async () => {
        const contents = createTrackFixture({ fingerprint: 'matching-canonical-tags' });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-current-'));
        const filePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/current.mp3',
            contents
        });
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;
        const music = await createExistingMusic({ filePath, contents });
        await models.physicalFile.update({
            where: { id: music.physicalFileId },
            data: {
                metadataSyncStatus: 'stale',
                metadataSyncError: 'Previous mismatch'
            }
        });
        walkMock.mockResolvedValue([filePath]);

        const result = await syncMusic({ emit: jest.fn() }, true);

        expect(result?.reconcile).toEqual([]);
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: music.physicalFileId }
        })).resolves.toMatchObject({
            metadataSyncStatus: 'current',
            metadataSyncError: null
        });
    });

    it('imports release type and orders duplicate track numbers across discs', async () => {
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-discs-'));
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;
        const discTwoPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/disc-2-track-1.mp3',
            contents: createTrackFixture({
                title: 'Second Disc Opener',
                discNumber: 2,
                totalDiscs: 2,
                releaseTypes: ['Album', 'Live'],
                fingerprint: 'disc-two'
            })
        });
        const discOnePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/disc-1-track-1.mp3',
            contents: createTrackFixture({
                title: 'First Disc Opener',
                discNumber: 1,
                totalDiscs: 2,
                releaseTypes: ['Album', 'Live'],
                fingerprint: 'disc-one'
            })
        });
        walkMock.mockResolvedValue([discTwoPath, discOnePath]);

        await syncMusic({ emit: jest.fn() });

        const release = await models.release.findFirstOrThrow({
            where: { title: 'Album A' }
        });
        const positions = await models.releaseTrack.findMany({
            where: { releaseId: release.id },
            include: { Recording: true }
        });
        const album = await models.album.findUniqueOrThrow({ where: { id: release.id } });
        const albumArtist = await models.artist.findFirstOrThrow({ where: { name: 'Artist A' } });
        const orderedMusics = await (albumResolvers.Album as {
            musics: (album: { id: number }) => Promise<Array<{ id: number; name: string }>>;
        }).musics(album);
        const discNumber = await (musicResolvers.Music as {
            discNumber: (music: { releaseTrackId: number }) => Promise<number | null>;
        }).discNumber(orderedMusics[1] as never);
        const artistReleaseResolvers = artistResolvers.Artist as {
            albums: (artist: typeof albumArtist) => Promise<Array<{ id: number }>>;
            appearsOn: (artist: typeof albumArtist) => Promise<Array<{ id: number }>>;
        };

        expect(release).toMatchObject({
            releaseType: 'live',
            totalDiscs: 2
        });
        expect(positions.map(position => ({
            title: position.Recording.title,
            discNumber: position.discNumber,
            trackNumber: position.trackNumber
        }))).toEqual(expect.arrayContaining([
            { title: 'First Disc Opener', discNumber: 1, trackNumber: 1 },
            { title: 'Second Disc Opener', discNumber: 2, trackNumber: 1 }
        ]));
        expect(orderedMusics.map(({ name }) => name)).toEqual([
            'First Disc Opener',
            'Second Disc Opener'
        ]);
        expect(discNumber).toBe(2);
        await expect(artistReleaseResolvers.albums(albumArtist)).resolves.toEqual([
            expect.objectContaining({ id: release.id })
        ]);
        await expect(artistReleaseResolvers.appearsOn(albumArtist)).resolves.toEqual([]);
    });

    it('indexes ordered track credits separately from a compilation album artist', async () => {
        const contents = createTrackFixture({
            title: 'Collaboration',
            artist: 'Artist A feat. Artist B',
            artists: ['Artist A', 'Artist B'],
            album: 'Compilation',
            albumArtist: 'Various Artists',
            albumArtists: ['Various Artists'],
            releaseTypes: ['Compilation'],
            compilation: true,
            fingerprint: 'multi-artist-hash'
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-credits-'));
        const relativePath = 'library/collaboration.mp3';
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;
        const filePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath,
            contents
        });
        walkMock.mockResolvedValue([filePath]);

        await syncMusic({ emit: jest.fn() });

        const music = await models.music.findFirstOrThrow({
            where: { name: 'Collaboration' }
        });
        const recordingCredits = await models.artistCredit.findMany({
            where: { recordingId: music.recordingId },
            include: { Artist: true },
            orderBy: { position: 'asc' }
        });
        const releaseCredits = await models.artistCredit.findMany({
            where: { releaseId: music.albumId },
            include: { Artist: true },
            orderBy: { position: 'asc' }
        });
        const guestArtist = await models.artist.findFirstOrThrow({
            where: { name: 'Artist B' }
        });
        const primaryArtist = await models.artist.findFirstOrThrow({
            where: { name: 'Artist A' }
        });
        const compilationArtist = await models.artist.findFirstOrThrow({
            where: { name: 'Various Artists' }
        });
        const guestMusics = await (artistResolvers.Artist as {
            musics: (artist: typeof guestArtist) => Promise<Array<{ id: number }>>;
        }).musics(guestArtist);
        const creditedArtists = await (artistResolvers.Query as {
            allArtists: () => Promise<Array<{ name: string }>>;
        }).allArtists();
        const artistReleaseResolvers = artistResolvers.Artist as {
            albums: (artist: typeof primaryArtist) => Promise<Array<{ id: number }>>;
            appearsOn: (artist: typeof primaryArtist) => Promise<Array<{ id: number }>>;
        };

        expect(recordingCredits).toEqual([
            expect.objectContaining({
                role: 'primary',
                joinPhrase: ' feat. ',
                Artist: expect.objectContaining({ name: 'Artist A' })
            }),
            expect.objectContaining({
                role: 'featured',
                joinPhrase: '',
                Artist: expect.objectContaining({ name: 'Artist B' })
            })
        ]);
        expect(releaseCredits).toEqual([
            expect.objectContaining({
                role: 'primary',
                Artist: expect.objectContaining({ name: 'Various Artists' })
            })
        ]);
        expect(guestMusics.map(({ id }) => id)).toContain(music.id);
        expect(creditedArtists.map(({ name }) => name)).toEqual(expect.arrayContaining([
            'Artist A',
            'Artist B',
            'Various Artists'
        ]));
        await expect(artistReleaseResolvers.albums(primaryArtist)).resolves.toEqual([]);
        await expect(artistReleaseResolvers.appearsOn(primaryArtist)).resolves.toEqual([
            expect.objectContaining({ id: music.albumId })
        ]);
        await expect(artistReleaseResolvers.appearsOn(guestArtist)).resolves.toEqual([
            expect.objectContaining({ id: music.albumId })
        ]);
        await expect(artistReleaseResolvers.albums(compilationArtist)).resolves.toEqual([
            expect.objectContaining({ id: music.albumId })
        ]);
        await expect(artistReleaseResolvers.appearsOn(compilationArtist)).resolves.toEqual([]);

        fs.writeFileSync(filePath, createTrackFixture({
            title: 'Collaboration',
            artist: 'Artist A; Artist B',
            artists: ['Artist A', 'Artist B'],
            album: 'Compilation',
            albumArtist: 'Various Artists',
            albumArtists: ['Various Artists'],
            releaseTypes: ['Compilation'],
            compilation: true,
            fingerprint: 'multi-artist-hash'
        }));
        await syncMusic({ emit: jest.fn() }, true);

        await expect(models.artistCredit.findMany({
            where: { recordingId: music.recordingId },
            orderBy: { position: 'asc' }
        })).resolves.toEqual([
            expect.objectContaining({ role: 'primary', joinPhrase: ' feat. ' }),
            expect.objectContaining({ role: 'featured', joinPhrase: '' })
        ]);
    });

    it('does not overwrite custom album artwork during a force sync', async () => {
        const contents = createTrackFixture({
            fingerprint: 'manual-cover-hash',
            picture: 'embedded-cover'
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-manual-cover-'));
        const relativePath = 'library/manual-cover.mp3';
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;

        const filePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath,
            contents
        });
        const music = await createExistingMusic({ filePath, contents });
        const coverFileName = `${music.albumId}.jpg`;
        const cachePath = resolveCachePath();
        fs.mkdirSync(path.join(cachePath, 'resized'), { recursive: true });
        fs.writeFileSync(path.join(cachePath, coverFileName), 'manual-cover');
        fs.writeFileSync(path.join(cachePath, 'resized', coverFileName), 'manual-cover-resized');
        await models.album.update({
            where: { id: music.albumId },
            data: {
                cover: `/cache/resized/${coverFileName}`,
                isCoverCustom: true
            }
        });
        walkMock.mockResolvedValue([filePath]);

        await syncMusic({ emit: jest.fn() }, true);

        expect(fs.readFileSync(path.join(cachePath, coverFileName), 'utf8')).toBe('manual-cover');
        expect(fs.readFileSync(path.join(cachePath, 'resized', coverFileName), 'utf8'))
            .toBe('manual-cover-resized');
        await expect(models.album.findUniqueOrThrow({ where: { id: music.albumId } }))
            .resolves.toMatchObject({ isCoverCustom: true });
    });

    it('marks unseen tracks as missing instead of deleting them', async () => {
        const contents = createTrackFixture({ fingerprint: 'missing-hash' });
        const existingMusic = await createExistingMusic({
            filePath: '/tmp/library/missing-track.mp3',
            contents
        });
        const playlist = await models.playlist.create({ data: { name: 'Archive' } });
        await models.musicLike.create({ data: { musicId: existingMusic.id } });
        await models.playlistMusic.create({
            data: {
                playlistId: playlist.id,
                musicId: existingMusic.id
            }
        });

        walkMock.mockResolvedValue([]);

        const result = await syncMusic({ emit: jest.fn() } as never);
        const missingMusic = await models.music.findUniqueOrThrow({ where: { id: existingMusic.id } });
        const visibleMusics = await (musicResolvers.Query as { allMusics: () => Promise<{ id: number }[]> }).allMusics();
        const report = await models.syncReport.findFirstOrThrow({
            orderBy: { createdAt: 'desc' },
            include: { Item: true }
        });

        expect(result).toMatchObject({
            missing: [{
                musicId: existingMusic.id,
                filePath: existingMusic.filePath
            }]
        });
        expect(missingMusic.syncStatus).toBe(TRACK_SYNC_STATUS.missing);
        expect(missingMusic.missingSinceAt).not.toBeNull();
        expect(await models.musicLike.count({ where: { musicId: existingMusic.id } })).toBe(1);
        expect(await models.playlistMusic.count({ where: { musicId: existingMusic.id } })).toBe(1);
        expect(visibleMusics).toHaveLength(0);
        expect(report).toMatchObject({
            status: SYNC_REPORT_STATUS.success,
            missingCount: 1
        });
        expect(report.Item).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: SYNC_REPORT_KIND.missing,
                musicId: existingMusic.id,
                filePath: existingMusic.filePath,
                musicName: existingMusic.name
            })
        ]));
    });

    it('reports a returning stale file for explicit metadata reconciliation', async () => {
        const contents = createTrackFixture({ fingerprint: 'returning-stale-hash' });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-sync-stale-return-'));
        const relativePath = 'library/returning-stale.mp3';
        tempDirectories.push(tempDirectory);
        process.env.OCEAN_WAVE_MUSIC_PATH = tempDirectory;
        const filePath = createTempTrackFile({
            directory: tempDirectory,
            relativePath,
            contents
        });
        const music = await createExistingMusic({ filePath, contents });
        await models.physicalFile.update({
            where: { id: music.physicalFileId },
            data: {
                syncStatus: TRACK_SYNC_STATUS.missing,
                missingSinceAt: new Date(),
                metadataSyncStatus: 'stale',
                metadataSyncError: 'Canonical metadata changed while unavailable.'
            }
        });
        walkMock.mockResolvedValue([filePath]);

        const result = await syncMusic({ emit: jest.fn() } as never);
        const report = await models.syncReport.findFirstOrThrow({
            orderBy: { createdAt: 'desc' },
            include: { Item: true }
        });

        expect(result?.reconcile).toEqual([
            expect.objectContaining({
                musicId: music.id,
                physicalFileId: music.physicalFileId,
                filePath: relativePath
            })
        ]);
        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: music.physicalFileId }
        })).resolves.toMatchObject({
            syncStatus: TRACK_SYNC_STATUS.active,
            metadataSyncStatus: 'stale'
        });
        expect(report).toMatchObject({ reconcileCount: 1 });
        expect(report.Item).toEqual([
            expect.objectContaining({
                kind: SYNC_REPORT_KIND.reconcile,
                musicId: music.physicalFileId,
                filePath: relativePath
            })
        ]);
    });
});
