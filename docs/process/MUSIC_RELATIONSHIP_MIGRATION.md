# Music Relationship Migration Operations

## Scope

Migration `20260721143000_music_relationship_model` upgrades the current Ocean
Wave SQLite schema from the legacy `Music` and `Album` tables to Recording,
Release, ReleaseTrack, and PhysicalFile. It does not accept a database merely
because it has similarly named tables: every required Ocean Wave baseline
migration must be recorded in order with its exact checksum, and the legacy
schema signature must match without additional application tables or indexes.

## Automatic startup safeguards

Before `prisma migrate deploy` reaches this migration, the server startup path:

1. confirms that the database is at the exact supported Ocean Wave baseline;
2. runs read-only checks for foreign-key damage, invalid values, runtime-
   normalized path collisions, duplicate preferences, and duplicate playlist
   membership;
3. captures row counts and listening aggregates inside the migration
   transaction in a durable verification record;
4. creates a SQLite online backup in `.backups` beside the database;
5. runs `PRAGMA integrity_check` on the backup and compares every source and
   backup table count;
6. runs Prisma migration deploy; and
7. normalizes stored artist names and physical-file paths, then checks database
   integrity, foreign keys, compatibility row counts, dependent row counts,
   and listening aggregates before durably marking verification complete and
   starting the server.

The backup name has this form:

```text
<database>.before-music-relationship-<UTC timestamp>.sqlite3
```

A fresh installation and an already migrated database skip the legacy backup.
Preflight failure is read-only and prevents Prisma from starting the migration.
If the process exits after Prisma commits but before final verification, the
pending durable record makes the next startup repeat verification instead of
silently accepting the database.

## Expected locking

The schema swap uses one `BEGIN IMMEDIATE` transaction. Readers may continue
while SQLite prepares the new tables, but another writer cannot commit until
the migration finishes. Stop every Ocean Wave server that shares the database
before upgrading. Do not run two upgrade processes against the same file.

## Failure and retry

The schema and backfill are committed together. A SQL failure rolls back the
schema swap instead of leaving a partially converted library. The verified
backup is retained even after a successful upgrade.

If preflight fails:

1. leave the server stopped;
2. repair only the rows identified by the error output;
3. make an additional operator-controlled copy if manual repair is required;
4. run SQLite `PRAGMA integrity_check` and `PRAGMA foreign_key_check`; and
5. restart Ocean Wave to repeat preflight, backup, and migration.

If Prisma or post-migration verification fails after a backup was created,
restore the verified backup before retrying:

1. stop every process using the database;
2. preserve the failed database, `-wal`, and `-shm` files for diagnosis;
3. copy the reported `.backups/...sqlite3` file to a new temporary file in the
   database directory;
4. run `PRAGMA integrity_check` against that temporary file;
5. atomically rename the temporary file over the database and remove stale
   `-wal` and `-shm` files; and
6. restart Ocean Wave.

Restoring the pre-migration backup also removes a failed Prisma migration row,
so the next startup can retry normally. Never mark this migration applied with
`prisma migrate resolve --applied` after a failed run.

## Post-upgrade verification queries

```sql
PRAGMA integrity_check;
PRAGMA foreign_key_check;

SELECT count(*) FROM Recording;
SELECT count(*) FROM ReleaseTrack;
SELECT count(*) FROM PhysicalFile;
SELECT count(*) FROM Music;

SELECT count(*)
FROM _MusicRelationshipMigrationVerification
WHERE finalizedAt IS NULL;

SELECT
  sum(playCount),
  sum(skipCount),
  sum(completionCount),
  sum(totalPlayedMs)
FROM Recording;
```

`integrity_check` must return `ok`, `foreign_key_check` must return no rows, and
the three core music counts plus the compatibility `Music` count must match the
legacy music count recorded in startup verification.
The pending verification query must return `0`.
