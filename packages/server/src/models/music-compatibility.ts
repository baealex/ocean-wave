import type {
    Album,
    Music,
    Prisma,
    PrismaClient
} from '@prisma/client';

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

interface RelationConnection {
    connect: { id: number };
}

interface GenreConnections {
    connect?: Array<{ id: number }>;
    set?: Array<{ id: number }>;
}

type NumericUpdate = number | {
    set?: number;
    increment?: number;
    decrement?: number;
    multiply?: number;
    divide?: number;
};

export interface CompatibilityAlbumCreateInput {
    id?: number;
    name: string;
    cover: string;
    isCoverCustom?: boolean;
    publishedYear: string;
    artistId: number;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface CompatibilityMusicCreateInput {
    id?: number;
    name: string;
    albumId?: number;
    artistId?: number;
    Album?: RelationConnection;
    Artist?: RelationConnection;
    Genre?: GenreConnections;
    filePath: string;
    metadataOverride?: string | null;
    contentHash?: string | null;
    hashVersion?: number | null;
    duration: number;
    codec: string;
    container: string;
    bitrate: number;
    sampleRate: number;
    playCount?: number;
    lastPlayedAt?: Date | null;
    skipCount?: number;
    lastSkippedAt?: Date | null;
    completionCount?: number;
    lastCompletedAt?: Date | null;
    lastSeenAt?: Date | null;
    missingSinceAt?: Date | null;
    syncStatus?: string;
    totalPlayedMs?: number;
    discNumber?: number | null;
    trackNumber: number | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export type CompatibilityMusicUpdateInput = Partial<Omit<
CompatibilityMusicCreateInput,
'Album' | 'Artist' | 'Genre' | 'discNumber' | 'filePath' | 'name' | 'trackNumber'
>> & {
    name?: string;
    albumId?: number;
    artistId?: number;
    filePath?: string;
    discNumber?: number | null;
    trackNumber?: number | null;
    Genre?: GenreConnections;
    playCount?: NumericUpdate;
    skipCount?: NumericUpdate;
    completionCount?: NumericUpdate;
    totalPlayedMs?: NumericUpdate;
};

type MusicReadDelegate = PrismaClient['music'];
type AlbumReadDelegate = PrismaClient['album'];

export type CompatibilityMusicDelegate = MusicReadDelegate & {
    create(args: { data: CompatibilityMusicCreateInput }): Promise<Music>;
    createMany(args: {
        data: CompatibilityMusicCreateInput | CompatibilityMusicCreateInput[];
        skipDuplicates?: boolean;
    }): Promise<{ count: number }>;
    update(args: {
        where: { id: number };
        data: CompatibilityMusicUpdateInput;
    }): Promise<Music>;
    delete(args: { where: { id: number } }): Promise<Music>;
    deleteMany(args?: { where?: Prisma.MusicWhereInput }): Promise<{ count: number }>;
};

export type CompatibilityAlbumDelegate = AlbumReadDelegate & {
    create(args: { data: CompatibilityAlbumCreateInput }): Promise<Album>;
    createMany(args: {
        data: CompatibilityAlbumCreateInput | CompatibilityAlbumCreateInput[];
        skipDuplicates?: boolean;
    }): Promise<{ count: number }>;
    update(args: {
        where: { id: number };
        data: Partial<CompatibilityAlbumCreateInput>;
    }): Promise<Album>;
    delete(args: { where: { id: number } }): Promise<Album>;
    deleteMany(args?: { where?: Prisma.AlbumWhereInput }): Promise<{ count: number }>;
};

const resolveRequiredRelationId = (
    scalarId: number | undefined,
    relation: RelationConnection | undefined,
    label: string
) => {
    const id = scalarId ?? relation?.connect.id;

    if (!Number.isInteger(id) || (id ?? 0) < 1) {
        throw new Error(`${label} is required.`);
    }

    return id as number;
};

const resolveNumericUpdate = (current: number, update: NumericUpdate | undefined) => {
    if (update === undefined) {
        return undefined;
    }

    if (typeof update === 'number') {
        return update;
    }

    if (update.set !== undefined) {
        return update.set;
    }

    let next = current;

    if (update.increment !== undefined) next += update.increment;
    if (update.decrement !== undefined) next -= update.decrement;
    if (update.multiply !== undefined) next *= update.multiply;
    if (update.divide !== undefined) next /= update.divide;

    return next;
};

export const createCompatibilityAlbumInTransaction = async (
    transaction: Prisma.TransactionClient,
    data: CompatibilityAlbumCreateInput
) => {
    const release = await transaction.release.create({
        data: {
            ...(data.id === undefined ? {} : { id: data.id }),
            title: data.name,
            releaseDate: data.publishedYear,
            releaseType: 'unknown',
            totalDiscs: 1,
            cover: data.cover,
            isCoverCustom: data.isCoverCustom ?? false,
            ...(data.createdAt === undefined ? {} : { createdAt: data.createdAt }),
            ...(data.updatedAt === undefined ? {} : { updatedAt: data.updatedAt }),
            ArtistCredit: {
                create: {
                    artistId: data.artistId,
                    role: 'primary',
                    position: 0
                }
            }
        }
    });

    return transaction.album.findUniqueOrThrow({ where: { id: release.id } });
};

export const createCompatibilityMusicInTransaction = async (
    transaction: Prisma.TransactionClient,
    data: CompatibilityMusicCreateInput
) => {
    const artistId = resolveRequiredRelationId(data.artistId, data.Artist, 'Artist');
    const releaseId = resolveRequiredRelationId(data.albumId, data.Album, 'Album');
    const recordingMaximum = await transaction.recording.aggregate({ _max: { id: true } });
    const releaseTrackMaximum = await transaction.releaseTrack.aggregate({ _max: { id: true } });
    const physicalFileMaximum = await transaction.physicalFile.aggregate({ _max: { id: true } });
    const identityId = data.id ?? Math.max(
        recordingMaximum._max.id ?? 0,
        releaseTrackMaximum._max.id ?? 0,
        physicalFileMaximum._max.id ?? 0
    ) + 1;
    const recording = await transaction.recording.create({
        data: {
            id: identityId,
            title: data.name,
            playCount: data.playCount ?? 0,
            lastPlayedAt: data.lastPlayedAt,
            skipCount: data.skipCount ?? 0,
            lastSkippedAt: data.lastSkippedAt,
            completionCount: data.completionCount ?? 0,
            lastCompletedAt: data.lastCompletedAt,
            totalPlayedMs: data.totalPlayedMs ?? 0,
            ...(data.createdAt === undefined ? {} : { createdAt: data.createdAt }),
            ...(data.updatedAt === undefined ? {} : { updatedAt: data.updatedAt }),
            ArtistCredit: {
                create: {
                    artistId,
                    role: 'primary',
                    position: 0
                }
            }
        }
    });

    const releaseTrack = await transaction.releaseTrack.create({
        data: {
            id: identityId,
            recordingId: recording.id,
            releaseId,
            discNumber: data.discNumber === undefined ? 1 : data.discNumber,
            trackNumber: data.trackNumber,
            ...(data.createdAt === undefined ? {} : { createdAt: data.createdAt }),
            ...(data.updatedAt === undefined ? {} : { updatedAt: data.updatedAt })
        }
    });

    await transaction.physicalFile.create({
        data: {
            id: identityId,
            releaseTrackId: releaseTrack.id,
            filePath: data.filePath,
            legacyMetadataOverride: data.metadataOverride,
            contentHash: data.contentHash,
            hashVersion: data.hashVersion,
            durationMs: Math.round(data.duration * 1_000),
            codec: data.codec,
            container: data.container,
            bitrate: Math.round(data.bitrate),
            sampleRate: Math.round(data.sampleRate),
            lastSeenAt: data.lastSeenAt,
            missingSinceAt: data.missingSinceAt,
            syncStatus: data.syncStatus ?? 'active',
            ...(data.createdAt === undefined ? {} : { createdAt: data.createdAt }),
            ...(data.updatedAt === undefined ? {} : { updatedAt: data.updatedAt })
        }
    });

    const genreIds = data.Genre?.connect?.map(({ id }) => id) ?? [];

    if (genreIds.length) {
        await transaction.recordingGenre.createMany({
            data: genreIds.map(genreId => ({ recordingId: recording.id, genreId }))
        });
    }

    return transaction.music.findUniqueOrThrow({ where: { id: releaseTrack.id } });
};

export const updateCompatibilityAlbumInTransaction = async (
    transaction: Prisma.TransactionClient,
    id: number,
    data: Partial<CompatibilityAlbumCreateInput>
) => {
    await transaction.release.update({
        where: { id },
        data: {
            ...(data.name === undefined ? {} : { title: data.name }),
            ...(data.publishedYear === undefined ? {} : { releaseDate: data.publishedYear }),
            ...(data.cover === undefined ? {} : { cover: data.cover }),
            ...(data.isCoverCustom === undefined ? {} : { isCoverCustom: data.isCoverCustom }),
            ...(data.createdAt === undefined ? {} : { createdAt: data.createdAt }),
            ...(data.updatedAt === undefined ? {} : { updatedAt: data.updatedAt })
        }
    });

    if (data.artistId !== undefined) {
        await transaction.artistCredit.updateMany({
            where: { releaseId: id, role: 'primary' },
            data: { artistId: data.artistId }
        });
    }

    return transaction.album.findUniqueOrThrow({ where: { id } });
};

export const updateCompatibilityMusicInTransaction = async (
    transaction: Prisma.TransactionClient,
    id: number,
    data: CompatibilityMusicUpdateInput
) => {
    const current = await transaction.music.findUniqueOrThrow({ where: { id } });
    const recordingData: Prisma.RecordingUpdateInput = {};
    const releaseTrackData: Prisma.ReleaseTrackUncheckedUpdateInput = {};
    const physicalFileData: Prisma.PhysicalFileUpdateInput = {};

    if (data.name !== undefined) recordingData.title = data.name;
    if (data.lastPlayedAt !== undefined) recordingData.lastPlayedAt = data.lastPlayedAt;
    if (data.lastSkippedAt !== undefined) recordingData.lastSkippedAt = data.lastSkippedAt;
    if (data.lastCompletedAt !== undefined) recordingData.lastCompletedAt = data.lastCompletedAt;

    const playCount = resolveNumericUpdate(current.playCount, data.playCount);
    const skipCount = resolveNumericUpdate(current.skipCount, data.skipCount);
    const completionCount = resolveNumericUpdate(current.completionCount, data.completionCount);
    const totalPlayedMs = resolveNumericUpdate(current.totalPlayedMs, data.totalPlayedMs);

    if (playCount !== undefined) recordingData.playCount = playCount;
    if (skipCount !== undefined) recordingData.skipCount = skipCount;
    if (completionCount !== undefined) recordingData.completionCount = completionCount;
    if (totalPlayedMs !== undefined) recordingData.totalPlayedMs = totalPlayedMs;
    if (data.albumId !== undefined) releaseTrackData.releaseId = data.albumId;
    if (data.discNumber !== undefined) releaseTrackData.discNumber = data.discNumber;
    if (data.trackNumber !== undefined) releaseTrackData.trackNumber = data.trackNumber;
    if (data.filePath !== undefined) physicalFileData.filePath = data.filePath;
    if (data.metadataOverride !== undefined) physicalFileData.legacyMetadataOverride = data.metadataOverride;
    if (data.contentHash !== undefined) physicalFileData.contentHash = data.contentHash;
    if (data.hashVersion !== undefined) physicalFileData.hashVersion = data.hashVersion;
    if (data.duration !== undefined) physicalFileData.durationMs = Math.round(data.duration * 1_000);
    if (data.codec !== undefined) physicalFileData.codec = data.codec;
    if (data.container !== undefined) physicalFileData.container = data.container;
    if (data.bitrate !== undefined) physicalFileData.bitrate = Math.round(data.bitrate);
    if (data.sampleRate !== undefined) physicalFileData.sampleRate = Math.round(data.sampleRate);
    if (data.lastSeenAt !== undefined) physicalFileData.lastSeenAt = data.lastSeenAt;
    if (data.missingSinceAt !== undefined) physicalFileData.missingSinceAt = data.missingSinceAt;
    if (data.syncStatus !== undefined) physicalFileData.syncStatus = data.syncStatus;

    if (Object.keys(recordingData).length) {
        await transaction.recording.update({
            where: { id: current.recordingId },
            data: recordingData
        });
    }

    if (Object.keys(releaseTrackData).length) {
        await transaction.releaseTrack.update({
            where: { id: current.releaseTrackId },
            data: releaseTrackData
        });
    }

    if (Object.keys(physicalFileData).length) {
        await transaction.physicalFile.update({
            where: { id: current.physicalFileId },
            data: physicalFileData
        });
    }

    if (data.artistId !== undefined) {
        await transaction.artistCredit.updateMany({
            where: { recordingId: current.recordingId, role: 'primary' },
            data: { artistId: data.artistId }
        });
    }

    if (data.Genre?.set) {
        await transaction.recordingGenre.deleteMany({
            where: { recordingId: current.recordingId }
        });

        if (data.Genre.set.length) {
            await transaction.recordingGenre.createMany({
                data: data.Genre.set.map(({ id: genreId }) => ({
                    recordingId: current.recordingId,
                    genreId
                }))
            });
        }
    }

    return transaction.music.findUniqueOrThrow({ where: { id } });
};

const deleteMusicRows = async (
    transaction: Prisma.TransactionClient,
    rows: Array<Pick<Music, 'id' | 'recordingId' | 'physicalFileId'>>
) => {
    if (!rows.length) {
        return;
    }

    const releaseTrackIds = rows.map(({ id }) => id);
    const physicalFileIds = rows.map(({ physicalFileId }) => physicalFileId);
    const recordingIds = [...new Set(rows.map(({ recordingId }) => recordingId))];

    await transaction.physicalFile.deleteMany({ where: { id: { in: physicalFileIds } } });
    await transaction.releaseTrack.deleteMany({ where: { id: { in: releaseTrackIds } } });
    await transaction.recording.deleteMany({
        where: {
            id: { in: recordingIds },
            ReleaseTrack: { none: {} }
        }
    });
};

export const createCompatibilityDelegates = (client: PrismaClient) => {
    const musicWrites = {
        create: ({ data }: { data: CompatibilityMusicCreateInput }) => (
            client.$transaction(transaction => createCompatibilityMusicInTransaction(transaction, data))
        ),
        createMany: ({ data }: {
            data: CompatibilityMusicCreateInput | CompatibilityMusicCreateInput[];
        }) => client.$transaction(async transaction => {
            const rows = Array.isArray(data) ? data : [data];

            for (const row of rows) {
                await createCompatibilityMusicInTransaction(transaction, row);
            }

            return { count: rows.length };
        }),
        update: ({ where, data }: {
            where: { id: number };
            data: CompatibilityMusicUpdateInput;
        }) => client.$transaction(transaction => updateCompatibilityMusicInTransaction(
            transaction,
            where.id,
            data
        )),
        delete: ({ where }: { where: { id: number } }) => client.$transaction(async transaction => {
            const current = await transaction.music.findUniqueOrThrow({ where });
            await deleteMusicRows(transaction, [current]);
            return current;
        }),
        deleteMany: (args?: { where?: Prisma.MusicWhereInput }) => client.$transaction(async transaction => {
            const rows = await transaction.music.findMany({
                where: args?.where,
                select: { id: true, recordingId: true, physicalFileId: true }
            });
            await deleteMusicRows(transaction, rows);
            return { count: rows.length };
        })
    };

    const albumWrites = {
        create: ({ data }: { data: CompatibilityAlbumCreateInput }) => (
            client.$transaction(transaction => createCompatibilityAlbumInTransaction(transaction, data))
        ),
        createMany: ({ data }: {
            data: CompatibilityAlbumCreateInput | CompatibilityAlbumCreateInput[];
        }) => client.$transaction(async transaction => {
            const rows = Array.isArray(data) ? data : [data];

            for (const row of rows) {
                await createCompatibilityAlbumInTransaction(transaction, row);
            }

            return { count: rows.length };
        }),
        update: ({ where, data }: {
            where: { id: number };
            data: Partial<CompatibilityAlbumCreateInput>;
        }) => client.$transaction(transaction => updateCompatibilityAlbumInTransaction(transaction, where.id, data)),
        delete: ({ where }: { where: { id: number } }) => client.$transaction(async transaction => {
            const current = await transaction.album.findUniqueOrThrow({ where });
            await transaction.release.delete({ where });
            return current;
        }),
        deleteMany: (args?: { where?: Prisma.AlbumWhereInput }) => client.$transaction(async transaction => {
            const rows = await transaction.album.findMany({
                where: args?.where,
                select: { id: true }
            });
            const result = await transaction.release.deleteMany({
                where: { id: { in: rows.map(({ id }) => id) } }
            });
            return { count: result.count };
        })
    };

    const music = new Proxy(client.music, {
        get: (target, property, receiver) => (
            property in musicWrites
                ? Reflect.get(musicWrites, property)
                : Reflect.get(target, property, receiver)
        )
    }) as CompatibilityMusicDelegate;

    const album = new Proxy(client.album, {
        get: (target, property, receiver) => (
            property in albumWrites
                ? Reflect.get(albumWrites, property)
                : Reflect.get(target, property, receiver)
        )
    }) as CompatibilityAlbumDelegate;

    return { music, album };
};
