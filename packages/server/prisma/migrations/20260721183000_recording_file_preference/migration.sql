DROP VIEW "Music";

ALTER TABLE "PhysicalFile"
ADD COLUMN "isExplicitlyActivated" BOOLEAN NOT NULL DEFAULT false;

CREATE VIEW "Music" AS
SELECT
    releaseTrack."id" AS "id",
    releaseTrack."recordingId" AS "recordingId",
    releaseTrack."id" AS "releaseTrackId",
    physicalFile."id" AS "physicalFileId",
    coalesce(releaseTrack."titleOverride", recording."title") AS "name",
    releaseTrack."createdAt" AS "createdAt",
    max(releaseTrack."updatedAt", recording."updatedAt", physicalFile."updatedAt") AS "updatedAt",
    releaseTrack."releaseId" AS "albumId",
    coalesce(
        (
            SELECT credit."artistId"
            FROM "ArtistCredit" credit
            WHERE credit."releaseTrackId" = releaseTrack."id" AND credit."role" = 'primary'
            ORDER BY credit."position", credit."id"
            LIMIT 1
        ),
        (
            SELECT credit."artistId"
            FROM "ArtistCredit" credit
            WHERE credit."recordingId" = recording."id" AND credit."role" = 'primary'
            ORDER BY credit."position", credit."id"
            LIMIT 1
        )
    ) AS "artistId",
    physicalFile."filePath" AS "filePath",
    physicalFile."legacyMetadataOverride" AS "metadataOverride",
    physicalFile."contentHash" AS "contentHash",
    physicalFile."hashVersion" AS "hashVersion",
    physicalFile."durationMs" / 1000.0 AS "duration",
    physicalFile."codec" AS "codec",
    physicalFile."container" AS "container",
    physicalFile."bitrate" * 1.0 AS "bitrate",
    physicalFile."sampleRate" * 1.0 AS "sampleRate",
    recording."playCount" AS "playCount",
    recording."lastPlayedAt" AS "lastPlayedAt",
    recording."skipCount" AS "skipCount",
    recording."lastSkippedAt" AS "lastSkippedAt",
    recording."completionCount" AS "completionCount",
    recording."lastCompletedAt" AS "lastCompletedAt",
    physicalFile."lastSeenAt" AS "lastSeenAt",
    physicalFile."missingSinceAt" AS "missingSinceAt",
    physicalFile."syncStatus" AS "syncStatus",
    recording."totalPlayedMs" AS "totalPlayedMs",
    coalesce(releaseTrack."trackNumber", 1) AS "trackNumber"
FROM "ReleaseTrack" releaseTrack
JOIN "Recording" recording ON recording."id" = releaseTrack."recordingId"
JOIN "PhysicalFile" physicalFile ON physicalFile."id" = (
    SELECT candidate."id"
    FROM "PhysicalFile" candidate
    WHERE candidate."releaseTrackId" = releaseTrack."id"
    ORDER BY
        CASE candidate."syncStatus"
            WHEN 'active' THEN 0
            WHEN 'missing' THEN 1
            ELSE 2
        END,
        CASE WHEN candidate."preferenceRank" IS NULL THEN 1 ELSE 0 END,
        candidate."preferenceRank",
        CASE
            WHEN lower(candidate."codec") IN (
                'flac', 'alac', 'wav', 'wave', 'pcm', 'aiff', 'ape', 'wavpack'
            ) THEN 0
            ELSE 1
        END,
        candidate."sampleRate" DESC,
        candidate."bitrate" DESC,
        candidate."fileSizeBytes" DESC,
        candidate."id"
    LIMIT 1
);
