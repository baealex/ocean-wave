import fs from 'fs';
import path from 'path';
import type { Socket } from 'socket.io';
import models, {
    type Album,
    type Genre,
    type Music,
    type PhysicalFile
} from '~/models';
import {
    createCompatibilityMusicInTransaction,
    updateCompatibilityMusicInTransaction
} from '../models/music-compatibility';
import {
    hasHealthyAlbumCoverCache,
    syncAlbumCoverCache
} from '../modules/album-cover-cache';
import {
    type ArtistCreditValue,
    findOrCreateArtist,
    getEffectiveMusicArtistCredits,
    preserveArtistCreditPresentation,
    replaceArtistCredits,
    resolveArtistCreditArtists
} from '../modules/artist-credits';
import { walk } from '../modules/file';
import { isTrackMetadataOperationFilePath } from '../modules/audio-metadata-writer';
import { withLibraryMetadataLock } from '../modules/library-metadata-lock';
import {
    normalizeMusicFilePath,
    resolveCachePath,
    resolveMusicPath
} from '../modules/storage-paths';
import {
    SYNC_REPORT_KIND,
    SYNC_REPORT_STATUS,
    type SyncReportStatus
} from '../modules/sync-report';
import {
    createTrackContentHash,
    shouldRefreshTrackContentHash,
    TRACK_CONTENT_HASH_VERSION
} from '../modules/track-hash';
import {
    classifyTrackIdentityCandidate,
    deriveTrackPresenceUpdates,
    TRACK_SYNC_STATUS,
    type TrackIdentityRecord,
    type TrackSyncStatus
} from '../modules/track-identity';
import {
    applyMusicMetadataOverride,
    createTrackTagSnapshot,
    type ParsedTrackMetadata,
    parseTrackMetadata
} from '../modules/track-metadata';
import { TRACK_TAG_SNAPSHOT_VERSION } from '../modules/track-version';
import { connectors } from './connectors';

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
    '.mp3',
    '.aac',
    '.wav',
    '.ogg',
    '.flac'
]);

export const SYNC_EVENT = 'sync-music';

interface SyncResultEntry {
    musicId: number;
    physicalFileId: number;
    musicName: string;
    filePath: string;
    previousFilePath: string | null;
}

export interface SyncMusicResult {
    scannedFiles: number;
    indexedFiles: number;
    created: SyncResultEntry[];
    moved: SyncResultEntry[];
    duplicate: SyncResultEntry[];
    missing: SyncResultEntry[];
    reconcile: SyncResultEntry[];
}

const ensureDirectory = (directoryPath: string) => {
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }
};

const emitSyncMessage = (socket: Pick<Socket, 'emit'>, message: string) => {
    socket.emit(SYNC_EVENT, message);
};

const isSupportedAudioFile = (filePath: string) => {
    return !isTrackMetadataOperationFilePath(filePath)
        && SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
};

const toTrackIdentityRecord = (file: PhysicalFile): TrackIdentityRecord => {
    return {
        id: file.id,
        releaseTrackId: file.releaseTrackId,
        filePath: normalizeMusicFilePath(file.filePath),
        contentHash: file.contentHash,
        isExplicitlyActivated: file.isExplicitlyActivated,
        lastSeenAt: file.lastSeenAt,
        missingSinceAt: file.missingSinceAt,
        syncStatus: file.syncStatus as TrackSyncStatus
    };
};

const findOrCreateAlbum = async ({
    name,
    publishedYear,
    artistCredits,
    releaseType,
    totalDiscs,
    preferredReleaseId
}: {
    name: string;
    publishedYear: string;
    artistCredits: ArtistCreditValue[];
    releaseType: ParsedTrackMetadata['releaseType'];
    totalDiscs: number | null;
    preferredReleaseId?: number;
}): Promise<Album> => {
    return models.$transaction(async (transaction) => {
        const releaseDate = publishedYear || null;
        const artists = await resolveArtistCreditArtists(transaction, artistCredits);
        const releases = await transaction.release.findMany({
            where: {
                title: name,
                releaseDate
            },
            include: {
                ArtistCredit: {
                    include: { Artist: true },
                    orderBy: [{ position: 'asc' }, { id: 'asc' }]
                }
            }
        });
        const creditMatches = releases.filter((release) => (
            release.ArtistCredit.length === artists.length
            && release.ArtistCredit.every((credit, index) => (
                credit.artistId === artists[index].id
            ))
        ));
        const preferredRelease = creditMatches.find(({ id }) => id === preferredReleaseId);
        const exactTypeRelease = creditMatches.find(candidate => (
            candidate.releaseType === releaseType
        ));
        const unknownTypeRelease = creditMatches.find(candidate => (
            candidate.releaseType === 'unknown'
        ));
        const existingRelease = preferredRelease ?? (
            releaseType === 'unknown'
                ? unknownTypeRelease ?? (creditMatches.length === 1 ? creditMatches[0] : undefined)
                : exactTypeRelease ?? unknownTypeRelease
        );
        const resolvedCredits = existingRelease
            ? preserveArtistCreditPresentation(artistCredits, existingRelease.ArtistCredit)
            : artistCredits;
        const canSeedMissingReleaseMetadata = preferredReleaseId === undefined;
        const nextTotalDiscs = existingRelease
            ? canSeedMissingReleaseMetadata && totalDiscs
                ? Math.max(existingRelease.totalDiscs ?? 0, totalDiscs)
                : existingRelease.totalDiscs
            : totalDiscs;
        const release = existingRelease
            ? await transaction.release.update({
                where: { id: existingRelease.id },
                data: {
                    releaseDate,
                    ...(canSeedMissingReleaseMetadata
                        && existingRelease.releaseType === 'unknown'
                        && releaseType !== 'unknown'
                        ? { releaseType }
                        : {}),
                    ...(nextTotalDiscs !== existingRelease.totalDiscs
                        ? { totalDiscs: nextTotalDiscs }
                        : {})
                }
            })
            : await transaction.release.create({
                data: {
                    title: name,
                    releaseDate,
                    releaseType,
                    totalDiscs,
                    cover: ''
                }
            });

        await replaceArtistCredits(
            transaction,
            { releaseId: release.id },
            resolvedCredits
        );

        return transaction.album.findUniqueOrThrow({ where: { id: release.id } });
    });
};

const findOrCreateGenres = async (genreNames: string[]): Promise<Genre[]> => {
    return Promise.all(genreNames.map(async (name) => {
        const existingGenre = await models.genre.findUnique({ where: { name } });

        if (existingGenre) {
            return existingGenre;
        }

        return models.genre.create({ data: { name } });
    }));
};

const sameStringSet = (left: string[], right: string[]) => (
    [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0')
);

const sameStringList = (left: string[], right: string[]) => left.join('\0') === right.join('\0');

const sameDiscPosition = (canonical: number | null, embedded: number | null) => (
    canonical === embedded || canonical === 1 && embedded === null
);

const getCanonicalFileMetadata = async (releaseTrackId: number) => {
    const track = await models.releaseTrack.findUniqueOrThrow({
        where: { id: releaseTrackId },
        include: {
            ArtistCredit: {
                include: { Artist: true },
                orderBy: [{ position: 'asc' }, { id: 'asc' }]
            },
            Recording: {
                include: {
                    ArtistCredit: {
                        include: { Artist: true },
                        orderBy: [{ position: 'asc' }, { id: 'asc' }]
                    },
                    RecordingGenre: { include: { Genre: true } }
                }
            },
            Release: {
                include: {
                    ArtistCredit: {
                        include: { Artist: true },
                        orderBy: [{ position: 'asc' }, { id: 'asc' }]
                    }
                }
            }
        }
    });
    const toCredits = (rows: typeof track.ArtistCredit) => rows.map(credit => ({
        name: credit.Artist.name,
        role: credit.role,
        creditedName: credit.creditedName,
        joinPhrase: credit.joinPhrase
    }));
    const recordingCredits = toCredits(track.Recording.ArtistCredit);
    const effectiveCredits = track.ArtistCredit.length
        ? toCredits(track.ArtistCredit)
        : recordingCredits;
    const releaseCredits = toCredits(track.Release.ArtistCredit);

    return {
        title: track.titleOverride ?? track.Recording.title,
        artistNames: effectiveCredits.map(credit => credit.name),
        album: track.Release.title,
        albumArtistNames: releaseCredits.map(credit => credit.name),
        releaseDate: track.Release.releaseDate ?? '',
        releaseType: track.Release.releaseType,
        totalDiscs: track.Release.totalDiscs,
        recordingVersionTitle: track.Recording.versionTitle,
        releaseVersionTitle: track.versionTitle,
        discNumber: track.discNumber,
        trackNumber: track.trackNumber,
        genres: track.Recording.RecordingGenre.map(({ Genre }) => Genre.name)
    };
};

const matchesCanonicalFileMetadata = async (
    releaseTrackId: number,
    metadata: ParsedTrackMetadata
) => {
    const canonical = await getCanonicalFileMetadata(releaseTrackId);

    return canonical.title === metadata.title
        && sameStringList(canonical.artistNames, metadata.artistCredits.map(credit => credit.name))
        && canonical.album === metadata.album
        && sameStringList(
            canonical.albumArtistNames,
            (metadata.albumArtistCredits ?? metadata.artistCredits)
                .map(credit => credit.name)
        )
        && canonical.releaseDate === metadata.year
        && canonical.releaseType === metadata.releaseType
        && sameDiscPosition(canonical.totalDiscs, metadata.totalDiscs)
        && canonical.recordingVersionTitle === metadata.recordingVersionTitle
        && canonical.releaseVersionTitle === metadata.releaseVersionTitle
        && sameDiscPosition(canonical.discNumber, metadata.discNumber)
        && canonical.trackNumber === metadata.trackNumber
        && sameStringSet(canonical.genres, metadata.genres);
};

const refreshKnownPhysicalFile = async ({
    file,
    filePath,
    contentHash,
    metadata,
    observedAt,
    fileSizeBytes,
    metadataMatches
}: {
    file: PhysicalFile;
    filePath: string;
    contentHash: string;
    metadata: ParsedTrackMetadata;
    observedAt: Date;
    fileSizeBytes: bigint;
    metadataMatches: boolean;
}) => {
    const recoveryBlocked = file.metadataSyncStatus === 'reconcile-required';

    return models.physicalFile.update({
        where: { id: file.id },
        data: {
            filePath,
            contentHash,
            hashVersion: TRACK_CONTENT_HASH_VERSION,
            durationMs: Math.round(metadata.duration * 1_000),
            codec: metadata.codec,
            container: metadata.container,
            bitrate: Math.round(metadata.bitrate),
            sampleRate: Math.round(metadata.sampleRate),
            fileSizeBytes,
            tagSnapshotJson: createTrackTagSnapshot(metadata),
            tagSnapshotVersion: TRACK_TAG_SNAPSHOT_VERSION,
            lastSeenAt: observedAt,
            missingSinceAt: null,
            syncStatus: TRACK_SYNC_STATUS.active,
            metadataSyncStatus: recoveryBlocked
                ? 'reconcile-required'
                : metadataMatches ? 'current' : 'stale',
            metadataSyncError: recoveryBlocked
                ? file.metadataSyncError
                    ?? 'An unfinished metadata operation must be recovered.'
                : metadataMatches
                    ? null
                    : 'Embedded tags differ from canonical relational metadata.',
            metadataRevision: { increment: 1 }
        }
    });
};

const upsertMusicFromMetadata = async ({
    existingMusic,
    filePath,
    contentHash,
    metadata,
    observedAt,
    syncStatus,
    fileSizeBytes,
    cachePath,
    resizedPath
}: {
    existingMusic?: Music;
    filePath: string;
    contentHash: string;
    metadata: ParsedTrackMetadata;
    observedAt: Date;
    syncStatus: TrackSyncStatus;
    fileSizeBytes: bigint;
    cachePath: string;
    resizedPath: string;
}) => {
    const resolvedMetadata = applyMusicMetadataOverride(
        metadata,
        existingMusic?.metadataOverride
    );
    const existingCredits = existingMusic
        ? await getEffectiveMusicArtistCredits(existingMusic)
        : [];
    const artistCredits = existingCredits.length
        ? preserveArtistCreditPresentation(resolvedMetadata.artistCredits, existingCredits)
        : resolvedMetadata.artistCredits;
    const albumArtistCredits = resolvedMetadata.albumArtistCredits ?? artistCredits;
    const album = await findOrCreateAlbum({
        name: resolvedMetadata.album,
        publishedYear: resolvedMetadata.year,
        artistCredits: albumArtistCredits,
        releaseType: resolvedMetadata.releaseType,
        totalDiscs: resolvedMetadata.totalDiscs,
        preferredReleaseId: existingMusic?.albumId
    });
    const genres = await findOrCreateGenres(resolvedMetadata.genres);

    const coverPath = album.isCoverCustom
        ? album.cover
        : await syncAlbumCoverCache({
            albumId: album.id,
            currentCoverPath: album.cover,
            pictureData: metadata.pictureData,
            cachePath,
            resizedPath
        });

    if (album.cover !== coverPath) {
        await models.album.update({
            where: { id: album.id },
            data: { cover: coverPath }
        });
    }

    return models.$transaction(async (transaction) => {
        const primaryCredit = artistCredits.find(credit => credit.role === 'primary')
            ?? artistCredits[0];
        const primaryArtist = await findOrCreateArtist(transaction, primaryCredit.name);

        if (existingMusic) {
            const canonicalTrack = await transaction.releaseTrack.findUniqueOrThrow({
                where: { id: existingMusic.releaseTrackId },
                select: {
                    versionTitle: true,
                    Recording: { select: { versionTitle: true } }
                }
            });
            const releaseTrackCreditCount = await transaction.artistCredit.count({
                where: { releaseTrackId: existingMusic.releaseTrackId }
            });
            const updatedMusic = await updateCompatibilityMusicInTransaction(
                transaction,
                existingMusic.id,
                {
                    codec: metadata.codec,
                    container: metadata.container,
                    bitrate: metadata.bitrate,
                    sampleRate: metadata.sampleRate,
                    name: resolvedMetadata.title,
                    duration: metadata.duration,
                    discNumber: resolvedMetadata.discNumber,
                    trackNumber: resolvedMetadata.trackNumber,
                    filePath,
                    contentHash,
                    hashVersion: TRACK_CONTENT_HASH_VERSION,
                    tagSnapshotJson: createTrackTagSnapshot(metadata),
                    tagSnapshotVersion: TRACK_TAG_SNAPSHOT_VERSION,
                    fileSizeBytes,
                    lastSeenAt: observedAt,
                    missingSinceAt: null,
                    syncStatus,
                    albumId: album.id,
                    ...(canonicalTrack.Recording.versionTitle === null
                        && resolvedMetadata.recordingVersionTitle
                        ? { recordingVersionTitle: resolvedMetadata.recordingVersionTitle }
                        : {}),
                    ...(canonicalTrack.versionTitle === null
                        && resolvedMetadata.releaseVersionTitle
                        ? { releaseVersionTitle: resolvedMetadata.releaseVersionTitle }
                        : {}),
                    ...(releaseTrackCreditCount ? {} : { artistId: primaryArtist.id }),
                    Genre: { set: genres.map((genre) => ({ id: genre.id })) }
                }
            );

            await replaceArtistCredits(
                transaction,
                releaseTrackCreditCount
                    ? { releaseTrackId: existingMusic.releaseTrackId }
                    : { recordingId: existingMusic.recordingId },
                artistCredits
            );

            return transaction.music.findUniqueOrThrow({ where: { id: updatedMusic.id } });
        }

        const createdMusic = await createCompatibilityMusicInTransaction(transaction, {
            codec: metadata.codec,
            container: metadata.container,
            bitrate: metadata.bitrate,
            sampleRate: metadata.sampleRate,
            name: resolvedMetadata.title,
            duration: metadata.duration,
            discNumber: resolvedMetadata.discNumber,
            trackNumber: resolvedMetadata.trackNumber,
            filePath,
            contentHash,
            hashVersion: TRACK_CONTENT_HASH_VERSION,
            tagSnapshotJson: createTrackTagSnapshot(metadata),
            tagSnapshotVersion: TRACK_TAG_SNAPSHOT_VERSION,
            fileSizeBytes,
            recordingVersionTitle: resolvedMetadata.recordingVersionTitle,
            releaseVersionTitle: resolvedMetadata.releaseVersionTitle,
            lastSeenAt: observedAt,
            missingSinceAt: null,
            syncStatus,
            albumId: album.id,
            artistId: primaryArtist.id,
            Genre: { connect: genres.map((genre) => ({ id: genre.id })) }
        });

        await replaceArtistCredits(
            transaction,
            { recordingId: createdMusic.recordingId },
            artistCredits
        );

        return transaction.music.findUniqueOrThrow({ where: { id: createdMusic.id } });
    });
};

const updatePhysicalFileIdentity = async ({
    file,
    contentHash,
    fileSizeBytes
}: {
    file: PhysicalFile;
    contentHash: string;
    fileSizeBytes: bigint;
}) => {
    return models.physicalFile.update({
        where: { id: file.id },
        data: {
            contentHash,
            hashVersion: TRACK_CONTENT_HASH_VERSION,
            fileSizeBytes
        }
    });
};

const updateGroupedPhysicalFileFromMetadata = ({
    file,
    filePath,
    contentHash,
    metadata,
    observedAt,
    syncStatus,
    fileSizeBytes
}: {
    file: PhysicalFile;
    filePath: string;
    contentHash: string;
    metadata: ParsedTrackMetadata;
    observedAt: Date;
    syncStatus: TrackSyncStatus;
    fileSizeBytes: bigint;
}) => models.physicalFile.update({
    where: { id: file.id },
    data: {
        filePath,
        contentHash,
        hashVersion: TRACK_CONTENT_HASH_VERSION,
        durationMs: Math.round(metadata.duration * 1_000),
        codec: metadata.codec,
        container: metadata.container,
        bitrate: Math.round(metadata.bitrate),
        sampleRate: Math.round(metadata.sampleRate),
        fileSizeBytes,
        tagSnapshotJson: createTrackTagSnapshot(metadata),
        tagSnapshotVersion: TRACK_TAG_SNAPSHOT_VERSION,
        lastSeenAt: observedAt,
        missingSinceAt: null,
        syncStatus
    }
});

const updateLinkedPhysicalFileFromMetadata = async ({
    file,
    music,
    filePath,
    contentHash,
    metadata,
    observedAt,
    syncStatus,
    fileSizeBytes,
    cachePath,
    resizedPath
}: {
    file: PhysicalFile;
    music: Music;
    filePath: string;
    contentHash: string;
    metadata: ParsedTrackMetadata;
    observedAt: Date;
    syncStatus: TrackSyncStatus;
    fileSizeBytes: bigint;
    cachePath: string;
    resizedPath: string;
}) => {
    const fileCount = await models.physicalFile.count({
        where: { releaseTrackId: file.releaseTrackId }
    });

    if (fileCount === 1) {
        const updatedMusic = await upsertMusicFromMetadata({
            existingMusic: music,
            filePath,
            contentHash,
            metadata,
            observedAt,
            syncStatus,
            fileSizeBytes,
            cachePath,
            resizedPath
        });
        const updatedFile = await models.physicalFile.findUniqueOrThrow({
            where: { id: file.id }
        });
        return { music: updatedMusic, file: updatedFile };
    }

    const updatedFile = await updateGroupedPhysicalFileFromMetadata({
        file,
        filePath,
        contentHash,
        metadata,
        observedAt,
        syncStatus,
        fileSizeBytes
    });
    const updatedMusic = await models.music.findUniqueOrThrow({
        where: { id: file.releaseTrackId }
    });
    return { music: updatedMusic, file: updatedFile };
};

const syncLinkedAlbumCoverFromMetadata = async ({
    file,
    music,
    metadata,
    cachePath,
    resizedPath,
    albumById
}: {
    file: PhysicalFile;
    music: Music;
    metadata: ParsedTrackMetadata;
    cachePath: string;
    resizedPath: string;
    albumById: Map<number, Album>;
}) => {
    const fileCount = await models.physicalFile.count({
        where: { releaseTrackId: file.releaseTrackId }
    });
    const album = albumById.get(music.albumId);

    if (fileCount !== 1 || !album || album.isCoverCustom) return;

    const cover = await syncAlbumCoverCache({
        albumId: album.id,
        currentCoverPath: album.cover,
        pictureData: metadata.pictureData,
        cachePath,
        resizedPath
    });

    if (cover !== album.cover) {
        const updatedAlbum = await models.album.update({
            where: { id: album.id },
            data: { cover }
        });
        albumById.set(album.id, updatedAlbum);
    }
};

const repairAlbumCoverCacheIfNeeded = async ({
    music,
    filePath,
    fileData,
    cachePath,
    resizedPath,
    albumById
}: {
    music: Music;
    filePath: string;
    fileData: Buffer | null;
    cachePath: string;
    resizedPath: string;
    albumById: Map<number, Album>;
}) => {
    const album = albumById.get(music.albumId);

    if (!album || album.isCoverCustom || !album.cover || hasHealthyAlbumCoverCache({
        coverPath: album.cover,
        cachePath,
        resizedPath
    })) {
        return;
    }

    const metadata = await parseTrackMetadata(filePath, fileData ?? fs.readFileSync(filePath));
    const coverPath = await syncAlbumCoverCache({
        albumId: album.id,
        currentCoverPath: album.cover,
        pictureData: metadata.pictureData,
        cachePath,
        resizedPath
    });

    albumById.set(album.id, {
        ...album,
        cover: coverPath
    });
};

const flattenSyncReportEntries = (result: SyncMusicResult) => {
    return ([
        [SYNC_REPORT_KIND.created, result.created],
        [SYNC_REPORT_KIND.moved, result.moved],
        [SYNC_REPORT_KIND.duplicate, result.duplicate],
        [SYNC_REPORT_KIND.missing, result.missing],
        [SYNC_REPORT_KIND.reconcile, result.reconcile]
    ] as const).flatMap(([kind, entries]) => {
        return entries.map((entry) => ({
            kind,
            ...entry
        }));
    });
};

const persistSyncReport = async ({
    startedAt,
    completedAt,
    force,
    status,
    result
}: {
    startedAt: Date;
    completedAt: Date;
    force: boolean;
    status: SyncReportStatus;
    result: SyncMusicResult;
}) => {
    const items = flattenSyncReportEntries(result);

    return models.syncReport.create({
        data: {
            startedAt,
            completedAt,
            force,
            status,
            scannedFiles: result.scannedFiles,
            indexedFiles: result.indexedFiles,
            createdCount: result.created.length,
            movedCount: result.moved.length,
            duplicateCount: result.duplicate.length,
            missingCount: result.missing.length,
            reconcileCount: result.reconcile.length,
            Item: {
                create: items.map((entry) => ({
                    kind: entry.kind,
                    musicId: entry.physicalFileId,
                    musicName: entry.musicName,
                    filePath: entry.filePath,
                    previousFilePath: entry.previousFilePath
                }))
            }
        }
    });
};

export const syncListener = (socket: Socket) => {
    let alreadySyncing = false;

    socket.on(SYNC_EVENT, async ({ force = false }) => {
        console.log(SYNC_EVENT);
        emitSyncMessage(socket, 'syncing...');

        if (alreadySyncing) {
            console.error('already syncing');
            emitSyncMessage(socket, 'error');
            return;
        }

        alreadySyncing = true;
        const syncResult = await syncMusic(socket, force);
        if (syncResult) {
            connectors.notify('resync', '');
        }
        alreadySyncing = false;
    });
};

export const syncMusic = async (
    socket: Pick<Socket, 'emit'>,
    force = false
): Promise<SyncMusicResult | null> => withLibraryMetadataLock(async () => {
    const startedAt = new Date();

    try {
        const fileEntries = (await walk(resolveMusicPath()))
            .filter(isSupportedAudioFile)
            .map((sourceFilePath) => ({
                filePath: normalizeMusicFilePath(sourceFilePath),
                sourceFilePath
            }))
            .sort((a, b) => a.filePath.localeCompare(b.filePath));
        const files = fileEntries.map((entry) => entry.filePath);
        const sourceFilePathByFilePath = new Map(
            fileEntries.map((entry) => [entry.filePath, entry.sourceFilePath])
        );
        const visiblePaths = new Set(files);
        const observedAt = startedAt;

        console.log(`find ${files.length} files`);
        emitSyncMessage(socket, `find ${files.length} files`);

        const cachePath = resolveCachePath();
        const resizedPath = path.join(cachePath, 'resized');
        ensureDirectory(cachePath);
        ensureDirectory(resizedPath);

        const physicalFiles = await models.physicalFile.findMany({ orderBy: { id: 'asc' } });
        const releaseTrackIds = [...new Set(physicalFiles.map(file => file.releaseTrackId))];
        const musics = await models.music.findMany({
            where: { id: { in: releaseTrackIds } },
            orderBy: { id: 'asc' }
        });
        const albums = await models.album.findMany({ orderBy: { id: 'asc' } });
        const musicByReleaseTrackId = new Map(musics.map((music) => [music.id, music]));
        const physicalFileById = new Map(physicalFiles.map(file => [file.id, file]));
        const physicalFileByPath = new Map(physicalFiles.map(file => [
            normalizeMusicFilePath(file.filePath),
            file
        ]));
        const identityRecordById = new Map(physicalFiles.map(file => [
            file.id,
            toTrackIdentityRecord(file)
        ]));
        const albumById = new Map(albums.map((album) => [album.id, album]));
        const indexedFiles = files.filter((filePath) => {
            const file = physicalFileByPath.get(filePath);

            if (!file) {
                return true;
            }

            return force || shouldRefreshTrackContentHash({
                contentHash: file.contentHash,
                hashVersion: file.hashVersion
            });
        }).length;
        const result: SyncMusicResult = {
            scannedFiles: files.length,
            indexedFiles,
            created: [],
            moved: [],
            duplicate: [],
            missing: [],
            reconcile: []
        };
        const orderedFiles = [
            ...files.filter((filePath) => physicalFileByPath.has(filePath)),
            ...files.filter((filePath) => !physicalFileByPath.has(filePath))
        ];

        console.log(`indexing ${indexedFiles} files`);
        emitSyncMessage(socket, `indexing ${indexedFiles} files`);

        const upsertKnownPhysicalFile = (file: PhysicalFile) => {
            const previousFile = physicalFileById.get(file.id);

            if (previousFile) {
                physicalFileByPath.delete(normalizeMusicFilePath(previousFile.filePath));
            }

            physicalFileById.set(file.id, file);
            physicalFileByPath.set(normalizeMusicFilePath(file.filePath), file);
            identityRecordById.set(file.id, toTrackIdentityRecord(file));
        };
        const upsertKnownMusic = (music: Music) => {
            musicByReleaseTrackId.set(music.releaseTrackId, music);
        };

        for (const [index, filePath] of orderedFiles.entries()) {
            const sourceFilePath = sourceFilePathByFilePath.get(filePath) ?? filePath;

            console.log(`sync... ${filePath}`);
            emitSyncMessage(socket, `sync... ${index + 1}/${files.length}`);

            const pathMatch = physicalFileByPath.get(filePath);
            const requiresHashRefresh = !pathMatch || force || shouldRefreshTrackContentHash({
                contentHash: pathMatch.contentHash,
                hashVersion: pathMatch.hashVersion
            });

            let fileData: Buffer | null = null;
            let contentHash = pathMatch?.contentHash ?? null;

            if (requiresHashRefresh) {
                fileData = fs.readFileSync(sourceFilePath);
                contentHash = createTrackContentHash(fileData);
            }

            if (pathMatch) {
                const music = musicByReleaseTrackId.get(pathMatch.releaseTrackId);
                let linkedFile = pathMatch;

                if (!music) continue;

                if (pathMatch.filePath !== filePath) {
                    linkedFile = await models.physicalFile.update({
                        where: { id: pathMatch.id },
                        data: {
                            filePath,
                            lastSeenAt: observedAt,
                            missingSinceAt: null
                        }
                    });
                    upsertKnownPhysicalFile(linkedFile);
                }

                if (force) {
                    const resolvedData = fileData ?? fs.readFileSync(sourceFilePath);
                    const metadata = await parseTrackMetadata(sourceFilePath, resolvedData);

                    if (linkedFile.legacyMetadataOverride) {
                        const updated = await updateLinkedPhysicalFileFromMetadata({
                            file: linkedFile,
                            music,
                            filePath,
                            contentHash: contentHash ?? createTrackContentHash(resolvedData),
                            metadata,
                            observedAt,
                            syncStatus: linkedFile.syncStatus as TrackSyncStatus,
                            fileSizeBytes: BigInt(resolvedData.length),
                            cachePath,
                            resizedPath
                        });
                        upsertKnownPhysicalFile(updated.file);
                        upsertKnownMusic(updated.music);
                        continue;
                    }

                    const metadataMatches = await matchesCanonicalFileMetadata(
                        linkedFile.releaseTrackId,
                        metadata
                    );
                    const updatedFile = await refreshKnownPhysicalFile({
                        file: linkedFile,
                        filePath,
                        contentHash: contentHash ?? createTrackContentHash(resolvedData),
                        metadata,
                        observedAt,
                        fileSizeBytes: BigInt(resolvedData.length),
                        metadataMatches
                    });
                    upsertKnownPhysicalFile(updatedFile);
                    await syncLinkedAlbumCoverFromMetadata({
                        file: updatedFile,
                        music,
                        metadata,
                        cachePath,
                        resizedPath,
                        albumById
                    });

                    if (updatedFile.metadataSyncStatus !== 'current') {
                        result.reconcile.push({
                            musicId: music.id,
                            physicalFileId: updatedFile.id,
                            musicName: music.name,
                            filePath,
                            previousFilePath: null
                        });
                    }

                    continue;
                }

                if (requiresHashRefresh && contentHash) {
                    const updatedFile = await updatePhysicalFileIdentity({
                        file: linkedFile,
                        contentHash,
                        fileSizeBytes: BigInt((fileData ?? fs.readFileSync(sourceFilePath)).length)
                    });
                    upsertKnownPhysicalFile(updatedFile);
                }

                await repairAlbumCoverCacheIfNeeded({
                    music,
                    filePath: sourceFilePath,
                    fileData,
                    cachePath,
                    resizedPath,
                    albumById
                });

                continue;
            }

            const resolvedFileData = fileData ?? fs.readFileSync(sourceFilePath);
            const resolvedContentHash = contentHash ?? createTrackContentHash(resolvedFileData);
            const metadata = await parseTrackMetadata(sourceFilePath, resolvedFileData);
            const match = classifyTrackIdentityCandidate(
                [...identityRecordById.values()],
                {
                    filePath,
                    contentHash: resolvedContentHash
                },
                visiblePaths
            );

            if (match.kind === 'moved') {
                const existingFile = physicalFileById.get(match.record.id);
                const existingMusic = existingFile
                    ? musicByReleaseTrackId.get(existingFile.releaseTrackId)
                    : null;

                if (!existingFile || !existingMusic) {
                    continue;
                }

                let movedFile: PhysicalFile;
                let movedMusic = existingMusic;

                if (existingFile.legacyMetadataOverride) {
                    const moved = await updateLinkedPhysicalFileFromMetadata({
                        file: existingFile,
                        music: existingMusic,
                        filePath,
                        contentHash: resolvedContentHash,
                        metadata,
                        observedAt,
                        syncStatus: TRACK_SYNC_STATUS.active,
                        fileSizeBytes: BigInt(resolvedFileData.length),
                        cachePath,
                        resizedPath
                    });
                    movedFile = moved.file;
                    movedMusic = moved.music;
                } else {
                    const metadataMatches = await matchesCanonicalFileMetadata(
                        existingFile.releaseTrackId,
                        metadata
                    );
                    movedFile = await refreshKnownPhysicalFile({
                        file: existingFile,
                        filePath,
                        contentHash: resolvedContentHash,
                        metadata,
                        observedAt,
                        fileSizeBytes: BigInt(resolvedFileData.length),
                        metadataMatches
                    });
                    await syncLinkedAlbumCoverFromMetadata({
                        file: movedFile,
                        music: existingMusic,
                        metadata,
                        cachePath,
                        resizedPath,
                        albumById
                    });

                    if (movedFile.metadataSyncStatus !== 'current') {
                        result.reconcile.push({
                            musicId: existingMusic.id,
                            physicalFileId: movedFile.id,
                            musicName: existingMusic.name,
                            filePath,
                            previousFilePath: match.record.filePath
                        });
                    }
                }

                upsertKnownPhysicalFile(movedFile);
                upsertKnownMusic(movedMusic);
                result.moved.push({
                    musicId: movedMusic.id,
                    physicalFileId: movedFile.id,
                    musicName: movedMusic.name,
                    filePath,
                    previousFilePath: match.record.filePath
                });
                continue;
            }

            if (match.kind === 'duplicate') {
                const matchedFile = physicalFileById.get(match.record.id);
                const matchedMusic = matchedFile
                    ? musicByReleaseTrackId.get(matchedFile.releaseTrackId)
                    : null;

                if (!matchedFile || !matchedMusic) continue;
                const metadataMatches = await matchesCanonicalFileMetadata(
                    matchedFile.releaseTrackId,
                    metadata
                );

                const duplicateFile = await models.physicalFile.create({
                    data: {
                        releaseTrackId: matchedFile.releaseTrackId,
                        filePath,
                        contentHash: resolvedContentHash,
                        hashVersion: TRACK_CONTENT_HASH_VERSION,
                        durationMs: Math.round(metadata.duration * 1_000),
                        codec: metadata.codec,
                        container: metadata.container,
                        bitrate: Math.round(metadata.bitrate),
                        sampleRate: Math.round(metadata.sampleRate),
                        fileSizeBytes: BigInt(resolvedFileData.length),
                        tagSnapshotJson: createTrackTagSnapshot(metadata),
                        tagSnapshotVersion: TRACK_TAG_SNAPSHOT_VERSION,
                        lastSeenAt: observedAt,
                        metadataSyncStatus: metadataMatches ? 'current' : 'stale',
                        metadataSyncError: metadataMatches
                            ? null
                            : 'Embedded tags differ from canonical relational metadata.',
                        syncStatus: TRACK_SYNC_STATUS.duplicate
                    }
                });
                upsertKnownPhysicalFile(duplicateFile);
                result.duplicate.push({
                    musicId: matchedMusic.id,
                    physicalFileId: duplicateFile.id,
                    musicName: matchedMusic.name,
                    filePath,
                    previousFilePath: null
                });
                if (!metadataMatches) {
                    result.reconcile.push({
                        musicId: matchedMusic.id,
                        physicalFileId: duplicateFile.id,
                        musicName: matchedMusic.name,
                        filePath,
                        previousFilePath: null
                    });
                }
            } else {
                const createdMusic = await upsertMusicFromMetadata({
                    filePath,
                    contentHash: resolvedContentHash,
                    metadata,
                    observedAt,
                    syncStatus: TRACK_SYNC_STATUS.active,
                    fileSizeBytes: BigInt(resolvedFileData.length),
                    cachePath,
                    resizedPath
                });
                const createdFile = await models.physicalFile.findUniqueOrThrow({
                    where: { filePath }
                });
                upsertKnownPhysicalFile(createdFile);
                upsertKnownMusic(createdMusic);
                result.created.push({
                    musicId: createdMusic.id,
                    physicalFileId: createdFile.id,
                    musicName: createdMusic.name,
                    filePath,
                    previousFilePath: null
                });
            }
        }

        const presenceUpdates = deriveTrackPresenceUpdates(
            [...identityRecordById.values()],
            visiblePaths,
            observedAt
        );

        for (const presenceUpdate of presenceUpdates) {
            const existingFile = physicalFileById.get(presenceUpdate.id);

            if (!existingFile) continue;

            const updatedFile = await models.physicalFile.update({
                where: { id: presenceUpdate.id },
                data: {
                    lastSeenAt: presenceUpdate.lastSeenAt,
                    missingSinceAt: presenceUpdate.missingSinceAt,
                    syncStatus: presenceUpdate.syncStatus
                }
            });
            upsertKnownPhysicalFile(updatedFile);

            if (presenceUpdate.syncStatus === TRACK_SYNC_STATUS.missing) {
                const music = musicByReleaseTrackId.get(existingFile.releaseTrackId);

                if (!music) continue;

                result.missing.push({
                    musicId: music.id,
                    physicalFileId: updatedFile.id,
                    musicName: music.name,
                    filePath: updatedFile.filePath,
                    previousFilePath: null
                });
            } else if (
                presenceUpdate.syncStatus === TRACK_SYNC_STATUS.active
                && existingFile.metadataSyncStatus !== 'current'
                && !result.reconcile.some(entry => (
                    entry.physicalFileId === existingFile.id
                ))
            ) {
                const music = musicByReleaseTrackId.get(existingFile.releaseTrackId);

                if (!music) continue;

                result.reconcile.push({
                    musicId: music.id,
                    physicalFileId: updatedFile.id,
                    musicName: music.name,
                    filePath: updatedFile.filePath,
                    previousFilePath: null
                });
            }
        }

        await persistSyncReport({
            startedAt,
            completedAt: new Date(),
            force,
            status: SYNC_REPORT_STATUS.success,
            result
        });
        console.log('sync-music done');
        emitSyncMessage(socket, 'done');

        return result;
    } catch (error) {
        console.error(error);
        await persistSyncReport({
            startedAt,
            completedAt: new Date(),
            force,
            status: SYNC_REPORT_STATUS.error,
            result: {
                scannedFiles: 0,
                indexedFiles: 0,
                created: [],
                moved: [],
                duplicate: [],
                missing: [],
                reconcile: []
            }
        }).catch((reportError) => {
            console.error(reportError);
        });
        emitSyncMessage(socket, 'error');
        return null;
    }
});
