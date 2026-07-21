import Database from 'better-sqlite3';
import childProcess from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';

import {
    finalizeMusicRelationshipMigration,
    MUSIC_RELATIONSHIP_MIGRATION_NAME,
    MusicRelationshipMigrationPreflightError,
    prepareMusicRelationshipMigration,
    REQUIRED_MUSIC_RELATIONSHIP_BASELINE_MIGRATIONS
} from './music-relationship-migration';

const serverDirectory = path.resolve(__dirname, '..');
const migrationsDirectory = path.join(serverDirectory, 'prisma/migrations');
const targetMigrationPath = path.join(
    migrationsDirectory,
    MUSIC_RELATIONSHIP_MIGRATION_NAME,
    'migration.sql'
);
const fixedTime = '2026-07-21T00:00:00.000Z';
const temporaryDirectories: string[] = [];

jest.setTimeout(60_000);

const createTemporaryDatabasePath = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-migration-'));
    temporaryDirectories.push(directory);
    return path.join(directory, 'library.sqlite3');
};

const createMigrationTable = (database: Database.Database) => {
    database.exec(`
        CREATE TABLE "_prisma_migrations" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "checksum" TEXT NOT NULL,
            "finished_at" DATETIME,
            "migration_name" TEXT NOT NULL,
            "logs" TEXT,
            "rolled_back_at" DATETIME,
            "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "applied_steps_count" INTEGER NOT NULL DEFAULT 0
        );
    `);
};

const recordMigration = (database: Database.Database, migrationName: string) => {
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(
        path.join(migrationsDirectory, migrationName, 'migration.sql')
    )).digest('hex');
    database.prepare(`
        INSERT INTO "_prisma_migrations" (
            "id", "checksum", "finished_at", "migration_name",
            "started_at", "applied_steps_count"
        ) VALUES (?, ?, ?, ?, ?, 1)
    `).run(`test:${migrationName}`, checksum, fixedTime, migrationName, fixedTime);
};

const applyBaselineMigrations = (database: Database.Database) => {
    createMigrationTable(database);

    for (const migrationName of REQUIRED_MUSIC_RELATIONSHIP_BASELINE_MIGRATIONS) {
        database.exec(fs.readFileSync(
            path.join(migrationsDirectory, migrationName, 'migration.sql'),
            'utf8'
        ));
        recordMigration(database, migrationName);
    }
};

const seedLegacyDatabase = (
    database: Database.Database,
    trackCount: number,
    withRelations = true
) => {
    const insertArtist = database.prepare(`
        INSERT INTO "Artist" ("id", "name", "createdAt", "updatedAt")
        VALUES (?, ?, ?, ?)
    `);
    const insertAlbum = database.prepare(`
        INSERT INTO "Album" (
            "id", "name", "cover", "createdAt", "updatedAt",
            "publishedYear", "artistId", "isCoverCustom"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMusic = database.prepare(`
        INSERT INTO "Music" (
            "id", "name", "createdAt", "updatedAt", "albumId", "artistId",
            "filePath", "contentHash", "hashVersion", "duration", "codec",
            "container", "bitrate", "sampleRate", "playCount", "lastPlayedAt",
            "lastSeenAt", "missingSinceAt", "syncStatus", "totalPlayedMs",
            "trackNumber", "metadataOverride", "skipCount", "lastSkippedAt",
            "completionCount", "lastCompletedAt"
        ) VALUES (
            ?, ?, ?, ?, 1, 1, ?, ?, 1, ?, 'flac', 'flac', 900, 48000,
            ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?
        )
    `);

    database.transaction(() => {
        insertArtist.run(1, ' Ｆｏｏ   BAR ', fixedTime, fixedTime);
        insertArtist.run(2, 'Guest Artist', fixedTime, fixedTime);
        insertAlbum.run(
            1,
            'Migration Album',
            '/cache/resized/1.jpg',
            fixedTime,
            fixedTime,
            '2026',
            1,
            1
        );
        database.prepare(`
            INSERT INTO "Genre" ("id", "name", "createdAt", "updatedAt")
            VALUES (1, 'Ambient', ?, ?)
        `).run(fixedTime, fixedTime);

        for (let id = 1; id <= trackCount; id += 1) {
            const playCount = id % 5;
            const skipCount = id % 3;
            const completionCount = id % 2;
            insertMusic.run(
                id,
                `Track ${id}`,
                fixedTime,
                fixedTime,
                `/music/track-${id}.flac`,
                `hash-${id}`,
                180 + (id % 30),
                playCount,
                playCount ? fixedTime : null,
                fixedTime,
                id % 7 === 0 ? 'missing' : 'active',
                playCount * 90_000,
                (id % 20) + 1,
                skipCount,
                skipCount ? fixedTime : null,
                completionCount,
                completionCount ? fixedTime : null
            );
        }

        if (!withRelations) {
            return;
        }

        database.exec(`
            INSERT INTO "_GenreToMusic" ("A", "B") VALUES (1, 1);
            INSERT INTO "MusicLike" ("id", "createdAt", "updatedAt", "musicId")
                VALUES (1, '${fixedTime}', '${fixedTime}', 1);
            INSERT INTO "MusicHate" ("id", "createdAt", "updatedAt", "musicId")
                VALUES (1, '${fixedTime}', '${fixedTime}', 2);
            INSERT INTO "Tag" (
                "id", "scopeKey", "name", "normalizedName", "createdAt", "updatedAt"
            ) VALUES (1, 'local', 'Focus', 'focus', '${fixedTime}', '${fixedTime}');
            INSERT INTO "MusicTag" (
                "id", "source", "createdAt", "updatedAt", "musicId", "tagId"
            ) VALUES (1, 'manual', '${fixedTime}', '${fixedTime}', 1, 1);
            INSERT INTO "SmartView" (
                "id", "scopeKey", "name", "normalizedName", "createdAt", "updatedAt"
            ) VALUES (1, 'local', 'Focus View', 'focus view', '${fixedTime}', '${fixedTime}');
            INSERT INTO "SmartViewTag" (
                "id", "createdAt", "updatedAt", "smartViewId", "tagId"
            ) VALUES (1, '${fixedTime}', '${fixedTime}', 1, 1);
            INSERT INTO "Playlist" ("id", "name", "createdAt", "updatedAt")
                VALUES (1, 'Migration Playlist', '${fixedTime}', '${fixedTime}');
            INSERT INTO "PlaylistMusic" (
                "id", "order", "createdAt", "updatedAt", "musicId", "playlistId"
            ) VALUES (1, 0, '${fixedTime}', '${fixedTime}', 1, 1);
            INSERT INTO "PlaybackSession" (
                "id", "scopeKey", "state", "currentMusicId", "positionMs",
                "positionUpdatedAt", "historyMusicId", "historySessionId",
                "historyBranchId", "historyStartedAt", "historyPlayedMs",
                "historyUpdatedAt", "revision", "createdAt", "updatedAt"
            ) VALUES (
                1, 'local', 'paused', 1, 12000, '${fixedTime}', 1,
                'history-1', 'history-1', '${fixedTime}', 12000,
                '${fixedTime}', 3, '${fixedTime}', '${fixedTime}'
            );
            INSERT INTO "PlaybackQueue" (
                "id", "sessionId", "currentIndex", "revision", "createdAt", "updatedAt",
                "contextType", "contextId", "contextTitle"
            ) VALUES (
                1, 1, 0, 2, '${fixedTime}', '${fixedTime}', 'album', 1, 'Migration Album'
            );
            INSERT INTO "PlaybackQueueItem" ("id", "queueId", "musicId", "order")
                VALUES (1, 1, 1, 0);
            INSERT INTO "PlaybackEvent" (
                "id", "createdAt", "startedAt", "endedAt", "playedMs",
                "completionRate", "countedAsPlay", "source", "clientSessionId",
                "musicId", "outcome", "endReason", "hadSeek"
            ) VALUES (
                1, '${fixedTime}', '${fixedTime}', '${fixedTime}', 12000,
                0.5, 1, 'queue', 'history-1', 1, 'listen', 'paused', 0
            );
            INSERT INTO "PlaybackEventBranch" (
                "id", "branchId", "basePlayedMs", "reportedPlayedMs", "playbackEventId"
            ) VALUES (1, 'history-1', 0, 12000, 1);
            INSERT INTO "SyncReport" (
                "id", "updatedAt", "startedAt", "completedAt", "status",
                "scannedFiles", "indexedFiles", "createdCount"
            ) VALUES (
                1, '${fixedTime}', '${fixedTime}', '${fixedTime}', 'success', 1, 1, 1
            );
            INSERT INTO "SyncReportItem" (
                "id", "kind", "musicId", "musicName", "filePath", "syncReportId"
            ) VALUES (1, 'created', 1, 'Track 1', '/music/track-1.flac', 1);
        `);
    })();
};

const createLegacyDatabase = (databasePath: string, trackCount = 2) => {
    const database = new Database(databasePath);
    database.pragma('foreign_keys = ON');
    applyBaselineMigrations(database);
    seedLegacyDatabase(database, trackCount, true);
    database.close();
};

const applyTargetMigration = (databasePath: string) => {
    const database = new Database(databasePath);
    database.exec(fs.readFileSync(targetMigrationPath, 'utf8'));
    recordMigration(database, MUSIC_RELATIONSHIP_MIGRATION_NAME);
    database.close();
};

afterEach(() => {
    while (temporaryDirectories.length) {
        fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
    }
});

describe('music relationship migration', () => {
    it('backs up and losslessly upgrades a populated Ocean Wave database', async () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);

        const preparation = await prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory,
            now: new Date(fixedTime)
        });

        expect(preparation).toMatchObject({
            required: true,
            databasePath
        });
        expect(preparation.backupPath).not.toBeNull();

        const backup = new Database(preparation.backupPath!, { readonly: true });
        expect(backup.prepare(`
            SELECT "type" FROM "sqlite_schema" WHERE "name" = 'Music'
        `).get()).toEqual({ type: 'table' });
        expect(backup.prepare('SELECT count(*) AS "count" FROM "Music"').get())
            .toEqual({ count: 2 });
        backup.close();

        applyTargetMigration(databasePath);
        finalizeMusicRelationshipMigration(preparation);

        const migrated = new Database(databasePath, { readonly: true });
        expect(migrated.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        expect(migrated.pragma('foreign_key_check')).toEqual([]);
        expect(migrated.prepare(`
            SELECT "stableId", "title", "playCount", "skipCount",
                   "completionCount", "totalPlayedMs"
            FROM "Recording" WHERE "id" = 1
        `).get()).toEqual({
            stableId: 'legacy:recording:1',
            title: 'Track 1',
            playCount: 1,
            skipCount: 1,
            completionCount: 1,
            totalPlayedMs: 90_000
        });
        expect(migrated.prepare(`
            SELECT "recordingId", "releaseId", "discNumber", "trackNumber"
            FROM "ReleaseTrack" WHERE "id" = 1
        `).get()).toEqual({
            recordingId: 1,
            releaseId: 1,
            discNumber: 1,
            trackNumber: 2
        });
        expect(migrated.prepare(`
            SELECT "releaseTrackId", "filePath", "durationMs", "syncStatus"
            FROM "PhysicalFile" WHERE "id" = 1
        `).get()).toEqual({
            releaseTrackId: 1,
            filePath: 'track-1.flac',
            durationMs: 181_000,
            syncStatus: 'active'
        });
        expect(migrated.prepare(`
            SELECT "id", "recordingId", "releaseTrackId", "physicalFileId",
                   "albumId", "artistId", "name"
            FROM "Music" WHERE "id" = 1
        `).get()).toEqual({
            id: 1,
            recordingId: 1,
            releaseTrackId: 1,
            physicalFileId: 1,
            albumId: 1,
            artistId: 1,
            name: 'Track 1'
        });
        expect(migrated.prepare(`
            SELECT "recordingId", "releaseTrackId", "physicalFileId"
            FROM "PlaybackEvent" WHERE "id" = 1
        `).get()).toEqual({ recordingId: 1, releaseTrackId: 1, physicalFileId: 1 });
        expect(migrated.prepare(`
            SELECT "currentReleaseTrackId", "historyRecordingId",
                   "historyReleaseTrackId", "historyPhysicalFileId"
            FROM "PlaybackSession" WHERE "id" = 1
        `).get()).toEqual({
            currentReleaseTrackId: 1,
            historyRecordingId: 1,
            historyReleaseTrackId: 1,
            historyPhysicalFileId: 1
        });
        expect(migrated.prepare(`
            SELECT "physicalFileId" FROM "SyncReportItem" WHERE "id" = 1
        `).get()).toEqual({ physicalFileId: 1 });
        expect(migrated.prepare(`
            SELECT "normalizedName" FROM "Artist" WHERE "id" = 1
        `).get()).toEqual({ normalizedName: 'foo bar' });
        expect(migrated.prepare(`
            SELECT count(*) AS "count"
            FROM "_MusicRelationshipMigrationVerification"
            WHERE "finalizedAt" IS NOT NULL
        `).get()).toEqual({ count: 15 });
        expect(migrated.prepare('SELECT count(*) AS "count" FROM "SmartView"').get())
            .toEqual({ count: 1 });
        migrated.close();
    });

    it('runs the populated upgrade through the server startup migration path', () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);
        const result = childProcess.spawnSync(
            'pnpm',
            [
                'exec',
                'ts-node',
                '-e',
                "import { createDatabase } from './script/shared'; "
                    + "createDatabase('deploy').catch(error => { "
                    + 'console.error(error); process.exit(1); });'
            ],
            {
                cwd: serverDirectory,
                env: {
                    ...process.env,
                    DATABASE_URL: `file:${databasePath}`
                },
                encoding: 'utf8',
                timeout: 30_000
            }
        );

        expect({ stdout: result.stdout, stderr: result.stderr, status: result.status })
            .toMatchObject({ status: 0 });
        const backupDirectory = path.join(path.dirname(databasePath), '.backups');
        expect(fs.readdirSync(backupDirectory)).toHaveLength(1);
        const database = new Database(databasePath, { readonly: true });
        expect(database.prepare(`
            SELECT "type" FROM "sqlite_schema" WHERE "name" = 'Music'
        `).get()).toEqual({ type: 'view' });
        expect(database.prepare('SELECT count(*) AS "count" FROM "Recording"').get())
            .toEqual({ count: 2 });
        expect(database.pragma('foreign_key_check')).toEqual([]);
        database.close();
    });

    it('resumes durable verification after Prisma commits and the process restarts', async () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);
        const firstPreparation = await prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        });
        expect(firstPreparation.required).toBe(true);
        applyTargetMigration(databasePath);

        const committed = new Database(databasePath, { readonly: true });
        expect(committed.prepare(`
            SELECT count(*) AS "count"
            FROM "_MusicRelationshipMigrationVerification"
            WHERE "finalizedAt" IS NULL
        `).get()).toEqual({ count: 15 });
        expect(committed.prepare(`
            SELECT "normalizedName" FROM "Artist" WHERE "id" = 1
        `).get()).toEqual({ normalizedName: 'Ｆｏｏ   bar' });
        committed.close();

        const restartedPreparation = await prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        });
        expect(restartedPreparation).toMatchObject({
            required: false,
            databasePath,
            backupPath: null
        });
        finalizeMusicRelationshipMigration(restartedPreparation);

        const finalized = new Database(databasePath, { readonly: true });
        expect(finalized.prepare(`
            SELECT count(*) AS "count"
            FROM "_MusicRelationshipMigrationVerification"
            WHERE "finalizedAt" IS NOT NULL
        `).get()).toEqual({ count: 15 });
        expect(finalized.prepare(`
            SELECT "normalizedName" FROM "Artist" WHERE "id" = 1
        `).get()).toEqual({ normalizedName: 'foo bar' });
        finalized.close();
    });

    it('reports invalid legacy rows without changing data and succeeds after repair', async () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);
        const database = new Database(databasePath);
        database.prepare(`
            INSERT INTO "MusicLike" ("createdAt", "updatedAt", "musicId")
            VALUES (?, ?, 1)
        `).run(fixedTime, fixedTime);
        database.close();

        await expect(prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        })).rejects.toMatchObject<Partial<MusicRelationshipMigrationPreflightError>>({
            name: 'MusicRelationshipMigrationPreflightError',
            issues: [expect.objectContaining({ code: 'DUPLICATE_LIKE' })]
        });

        const unchanged = new Database(databasePath);
        expect(unchanged.prepare(`
            SELECT "type" FROM "sqlite_schema" WHERE "name" = 'Music'
        `).get()).toEqual({ type: 'table' });
        expect(unchanged.prepare('SELECT count(*) AS "count" FROM "Music"').get())
            .toEqual({ count: 2 });
        unchanged.prepare('DELETE FROM "MusicLike" WHERE "id" <> 1').run();
        unchanged.close();

        const preparation = await prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        });
        applyTargetMigration(databasePath);
        finalizeMusicRelationshipMigration(preparation);

        const migrated = new Database(databasePath, { readonly: true });
        expect(migrated.prepare('SELECT count(*) AS "count" FROM "Recording"').get())
            .toEqual({ count: 2 });
        migrated.close();
    });

    it('rejects file paths that collide under the runtime normalization contract', async () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);
        const database = new Database(databasePath);
        database.prepare(`
            UPDATE "Music" SET "filePath" = '/old/music/track-1.flac' WHERE "id" = 1
        `).run();
        database.prepare(`
            UPDATE "Music" SET "filePath" = 'track-1.flac' WHERE "id" = 2
        `).run();
        database.close();

        await expect(prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        })).rejects.toMatchObject({
            name: 'MusicRelationshipMigrationPreflightError',
            issues: [expect.objectContaining({ code: 'DUPLICATE_FILE_PATH' })]
        });
        expect(fs.existsSync(path.join(path.dirname(databasePath), '.backups'))).toBe(false);
    });

    it('preserves nested music path segments until environment-aware finalization', async () => {
        const previousMusicPath = process.env.OCEAN_WAVE_MUSIC_PATH;
        process.env.OCEAN_WAVE_MUSIC_PATH = '/music';

        try {
            const databasePath = createTemporaryDatabasePath();
            createLegacyDatabase(databasePath);
            const database = new Database(databasePath);
            database.prepare(`
                UPDATE "Music"
                SET "filePath" = '/music/artist/music/song.flac'
                WHERE "id" = 1
            `).run();
            database.close();

            const preparation = await prepareMusicRelationshipMigration({
                databaseUrl: `file:${databasePath}`,
                baseDirectory: serverDirectory
            });
            applyTargetMigration(databasePath);

            const committed = new Database(databasePath, { readonly: true });
            expect(committed.prepare(`
                SELECT "filePath" FROM "PhysicalFile" WHERE "id" = 1
            `).get()).toEqual({ filePath: '/music/artist/music/song.flac' });
            committed.close();

            finalizeMusicRelationshipMigration(preparation);
            const finalized = new Database(databasePath, { readonly: true });
            expect(finalized.prepare(`
                SELECT "filePath" FROM "PhysicalFile" WHERE "id" = 1
            `).get()).toEqual({ filePath: 'artist/music/song.flac' });
            finalized.close();
        } finally {
            if (previousMusicPath === undefined) {
                delete process.env.OCEAN_WAVE_MUSIC_PATH;
            } else {
                process.env.OCEAN_WAVE_MUSIC_PATH = previousMusicPath;
            }
        }
    });

    it('rejects a lookalike database without the exact Ocean Wave baseline', async () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);
        const database = new Database(databasePath);
        database.prepare(`
            DELETE FROM "_prisma_migrations"
            WHERE "migration_name" = ?
        `).run(REQUIRED_MUSIC_RELATIONSHIP_BASELINE_MIGRATIONS.at(-1));
        database.close();

        await expect(prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        })).rejects.toMatchObject({
            name: 'MusicRelationshipMigrationPreflightError',
            issues: [expect.objectContaining({ code: 'UNSUPPORTED_MIGRATION_HISTORY' })]
        });
        expect(fs.existsSync(path.join(path.dirname(databasePath), '.backups'))).toBe(false);
    });

    it('rejects altered migration checksums', async () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);
        const database = new Database(databasePath);
        database.prepare(`
            UPDATE "_prisma_migrations"
            SET "checksum" = 'tampered'
            WHERE "migration_name" = ?
        `).run(REQUIRED_MUSIC_RELATIONSHIP_BASELINE_MIGRATIONS[0]);
        database.close();

        await expect(prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        })).rejects.toMatchObject({
            issues: [expect.objectContaining({ code: 'UNSUPPORTED_MIGRATION_HISTORY' })]
        });
    });

    it('rejects additional successful migrations outside the baseline', async () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);
        const database = new Database(databasePath);
        database.prepare(`
            INSERT INTO "_prisma_migrations" (
                "id", "checksum", "finished_at", "migration_name",
                "started_at", "applied_steps_count"
            ) VALUES ('test:unexpected', 'unexpected', ?, 'unexpected', ?, 1)
        `).run(fixedTime, fixedTime);
        database.close();

        await expect(prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        })).rejects.toMatchObject({
            issues: [expect.objectContaining({ code: 'UNSUPPORTED_MIGRATION_HISTORY' })]
        });
    });

    it('rejects legacy databases with an unexpected schema signature', async () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);
        const database = new Database(databasePath);
        database.exec('CREATE TABLE "UnexpectedLibraryData" ("id" INTEGER PRIMARY KEY);');
        database.close();

        await expect(prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        })).rejects.toMatchObject({
            issues: [expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' })]
        });
    });

    it('rolls back an injected mid-migration failure and can rerun safely', async () => {
        const databasePath = createTemporaryDatabasePath();
        createLegacyDatabase(databasePath);
        const preparation = await prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        });
        const migrationSql = fs.readFileSync(targetMigrationPath, 'utf8');
        const failingSql = migrationSql.replace(
            '\nCOMMIT;',
            '\nSELECT * FROM "__forced_migration_failure";\nCOMMIT;'
        );
        const database = new Database(databasePath);

        expect(() => database.exec(failingSql)).toThrow();
        if (database.inTransaction) {
            database.exec('ROLLBACK;');
        }
        expect(database.prepare(`
            SELECT "type" FROM "sqlite_schema" WHERE "name" = 'Music'
        `).get()).toEqual({ type: 'table' });
        expect(database.prepare(`
            SELECT "type" FROM "sqlite_schema" WHERE "name" = 'Recording'
        `).get()).toBeUndefined();

        database.exec(migrationSql);
        recordMigration(database, MUSIC_RELATIONSHIP_MIGRATION_NAME);
        database.close();
        finalizeMusicRelationshipMigration(preparation);

        const migrated = new Database(databasePath, { readonly: true });
        expect(migrated.pragma('foreign_key_check')).toEqual([]);
        expect(migrated.prepare('SELECT count(*) AS "count" FROM "Music"').get())
            .toEqual({ count: 2 });
        migrated.close();
    });

    it('upgrades a large copy under one immediate writer lock', async () => {
        const databasePath = createTemporaryDatabasePath();
        const database = new Database(databasePath);
        database.pragma('foreign_keys = ON');
        applyBaselineMigrations(database);
        seedLegacyDatabase(database, 10_000, false);
        database.close();

        const firstWriter = new Database(databasePath);
        const competingWriter = new Database(databasePath, { timeout: 10 });
        firstWriter.exec('BEGIN IMMEDIATE;');
        expect(competingWriter.prepare('SELECT count(*) AS "count" FROM "Music"').get())
            .toEqual({ count: 10_000 });
        expect(() => competingWriter.prepare(`
            UPDATE "Music" SET "name" = "name" WHERE "id" = 1
        `).run()).toThrow(/locked/u);
        firstWriter.exec('ROLLBACK;');
        firstWriter.close();
        competingWriter.close();

        expect(fs.readFileSync(targetMigrationPath, 'utf8'))
            .toMatch(/BEGIN IMMEDIATE;[\s\S]*COMMIT;/u);
        const startedAt = performance.now();
        const preparation = await prepareMusicRelationshipMigration({
            databaseUrl: `file:${databasePath}`,
            baseDirectory: serverDirectory
        });
        applyTargetMigration(databasePath);
        finalizeMusicRelationshipMigration(preparation);
        const elapsedMs = performance.now() - startedAt;

        expect(elapsedMs).toBeLessThan(30_000);
        const migrated = new Database(databasePath, { readonly: true });
        expect(migrated.prepare('SELECT count(*) AS "count" FROM "Recording"').get())
            .toEqual({ count: 10_000 });
        expect(migrated.prepare('SELECT count(*) AS "count" FROM "Music"').get())
            .toEqual({ count: 10_000 });
        expect(migrated.pragma('foreign_key_check')).toEqual([]);
        migrated.close();
    });

    it('supports a fresh Prisma migrate deploy installation', () => {
        const databasePath = createTemporaryDatabasePath();
        const result = childProcess.spawnSync(
            'pnpm',
            ['exec', 'prisma', 'migrate', 'deploy'],
            {
                cwd: serverDirectory,
                env: {
                    ...process.env,
                    DATABASE_URL: `file:${databasePath}`
                },
                encoding: 'utf8',
                timeout: 30_000
            }
        );

        expect(result.status).toBe(0);
        const database = new Database(databasePath, { readonly: true });
        expect(database.prepare(`
            SELECT "type" FROM "sqlite_schema" WHERE "name" = 'Music'
        `).get()).toEqual({ type: 'view' });
        expect(database.prepare('SELECT count(*) AS "count" FROM "Recording"').get())
            .toEqual({ count: 0 });
        expect(database.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        expect(database.pragma('foreign_key_check')).toEqual([]);
        database.close();
    });
});
