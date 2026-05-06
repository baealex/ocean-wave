-- CreateTable
CREATE TABLE "Artist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Album" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "cover" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedYear" TEXT NOT NULL,
    "artistId" INTEGER NOT NULL,
    CONSTRAINT "Album_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Genre" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Music" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "albumId" INTEGER NOT NULL,
    "artistId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "contentHash" TEXT,
    "hashVersion" INTEGER,
    "duration" REAL NOT NULL,
    "codec" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "bitrate" REAL NOT NULL,
    "sampleRate" REAL NOT NULL,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" DATETIME,
    "lastSeenAt" DATETIME,
    "missingSinceAt" DATETIME,
    "syncStatus" TEXT NOT NULL DEFAULT 'active',
    "totalPlayedMs" REAL NOT NULL DEFAULT 0,
    "trackNumber" INTEGER NOT NULL,
    CONSTRAINT "Music_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Music_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "status" TEXT NOT NULL,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "scannedFiles" INTEGER NOT NULL DEFAULT 0,
    "indexedFiles" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "movedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "SyncReportItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "musicId" INTEGER,
    "musicName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "previousFilePath" TEXT,
    "syncReportId" INTEGER NOT NULL,
    CONSTRAINT "SyncReportItem_syncReportId_fkey" FOREIGN KEY ("syncReportId") REFERENCES "SyncReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaybackEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL,
    "playedMs" REAL NOT NULL,
    "completionRate" REAL NOT NULL,
    "countedAsPlay" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "clientSessionId" TEXT,
    "connectorId" TEXT,
    "musicId" INTEGER NOT NULL,
    CONSTRAINT "PlaybackEvent_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicLike" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "musicId" INTEGER NOT NULL,
    CONSTRAINT "MusicLike_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicHate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "musicId" INTEGER NOT NULL,
    CONSTRAINT "MusicHate_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlaylistMusic" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "musicId" INTEGER NOT NULL,
    "playlistId" INTEGER NOT NULL,
    CONSTRAINT "PlaylistMusic_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaylistMusic_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_GenreToMusic" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_GenreToMusic_A_fkey" FOREIGN KEY ("A") REFERENCES "Genre" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_GenreToMusic_B_fkey" FOREIGN KEY ("B") REFERENCES "Music" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_name_key" ON "Artist"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_name_key" ON "Genre"("name");

-- CreateIndex
CREATE INDEX "Music_contentHash_idx" ON "Music"("contentHash");

-- CreateIndex
CREATE INDEX "Music_syncStatus_missingSinceAt_idx" ON "Music"("syncStatus", "missingSinceAt");

-- CreateIndex
CREATE INDEX "SyncReport_createdAt_idx" ON "SyncReport"("createdAt");

-- CreateIndex
CREATE INDEX "SyncReport_status_createdAt_idx" ON "SyncReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncReportItem_syncReportId_kind_idx" ON "SyncReportItem"("syncReportId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackEvent_clientSessionId_key" ON "PlaybackEvent"("clientSessionId");

-- CreateIndex
CREATE INDEX "PlaybackEvent_musicId_endedAt_idx" ON "PlaybackEvent"("musicId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "_GenreToMusic_AB_unique" ON "_GenreToMusic"("A", "B");

-- CreateIndex
CREATE INDEX "_GenreToMusic_B_index" ON "_GenreToMusic"("B");
