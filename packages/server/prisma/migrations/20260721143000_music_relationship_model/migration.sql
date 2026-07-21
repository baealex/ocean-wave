-- This migration deliberately performs the complete legacy-to-relational swap
-- in one SQLite transaction. The server startup path creates and verifies a
-- database backup before Prisma reaches this migration on an existing library.
PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

CREATE TABLE "__MusicRelationshipMigrationGuard" (
    "issue" TEXT NOT NULL
);

CREATE TRIGGER "__MusicRelationshipMigrationGuard_abort"
BEFORE INSERT ON "__MusicRelationshipMigrationGuard"
BEGIN
    SELECT RAISE(ABORT, 'music relationship migration preflight or verification failed');
END;

-- Reject legacy values that cannot be represented without guessing or loss.
INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'legacy foreign-key violation'
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'duplicate legacy file path'
WHERE EXISTS (
    SELECT 1
    FROM "Music"
    GROUP BY "filePath"
    HAVING count(*) > 1
);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'invalid legacy release year'
WHERE EXISTS (
    SELECT 1
    FROM "Album"
    WHERE length("publishedYear") <> 4
       OR "publishedYear" GLOB '*[^0-9]*'
);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'invalid legacy track position'
WHERE EXISTS (SELECT 1 FROM "Music" WHERE "trackNumber" <= 0);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'invalid legacy media or listening value'
WHERE EXISTS (
    SELECT 1
    FROM "Music"
    WHERE "duration" < 0
       OR "bitrate" < 0
       OR "sampleRate" < 0
       OR "playCount" < 0
       OR "skipCount" < 0
       OR "completionCount" < 0
       OR "totalPlayedMs" < 0
       OR "duration" != "duration"
       OR "bitrate" != "bitrate"
       OR "sampleRate" != "sampleRate"
       OR "totalPlayedMs" != "totalPlayedMs"
       OR abs("duration") > 1.7976931348623157e308
       OR abs("bitrate") > 1.7976931348623157e308
       OR abs("sampleRate") > 1.7976931348623157e308
       OR abs("totalPlayedMs") > 1.7976931348623157e308
);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'invalid legacy sync status'
WHERE EXISTS (
    SELECT 1 FROM "Music"
    WHERE "syncStatus" NOT IN ('active', 'missing', 'duplicate')
);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'duplicate legacy like'
WHERE EXISTS (
    SELECT 1 FROM "MusicLike" GROUP BY "musicId" HAVING count(*) > 1
);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'duplicate legacy hide'
WHERE EXISTS (
    SELECT 1 FROM "MusicHate" GROUP BY "musicId" HAVING count(*) > 1
);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'duplicate legacy playlist membership'
WHERE EXISTS (
    SELECT 1
    FROM "PlaylistMusic"
    GROUP BY "playlistId", "musicId"
    HAVING count(*) > 1
);

CREATE TABLE "_MusicRelationshipMigrationVerification" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" REAL NOT NULL,
    "finalizedAt" DATETIME
);

INSERT INTO "_MusicRelationshipMigrationVerification" ("key", "value") VALUES
    ('album_count', (SELECT count(*) FROM "Album")),
    ('music_count', (SELECT count(*) FROM "Music")),
    ('genre_edge_count', (SELECT count(*) FROM "_GenreToMusic")),
    ('like_count', (SELECT count(*) FROM "MusicLike")),
    ('hate_count', (SELECT count(*) FROM "MusicHate")),
    ('tag_count', (SELECT count(*) FROM "MusicTag")),
    ('playlist_count', (SELECT count(*) FROM "PlaylistMusic")),
    ('queue_count', (SELECT count(*) FROM "PlaybackQueueItem")),
    ('event_count', (SELECT count(*) FROM "PlaybackEvent")),
    ('session_count', (SELECT count(*) FROM "PlaybackSession")),
    ('sync_item_count', (SELECT count(*) FROM "SyncReportItem")),
    ('play_sum', (SELECT coalesce(sum("playCount"), 0) FROM "Music")),
    ('skip_sum', (SELECT coalesce(sum("skipCount"), 0) FROM "Music")),
    ('completion_sum', (SELECT coalesce(sum("completionCount"), 0) FROM "Music")),
    ('played_ms_sum', (SELECT coalesce(sum("totalPlayedMs"), 0) FROM "Music"));

CREATE TABLE "new_Artist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "stableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_Artist" (
    "id", "stableId", "name", "normalizedName", "createdAt", "updatedAt"
)
SELECT
    "id",
    'legacy:artist:' || "id",
    "name",
    lower(trim("name")),
    "createdAt",
    "updatedAt"
FROM "Artist";

CREATE TABLE "Recording" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "stableId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "versionTitle" TEXT,
    "metadataRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("metadataRevision" >= 0),
    "playCount" INTEGER NOT NULL DEFAULT 0 CHECK ("playCount" >= 0),
    "lastPlayedAt" DATETIME,
    "skipCount" INTEGER NOT NULL DEFAULT 0 CHECK ("skipCount" >= 0),
    "lastSkippedAt" DATETIME,
    "completionCount" INTEGER NOT NULL DEFAULT 0 CHECK ("completionCount" >= 0),
    "lastCompletedAt" DATETIME,
    "totalPlayedMs" REAL NOT NULL DEFAULT 0 CHECK ("totalPlayedMs" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Release" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "stableId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "releaseDate" TEXT,
    "releaseType" TEXT NOT NULL DEFAULT 'unknown'
        CHECK ("releaseType" IN ('album', 'single', 'ep', 'compilation', 'live', 'unknown')),
    "totalDiscs" INTEGER CHECK ("totalDiscs" IS NULL OR "totalDiscs" > 0),
    "cover" TEXT NOT NULL DEFAULT '',
    "isCoverCustom" BOOLEAN NOT NULL DEFAULT false,
    "metadataRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("metadataRevision" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ReleaseTrack" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "stableId" TEXT NOT NULL,
    "recordingId" INTEGER NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "titleOverride" TEXT,
    "versionTitle" TEXT,
    "discNumber" INTEGER CHECK ("discNumber" IS NULL OR "discNumber" > 0),
    "trackNumber" INTEGER CHECK ("trackNumber" IS NULL OR "trackNumber" > 0),
    "metadataRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("metadataRevision" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReleaseTrack_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReleaseTrack_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PhysicalFile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "stableId" TEXT NOT NULL,
    "releaseTrackId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "contentHash" TEXT,
    "hashVersion" INTEGER,
    "durationMs" INTEGER NOT NULL CHECK ("durationMs" >= 0),
    "codec" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "bitrate" INTEGER NOT NULL CHECK ("bitrate" >= 0),
    "sampleRate" INTEGER NOT NULL CHECK ("sampleRate" >= 0),
    "fileSizeBytes" BIGINT CHECK ("fileSizeBytes" IS NULL OR "fileSizeBytes" >= 0),
    "tagSnapshotJson" TEXT,
    "tagSnapshotVersion" INTEGER,
    "legacyMetadataOverride" TEXT,
    "preferenceRank" INTEGER CHECK ("preferenceRank" IS NULL OR "preferenceRank" >= 0),
    "metadataRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("metadataRevision" >= 0),
    "lastSeenAt" DATETIME,
    "missingSinceAt" DATETIME,
    "syncStatus" TEXT NOT NULL DEFAULT 'active'
        CHECK ("syncStatus" IN ('active', 'missing', 'duplicate')),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PhysicalFile_releaseTrackId_fkey" FOREIGN KEY ("releaseTrackId") REFERENCES "ReleaseTrack" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ArtistCredit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER NOT NULL,
    "recordingId" INTEGER,
    "releaseId" INTEGER,
    "releaseTrackId" INTEGER,
    "role" TEXT NOT NULL DEFAULT 'primary'
        CHECK ("role" IN ('primary', 'featured', 'remixer', 'performer', 'composer', 'conductor', 'unknown')),
    "position" INTEGER NOT NULL CHECK ("position" >= 0),
    "creditedName" TEXT,
    "joinPhrase" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArtistCredit_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ArtistCredit_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtistCredit_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArtistCredit_releaseTrackId_fkey" FOREIGN KEY ("releaseTrackId") REFERENCES "ReleaseTrack" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK (
        ("recordingId" IS NOT NULL) +
        ("releaseId" IS NOT NULL) +
        ("releaseTrackId" IS NOT NULL) = 1
    )
);

CREATE TABLE "RecordingGenre" (
    "recordingId" INTEGER NOT NULL,
    "genreId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'file',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("recordingId", "genreId"),
    CONSTRAINT "RecordingGenre_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecordingGenre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "Recording" (
    "id", "stableId", "title", "versionTitle", "metadataRevision",
    "playCount", "lastPlayedAt", "skipCount", "lastSkippedAt",
    "completionCount", "lastCompletedAt", "totalPlayedMs", "createdAt", "updatedAt"
)
SELECT
    "id", 'legacy:recording:' || "id", "name", NULL, 0,
    "playCount", "lastPlayedAt", "skipCount", "lastSkippedAt",
    "completionCount", "lastCompletedAt", "totalPlayedMs", "createdAt", "updatedAt"
FROM "Music";

INSERT INTO "Release" (
    "id", "stableId", "title", "releaseDate", "releaseType", "totalDiscs",
    "cover", "isCoverCustom", "metadataRevision", "createdAt", "updatedAt"
)
SELECT
    "id", 'legacy:release:' || "id", "name", "publishedYear", 'unknown', 1,
    "cover", "isCoverCustom", 0, "createdAt", "updatedAt"
FROM "Album";

INSERT INTO "ReleaseTrack" (
    "id", "stableId", "recordingId", "releaseId", "titleOverride",
    "versionTitle", "discNumber", "trackNumber", "metadataRevision",
    "createdAt", "updatedAt"
)
SELECT
    "id", 'legacy:release-track:' || "id", "id", "albumId", NULL,
    NULL, 1, "trackNumber", 0, "createdAt", "updatedAt"
FROM "Music";

INSERT INTO "PhysicalFile" (
    "id", "stableId", "releaseTrackId", "filePath", "contentHash", "hashVersion",
    "durationMs", "codec", "container", "bitrate", "sampleRate", "fileSizeBytes",
    "tagSnapshotJson", "tagSnapshotVersion", "legacyMetadataOverride",
    "preferenceRank", "metadataRevision", "lastSeenAt", "missingSinceAt",
    "syncStatus", "createdAt", "updatedAt"
)
SELECT
    legacy."id", 'legacy:file:' || legacy."id", legacy."id",
    legacy."filePath", legacy."contentHash", legacy."hashVersion",
    CAST(round(legacy."duration" * 1000) AS INTEGER), legacy."codec", legacy."container",
    CAST(round(legacy."bitrate") AS INTEGER),
    CAST(round(legacy."sampleRate") AS INTEGER), NULL,
    NULL, NULL, legacy."metadataOverride", NULL, 0,
    legacy."lastSeenAt", legacy."missingSinceAt",
    legacy."syncStatus", legacy."createdAt", legacy."updatedAt"
FROM "Music" legacy;

INSERT INTO "ArtistCredit" (
    "id", "artistId", "recordingId", "releaseId", "releaseTrackId", "role",
    "position", "creditedName", "joinPhrase", "createdAt", "updatedAt"
)
SELECT
    "id", "artistId", "id", NULL, NULL, 'primary', 0, NULL, '', "createdAt", "updatedAt"
FROM "Music";

INSERT INTO "ArtistCredit" (
    "id", "artistId", "recordingId", "releaseId", "releaseTrackId", "role",
    "position", "creditedName", "joinPhrase", "createdAt", "updatedAt"
)
SELECT
    (SELECT coalesce(max("id"), 0) FROM "Music") + "id",
    "artistId", NULL, "id", NULL, 'primary', 0, NULL, '', "createdAt", "updatedAt"
FROM "Album";

INSERT INTO "RecordingGenre" (
    "recordingId", "genreId", "source", "createdAt", "updatedAt"
)
SELECT
    legacy."B", legacy."A", 'file', recording."createdAt", recording."updatedAt"
FROM "_GenreToMusic" legacy
JOIN "Recording" recording ON recording."id" = legacy."B";

-- Rebuild every dependent table so the physical foreign-key columns identify
-- their new canonical owners. Numeric ids are preserved one-to-one.
CREATE TABLE "new_MusicLike" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "recordingId" INTEGER NOT NULL,
    CONSTRAINT "MusicLike_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MusicLike" SELECT "id", "createdAt", "updatedAt", "musicId" FROM "MusicLike";

CREATE TABLE "new_MusicHate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "recordingId" INTEGER NOT NULL,
    CONSTRAINT "MusicHate_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MusicHate" SELECT "id", "createdAt", "updatedAt", "musicId" FROM "MusicHate";

CREATE TABLE "new_MusicTag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "recordingId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    CONSTRAINT "MusicTag_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MusicTag" SELECT "id", "source", "createdAt", "updatedAt", "musicId", "tagId" FROM "MusicTag";

CREATE TABLE "new_PlaylistMusic" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "releaseTrackId" INTEGER NOT NULL,
    "playlistId" INTEGER NOT NULL,
    CONSTRAINT "PlaylistMusic_releaseTrackId_fkey" FOREIGN KEY ("releaseTrackId") REFERENCES "ReleaseTrack" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaylistMusic_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlaylistMusic" SELECT "id", "order", "createdAt", "updatedAt", "musicId", "playlistId" FROM "PlaylistMusic";

CREATE TABLE "new_PlaybackQueueItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "queueId" INTEGER NOT NULL,
    "releaseTrackId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "sourceOrder" INTEGER,
    CONSTRAINT "PlaybackQueueItem_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "PlaybackQueue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaybackQueueItem_releaseTrackId_fkey" FOREIGN KEY ("releaseTrackId") REFERENCES "ReleaseTrack" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PlaybackQueueItem" SELECT "id", "queueId", "musicId", "order", "sourceOrder" FROM "PlaybackQueueItem";

CREATE TABLE "new_PlaybackEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL,
    "playedMs" REAL NOT NULL,
    "completionRate" REAL NOT NULL,
    "countedAsPlay" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT NOT NULL DEFAULT 'legacy',
    "endReason" TEXT NOT NULL DEFAULT 'legacy',
    "hadSeek" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "clientSessionId" TEXT,
    "connectorId" TEXT,
    "recordingId" INTEGER NOT NULL,
    "releaseTrackId" INTEGER NOT NULL,
    "physicalFileId" INTEGER,
    CONSTRAINT "PlaybackEvent_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaybackEvent_releaseTrackId_fkey" FOREIGN KEY ("releaseTrackId") REFERENCES "ReleaseTrack" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaybackEvent_physicalFileId_fkey" FOREIGN KEY ("physicalFileId") REFERENCES "PhysicalFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlaybackEvent" (
    "id", "createdAt", "startedAt", "endedAt", "playedMs", "completionRate",
    "countedAsPlay", "outcome", "endReason", "hadSeek", "source",
    "clientSessionId", "connectorId", "recordingId", "releaseTrackId", "physicalFileId"
)
SELECT
    "id", "createdAt", "startedAt", "endedAt", "playedMs", "completionRate",
    "countedAsPlay", "outcome", "endReason", "hadSeek", "source",
    "clientSessionId", "connectorId", "musicId", "musicId", "musicId"
FROM "PlaybackEvent";

CREATE TABLE "new_PlaybackSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scopeKey" TEXT NOT NULL DEFAULT 'local',
    "state" TEXT NOT NULL DEFAULT 'stopped',
    "activeDeviceId" TEXT,
    "activeDeviceSequence" INTEGER NOT NULL DEFAULT 0,
    "currentReleaseTrackId" INTEGER,
    "positionMs" REAL NOT NULL DEFAULT 0,
    "positionUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "historyRecordingId" INTEGER,
    "historyReleaseTrackId" INTEGER,
    "historyPhysicalFileId" INTEGER,
    "historySessionId" TEXT,
    "historyBranchId" TEXT,
    "historyParentBranchId" TEXT,
    "historyBranchBasePlayedMs" REAL NOT NULL DEFAULT 0,
    "historyStartedAt" DATETIME,
    "historyPlayedMs" REAL NOT NULL DEFAULT 0,
    "historyHadSeek" BOOLEAN NOT NULL DEFAULT false,
    "historyUpdatedAt" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaybackSession_currentReleaseTrackId_fkey" FOREIGN KEY ("currentReleaseTrackId") REFERENCES "ReleaseTrack" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlaybackSession_historyRecordingId_fkey" FOREIGN KEY ("historyRecordingId") REFERENCES "Recording" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlaybackSession_historyReleaseTrackId_fkey" FOREIGN KEY ("historyReleaseTrackId") REFERENCES "ReleaseTrack" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlaybackSession_historyPhysicalFileId_fkey" FOREIGN KEY ("historyPhysicalFileId") REFERENCES "PhysicalFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlaybackSession" (
    "id", "scopeKey", "state", "activeDeviceId", "activeDeviceSequence",
    "currentReleaseTrackId", "positionMs", "positionUpdatedAt", "startedAt",
    "historyRecordingId", "historyReleaseTrackId", "historyPhysicalFileId",
    "historySessionId", "historyBranchId", "historyParentBranchId",
    "historyBranchBasePlayedMs", "historyStartedAt", "historyPlayedMs",
    "historyHadSeek", "historyUpdatedAt", "revision", "createdAt", "updatedAt"
)
SELECT
    "id", "scopeKey", "state", "activeDeviceId", "activeDeviceSequence",
    "currentMusicId", "positionMs", "positionUpdatedAt", "startedAt",
    "historyMusicId", "historyMusicId", "historyMusicId",
    "historySessionId", "historyBranchId", "historyParentBranchId",
    "historyBranchBasePlayedMs", "historyStartedAt", "historyPlayedMs",
    "historyHadSeek", "historyUpdatedAt", "revision", "createdAt", "updatedAt"
FROM "PlaybackSession";

CREATE TABLE "new_SyncReportItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "physicalFileId" INTEGER,
    "musicName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "previousFilePath" TEXT,
    "syncReportId" INTEGER NOT NULL,
    CONSTRAINT "SyncReportItem_syncReportId_fkey" FOREIGN KEY ("syncReportId") REFERENCES "SyncReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SyncReportItem_physicalFileId_fkey" FOREIGN KEY ("physicalFileId") REFERENCES "PhysicalFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SyncReportItem" SELECT "id", "createdAt", "kind", "musicId", "musicName", "filePath", "previousFilePath", "syncReportId" FROM "SyncReportItem";

-- Verify the backfill before any legacy table is dropped.
INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'core row count mismatch'
WHERE (SELECT count(*) FROM "Recording") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'music_count')
   OR (SELECT count(*) FROM "ReleaseTrack") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'music_count')
   OR (SELECT count(*) FROM "PhysicalFile") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'music_count')
   OR (SELECT count(*) FROM "Release") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'album_count');

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'dependent row count mismatch'
WHERE (SELECT count(*) FROM "new_MusicLike") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'like_count')
   OR (SELECT count(*) FROM "RecordingGenre") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'genre_edge_count')
   OR (SELECT count(*) FROM "new_MusicHate") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'hate_count')
   OR (SELECT count(*) FROM "new_MusicTag") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'tag_count')
   OR (SELECT count(*) FROM "new_PlaylistMusic") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'playlist_count')
   OR (SELECT count(*) FROM "new_PlaybackQueueItem") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'queue_count')
   OR (SELECT count(*) FROM "new_PlaybackEvent") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'event_count')
   OR (SELECT count(*) FROM "new_PlaybackSession") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'session_count')
   OR (SELECT count(*) FROM "new_SyncReportItem") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'sync_item_count');

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'listening aggregate mismatch'
WHERE (SELECT coalesce(sum("playCount"), 0) FROM "Recording") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'play_sum')
   OR (SELECT coalesce(sum("skipCount"), 0) FROM "Recording") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'skip_sum')
   OR (SELECT coalesce(sum("completionCount"), 0) FROM "Recording") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'completion_sum')
   OR (SELECT coalesce(sum("totalPlayedMs"), 0) FROM "Recording") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'played_ms_sum');

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'compatibility identity mismatch'
WHERE EXISTS (
    SELECT 1
    FROM "Music" legacy
    JOIN "Recording" recording ON recording."id" = legacy."id"
    JOIN "ReleaseTrack" releaseTrack ON releaseTrack."id" = legacy."id"
    JOIN "PhysicalFile" physicalFile ON physicalFile."id" = legacy."id"
    WHERE recording."title" <> legacy."name"
       OR releaseTrack."releaseId" <> legacy."albumId"
       OR physicalFile."filePath" <> legacy."filePath"
       OR physicalFile."syncStatus" <> legacy."syncStatus"
);

DROP TABLE "MusicLike";
DROP TABLE "MusicHate";
DROP TABLE "MusicTag";
DROP TABLE "PlaylistMusic";
DROP TABLE "PlaybackQueueItem";
DROP TABLE "PlaybackEvent";
DROP TABLE "PlaybackSession";
DROP TABLE "SyncReportItem";
DROP TABLE "_GenreToMusic";
DROP TABLE "Music";
DROP TABLE "Album";
DROP TABLE "Artist";

ALTER TABLE "new_Artist" RENAME TO "Artist";
ALTER TABLE "new_MusicLike" RENAME TO "MusicLike";
ALTER TABLE "new_MusicHate" RENAME TO "MusicHate";
ALTER TABLE "new_MusicTag" RENAME TO "MusicTag";
ALTER TABLE "new_PlaylistMusic" RENAME TO "PlaylistMusic";
ALTER TABLE "new_PlaybackQueueItem" RENAME TO "PlaybackQueueItem";
ALTER TABLE "new_PlaybackEvent" RENAME TO "PlaybackEvent";
ALTER TABLE "new_PlaybackSession" RENAME TO "PlaybackSession";
ALTER TABLE "new_SyncReportItem" RENAME TO "SyncReportItem";

CREATE UNIQUE INDEX "Artist_stableId_key" ON "Artist"("stableId");
CREATE INDEX "Artist_normalizedName_idx" ON "Artist"("normalizedName");
CREATE UNIQUE INDEX "Recording_stableId_key" ON "Recording"("stableId");
CREATE INDEX "Recording_title_idx" ON "Recording"("title");
CREATE INDEX "Recording_lastPlayedAt_idx" ON "Recording"("lastPlayedAt");
CREATE UNIQUE INDEX "Release_stableId_key" ON "Release"("stableId");
CREATE INDEX "Release_title_idx" ON "Release"("title");
CREATE INDEX "Release_releaseType_releaseDate_idx" ON "Release"("releaseType", "releaseDate");
CREATE UNIQUE INDEX "ReleaseTrack_stableId_key" ON "ReleaseTrack"("stableId");
CREATE INDEX "ReleaseTrack_recordingId_idx" ON "ReleaseTrack"("recordingId");
CREATE INDEX "ReleaseTrack_releaseId_discNumber_trackNumber_idx" ON "ReleaseTrack"("releaseId", "discNumber", "trackNumber");
CREATE UNIQUE INDEX "PhysicalFile_stableId_key" ON "PhysicalFile"("stableId");
CREATE UNIQUE INDEX "PhysicalFile_filePath_key" ON "PhysicalFile"("filePath");
CREATE UNIQUE INDEX "PhysicalFile_releaseTrackId_preferenceRank_key" ON "PhysicalFile"("releaseTrackId", "preferenceRank");
CREATE INDEX "PhysicalFile_releaseTrackId_syncStatus_preferenceRank_idx" ON "PhysicalFile"("releaseTrackId", "syncStatus", "preferenceRank");
CREATE INDEX "PhysicalFile_hashVersion_contentHash_idx" ON "PhysicalFile"("hashVersion", "contentHash");
CREATE INDEX "PhysicalFile_syncStatus_missingSinceAt_idx" ON "PhysicalFile"("syncStatus", "missingSinceAt");
CREATE UNIQUE INDEX "ArtistCredit_recordingId_position_key" ON "ArtistCredit"("recordingId", "position");
CREATE UNIQUE INDEX "ArtistCredit_releaseId_position_key" ON "ArtistCredit"("releaseId", "position");
CREATE UNIQUE INDEX "ArtistCredit_releaseTrackId_position_key" ON "ArtistCredit"("releaseTrackId", "position");
CREATE INDEX "ArtistCredit_artistId_idx" ON "ArtistCredit"("artistId");
CREATE INDEX "RecordingGenre_genreId_recordingId_idx" ON "RecordingGenre"("genreId", "recordingId");
CREATE UNIQUE INDEX "MusicLike_recordingId_key" ON "MusicLike"("recordingId");
CREATE UNIQUE INDEX "MusicHate_recordingId_key" ON "MusicHate"("recordingId");
CREATE UNIQUE INDEX "MusicTag_recordingId_tagId_key" ON "MusicTag"("recordingId", "tagId");
CREATE INDEX "MusicTag_tagId_recordingId_idx" ON "MusicTag"("tagId", "recordingId");
CREATE UNIQUE INDEX "PlaylistMusic_playlistId_releaseTrackId_key" ON "PlaylistMusic"("playlistId", "releaseTrackId");
CREATE INDEX "PlaylistMusic_playlistId_order_idx" ON "PlaylistMusic"("playlistId", "order");
CREATE INDEX "PlaylistMusic_releaseTrackId_idx" ON "PlaylistMusic"("releaseTrackId");
CREATE UNIQUE INDEX "PlaybackQueueItem_queueId_releaseTrackId_key" ON "PlaybackQueueItem"("queueId", "releaseTrackId");
CREATE UNIQUE INDEX "PlaybackQueueItem_queueId_order_key" ON "PlaybackQueueItem"("queueId", "order");
CREATE INDEX "PlaybackQueueItem_releaseTrackId_idx" ON "PlaybackQueueItem"("releaseTrackId");
CREATE UNIQUE INDEX "PlaybackEvent_clientSessionId_key" ON "PlaybackEvent"("clientSessionId");
CREATE INDEX "PlaybackEvent_recordingId_endedAt_idx" ON "PlaybackEvent"("recordingId", "endedAt");
CREATE INDEX "PlaybackEvent_releaseTrackId_endedAt_idx" ON "PlaybackEvent"("releaseTrackId", "endedAt");
CREATE INDEX "PlaybackEvent_physicalFileId_idx" ON "PlaybackEvent"("physicalFileId");
CREATE UNIQUE INDEX "PlaybackSession_scopeKey_key" ON "PlaybackSession"("scopeKey");
CREATE INDEX "PlaybackSession_currentReleaseTrackId_idx" ON "PlaybackSession"("currentReleaseTrackId");
CREATE INDEX "PlaybackSession_historyRecordingId_idx" ON "PlaybackSession"("historyRecordingId");
CREATE INDEX "PlaybackSession_historyReleaseTrackId_idx" ON "PlaybackSession"("historyReleaseTrackId");
CREATE INDEX "PlaybackSession_historyPhysicalFileId_idx" ON "PlaybackSession"("historyPhysicalFileId");
CREATE INDEX "SyncReportItem_syncReportId_kind_idx" ON "SyncReportItem"("syncReportId", "kind");
CREATE INDEX "SyncReportItem_physicalFileId_idx" ON "SyncReportItem"("physicalFileId");

-- Compatibility views preserve the current GraphQL names and numeric ids while
-- all mutable state remains owned by the relational tables above.
CREATE VIEW "Album" AS
SELECT
    release."id" AS "id",
    release."title" AS "name",
    release."cover" AS "cover",
    release."isCoverCustom" AS "isCoverCustom",
    release."createdAt" AS "createdAt",
    release."updatedAt" AS "updatedAt",
    coalesce(release."releaseDate", '') AS "publishedYear",
    (
        SELECT credit."artistId"
        FROM "ArtistCredit" credit
        WHERE credit."releaseId" = release."id" AND credit."role" = 'primary'
        ORDER BY credit."position", credit."id"
        LIMIT 1
    ) AS "artistId"
FROM "Release" release;

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
        candidate."id"
    LIMIT 1
);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'post-swap foreign-key violation'
WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);

INSERT INTO "__MusicRelationshipMigrationGuard" ("issue")
SELECT 'compatibility view row count mismatch'
WHERE (SELECT count(*) FROM "Music") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'music_count')
   OR (SELECT count(*) FROM "Album") <> (SELECT "value" FROM "_MusicRelationshipMigrationVerification" WHERE "key" = 'album_count');

DROP TRIGGER "__MusicRelationshipMigrationGuard_abort";
DROP TABLE "__MusicRelationshipMigrationGuard";

COMMIT;
PRAGMA foreign_keys=ON;
