-- Preserve the collection that started a shared queue so another browser can
-- describe a recent continuation without loading every album or playlist.
ALTER TABLE "PlaybackQueue" ADD COLUMN "contextType" TEXT NOT NULL DEFAULT 'queue';
ALTER TABLE "PlaybackQueue" ADD COLUMN "contextId" INTEGER;
ALTER TABLE "PlaybackQueue" ADD COLUMN "contextTitle" TEXT;
