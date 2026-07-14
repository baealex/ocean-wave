-- CreateTable
CREATE TABLE "PlaybackSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scopeKey" TEXT NOT NULL DEFAULT 'local',
    "state" TEXT NOT NULL DEFAULT 'stopped',
    "activeDeviceId" TEXT,
    "activeDeviceSequence" INTEGER NOT NULL DEFAULT 0,
    "currentMusicId" INTEGER,
    "positionMs" REAL NOT NULL DEFAULT 0,
    "positionUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaybackSession_currentMusicId_fkey" FOREIGN KEY ("currentMusicId") REFERENCES "Music" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackSession_scopeKey_key" ON "PlaybackSession"("scopeKey");

-- CreateIndex
CREATE INDEX "PlaybackSession_currentMusicId_idx" ON "PlaybackSession"("currentMusicId");
