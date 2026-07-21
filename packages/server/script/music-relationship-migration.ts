import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { normalizeArtistName } from '../src/modules/artist-identity';
import { normalizeMusicFilePath } from '../src/modules/storage-paths';

export const MUSIC_RELATIONSHIP_MIGRATION_NAME =
    '20260721143000_music_relationship_model';

const MUSIC_RELATIONSHIP_VERIFICATION_TABLE =
    '_MusicRelationshipMigrationVerification';

export const REQUIRED_MUSIC_RELATIONSHIP_BASELINE_MIGRATIONS = [
    '0001_initial_schema',
    '20260603114521_add_music_tags',
    '20260714022500_add_playback_session',
    '20260714043000_add_playback_queue',
    '20260714090000_add_music_editor_overrides',
    '20260720025000_add_playback_devices',
    '20260721043000_add_playback_history_signals',
    '20260721093000_add_playback_queue_context'
] as const;

const REQUIRED_LEGACY_TABLES = [
    'Album',
    'Artist',
    'Genre',
    'Music',
    'MusicHate',
    'MusicLike',
    'MusicTag',
    'PlaybackEvent',
    'PlaybackQueueItem',
    'PlaybackSession',
    'PlaylistMusic',
    'SyncReportItem',
    '_GenreToMusic',
    '_prisma_migrations'
] as const;

interface MigrationIssue {
    code: string;
    message: string;
    examples?: unknown[];
}

export interface LegacyMigrationStats {
    albumCount: number;
    musicCount: number;
    genreEdgeCount: number;
    likeCount: number;
    hateCount: number;
    tagCount: number;
    playlistCount: number;
    queueCount: number;
    eventCount: number;
    sessionCount: number;
    syncItemCount: number;
    playSum: number;
    skipSum: number;
    completionSum: number;
    playedMsSum: number;
}

const LEGACY_STAT_KEYS: Record<keyof LegacyMigrationStats, string> = {
    albumCount: 'album_count',
    musicCount: 'music_count',
    genreEdgeCount: 'genre_edge_count',
    likeCount: 'like_count',
    hateCount: 'hate_count',
    tagCount: 'tag_count',
    playlistCount: 'playlist_count',
    queueCount: 'queue_count',
    eventCount: 'event_count',
    sessionCount: 'session_count',
    syncItemCount: 'sync_item_count',
    playSum: 'play_sum',
    skipSum: 'skip_sum',
    completionSum: 'completion_sum',
    playedMsSum: 'played_ms_sum'
};

export interface MusicRelationshipMigrationPreparation {
    required: boolean;
    databasePath: string | null;
    backupPath: string | null;
}

export class MusicRelationshipMigrationPreflightError extends Error {
    readonly issues: MigrationIssue[];

    constructor(issues: MigrationIssue[]) {
        const details = issues.flatMap(issue => [
            `- ${issue.code}: ${issue.message}`,
            ...(issue.examples?.length
                ? [`  Examples: ${JSON.stringify(issue.examples)}`]
                : [])
        ]);

        super([
            'Music relationship migration preflight failed.',
            ...details,
            'The database was not changed. Repair the reported rows and restart.'
        ].join('\n'));
        this.name = 'MusicRelationshipMigrationPreflightError';
        this.issues = issues;
    }
}

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

const getObjectType = (database: Database.Database, name: string) => {
    const row = database.prepare(`
        SELECT "type"
        FROM "sqlite_schema"
        WHERE "name" = ? COLLATE BINARY
        LIMIT 1
    `).get(name) as { type: string } | undefined;

    return row?.type ?? null;
};

const tableExists = (database: Database.Database, name: string) => (
    getObjectType(database, name) === 'table'
);

const readExamples = (
    database: Database.Database,
    sql: string,
    parameters: unknown[] = []
) => database.prepare(sql).all(...parameters) as unknown[];

const migrationsDirectory = path.resolve(__dirname, '../prisma/migrations');

interface SchemaSignatureEntry {
    type: string;
    name: string;
    tableName: string;
    sql: string | null;
}

const normalizeSchemaSql = (sql: string | null) => (
    sql?.replace(/\s+/gu, ' ').trim() ?? null
);

const readSchemaSignature = (
    database: Database.Database
): SchemaSignatureEntry[] => (database.prepare(`
    SELECT "type", "name", "tbl_name" AS "tableName", "sql"
    FROM "sqlite_schema"
    WHERE "name" NOT LIKE 'sqlite_%'
      AND "name" <> '_prisma_migrations'
    ORDER BY "type", "name"
`).all() as SchemaSignatureEntry[]).map(entry => ({
    ...entry,
    sql: normalizeSchemaSql(entry.sql)
}));

let expectedLegacySchemaSignature: SchemaSignatureEntry[] | null = null;

const getExpectedLegacySchemaSignature = () => {
    if (expectedLegacySchemaSignature) {
        return expectedLegacySchemaSignature;
    }

    const expected = new Database(':memory:');
    try {
        for (const migrationName of REQUIRED_MUSIC_RELATIONSHIP_BASELINE_MIGRATIONS) {
            expected.exec(fs.readFileSync(path.join(
                migrationsDirectory,
                migrationName,
                'migration.sql'
            ), 'utf8'));
        }
        expectedLegacySchemaSignature = readSchemaSignature(expected);
        return expectedLegacySchemaSignature;
    } finally {
        expected.close();
    }
};

const compareLegacySchema = (database: Database.Database): MigrationIssue | null => {
    const expected = getExpectedLegacySchemaSignature();
    const actual = readSchemaSignature(database);

    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        return null;
    }

    const expectedByObject = new Map(expected.map(entry => [
        `${entry.type}:${entry.name}`,
        entry
    ]));
    const actualByObject = new Map(actual.map(entry => [
        `${entry.type}:${entry.name}`,
        entry
    ]));
    const changedObjects = [...new Set([
        ...expectedByObject.keys(),
        ...actualByObject.keys()
    ])].filter(key => (
        JSON.stringify(expectedByObject.get(key))
        !== JSON.stringify(actualByObject.get(key))
    )).slice(0, 10);

    return {
        code: 'UNSUPPORTED_SCHEMA',
        message: 'The legacy database schema does not match the exact Ocean Wave baseline.',
        examples: changedObjects
    };
};

interface AppliedMigration {
    migrationName: string;
    checksum: string;
    finishedAt: string | null;
    appliedStepsCount: number;
}

const collectMigrationHistoryIssue = (
    database: Database.Database
): MigrationIssue | null => {
    let appliedMigrations: AppliedMigration[];
    try {
        appliedMigrations = database.prepare(`
            SELECT "migration_name" AS "migrationName", "checksum",
                   "finished_at" AS "finishedAt",
                   "applied_steps_count" AS "appliedStepsCount"
            FROM "_prisma_migrations"
            WHERE "rolled_back_at" IS NULL
            ORDER BY "started_at", rowid
        `).all() as AppliedMigration[];
    } catch {
        return {
            code: 'UNSUPPORTED_MIGRATION_HISTORY',
            message: 'The Prisma migration history table is not compatible.'
        };
    }

    const expected = REQUIRED_MUSIC_RELATIONSHIP_BASELINE_MIGRATIONS.map(
        migrationName => ({
            migrationName,
            checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(
                migrationsDirectory,
                migrationName,
                'migration.sql'
            ))).digest('hex')
        })
    );
    const mismatches: unknown[] = [];

    if (appliedMigrations.length !== expected.length) {
        mismatches.push({
            expectedCount: expected.length,
            actualCount: appliedMigrations.length
        });
    }

    const comparisonLength = Math.max(appliedMigrations.length, expected.length);
    for (let index = 0; index < comparisonLength; index += 1) {
        const actualMigration = appliedMigrations[index];
        const expectedMigration = expected[index];
        if (
            actualMigration?.migrationName !== expectedMigration?.migrationName
            || actualMigration?.checksum !== expectedMigration?.checksum
            || !actualMigration.finishedAt
            || actualMigration.appliedStepsCount !== 1
        ) {
            mismatches.push({
                position: index + 1,
                expected: expectedMigration?.migrationName ?? null,
                actual: actualMigration?.migrationName ?? null,
                checksumMatches: Boolean(
                    actualMigration
                    && expectedMigration
                    && actualMigration.checksum === expectedMigration.checksum
                ),
                finished: Boolean(actualMigration?.finishedAt),
                appliedStepsCount: actualMigration?.appliedStepsCount ?? null
            });
        }
    }

    return mismatches.length ? {
        code: 'UNSUPPORTED_MIGRATION_HISTORY',
        message: 'The applied migration history does not match the exact Ocean Wave baseline.',
        examples: mismatches.slice(0, 10)
    } : null;
};

const findDuplicateMusicPaths = (database: Database.Database) => {
    const rows = database.prepare(`
        SELECT "id", "filePath"
        FROM "Music"
        ORDER BY "id"
    `).all() as Array<{ id: number; filePath: string }>;
    const byNormalizedPath = new Map<
        string,
        Array<{ id: number; filePath: string }>
    >();

    for (const row of rows) {
        const normalizedPath = normalizeMusicFilePath(row.filePath);
        const matches = byNormalizedPath.get(normalizedPath) ?? [];
        matches.push(row);
        byNormalizedPath.set(normalizedPath, matches);
    }

    return [...byNormalizedPath.entries()]
        .filter(([, matches]) => matches.length > 1)
        .slice(0, 10)
        .map(([normalizedPath, matches]) => ({ normalizedPath, matches }));
};

const collectPreflightIssues = (database: Database.Database): MigrationIssue[] => {
    const issues: MigrationIssue[] = [];
    const missingTables = REQUIRED_LEGACY_TABLES.filter(
        table => !tableExists(database, table)
    );

    if (missingTables.length) {
        issues.push({
            code: 'UNSUPPORTED_BASELINE',
            message: 'Required Ocean Wave baseline tables are missing.',
            examples: missingTables
        });
        return issues;
    }

    const schemaIssue = compareLegacySchema(database);
    if (schemaIssue) {
        issues.push(schemaIssue);
    }

    const migrationHistoryIssue = collectMigrationHistoryIssue(database);
    if (migrationHistoryIssue) {
        issues.push(migrationHistoryIssue);
    }

    const foreignKeyViolations = readExamples(database, `
        SELECT "table", "rowid", "parent", "fkid"
        FROM pragma_foreign_key_check
        LIMIT 10
    `);
    if (foreignKeyViolations.length) {
        issues.push({
            code: 'FOREIGN_KEY_VIOLATION',
            message: 'Legacy foreign-key violations must be repaired.',
            examples: foreignKeyViolations
        });
    }

    const duplicatePaths = findDuplicateMusicPaths(database);
    if (duplicatePaths.length) {
        issues.push({
            code: 'DUPLICATE_FILE_PATH',
            message: 'Normalized music file paths must be unique.',
            examples: duplicatePaths
        });
    }

    const invalidYears = readExamples(database, `
        SELECT "id", "publishedYear"
        FROM "Album"
        WHERE length("publishedYear") <> 4
           OR "publishedYear" GLOB '*[^0-9]*'
        LIMIT 10
    `);
    if (invalidYears.length) {
        issues.push({
            code: 'INVALID_RELEASE_YEAR',
            message: 'Legacy release years must contain exactly four digits.',
            examples: invalidYears
        });
    }

    const invalidPositions = readExamples(database, `
        SELECT "id", "trackNumber"
        FROM "Music"
        WHERE "trackNumber" <= 0
        LIMIT 10
    `);
    if (invalidPositions.length) {
        issues.push({
            code: 'INVALID_TRACK_POSITION',
            message: 'Legacy track numbers must be positive.',
            examples: invalidPositions
        });
    }

    const invalidMediaValues = readExamples(database, `
        SELECT "id", "duration", "bitrate", "sampleRate", "playCount",
               "skipCount", "completionCount", "totalPlayedMs"
        FROM "Music"
        WHERE "duration" < 0
           OR "bitrate" < 0
           OR "sampleRate" < 0
           OR "playCount" < 0
           OR "skipCount" < 0
           OR "completionCount" < 0
           OR "totalPlayedMs" < 0
           OR "duration" != "duration"
           OR "bitrate" != "bitrate"
           OR "sampleRate" != "sampleRate"
           OR "totalPlayedMs" != "totalPlayedMs"
           OR abs("duration") > 1.7976931348623157e308
           OR abs("bitrate") > 1.7976931348623157e308
           OR abs("sampleRate") > 1.7976931348623157e308
           OR abs("totalPlayedMs") > 1.7976931348623157e308
        LIMIT 10
    `);
    if (invalidMediaValues.length) {
        issues.push({
            code: 'INVALID_MEDIA_VALUE',
            message: 'Media and listening values must be finite and non-negative.',
            examples: invalidMediaValues
        });
    }

    const invalidStatuses = readExamples(database, `
        SELECT "id", "syncStatus"
        FROM "Music"
        WHERE "syncStatus" NOT IN ('active', 'missing', 'duplicate')
        LIMIT 10
    `);
    if (invalidStatuses.length) {
        issues.push({
            code: 'INVALID_SYNC_STATUS',
            message: 'Legacy sync status is outside the supported vocabulary.',
            examples: invalidStatuses
        });
    }

    const duplicateRelations = [
        {
            code: 'DUPLICATE_LIKE',
            message: 'A recording can have only one like.',
            sql: `
                SELECT "musicId", count(*) AS "count"
                FROM "MusicLike"
                GROUP BY "musicId"
                HAVING count(*) > 1
                LIMIT 10
            `
        },
        {
            code: 'DUPLICATE_HIDE',
            message: 'A recording can have only one hide.',
            sql: `
                SELECT "musicId", count(*) AS "count"
                FROM "MusicHate"
                GROUP BY "musicId"
                HAVING count(*) > 1
                LIMIT 10
            `
        },
        {
            code: 'DUPLICATE_PLAYLIST_MEMBERSHIP',
            message: 'A release track can occur only once in a playlist.',
            sql: `
                SELECT "playlistId", "musicId", count(*) AS "count"
                FROM "PlaylistMusic"
                GROUP BY "playlistId", "musicId"
                HAVING count(*) > 1
                LIMIT 10
            `
        }
    ];

    for (const relation of duplicateRelations) {
        const examples = readExamples(database, relation.sql);
        if (examples.length) {
            issues.push({
                code: relation.code,
                message: relation.message,
                examples
            });
        }
    }

    return issues;
};

interface PersistedVerificationState {
    stats: LegacyMigrationStats;
    finalized: boolean;
}

const readPersistedVerificationState = (
    database: Database.Database
): PersistedVerificationState => {
    if (!tableExists(database, MUSIC_RELATIONSHIP_VERIFICATION_TABLE)) {
        throw new Error('The durable music relationship verification record is missing.');
    }

    const rows = database.prepare(`
        SELECT "key", "value", "finalizedAt"
        FROM "_MusicRelationshipMigrationVerification"
        ORDER BY "key"
    `).all() as Array<{
        key: string;
        value: number;
        finalizedAt: string | null;
    }>;
    const expectedKeys = Object.values(LEGACY_STAT_KEYS).sort();
    const actualKeys = rows.map(row => row.key);
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        throw new Error('The durable music relationship verification keys are invalid.');
    }

    const finalizedRows = rows.filter(row => row.finalizedAt !== null).length;
    if (finalizedRows !== 0 && finalizedRows !== rows.length) {
        throw new Error('The durable music relationship verification status is inconsistent.');
    }

    const values = new Map(rows.map(row => [row.key, row.value]));
    const stats = {} as LegacyMigrationStats;
    for (const [property, key] of Object.entries(LEGACY_STAT_KEYS) as Array<
        [keyof LegacyMigrationStats, string]
    >) {
        const value = values.get(key);
        if (value === undefined || !Number.isFinite(value) || value < 0) {
            throw new Error(`The durable verification value for ${key} is invalid.`);
        }
        stats[property] = value;
    }

    return {
        stats,
        finalized: finalizedRows === rows.length
    };
};

const readTableCounts = (database: Database.Database) => {
    const tables = database.prepare(`
        SELECT "name"
        FROM "sqlite_schema"
        WHERE "type" = 'table'
          AND "name" NOT LIKE 'sqlite_%'
        ORDER BY "name"
    `).all() as Array<{ name: string }>;

    return Object.fromEntries(tables.map(({ name }) => {
        const row = database.prepare(
            `SELECT count(*) AS "count" FROM ${quoteIdentifier(name)}`
        ).get() as { count: number };
        return [name, row.count];
    }));
};

const fsyncPath = (targetPath: string) => {
    const descriptor = fs.openSync(targetPath, 'r');
    try {
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
};

const createVerifiedBackup = async (
    database: Database.Database,
    databasePath: string,
    now: Date
) => {
    const backupDirectory = path.join(path.dirname(databasePath), '.backups');
    const extension = path.extname(databasePath);
    const databaseName = path.basename(databasePath, extension);
    const timestamp = now.toISOString().replace(/[:.]/gu, '-');
    const backupPath = path.join(
        backupDirectory,
        `${databaseName}.before-music-relationship-${timestamp}${extension || '.sqlite3'}`
    );
    const sourceCounts = readTableCounts(database);

    fs.mkdirSync(backupDirectory, { recursive: true });
    await database.backup(backupPath);
    fsyncPath(backupPath);
    fsyncPath(backupDirectory);

    const backup = new Database(backupPath, {
        readonly: true,
        fileMustExist: true
    });
    try {
        const integrity = backup.pragma('integrity_check') as Array<{
            integrity_check: string;
        }>;
        if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
            throw new Error(`Backup integrity check failed: ${JSON.stringify(integrity)}`);
        }

        const backupCounts = readTableCounts(backup);
        if (JSON.stringify(backupCounts) !== JSON.stringify(sourceCounts)) {
            throw new Error('Backup table counts do not match the source snapshot.');
        }
    } catch (error) {
        fs.rmSync(backupPath, { force: true });
        throw error;
    } finally {
        backup.close();
    }

    return backupPath;
};

export const resolveSqliteDatabasePath = (
    databaseUrl: string,
    baseDirectory: string
) => {
    if (!databaseUrl.startsWith('file:')) {
        throw new Error('Ocean Wave migration backup supports only SQLite file URLs.');
    }

    const value = decodeURIComponent(databaseUrl.slice('file:'.length).split('?')[0] ?? '');
    if (!value || value === ':memory:') {
        return null;
    }

    return path.isAbsolute(value) ? value : path.resolve(baseDirectory, value);
};

export const prepareMusicRelationshipMigration = async ({
    databaseUrl,
    baseDirectory,
    now = new Date()
}: {
    databaseUrl: string;
    baseDirectory: string;
    now?: Date;
}): Promise<MusicRelationshipMigrationPreparation> => {
    const databasePath = resolveSqliteDatabasePath(databaseUrl, baseDirectory);
    if (!databasePath || !fs.existsSync(databasePath)) {
        return { required: false, databasePath, backupPath: null };
    }

    const database = new Database(databasePath, {
        readonly: true,
        fileMustExist: true,
        timeout: 5_000
    });

    try {
        const migrationApplied = tableExists(database, '_prisma_migrations')
            && Boolean(database.prepare(`
                SELECT 1
                FROM "_prisma_migrations"
                WHERE "migration_name" = ?
                  AND "finished_at" IS NOT NULL
                  AND "rolled_back_at" IS NULL
                LIMIT 1
            `).get(MUSIC_RELATIONSHIP_MIGRATION_NAME));
        if (migrationApplied) {
            try {
                readPersistedVerificationState(database);
            } catch (error) {
                throw new MusicRelationshipMigrationPreflightError([{
                    code: 'INCONSISTENT_MIGRATION_STATE',
                    message: error instanceof Error
                        ? error.message
                        : 'The durable migration verification state is invalid.'
                }]);
            }
            return { required: false, databasePath, backupPath: null };
        }

        const musicObjectType = getObjectType(database, 'Music');
        if (musicObjectType === null) {
            return { required: false, databasePath, backupPath: null };
        }
        if (musicObjectType !== 'table') {
            throw new MusicRelationshipMigrationPreflightError([{
                code: 'INCONSISTENT_MIGRATION_STATE',
                message: 'Music is not a legacy table, but the migration is not recorded.'
            }]);
        }

        const issues = collectPreflightIssues(database);
        if (issues.length) {
            throw new MusicRelationshipMigrationPreflightError(issues);
        }

        const backupPath = await createVerifiedBackup(database, databasePath, now);

        return { required: true, databasePath, backupPath };
    } finally {
        database.close();
    }
};

const assertEqual = (label: string, actual: number, expected: number) => {
    if (actual !== expected) {
        throw new Error(
            `Music relationship migration verification failed for ${label}: `
            + `expected ${expected}, received ${actual}.`
        );
    }
};

export const finalizeMusicRelationshipMigration = (
    preparation: MusicRelationshipMigrationPreparation
) => {
    if (!preparation.databasePath) {
        return;
    }
    if (!fs.existsSync(preparation.databasePath)) {
        if (preparation.required) {
            throw new Error('The database disappeared before migration verification.');
        }
        return;
    }

    const database = new Database(preparation.databasePath, {
        fileMustExist: true,
        timeout: 5_000
    });
    try {
        if (!tableExists(database, '_prisma_migrations')) {
            if (preparation.required) {
                throw new Error('Prisma did not create its migration history table.');
            }
            return;
        }

        const migration = database.prepare(`
            SELECT "checksum", "finished_at" AS "finishedAt",
                   "rolled_back_at" AS "rolledBackAt"
            FROM "_prisma_migrations"
            WHERE "migration_name" = ?
            ORDER BY "started_at" DESC
            LIMIT 1
        `).get(MUSIC_RELATIONSHIP_MIGRATION_NAME) as {
            checksum: string;
            finishedAt: string | null;
            rolledBackAt: string | null;
        } | undefined;
        if (!migration?.finishedAt || migration.rolledBackAt) {
            if (preparation.required) {
                throw new Error(
                    'Prisma did not record a successful music relationship migration.'
                );
            }
            return;
        }
        const expectedChecksum = crypto.createHash('sha256').update(fs.readFileSync(
            path.join(
                migrationsDirectory,
                MUSIC_RELATIONSHIP_MIGRATION_NAME,
                'migration.sql'
            )
        )).digest('hex');
        if (migration.checksum !== expectedChecksum) {
            throw new Error('The music relationship migration checksum does not match.');
        }

        const verification = readPersistedVerificationState(database);
        if (verification.finalized) {
            return;
        }

        const integrity = database.pragma('integrity_check') as Array<{
            integrity_check: string;
        }>;
        if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
            throw new Error(`Database integrity check failed: ${JSON.stringify(integrity)}`);
        }
        const foreignKeyViolations = database.pragma('foreign_key_check') as unknown[];
        if (foreignKeyViolations.length) {
            throw new Error(
                `Foreign-key verification failed: ${JSON.stringify(foreignKeyViolations)}`
            );
        }

        const finalize = database.transaction(() => {
            const artists = database.prepare(`
                SELECT "id", "name", "normalizedName"
                FROM "Artist"
                ORDER BY "id"
            `).all() as Array<{ id: number; name: string; normalizedName: string }>;
            const update = database.prepare(`
                UPDATE "Artist"
                SET "normalizedName" = ?
                WHERE "id" = ?
            `);

            for (const artist of artists) {
                const normalizedName = normalizeArtistName(artist.name);
                if (artist.normalizedName !== normalizedName) {
                    update.run(normalizedName, artist.id);
                }
            }

            const physicalFiles = database.prepare(`
                SELECT "id", "filePath"
                FROM "PhysicalFile"
                ORDER BY "id"
            `).all() as Array<{ id: number; filePath: string }>;
            const normalizedPaths = new Map<string, number>();
            const updatePath = database.prepare(`
                UPDATE "PhysicalFile"
                SET "filePath" = ?
                WHERE "id" = ?
            `);
            for (const physicalFile of physicalFiles) {
                const normalizedPath = normalizeMusicFilePath(physicalFile.filePath);
                const existingId = normalizedPaths.get(normalizedPath);
                if (existingId !== undefined) {
                    throw new Error(
                        'Music relationship migration verification found a normalized '
                        + `path collision between PhysicalFile ${existingId} and `
                        + `${physicalFile.id}: ${normalizedPath}`
                    );
                }
                normalizedPaths.set(normalizedPath, physicalFile.id);
                if (normalizedPath !== physicalFile.filePath) {
                    updatePath.run(normalizedPath, physicalFile.id);
                }
            }

            const stats = database.prepare(`
                SELECT
                    (SELECT count(*) FROM "Album") AS "albumCount",
                    (SELECT count(*) FROM "Release") AS "releaseCount",
                    (SELECT count(*) FROM "Music") AS "musicCount",
                    (SELECT count(*) FROM "Recording") AS "recordingCount",
                    (SELECT count(*) FROM "ReleaseTrack") AS "releaseTrackCount",
                    (SELECT count(*) FROM "PhysicalFile") AS "physicalFileCount",
                    (SELECT count(*) FROM "RecordingGenre") AS "genreEdgeCount",
                    (SELECT count(*) FROM "MusicLike") AS "likeCount",
                    (SELECT count(*) FROM "MusicHate") AS "hateCount",
                    (SELECT count(*) FROM "MusicTag") AS "tagCount",
                    (SELECT count(*) FROM "PlaylistMusic") AS "playlistCount",
                    (SELECT count(*) FROM "PlaybackQueueItem") AS "queueCount",
                    (SELECT count(*) FROM "PlaybackEvent") AS "eventCount",
                    (SELECT count(*) FROM "PlaybackSession") AS "sessionCount",
                    (SELECT count(*) FROM "SyncReportItem") AS "syncItemCount",
                    (SELECT coalesce(sum("playCount"), 0) FROM "Recording")
                        AS "playSum",
                    (SELECT coalesce(sum("skipCount"), 0) FROM "Recording")
                        AS "skipSum",
                    (SELECT coalesce(sum("completionCount"), 0) FROM "Recording")
                        AS "completionSum",
                    (SELECT coalesce(sum("totalPlayedMs"), 0) FROM "Recording")
                        AS "playedMsSum"
            `).get() as LegacyMigrationStats & {
                releaseCount: number;
                recordingCount: number;
                releaseTrackCount: number;
                physicalFileCount: number;
            };
            const expected = verification.stats;

            assertEqual('Album compatibility rows', stats.albumCount, expected.albumCount);
            assertEqual('Release rows', stats.releaseCount, expected.albumCount);
            assertEqual('Music compatibility rows', stats.musicCount, expected.musicCount);
            assertEqual('Recording rows', stats.recordingCount, expected.musicCount);
            assertEqual(
                'ReleaseTrack rows',
                stats.releaseTrackCount,
                expected.musicCount
            );
            assertEqual(
                'PhysicalFile rows',
                stats.physicalFileCount,
                expected.musicCount
            );
            assertEqual('recording genres', stats.genreEdgeCount, expected.genreEdgeCount);
            assertEqual('likes', stats.likeCount, expected.likeCount);
            assertEqual('hides', stats.hateCount, expected.hateCount);
            assertEqual('music tags', stats.tagCount, expected.tagCount);
            assertEqual(
                'playlist memberships',
                stats.playlistCount,
                expected.playlistCount
            );
            assertEqual('queue items', stats.queueCount, expected.queueCount);
            assertEqual('playback events', stats.eventCount, expected.eventCount);
            assertEqual('playback sessions', stats.sessionCount, expected.sessionCount);
            assertEqual('sync report items', stats.syncItemCount, expected.syncItemCount);
            assertEqual('play count sum', stats.playSum, expected.playSum);
            assertEqual('skip count sum', stats.skipSum, expected.skipSum);
            assertEqual(
                'completion count sum',
                stats.completionSum,
                expected.completionSum
            );
            assertEqual(
                'played milliseconds sum',
                stats.playedMsSum,
                expected.playedMsSum
            );

            const finalized = database.prepare(`
                UPDATE "_MusicRelationshipMigrationVerification"
                SET "finalizedAt" = CURRENT_TIMESTAMP
                WHERE "finalizedAt" IS NULL
            `).run();
            assertEqual(
                'durable verification rows',
                finalized.changes,
                Object.keys(LEGACY_STAT_KEYS).length
            );
        });
        finalize();
    } finally {
        database.close();
    }
};
