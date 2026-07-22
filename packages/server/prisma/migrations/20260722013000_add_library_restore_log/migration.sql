CREATE TABLE "LibraryRestoreApplication" (
    "manifestId" TEXT NOT NULL PRIMARY KEY,
    "manifestHash" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
