-- CreateTable
CREATE TABLE "PlaybackQueue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "currentIndex" INTEGER,
    "shuffle" BOOLEAN NOT NULL DEFAULT false,
    "repeatMode" TEXT NOT NULL DEFAULT 'none',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaybackQueue_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PlaybackSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaybackQueueItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "queueId" INTEGER NOT NULL,
    "musicId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "sourceOrder" INTEGER,
    CONSTRAINT "PlaybackQueueItem_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "PlaybackQueue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaybackQueueItem_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackQueue_sessionId_key" ON "PlaybackQueue"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackQueueItem_queueId_musicId_key" ON "PlaybackQueueItem"("queueId", "musicId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackQueueItem_queueId_order_key" ON "PlaybackQueueItem"("queueId", "order");

-- CreateIndex
CREATE INDEX "PlaybackQueueItem_musicId_idx" ON "PlaybackQueueItem"("musicId");
