ALTER TABLE "Album" ADD COLUMN "isCoverCustom" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Music" ADD COLUMN "metadataOverride" TEXT;
