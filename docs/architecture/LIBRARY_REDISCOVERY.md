# Library Rediscovery Ranking

Updated: 2026-07-21

## 1. Purpose and Boundary

Library rediscovery ranks owned music from persisted metadata and listening
signals. It does not use external charts, recommendation APIs, audio embeddings,
or nondeterministic sampling.

The server returns candidate identifiers, integer scores, and reason codes. UI
surfaces decide how to label and present those candidates in later work. Only
active, non-hated tracks are eligible.

## 2. Candidate Sections

The same input and reference time always produce the same order.

| Section | Qualification |
| --- | --- |
| Recently added | Added within 45 days |
| Dormant liked | Liked and never played, or not played for at least 30 days |
| Underplayed | At most 2.5 equivalent listens, using the greater of `playCount` and `totalPlayedMs / durationMs` |
| Forgotten albums | Album is at least 30 days old and none of its eligible tracks were played within 60 days |
| Fallback | Remaining eligible tracks when specialized sections do not describe the library well |

Track sections are allocated in this order: recently added, dormant liked,
underplayed, then fallback. A track appears in at most one track section. Album
candidates are independent because they represent a collection rather than a
duplicate track card.

## 3. Explainable Score

Scores are clamped to integer values from 0 through 100. Each section starts
with a category-specific score and combines these signals:

- a liked-track boost;
- completion share versus reliable skip signals;
- age since the last play;
- effective listen count;
- age since library addition;
- repeated positive tag and genre affinity;
- a penalty for a track replayed within the last seven days;
- selection-time artist and album diversity penalties.

Tag or genre affinity requires the same value to appear in at least two
positive seed tracks. A seed is liked or has completion evidence, and skips
reduce its contribution. This prevents a single uniquely tagged track from
declaring its own preference.

Ranking uses numeric identifiers as the final tie-breaker. Client clocks and
random values never participate.

## 4. Diversity and Small Libraries

Selection prefers a new album and allows at most two results from one artist
while alternatives exist. The constraint relaxes only when necessary to fill a
small or single-artist library. Repeated artist and album selections also reduce
the returned score at selection time.

If no specialized track rule applies, the fallback favors dormant and less
played tracks instead of returning an empty discovery response. Specialized
sections may still be empty; consumers use the non-empty sections and fallback
rather than rendering empty placeholders.

## 5. Reason Codes

The GraphQL contract returns one or more of these stable codes:

- `RECENTLY_ADDED`
- `LIKED_NOT_RECENTLY_PLAYED`
- `NEVER_PLAYED`
- `RARELY_PLAYED`
- `FORGOTTEN_ALBUM`
- `FREQUENTLY_COMPLETED`
- `TAG_AFFINITY`
- `GENRE_AFFINITY`
- `LIBRARY_FALLBACK`

Reason codes describe why a candidate was selected. They are not user-facing
copy and can be translated into context-specific labels by the client.

## 6. Bounded Data Access

The query does not load the full library.

- Default result limit: 8 candidates per section.
- Maximum result limit: 24 candidates per section.
- Source pools: `max(limit * 8, 48)`, capped at 192 rows per source.
- Sources: newest tracks, oldest liked tracks, qualified underplayed tracks,
  positive affinity seeds, a general fallback, and qualified album aggregates.
- Logical database operations: 8, independent of library size.
- Candidate details are loaded once for the union of the bounded source IDs.

The benchmark command is:

```bash
pnpm --filter ocean-wave-server benchmark:rediscovery
```

On 2026-07-21, a migrated copy of the local 2,547-track library produced a
70-track candidate pool. Ten warm runs at the default limit executed 12 SQL
statements each, with an 11.50 ms median and 16.31 ms p95 response time. These are
local measurements, not production latency guarantees.

## 7. GraphQL Contract

`libraryRediscovery(limit: Int)` returns:

- `generatedAt` as the ranking reference time;
- `eligibleMusicCount` for fallback decisions;
- track candidates for recently added, dormant liked, underplayed, and fallback;
- album candidates with a representative track, track count, and last-played
  timestamp;
- integer scores and reason codes for every candidate.

The diagnostics used by the benchmark are service-only and are not exposed in
GraphQL.
