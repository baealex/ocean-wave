# Music Relationship Model

Updated: 2026-07-21

## 1. Purpose and Boundary

The current `Music` row represents a logical track, one release appearance, and
one local file at the same time. That prevents Ocean Wave from representing one
recording on multiple releases or keeping several encodings of the same release
track without creating duplicate library items.

This document is the implementation contract for separating those meanings. It
defines the first SQLite and Prisma model, the legacy-reference mapping, and the
rules that later migration, credit, release, version-grouping, and metadata work
must follow. It does not perform the migration or change the public GraphQL
contract by itself.

## 2. Core Decision

Ocean Wave uses four distinct music identities:

1. **Recording** is the logical recorded performance. Listening signals,
   likes, hides, personal tags, and genres belong here.
2. **Release** is a published collection or edition. Its album artist credit,
   date, type, artwork, and disc count belong here.
3. **ReleaseTrack** is one ordered appearance of a recording on a release. A
   playlist or playback queue points here so its release context remains stable.
4. **PhysicalFile** is one locally stored encoding of a release track. Paths,
   hashes, availability, duration, codec, bitrate, and sample rate belong here.

`ArtistCredit` is an ordered relationship from an artist to exactly one
Recording, Release, or ReleaseTrack. It is not a comma-separated artist string.

```text
Artist <- ArtistCredit -> Recording <- ReleaseTrack -> Release
                                  ^          |
                                  |          +---- PhysicalFile
                                  |
                     preferences and listening history
```

The same Recording can therefore have an album ReleaseTrack and a single
ReleaseTrack. One ReleaseTrack can have FLAC and AAC PhysicalFiles. Neither case
creates another logical recording.

## 3. Entity Responsibilities

### Recording

A Recording identifies audio with the same musical performance. It owns:

- the canonical title and an optional intrinsic version label such as `Live`,
  `Acoustic`, `Remix`, or `Radio Edit`;
- ordered track artist credits;
- normalized genres;
- aggregate play, skip, completion, and last-listened signals;
- likes, hides, and personal tags.

A remaster of the same performance can remain the same Recording while its
release-specific mastering label lives on ReleaseTrack. A genuinely different
performance, remix, live take, or edit is a different Recording.

### Release

A Release replaces the current `Album` meaning. It owns:

- title, partial ISO release date, and release type;
- ordered album artist credits;
- artwork cache and custom-artwork flag;
- optional total disc count.

Release type is one of `album`, `ep`, `single`, `compilation`, `live`, or
`unknown`. Missing legacy data always becomes `unknown`; it is never inferred
from track count.

### ReleaseTrack

A ReleaseTrack connects exactly one Recording to exactly one Release. It owns:

- nullable disc and track numbers;
- an optional printed-title override;
- an optional release-specific version or mastering label;
- optional ordered artist credits when this release appearance differs from the
  Recording credit.

If ReleaseTrack has no artist credits, consumers use the Recording credits. A
nullable number means unknown. Import code must not turn every missing track
number into `1`.

Every Recording and Release has at least one primary credit. When an imported
file has no album-artist tag, the new Release copies the effective Recording
credit as its initial album credit. `Various Artists` is used only when the file
actually supplies it; it is never synthesized merely because track credits
differ.

### PhysicalFile

A PhysicalFile is a regular audio file below the configured music root. It
owns:

- its stable local identity and normalized relative path;
- whole-file content hash and hash version;
- file availability timestamps and sync status;
- probed duration and encoding values;
- the last parsed tag snapshot for diagnostics;
- an optional preference rank among files for the same ReleaseTrack.

Each PhysicalFile contains one encoding, so a separate Encoding table is not
needed in the first model. Encoding becomes a separate entity only if Ocean
Wave later manages generated renditions rather than files already owned by the
user.

### ArtistCredit

Each ArtistCredit row is one ordered participant, not a reusable credit header.
It stores:

- the referenced Artist;
- `role`, `position`, and the trailing `joinPhrase`;
- an optional `creditedName` when the release spelling differs from the
  canonical Artist name;
- exactly one owner: Recording, Release, or ReleaseTrack.

For example, `A feat. B` is two rows. The first row has `joinPhrase=" feat. "`
and the second has an empty join phrase. Credits are formatted from ordered
rows, so rescanning never needs to guess by splitting commas.

## 4. First-Migration Prisma Shape

The following is the required core shape. Existing dependent relations are
listed in the reference map below rather than repeated in this excerpt.

```prisma
model Recording {
    id                  Int       @id @default(autoincrement())
    stableId            String    @unique @default(uuid())
    title               String
    versionTitle        String?
    metadataRevision    Int       @default(0)
    playCount           Int       @default(0)
    lastPlayedAt        DateTime?
    skipCount           Int       @default(0)
    lastSkippedAt       DateTime?
    completionCount     Int       @default(0)
    lastCompletedAt     DateTime?
    totalPlayedMs       Float     @default(0)
    createdAt           DateTime  @default(now())
    updatedAt           DateTime  @updatedAt
    ReleaseTrack        ReleaseTrack[]
    ArtistCredit        ArtistCredit[] @relation("RecordingArtistCredit")
    RecordingGenre      RecordingGenre[]

    @@index([title])
    @@index([lastPlayedAt])
}

model Release {
    id                  Int       @id @default(autoincrement())
    stableId            String    @unique @default(uuid())
    title               String
    releaseDate         String?
    releaseType         String    @default("unknown")
    totalDiscs          Int?
    cover               String    @default("")
    isCoverCustom       Boolean   @default(false)
    metadataRevision    Int       @default(0)
    createdAt           DateTime  @default(now())
    updatedAt           DateTime  @updatedAt
    ReleaseTrack        ReleaseTrack[]
    ArtistCredit        ArtistCredit[] @relation("ReleaseArtistCredit")

    @@index([title])
    @@index([releaseType, releaseDate])
}

model ReleaseTrack {
    id                  Int       @id @default(autoincrement())
    stableId            String    @unique @default(uuid())
    recordingId         Int
    releaseId           Int
    titleOverride       String?
    versionTitle        String?
    discNumber          Int?
    trackNumber         Int?
    metadataRevision    Int       @default(0)
    createdAt           DateTime  @default(now())
    updatedAt           DateTime  @updatedAt
    Recording           Recording @relation(fields: [recordingId], references: [id], onDelete: Restrict)
    Release             Release   @relation(fields: [releaseId], references: [id], onDelete: Restrict)
    PhysicalFile        PhysicalFile[]
    ArtistCredit        ArtistCredit[] @relation("ReleaseTrackArtistCredit")

    @@index([recordingId])
    @@index([releaseId, discNumber, trackNumber])
}

model PhysicalFile {
    id                     Int       @id @default(autoincrement())
    stableId               String    @unique @default(uuid())
    releaseTrackId         Int
    filePath               String    @unique
    contentHash            String?
    hashVersion            Int?
    durationMs             Int
    codec                  String
    container              String
    bitrate                Int
    sampleRate             Int
    fileSizeBytes          BigInt?
    tagSnapshotJson        String?
    tagSnapshotVersion     Int?
    legacyMetadataOverride String?
    preferenceRank         Int?
    metadataRevision       Int       @default(0)
    lastSeenAt             DateTime?
    missingSinceAt         DateTime?
    syncStatus             String    @default("active")
    createdAt              DateTime  @default(now())
    updatedAt              DateTime  @updatedAt
    ReleaseTrack           ReleaseTrack @relation(fields: [releaseTrackId], references: [id], onDelete: Restrict)

    @@unique([releaseTrackId, preferenceRank])
    @@index([releaseTrackId, syncStatus, preferenceRank])
    @@index([hashVersion, contentHash])
    @@index([syncStatus, missingSinceAt])
}

model ArtistCredit {
    id                  Int       @id @default(autoincrement())
    artistId            Int
    recordingId         Int?
    releaseId           Int?
    releaseTrackId      Int?
    role                String    @default("primary")
    position            Int
    creditedName        String?
    joinPhrase          String    @default("")
    createdAt           DateTime  @default(now())
    updatedAt           DateTime  @updatedAt
    Artist              Artist    @relation(fields: [artistId], references: [id], onDelete: Restrict)
    Recording           Recording? @relation("RecordingArtistCredit", fields: [recordingId], references: [id], onDelete: Cascade)
    Release             Release? @relation("ReleaseArtistCredit", fields: [releaseId], references: [id], onDelete: Cascade)
    ReleaseTrack        ReleaseTrack? @relation("ReleaseTrackArtistCredit", fields: [releaseTrackId], references: [id], onDelete: Cascade)

    @@unique([recordingId, position])
    @@unique([releaseId, position])
    @@unique([releaseTrackId, position])
    @@index([artistId])
}

model RecordingGenre {
    recordingId         Int
    genreId             Int
    source              String    @default("file")
    createdAt           DateTime  @default(now())
    updatedAt           DateTime  @updatedAt
    Recording           Recording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
    Genre               Genre     @relation(fields: [genreId], references: [id], onDelete: Cascade)

    @@id([recordingId, genreId])
    @@index([genreId, recordingId])
}
```

`Artist` also receives `stableId`, `normalizedName`, and an index on
`normalizedName`. Artist names stop being identity and therefore stop being a
unique key. The migration preserves every current Artist row and its numeric id;
later scanners may use normalized names as cautious candidates but never as
proof that two artists are the same. Normalization uses Unicode NFKC, trim,
collapsed internal whitespace, and lowercase, matching the existing tag-name
normalization rules.

The composite PhysicalFile preference constraint deliberately uses nullable
`preferenceRank`. SQLite permits multiple `NULL` values but only one non-null
rank per ReleaseTrack. A manual preferred file uses rank `0`; later work may add
additional explicit ranks without changing the relationship model.

Release positions are indexed but not unique in the first migration. Existing
libraries may contain repeated default track numbers, and silently deleting or
renumbering those rows is worse than preserving a reported metadata conflict.
Ordering is `(discNumber IS NULL, discNumber, trackNumber IS NULL, trackNumber,
ReleaseTrack.id)` until the conflict is corrected.

## 5. SQLite Constraints and Validated Vocabularies

Prisma expresses primary keys, unique keys, indexes, foreign keys, and
referential actions. The migration adds these SQLite `CHECK` constraints in raw
SQL because Prisma does not express them in the model:

- ArtistCredit has exactly one non-null owner among `recordingId`, `releaseId`,
  and `releaseTrackId`.
- `position` and `preferenceRank` are non-negative.
- every `metadataRevision` is non-negative and increases once per accepted
  relational metadata edit;
- `discNumber`, `trackNumber`, and `totalDiscs` are positive when present.
- duration, bitrate, sample rate, file size, and listening counters are
  non-negative.
- `releaseType` is one of the six values defined above.
- initial `syncStatus` remains `active`, `missing`, or `duplicate` for a
  lossless legacy transition.
- initial credit roles are `primary`, `featured`, `remixer`, `performer`,
  `composer`, `conductor`, or `unknown`.

Application validation accepts Release `releaseDate` only as `YYYY`, `YYYY-MM`,
or `YYYY-MM-DD`. The first migration copies an existing `publishedYear` value
unchanged after a preflight confirms it is a four-digit year; an unexpected
legacy value blocks migration and is reported instead of being discarded.

The owner constraint is equivalent to:

```sql
CHECK (
  ("recordingId" IS NOT NULL) +
  ("releaseId" IS NOT NULL) +
  ("releaseTrackId" IS NOT NULL) = 1
)
```

Application constants use the same closed vocabularies. Unknown imported values
map to `unknown`; they do not bypass the database constraint.

SQLite cannot require a parent to have at least one child credit. Recording and
Release create/update services enforce that invariant in the same transaction
that writes the owner.

## 6. Legacy Data and Reference Map

The migration begins as a one-to-one expansion. It does **not** automatically
group rows by title, duration, artist name, or content hash.

For each current `Music` row with id `N`, backfill:

- Recording id `N`;
- ReleaseTrack id `N`;
- PhysicalFile id `N`.

For each current `Album` row with id `A`, backfill Release id `A`. Preserving
these numeric ids lets compatibility APIs and dependent rows move without an
ambiguous lookup table. New rows use normal autoincrement ids. Every new entity
also receives an opaque `stableId`; numeric ids remain local database keys and
are not portable identifiers. Existing rows use deterministic values
`legacy:artist:<id>`, `legacy:recording:<id>`, `legacy:release:<id>`,
`legacy:release-track:<id>`, and `legacy:file:<id>`. New rows use Prisma's UUID
default. This keeps the SQL backfill deterministic and retryable without
pretending that a local integer is portable by itself.

| Current data | New owner or reference |
| --- | --- |
| `Music.name` | `Recording.title`; ReleaseTrack override starts null |
| `Music.artistId` | one primary Recording ArtistCredit |
| `Album` fields and `Album.artistId` | Release and one primary Release ArtistCredit |
| `Music.albumId`, `trackNumber` | ReleaseTrack release, disc `1`, and existing track number |
| `Music.filePath`, hash, sync, duration, codec values | PhysicalFile |
| `Music.metadataOverride` | PhysicalFile `legacyMetadataOverride` until relational editing removes it safely |
| Music play/skip/completion aggregates | Recording |
| `_GenreToMusic` | RecordingGenre |
| `MusicLike`, `MusicHate`, `MusicTag` | Recording id |
| `PlaylistMusic` | ReleaseTrack id |
| `PlaybackQueueItem` | ReleaseTrack id |
| `PlaybackSession.currentMusicId` | current ReleaseTrack id |
| `PlaybackSession.historyMusicId` | Recording id, with new ReleaseTrack and PhysicalFile history provenance |
| `PlaybackEvent.musicId` | Recording id, plus the same ReleaseTrack and PhysicalFile ids for provenance |
| `SyncReportItem.musicId` | PhysicalFile id; name resolves through its ReleaseTrack and Recording |

An existing playback-queue context with type `album` keeps the same numeric
`contextId`, which now identifies Release. Playlist context ids are unchanged.

Release type becomes `unknown`, total discs becomes `1`, and version fields
remain null. Existing `duplicate` file status is preserved so the migration does
not suddenly expose previously hidden duplicates. Later explicit grouping can
attach such a PhysicalFile to an existing ReleaseTrack and make it active.
PhysicalFile `durationMs` is `round(Music.duration * 1000)`; bitrate and sample
rate are rounded to integers; file size, tag snapshot, and preference rank start
null. All metadata revisions start at `0`. The migration preflight rejects
negative or non-finite legacy media values rather than coercing them silently.

### Dependent relation contract

The first migration keeps the existing dependent table names to limit API and
code churn, but it rebuilds their foreign-key columns as follows. There are no
dual legacy/new id columns after the table swap.

| Table and new column | Nullability | Foreign key and delete action | Required indexes |
| --- | --- | --- | --- |
| `MusicLike.recordingId` | required | Recording, `CASCADE` | unique `(recordingId)` |
| `MusicHate.recordingId` | required | Recording, `CASCADE` | unique `(recordingId)` |
| `MusicTag.recordingId` | required | Recording, `CASCADE`; existing Tag relation remains `CASCADE` | unique `(recordingId, tagId)`, `(tagId, recordingId)` |
| `PlaylistMusic.releaseTrackId` | required | ReleaseTrack, `RESTRICT`; Playlist becomes `CASCADE` because the row is a playlist child | unique `(playlistId, releaseTrackId)`, index `(playlistId, order)`, index `(releaseTrackId)` |
| `PlaybackQueueItem.releaseTrackId` | required | ReleaseTrack, `RESTRICT`; queue remains `CASCADE` | existing unique queue/item and queue/order indexes, plus `(releaseTrackId)` |
| `PlaybackSession.currentReleaseTrackId` | optional | ReleaseTrack, `SET NULL` | `(currentReleaseTrackId)` |
| `PlaybackSession.historyRecordingId` | optional | Recording, `SET NULL` | `(historyRecordingId)` |
| `PlaybackSession.historyReleaseTrackId` | optional | ReleaseTrack, `SET NULL` | `(historyReleaseTrackId)` |
| `PlaybackSession.historyPhysicalFileId` | optional | PhysicalFile, `SET NULL` | `(historyPhysicalFileId)` |
| `PlaybackEvent.recordingId` | required | Recording, `RESTRICT` | `(recordingId, endedAt)` |
| `PlaybackEvent.releaseTrackId` | required | ReleaseTrack, `RESTRICT` | `(releaseTrackId, endedAt)` |
| `PlaybackEvent.physicalFileId` | optional | PhysicalFile, `SET NULL` | `(physicalFileId)` |
| `SyncReportItem.physicalFileId` | optional | PhysicalFile, `SET NULL` | existing `(syncReportId, kind)`, plus `(physicalFileId)` |

`PlaybackEvent.clientSessionId`, `PlaybackEventBranch`, queue revision fields,
and playlist ids keep their current constraints. Playback history always writes
Recording and ReleaseTrack together; PhysicalFile is required at event creation
but nullable in storage so an explicit later file purge does not erase history.

PlaybackSession is ephemeral. A domain cleanup that removes one of its targets
must clear the matching current/history id and the associated lineage fields in
one transaction before deletion; `SET NULL` is only the final foreign-key safety
net. `PlaybackQueue.contextId` remains nullable and polymorphic, so SQLite cannot
attach one foreign key to it. The playback-queue service validates that an
`album` context id names Release and that a `playlist` context id names Playlist.

The migration preflight rejects duplicate likes, hides, or playlist membership
before adding the new unique indexes. It reports the rows for explicit repair
and never deduplicates user data automatically.

## 7. Public and Internal Identifier Contract

During the compatibility phase, GraphQL `Music.id` continues to expose the
numeric ReleaseTrack id. A `Music` response is a projection composed from:

- ReleaseTrack for id, release context, printed title, and position;
- Recording for credits, genres, preferences, and listening aggregates;
- the resolved PhysicalFile for duration, path, and encoding details;
- Release for the existing `album` field and artwork.

Existing mutation inputs named `musicId` also accept a ReleaseTrack id:

- queue, playlist, and playback-session writes store the ReleaseTrack id;
- like, hide, and tag services resolve it to Recording before writing;
- playback history stores Recording as the aggregate owner and records the
  selected ReleaseTrack and PhysicalFile as provenance;
- the audio endpoint resolves ReleaseTrack to an active PhysicalFile.

This keeps current clients working while making the internal owner explicit.
Portable exports and future cross-server APIs use `stableId`, never a local
integer id or file path.

## 8. File Selection and Availability

A ReleaseTrack is playable when at least one attached PhysicalFile is active and
readable. Missing files do not make the Recording, Release, playlist item, or
history disappear.

The initial migration has one PhysicalFile per ReleaseTrack, so selection is
unambiguous. Once grouping is enabled, resolution follows these boundaries:

1. consider only active and readable files;
2. use the lowest explicit `preferenceRank` first;
3. use a deterministic quality fallback defined by the version-grouping work;
4. use PhysicalFile id as the final tie-breaker.

If a preferred file becomes missing, playback falls through to the next active
file without changing the playlist or queue item. The preference remains stored
so it becomes effective again if that file returns.

## 9. Source of Truth

| Field group | Source of truth |
| --- | --- |
| Relative path, hash, file size, availability, codec, bitrate, sample rate, duration | filesystem and media probe; DB is the indexed snapshot |
| Recording, Release, ReleaseTrack, credit, and grouping identities | Ocean Wave DB after first import |
| First-import title, credits, release, date, positions, genres, and version labels | embedded file tags seed the DB |
| Later Ocean Wave metadata edits | write and verify representable file tags first, then commit the DB transaction |
| External tag edits on an already linked file | detected as a difference; never silently remap or split DB relationships |
| Likes, hides, personal tags, playlists, queues, history, manual grouping, and preferred file | Ocean Wave DB only |
| Release artwork | existing cache/custom-cover policy; this change does not move artwork into files |

`tagSnapshotJson` records what the scanner observed. It is diagnostic input, not
a second canonical metadata model. A new server can reconstruct tag-encodable
metadata from files; DB-only relationships and preferences require the planned
library backup/export path.

### Relational metadata edit scope and recovery

A metadata edit resolves its complete target set before writing any file. The
target set depends on the edited owner:

- a Recording title, version, credit, or genre edit targets every active
  PhysicalFile below every ReleaseTrack for that Recording. Each file receives
  its effective printed values, so a ReleaseTrack title or credit override still
  wins for that appearance;
- a Release title, date, type, album credit, or total-disc edit targets every
  active PhysicalFile below that Release;
- a ReleaseTrack title, version, position, or credit-override edit targets every
  active PhysicalFile attached to that ReleaseTrack;
- a PhysicalFile path, hash, availability, or encoding value is scanner-owned
  and is not changed through the relational metadata editor.

When one command edits more than one owner, its target set is the union of those
files. A missing file is not rewritten. When it returns, the scanner reports its
stale tag snapshot as a reconciliation item and never lets those tags overwrite
the canonical relationships. An active but unreadable target fails preflight;
the editor does not silently apply a partial shared-entity edit.

SQLite and filesystem replacements cannot share one transaction. Before shared
relational edits are enabled, the metadata editor must therefore use a durable
operation journal with these steps:

1. Resolve target PhysicalFile stable ids and snapshot every affected entity's
   expected `metadataRevision`, old relational values, path, whole-file hash,
   and tag snapshot.
2. Create a rewritten temporary copy for every target without replacing an
   original. Verify its tags, readability, and whole-file hash, then flush the
   files and parent directories to durable storage.
3. Persist a `prepared` journal entry containing the requested relational
   change, target stable ids, expected revisions, old and new hashes, and the
   temporary and backup paths.
4. For each target, durably record `replacing` before the atomic same-filesystem
   renames, retain the original as a backup, and install the staged file. Verify
   the new hash, flush the installed file, and `fsync` every directory whose
   backup or target entry changed before durably recording `replaced`. Recovery
   uses the old/new hashes rather than trusting the last progress marker if a
   crash falls between a rename and its journal update.
5. Only after every target contains the verified new hash and every rename has
   crossed that filesystem durability barrier, run one DB transaction. It
   compares all expected revisions, writes the logical metadata and new file
   hashes/tag snapshots, increments each affected entity revision exactly once,
   and changes the journal state to `committed`.
6. For a committed operation, verify every installed file against its recorded
   new hash again before removing any backup or temporary file. Flush affected
   directories after cleanup, then durably record `cleaned`.

Every journal transition and the logical metadata commit uses SQLite's full
durability setting; an in-memory marker or a transaction acknowledged before
its journal/WAL is synced does not satisfy a state transition above.

Failure before replacement removes temporary files and leaves both originals
and relational rows unchanged. A replacement failure restores every file
already swapped from its retained backup while the DB remains unchanged. A DB
transaction or revision-check failure after replacement also restores every
original and requests a rescan. If any restoration cannot be verified, the
operation becomes `reconcile-required`; later edits to its targets are blocked
and recovery is surfaced explicitly rather than accepting split state.

Startup recovery processes every unfinished journal entry. A `prepared`,
`replacing`, or `replaced` operation is rolled back and is not closed until each
restored file matches its old hash and the restored directory entries are
synced. A `committed` operation may finish cleanup only when every target still
matches its recorded new hash. If a committed target is absent or mismatched,
recovery retains all backups and staging evidence and marks the operation
`reconcile-required`; it never deletes the last known-good copy. A recovery
service may either roll forward from a verified staged copy or restore every
backup and, in one compensating DB transaction, restore the recorded old
relational values while advancing metadata revisions again. Partial recovery is
not accepted. The current single-file "replace, then update DB" flow is not
sufficient for relational metadata edits. The metadata-editor work must add
this journal and recovery path before it enables edits shared by multiple
PhysicalFiles.

## 10. Rescan, Move, and Delete Rules

The scanner applies path identity first. A normalized path match updates that
PhysicalFile and does not perform hash-based identity selection.

For an unmatched new path, a hash candidate exists only when both its non-null
`contentHash` and `hashVersion` equal the scanner's current whole-file hash and
algorithm version. A null hash, a version mismatch, or a legacy hash from a
different algorithm never matches. Candidate ordering is only for stable
reporting; neither input order nor the lowest database id may choose an identity.
The scanner partitions exact candidates by whether each candidate's old
normalized path is visible in the same completed scan, then applies these rules:

1. Exactly one candidate exists and its old path is not visible: update only
   that PhysicalFile's path. This is the sole automatic move case; its
   ReleaseTrack and every logical or user-state id remain unchanged.
2. One or more candidates are still visible and every candidate belongs to the
   same ReleaseTrack: create a new PhysicalFile at the new path attached to that
   ReleaseTrack with `duplicate` status. Do not transfer an existing stable id.
3. Multiple candidates have non-visible paths and all belong to the same
   ReleaseTrack: create a new `duplicate` PhysicalFile on that ReleaseTrack,
   leave every missing candidate and its provenance untouched, and report the
   ambiguous stale identities for explicit cleanup. Never guess which missing
   file moved.
4. Candidates span more than one ReleaseTrack, whether visible or missing:
   create a new Recording, ReleaseTrack, and PhysicalFile without inherited
   preferences or history, and report all candidate stable ids as a grouping
   conflict. Never attach by arbitrary candidate order.
5. No exact candidates exist: create a new PhysicalFile and, until version
   grouping is explicitly implemented, a new Recording and ReleaseTrack.

A new logical row from rules 4 or 5 may reuse a Release only when normalized
title, full ordered album credit, and release date all match within the same
scan. New duplicates remain hidden until an explicit grouping workflow activates
them, so a rescan cannot unexpectedly add a second visible library item.

- Title, artist-name, album-name, and duration similarity alone never perform an
  automatic merge.
- A missing scan marks PhysicalFile missing with `missingSinceAt`. It never
  prunes Release, Recording, or Artist rows.
- Returning files clear the missing marker on the same PhysicalFile identity.
- The whole-file hash includes embedded tags and proves byte identity only.
  Re-encoding or a tag rewrite is not a move because the hash changes.
  Fingerprint work may later propose a relink, but ambiguous cases require
  confirmation.

Normal sync never hard-deletes library entities. Explicit deletion follows these
foreign-key rules:

- Recording and Release are restricted while ReleaseTracks refer to them.
- ReleaseTrack is restricted while PhysicalFiles, playlists, queues, or history
  refer to it.
- Artist is restricted while any ArtistCredit refers to it.
- ArtistCredit and RecordingGenre are dependent edges and cascade with their
  owner.
- PlaybackEvent restricts Recording deletion but allows its optional
  PhysicalFile provenance to become null after an explicit file purge.
- PlaybackSession may set its current ReleaseTrack to null only through the
  explicit cleanup service; queue and playlist rows are never silently cascaded.

The cleanup service must show affected user state and perform any reassignment
or deletion in one transaction before removing a logical entity.

## 11. Deferred External Identity

The first migration stores opaque local `stableId` values and the existing
whole-file hash. It does not invent external identifiers.

Later stable-relink work may add normalized identifier tables with a scheme and
value rather than one nullable column per provider:

- MusicBrainz Recording and Release identifiers;
- one or more ISRC values for Recording;
- AcoustID results and versioned audio fingerprints;
- MusicBrainz Artist identifiers;
- file fingerprint algorithm, version, and confidence evidence.

External ids are evidence, not permission to overwrite user grouping. Exact
validated identifiers may support automatic relink; conflicting or
low-confidence candidates remain reviewable.

## 12. Migration Guardrails

The follow-up migration must run against the current Ocean Wave baseline, not a
Beato migration history. Before swapping tables, it must reject duplicate
normalized file paths, invalid legacy years, invalid positions, and negative or
non-finite media values, and make a backup-copy workflow explicit.

Within one SQLite transaction it must:

1. create the new tables and indexes;
2. backfill the one-to-one entities and credits with preserved numeric ids;
3. rebuild every dependent table using the mapping above;
4. verify row counts and aggregate values;
5. run `PRAGMA foreign_key_check`;
6. drop legacy tables only after all checks pass.

Required acceptance evidence includes:

- Recording, ReleaseTrack, and PhysicalFile counts equal the old Music count;
- Release count equals the old Album count;
- playlist items, queue items, preferences, tags, and playback-event counts are
  unchanged;
- play, skip, completion, and total-listened aggregates are unchanged;
- every compatibility Music id still resolves to the same title, release,
  active path, and user state;
- new-install migration and an upgraded copy of a real Ocean Wave database both
  pass;
- a forced failure leaves the pre-migration database recoverable rather than a
  partially rebuilt schema.

Automatic grouping, multi-value tag parsing, external metadata lookup, lyrics,
and downloader integration remain outside this migration.

## 13. Artist Credit API Transition

The GraphQL `Music.artist` and `Album.artist` fields remain compatibility
projections of the first ordered primary credit. They are deprecated, and
first-party clients must use `artistCredits` for identity/navigation and
`artistDisplayName` for rendering, search, and sort. The scalar fields may only
be removed in a future breaking schema version after supported external clients
have had a full migration window.

Metadata mutations accept ordered `artistCredits` and `albumArtistCredits`.
The legacy scalar `artist` and `albumArtist` inputs remain accepted during the
same compatibility window but are not sent by first-party clients. A scalar tag
without a corresponding multi-value tag is one artist value and is never split
on commas. When a format exposes explicit artist values, their order defines
the credit boundaries and the singular display value may recover join phrases.

File formats do not consistently encode arbitrary credit roles or join phrases.
The relational credit remains canonical. A rescan that reports the same ordered
participants preserves its existing roles, credited names, and join phrases,
even when the tag reader normalizes the singular display separator. Changing
the ordered participant list creates a new parsed presentation instead of
silently applying stale credit semantics.
