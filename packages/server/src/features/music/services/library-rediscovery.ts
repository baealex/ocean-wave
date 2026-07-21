import { Prisma, type PrismaClient } from '@prisma/client';

import models from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

import {
    LIBRARY_REDISCOVERY_THRESHOLDS,
    type LibraryRediscoveryAlbumInput,
    type LibraryRediscoveryReasonCode,
    type LibraryRediscoveryTrackInput,
    rankLibraryRediscovery
} from './library-rediscovery-ranking';

export const DEFAULT_LIBRARY_REDISCOVERY_LIMIT = 8;
export const MAX_LIBRARY_REDISCOVERY_LIMIT = 24;
export const LIBRARY_REDISCOVERY_LOGICAL_QUERY_COUNT = 8;

const MIN_SOURCE_POOL_LIMIT = 48;
const MAX_SOURCE_POOL_LIMIT = 192;
const SOURCE_POOL_LIMIT_MULTIPLIER = 8;

interface RawAlbumCandidate {
    albumId: bigint | number;
    artistId: bigint | number;
    representativeMusicId: bigint | number;
    createdAt: Date | number | string;
    lastPlayedAt: Date | number | string | null;
    trackCount: bigint | number;
    totalPlayCount: bigint | number;
    totalSkipCount: bigint | number;
    totalCompletionCount: bigint | number;
    likedTrackCount: bigint | number;
}

interface RawMusicId {
    id: bigint | number;
}

export interface LibraryRediscoveryTrackCandidate {
    musicId: number;
    score: number;
    reasonCodes: LibraryRediscoveryReasonCode[];
}

export interface LibraryRediscoveryAlbumCandidate {
    albumId: number;
    representativeMusicId: number;
    trackCount: number;
    lastPlayedAt: string | null;
    score: number;
    reasonCodes: LibraryRediscoveryReasonCode[];
}

export interface LibraryRediscoveryResult {
    generatedAt: string;
    eligibleMusicCount: number;
    recentlyAdded: LibraryRediscoveryTrackCandidate[];
    dormantLiked: LibraryRediscoveryTrackCandidate[];
    underplayed: LibraryRediscoveryTrackCandidate[];
    forgottenAlbums: LibraryRediscoveryAlbumCandidate[];
    fallback: LibraryRediscoveryTrackCandidate[];
    metrics: {
        candidatePoolSize: number;
        logicalQueryCount: number;
        sourcePoolLimit: number;
    };
}

export const normalizeLibraryRediscoveryLimit = (limit: number | undefined) => {
    if (limit === undefined || !Number.isFinite(limit)) {
        return DEFAULT_LIBRARY_REDISCOVERY_LIMIT;
    }

    return Math.min(
        Math.max(Math.trunc(limit), 1),
        MAX_LIBRARY_REDISCOVERY_LIMIT
    );
};

const sourcePoolLimitFor = (limit: number) => Math.min(
    Math.max(limit * SOURCE_POOL_LIMIT_MULTIPLIER, MIN_SOURCE_POOL_LIMIT),
    MAX_SOURCE_POOL_LIMIT
);

const timestampMs = (value: Date | number | string | null) => {
    if (value === null) {
        return null;
    }
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
};

const toNumber = (value: bigint | number) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : 0;
};

const candidateWhere = {
    syncStatus: TRACK_SYNC_STATUS.active,
    Recording: { MusicHate: null }
} satisfies Prisma.MusicWhereInput;

export const getLibraryRediscovery = async ({
    database = models,
    limit: requestedLimit,
    now = new Date()
}: {
    database?: PrismaClient;
    limit?: number;
    now?: Date;
} = {}): Promise<LibraryRediscoveryResult> => {
    const limit = normalizeLibraryRediscoveryLimit(requestedLimit);
    const sourcePoolLimit = sourcePoolLimitFor(limit);
    const nowMs = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
    const recentlyAddedCutoff = new Date(
        nowMs - LIBRARY_REDISCOVERY_THRESHOLDS.recentlyAddedDays * 24 * 60 * 60 * 1_000
    );
    const dormantLikedCutoff = new Date(
        nowMs - LIBRARY_REDISCOVERY_THRESHOLDS.dormantLikedDays * 24 * 60 * 60 * 1_000
    );
    const forgottenAlbumCreatedCutoff = new Date(
        nowMs
        - LIBRARY_REDISCOVERY_THRESHOLDS.forgottenAlbumMinimumAgeDays * 24 * 60 * 60 * 1_000
    );
    const forgottenAlbumPlayedCutoff = new Date(
        nowMs - LIBRARY_REDISCOVERY_THRESHOLDS.forgottenAlbumDays * 24 * 60 * 60 * 1_000
    );
    const [
        eligibleMusicCount,
        recentlyAddedRows,
        dormantLikedRows,
        underplayedRows,
        affinityRows,
        fallbackRows,
        rawAlbums
    ] = await database.$transaction([
        database.music.count({ where: candidateWhere }),
        database.music.findMany({
            where: {
                ...candidateWhere,
                createdAt: { gte: recentlyAddedCutoff }
            },
            orderBy: [
                { createdAt: 'desc' },
                { id: 'asc' }
            ],
            select: { id: true },
            take: sourcePoolLimit
        }),
        database.music.findMany({
            where: {
                ...candidateWhere,
                Recording: {
                    MusicHate: null,
                    MusicLike: { isNot: null }
                },
                OR: [
                    { lastPlayedAt: null },
                    { lastPlayedAt: { lte: dormantLikedCutoff } }
                ]
            },
            orderBy: [
                { lastPlayedAt: 'asc' },
                { createdAt: 'asc' },
                { id: 'asc' }
            ],
            select: { id: true },
            take: sourcePoolLimit
        }),
        database.$queryRaw<RawMusicId[]>(Prisma.sql`
            SELECT music."id" AS "id"
            FROM "Music" music
            WHERE music."syncStatus" = ${TRACK_SYNC_STATUS.active}
                AND NOT EXISTS (
                    SELECT 1
                    FROM "MusicHate" hated
                    WHERE hated."recordingId" = music."recordingId"
                )
                AND music."playCount"
                    <= ${LIBRARY_REDISCOVERY_THRESHOLDS.underplayedEquivalentListens}
                AND (
                    music."duration" <= 0
                    OR music."totalPlayedMs"
                        <= music."duration" * 1000
                            * ${LIBRARY_REDISCOVERY_THRESHOLDS.underplayedEquivalentListens}
                )
            ORDER BY
                MAX(
                    CAST(music."playCount" AS REAL),
                    CASE WHEN music."duration" > 0
                        THEN music."totalPlayedMs" / (music."duration" * 1000)
                        ELSE 0
                    END
                ) ASC,
                music."lastPlayedAt" ASC,
                music."id" ASC
            LIMIT ${sourcePoolLimit}
        `),
        database.music.findMany({
            where: {
                ...candidateWhere,
                OR: [
                    { Recording: { MusicLike: { isNot: null } } },
                    { completionCount: { gt: 0 } }
                ]
            },
            orderBy: [
                { completionCount: 'desc' },
                { lastCompletedAt: 'desc' },
                { playCount: 'desc' },
                { id: 'asc' }
            ],
            select: { id: true },
            take: sourcePoolLimit
        }),
        database.music.findMany({
            where: candidateWhere,
            orderBy: [
                { lastPlayedAt: 'asc' },
                { playCount: 'asc' },
                { totalPlayedMs: 'asc' },
                { id: 'asc' }
            ],
            select: { id: true },
            take: sourcePoolLimit
        }),
        database.$queryRaw<RawAlbumCandidate[]>(Prisma.sql`
            SELECT
                music."albumId" AS "albumId",
                album."artistId" AS "artistId",
                MIN(music."id") AS "representativeMusicId",
                album."createdAt" AS "createdAt",
                MAX(music."lastPlayedAt") AS "lastPlayedAt",
                COUNT(*) AS "trackCount",
                SUM(music."playCount") AS "totalPlayCount",
                SUM(music."skipCount") AS "totalSkipCount",
                SUM(music."completionCount") AS "totalCompletionCount",
                SUM(CASE WHEN EXISTS (
                    SELECT 1
                    FROM "MusicLike" liked
                    WHERE liked."recordingId" = music."recordingId"
                ) THEN 1 ELSE 0 END) AS "likedTrackCount"
            FROM "Music" music
            INNER JOIN "Album" album ON album."id" = music."albumId"
            WHERE music."syncStatus" = ${TRACK_SYNC_STATUS.active}
                AND album."createdAt" <= ${forgottenAlbumCreatedCutoff}
                AND NOT EXISTS (
                    SELECT 1
                    FROM "MusicHate" hated
                    WHERE hated."recordingId" = music."recordingId"
                )
            GROUP BY music."albumId", album."artistId", album."createdAt"
            HAVING MAX(music."lastPlayedAt") IS NULL
                OR MAX(music."lastPlayedAt") <= ${forgottenAlbumPlayedCutoff}
            ORDER BY
                CASE WHEN MAX(music."lastPlayedAt") IS NULL THEN 0 ELSE 1 END ASC,
                MAX(music."lastPlayedAt") ASC,
                SUM(music."playCount") ASC,
                music."albumId" ASC
            LIMIT ${sourcePoolLimit}
        `)
    ]);
    const affinityIds = new Set(affinityRows.map(row => row.id));
    const candidateIds = new Set([
        ...recentlyAddedRows.map(row => row.id),
        ...dormantLikedRows.map(row => row.id),
        ...underplayedRows.map(row => toNumber(row.id)),
        ...affinityRows.map(row => row.id),
        ...fallbackRows.map(row => row.id),
        ...rawAlbums.map(row => toNumber(row.representativeMusicId))
    ]);
    const trackRows = await database.music.findMany({
        where: {
            ...candidateWhere,
            id: { in: [...candidateIds] }
        },
        orderBy: { id: 'asc' },
        select: {
            id: true,
            artistId: true,
            albumId: true,
            createdAt: true,
            lastPlayedAt: true,
            duration: true,
            playCount: true,
            totalPlayedMs: true,
            skipCount: true,
            completionCount: true,
            Recording: {
                select: {
                    RecordingGenre: { select: { genreId: true } },
                    MusicLike: { select: { id: true } },
                    MusicTag: { select: { tagId: true } }
                }
            }
        }
    });
    const tracks: LibraryRediscoveryTrackInput[] = trackRows.map(row => ({
        albumId: row.albumId,
        artistId: row.artistId,
        completionCount: row.completionCount,
        createdAtMs: row.createdAt.getTime(),
        durationMs: row.duration * 1_000,
        genreIds: row.Recording.RecordingGenre.map(genre => genre.genreId),
        id: row.id,
        isAffinitySeed: affinityIds.has(row.id),
        isLiked: row.Recording.MusicLike !== null,
        lastPlayedAtMs: row.lastPlayedAt?.getTime() ?? null,
        playCount: row.playCount,
        skipCount: row.skipCount,
        tagIds: row.Recording.MusicTag.map(tag => tag.tagId),
        totalPlayedMs: row.totalPlayedMs
    }));
    const albums: LibraryRediscoveryAlbumInput[] = rawAlbums.map(row => ({
        artistId: toNumber(row.artistId),
        createdAtMs: timestampMs(row.createdAt) ?? nowMs,
        id: toNumber(row.albumId),
        lastPlayedAtMs: timestampMs(row.lastPlayedAt),
        likedTrackCount: toNumber(row.likedTrackCount),
        representativeMusicId: toNumber(row.representativeMusicId),
        totalCompletionCount: toNumber(row.totalCompletionCount),
        totalPlayCount: toNumber(row.totalPlayCount),
        totalSkipCount: toNumber(row.totalSkipCount),
        trackCount: toNumber(row.trackCount)
    }));
    const ranking = rankLibraryRediscovery({
        albums,
        limit,
        nowMs,
        tracks
    });

    return {
        ...ranking,
        eligibleMusicCount,
        forgottenAlbums: ranking.forgottenAlbums.map(album => ({
            albumId: album.albumId,
            lastPlayedAt: album.lastPlayedAtMs === null
                ? null
                : new Date(album.lastPlayedAtMs).toISOString(),
            reasonCodes: album.reasonCodes,
            representativeMusicId: album.representativeMusicId,
            score: album.score,
            trackCount: album.trackCount
        })),
        generatedAt: new Date(nowMs).toISOString(),
        metrics: {
            candidatePoolSize: tracks.length,
            logicalQueryCount: LIBRARY_REDISCOVERY_LOGICAL_QUERY_COUNT,
            sourcePoolLimit
        }
    };
};
