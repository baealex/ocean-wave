ALTER TABLE "PhysicalFile"
ADD COLUMN "metadataSyncStatus" TEXT NOT NULL DEFAULT 'current'
    CHECK ("metadataSyncStatus" IN ('current', 'stale', 'reconcile-required'));

ALTER TABLE "PhysicalFile"
ADD COLUMN "metadataSyncError" TEXT;

ALTER TABLE "SyncReport"
ADD COLUMN "reconcileCount" INTEGER NOT NULL DEFAULT 0
    CHECK ("reconcileCount" >= 0);

CREATE TABLE "MusicMetadataOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "selectedReleaseTrackStableId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preparing'
        CHECK ("status" IN (
            'preparing',
            'prepared',
            'replacing',
            'replaced',
            'committed',
            'cleaned',
            'failed',
            'rolled-back',
            'reconcile-required'
        )),
    "previewToken" TEXT NOT NULL,
    "requestedJson" TEXT NOT NULL,
    "oldRelationalJson" TEXT NOT NULL,
    "expectedRevisionsJson" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryOfId" TEXT,
    "preparedAt" DATETIME,
    "replacedAt" DATETIME,
    "committedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "MusicMetadataOperationTarget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "operationId" TEXT NOT NULL,
    "physicalFileStableId" TEXT NOT NULL,
    "releaseTrackStableId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending'
        CHECK ("status" IN (
            'pending',
            'prepared',
            'replacing',
            'replaced',
            'restored',
            'cleaned',
            'failed',
            'reconcile-required'
        )),
    "oldContentHash" TEXT NOT NULL,
    "newContentHash" TEXT,
    "hashVersion" INTEGER NOT NULL CHECK ("hashVersion" > 0),
    "oldFileSizeBytes" BIGINT CHECK (
        "oldFileSizeBytes" IS NULL OR "oldFileSizeBytes" >= 0
    ),
    "newFileSizeBytes" BIGINT CHECK (
        "newFileSizeBytes" IS NULL OR "newFileSizeBytes" >= 0
    ),
    "oldTagSnapshotJson" TEXT,
    "newTagSnapshotJson" TEXT,
    "oldMetadataSyncStatus" TEXT NOT NULL DEFAULT 'current'
        CHECK ("oldMetadataSyncStatus" IN ('current', 'stale', 'reconcile-required')),
    "oldMetadataSyncError" TEXT,
    "stagingPath" TEXT,
    "backupPath" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicMetadataOperationTarget_operationId_fkey"
        FOREIGN KEY ("operationId") REFERENCES "MusicMetadataOperation" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MusicMetadataOperationTarget_operationId_physicalFileStableId_key"
ON "MusicMetadataOperationTarget"("operationId", "physicalFileStableId");

CREATE INDEX "MusicMetadataOperation_selectedReleaseTrackStableId_createdAt_idx"
ON "MusicMetadataOperation"("selectedReleaseTrackStableId", "createdAt");

CREATE INDEX "MusicMetadataOperation_status_updatedAt_idx"
ON "MusicMetadataOperation"("status", "updatedAt");

CREATE INDEX "MusicMetadataOperationTarget_physicalFileStableId_status_idx"
ON "MusicMetadataOperationTarget"("physicalFileStableId", "status");

CREATE INDEX "MusicMetadataOperationTarget_releaseTrackStableId_operationId_idx"
ON "MusicMetadataOperationTarget"("releaseTrackStableId", "operationId");

CREATE INDEX "MusicMetadataOperationTarget_operationId_status_idx"
ON "MusicMetadataOperationTarget"("operationId", "status");
