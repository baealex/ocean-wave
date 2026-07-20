-- Existing playback events do not contain trustworthy terminal intent. Keep
-- them as `legacy` instead of inferring skip or completion signals.
ALTER TABLE "Music" ADD COLUMN "skipCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Music" ADD COLUMN "lastSkippedAt" DATETIME;
ALTER TABLE "Music" ADD COLUMN "completionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Music" ADD COLUMN "lastCompletedAt" DATETIME;

ALTER TABLE "PlaybackEvent" ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "PlaybackEvent" ADD COLUMN "endReason" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "PlaybackEvent" ADD COLUMN "hadSeek" BOOLEAN NOT NULL DEFAULT false;

-- The authoritative playback session keeps only the current logical-listen
-- lineage. Nullable fields preserve old sessions without inventing history.
ALTER TABLE "PlaybackSession" ADD COLUMN "historyMusicId" INTEGER;
ALTER TABLE "PlaybackSession" ADD COLUMN "historySessionId" TEXT;
ALTER TABLE "PlaybackSession" ADD COLUMN "historyBranchId" TEXT;
ALTER TABLE "PlaybackSession" ADD COLUMN "historyParentBranchId" TEXT;
ALTER TABLE "PlaybackSession" ADD COLUMN "historyBranchBasePlayedMs" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PlaybackSession" ADD COLUMN "historyStartedAt" DATETIME;
ALTER TABLE "PlaybackSession" ADD COLUMN "historyPlayedMs" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PlaybackSession" ADD COLUMN "historyHadSeek" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlaybackSession" ADD COLUMN "historyUpdatedAt" DATETIME;

-- Each device continuation contributes only the listening performed after its
-- handoff baseline. This preserves one logical event while allowing delayed
-- source and target recovery to arrive in either order.
CREATE TABLE "PlaybackEventBranch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "branchId" TEXT NOT NULL,
    "parentBranchId" TEXT,
    "basePlayedMs" REAL NOT NULL DEFAULT 0,
    "reportedPlayedMs" REAL NOT NULL DEFAULT 0,
    "playbackEventId" INTEGER NOT NULL,
    CONSTRAINT "PlaybackEventBranch_playbackEventId_fkey" FOREIGN KEY ("playbackEventId") REFERENCES "PlaybackEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlaybackEventBranch_playbackEventId_branchId_key"
ON "PlaybackEventBranch"("playbackEventId", "branchId");

CREATE INDEX "PlaybackEventBranch_playbackEventId_parentBranchId_idx"
ON "PlaybackEventBranch"("playbackEventId", "parentBranchId");
