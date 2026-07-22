DROP INDEX IF EXISTS "PlaylistMusic_playlistId_releaseTrackId_key";
CREATE INDEX "PlaylistMusic_playlistId_releaseTrackId_idx" ON "PlaylistMusic"("playlistId", "releaseTrackId");

CREATE TABLE "PlaylistImportSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "sourceJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "playlistId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaylistImportSession_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PlaylistImportSession_status_updatedAt_idx" ON "PlaylistImportSession"("status", "updatedAt");
CREATE INDEX "PlaylistImportSession_playlistId_idx" ON "PlaylistImportSession"("playlistId");

CREATE TABLE "PlaylistImportItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "sourceJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "candidateIdsJson" TEXT NOT NULL,
    "selectedMusicId" INTEGER,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaylistImportItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PlaylistImportSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistImportItem_selectedMusicId_fkey" FOREIGN KEY ("selectedMusicId") REFERENCES "ReleaseTrack" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlaylistImportItem_sessionId_order_key" ON "PlaylistImportItem"("sessionId", "order");
CREATE INDEX "PlaylistImportItem_sessionId_status_idx" ON "PlaylistImportItem"("sessionId", "status");
CREATE INDEX "PlaylistImportItem_selectedMusicId_idx" ON "PlaylistImportItem"("selectedMusicId");
