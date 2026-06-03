-- CreateTable
CREATE TABLE "Tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scopeKey" TEXT NOT NULL DEFAULT 'local',
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MusicTag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "musicId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    CONSTRAINT "MusicTag_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SmartView" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scopeKey" TEXT NOT NULL DEFAULT 'local',
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "tagMode" TEXT NOT NULL DEFAULT 'all',
    "filterVersion" INTEGER NOT NULL DEFAULT 1,
    "filterJson" TEXT,
    "sortKey" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SmartViewTag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "polarity" TEXT NOT NULL DEFAULT 'include',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "smartViewId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    CONSTRAINT "SmartViewTag_smartViewId_fkey" FOREIGN KEY ("smartViewId") REFERENCES "SmartView" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SmartViewTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Tag_scopeKey_order_idx" ON "Tag"("scopeKey", "order");

-- CreateIndex
CREATE INDEX "Tag_scopeKey_updatedAt_idx" ON "Tag"("scopeKey", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_scopeKey_normalizedName_key" ON "Tag"("scopeKey", "normalizedName");

-- CreateIndex
CREATE INDEX "MusicTag_tagId_musicId_idx" ON "MusicTag"("tagId", "musicId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicTag_musicId_tagId_key" ON "MusicTag"("musicId", "tagId");

-- CreateIndex
CREATE INDEX "SmartView_scopeKey_order_idx" ON "SmartView"("scopeKey", "order");

-- CreateIndex
CREATE INDEX "SmartView_scopeKey_updatedAt_idx" ON "SmartView"("scopeKey", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmartView_scopeKey_normalizedName_key" ON "SmartView"("scopeKey", "normalizedName");

-- CreateIndex
CREATE INDEX "SmartViewTag_tagId_smartViewId_idx" ON "SmartViewTag"("tagId", "smartViewId");

-- CreateIndex
CREATE INDEX "SmartViewTag_smartViewId_order_idx" ON "SmartViewTag"("smartViewId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SmartViewTag_smartViewId_tagId_key" ON "SmartViewTag"("smartViewId", "tagId");
