import fs from 'fs';
import path from 'path';
import type { Socket } from 'socket.io';

import { connectors } from './connectors';

import {
    hasHealthyAlbumCoverCache,
    syncAlbumCoverCache
} from '../modules/album-cover-cache';
import {
    findOrCreateArtist,
    getEffectiveMusicArtistCredits,
    preserveArtistCreditPresentation,
    replaceArtistCredits,
    resolveArtistCreditArtists,
    type ArtistCreditValue
} from '../modules/artist-credits';
import { walk } from '../modules/file';
import {
    normalizeMusicFilePath,
    resolveCachePath,
    resolveMusicPath
} from '../modules/storage-paths';
import {
    applyMusicMetadataOverride,
    parseTrackMetadata,
    type ParsedTrackMetadata
} from '../modules/track-metadata';
import {
    TRACK_CONTENT_HASH_VERSION,
    createTrackContentHash,
    shouldRefreshTrackContentHash
} from '../modules/track-hash';
import {
    TRACK_SYNC_STATUS,
    classifyTrackIdentityCandidate,
    deriveTrackPresenceUpdates,
    type TrackIdentityRecord,
    type TrackSyncStatus
} from '../modules/track-identity';
import {
    SYNC_REPORT_KIND,
    SYNC_REPORT_STATUS,
    type SyncReportStatus
} from '../modules/sync-report';
import {
    createCompatibilityMusicInTransaction,
    updateCompatibilityMusicInTransaction
} from '../models/music-compatibility';

import models, { type Album, type Genre, type Music } from '~/models';

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
    return SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
};

const toTrackIdentityRecord = (music: Music): TrackIdentityRecord => {
    return {
        id: music.id,
        filePath: normalizeMusicFilePath(music.filePath),
        contentHash: music.contentHash,
        lastSeenAt: music.lastSeenAt,
        missingSinceAt: music.missingSinceAt,
        syncStatus: music.syncStatus as TrackSyncStatus
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
        const artists = await resolveArtistCreditArtists(transaction, artistCredits);
        const releases = await transaction.release.findMany({
            where: {
                title: name,
                releaseDate: publishedYear
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
                    releaseDate: publishedYear,
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
                    releaseDate: publishedYear,
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

const upsertMusicFromMetadata = async ({
    existingMusic,
    filePath,
    contentHash,
    metadata,
    observedAt,
    syncStatus,
    cachePath,
    resizedPath
}: {
    existingMusic?: Music;
    filePath: string;
    contentHash: string;
    metadata: ParsedTrackMetadata;
    observedAt: Date;
    syncStatus: TrackSyncStatus;
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
                    lastSeenAt: observedAt,
                    missingSinceAt: null,
                    syncStatus,
                    albumId: album.id,
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

const updateMusicIdentity = async ({
    music,
    contentHash
}: {
    music: Music;
    contentHash: string;
}) => {
    return models.music.update({
        where: { id: music.id },
        data: {
            contentHash,
            hashVersion: TRACK_CONTENT_HASH_VERSION
        }
    });
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
        [SYNC_REPORT_KIND.missing, result.missing]
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
    const musicRows = await models.music.findMany({
        where: { id: { in: [...new Set(items.map(item => item.musicId))] } },
        select: { id: true, physicalFileId: true }
    });
    const physicalFileIdByMusicId = new Map(
        musicRows.map(music => [music.id, music.physicalFileId])
    );

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
            Item: {
                create: items.map((entry) => ({
                    kind: entry.kind,
                    musicId: physicalFileIdByMusicId.get(entry.musicId) ?? null,
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

export const syncMusic = async (socket: Pick<Socket, 'emit'>, force = false): Promise<SyncMusicResult | null> => {
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

        const musics = await models.music.findMany({ orderBy: { id: 'asc' } });
        const albums = await models.album.findMany({ orderBy: { id: 'asc' } });
        const musicById = new Map(musics.map((music) => [music.id, music]));
        const musicByPath = new Map(musics.map((music) => [normalizeMusicFilePath(music.filePath), music]));
        const identityRecordById = new Map(musics.map((music) => [music.id, toTrackIdentityRecord(music)]));
        const albumById = new Map(albums.map((album) => [album.id, album]));
        const indexedFiles = files.filter((filePath) => {
            const music = musicByPath.get(filePath);

            if (!music) {
                return true;
            }

            return force || shouldRefreshTrackContentHash({
                contentHash: music.contentHash,
                hashVersion: music.hashVersion
            });
        }).length;
        const result: SyncMusicResult = {
            scannedFiles: files.length,
            indexedFiles,
            created: [],
            moved: [],
            duplicate: [],
            missing: []
        };
        const orderedFiles = [
            ...files.filter((filePath) => musicByPath.has(filePath)),
            ...files.filter((filePath) => !musicByPath.has(filePath))
        ];

        console.log(`indexing ${indexedFiles} files`);
        emitSyncMessage(socket, `indexing ${indexedFiles} files`);

        const upsertKnownMusic = (music: Music) => {
            const previousMusic = musicById.get(music.id);

            if (previousMusic) {
                musicByPath.delete(normalizeMusicFilePath(previousMusic.filePath));
            }

            musicById.set(music.id, music);
            musicByPath.set(normalizeMusicFilePath(music.filePath), music);
            identityRecordById.set(music.id, toTrackIdentityRecord(music));
        };

        for (const [index, filePath] of orderedFiles.entries()) {
            const sourceFilePath = sourceFilePathByFilePath.get(filePath) ?? filePath;

            console.log(`sync... ${filePath}`);
            emitSyncMessage(socket, `sync... ${index + 1}/${files.length}`);

            const pathMatch = musicByPath.get(filePath);
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
                if (force) {
                    const metadata = await parseTrackMetadata(sourceFilePath, fileData ?? fs.readFileSync(sourceFilePath));
                    const updatedMusic = await upsertMusicFromMetadata({
                        existingMusic: pathMatch,
                        filePath,
                        contentHash: contentHash ?? createTrackContentHash(fs.readFileSync(sourceFilePath)),
                        metadata,
                        observedAt,
                        syncStatus: pathMatch.syncStatus as TrackSyncStatus,
                        cachePath,
                        resizedPath
                    });
                    upsertKnownMusic(updatedMusic);
                    continue;
                }

                if (pathMatch.filePath !== filePath) {
                    const updatedMusic = await models.music.update({
                        where: { id: pathMatch.id },
                        data: {
                            filePath,
                            lastSeenAt: observedAt,
                            missingSinceAt: null,
                            syncStatus: TRACK_SYNC_STATUS.active
                        }
                    });
                    upsertKnownMusic(updatedMusic);
                }

                if (requiresHashRefresh && contentHash) {
                    const updatedMusic = await updateMusicIdentity({
                        music: pathMatch,
                        contentHash
                    });
                    upsertKnownMusic(updatedMusic);
                }

                await repairAlbumCoverCacheIfNeeded({
                    music: pathMatch,
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
                const existingMusic = musicById.get(match.record.id);

                if (!existingMusic) {
                    continue;
                }

                const movedMusic = await upsertMusicFromMetadata({
                    existingMusic,
                    filePath,
                    contentHash: resolvedContentHash,
                    metadata,
                    observedAt,
                    syncStatus: TRACK_SYNC_STATUS.active,
                    cachePath,
                    resizedPath
                });
                upsertKnownMusic(movedMusic);
                result.moved.push({
                    musicId: movedMusic.id,
                    musicName: movedMusic.name,
                    filePath,
                    previousFilePath: match.record.filePath
                });
                continue;
            }

            const createdMusic = await upsertMusicFromMetadata({
                filePath,
                contentHash: resolvedContentHash,
                metadata,
                observedAt,
                syncStatus: match.kind === 'duplicate'
                    ? TRACK_SYNC_STATUS.duplicate
                    : TRACK_SYNC_STATUS.active,
                cachePath,
                resizedPath
            });
            upsertKnownMusic(createdMusic);

            if (match.kind === 'duplicate') {
                result.duplicate.push({
                    musicId: createdMusic.id,
                    musicName: createdMusic.name,
                    filePath,
                    previousFilePath: null
                });
            } else {
                result.created.push({
                    musicId: createdMusic.id,
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
            const updatedMusic = await models.music.update({
                where: { id: presenceUpdate.id },
                data: {
                    lastSeenAt: presenceUpdate.lastSeenAt,
                    missingSinceAt: presenceUpdate.missingSinceAt,
                    syncStatus: presenceUpdate.syncStatus
                }
            });
            upsertKnownMusic(updatedMusic);

            if (presenceUpdate.syncStatus === TRACK_SYNC_STATUS.missing) {
                result.missing.push({
                    musicId: updatedMusic.id,
                    musicName: updatedMusic.name,
                    filePath: updatedMusic.filePath,
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
                missing: []
            }
        }).catch((reportError) => {
            console.error(reportError);
        });
        emitSyncMessage(socket, 'error');
        return null;
    }
};
