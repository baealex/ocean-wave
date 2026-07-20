CREATE TABLE "PlaybackDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PlaybackEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "lastSeenAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaybackEndpoint_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PlaybackDevice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PlaybackDevice_lastSeenAt_idx" ON "PlaybackDevice"("lastSeenAt");
CREATE INDEX "PlaybackEndpoint_deviceId_lastSeenAt_idx" ON "PlaybackEndpoint"("deviceId", "lastSeenAt");
