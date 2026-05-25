# Ocean Wave Client API Import Convention

Updated: 2026-05-25

## 1. Purpose
- Keep the client API layer easy to trace after it was split by domain.
- Prevent new code from hiding domain ownership behind the top-level `~/api` barrel.

## 2. Core Rule
- New client code must import API functions from the domain module that owns the call.
- Do not add new production imports from the top-level `~/api` barrel.

Allowed examples:

```ts
import { getAuthSession } from '~/api/auth';
import { getAlbum, getMusics } from '~/api/library';
import { getAudio } from '~/api/playback';
import { getLatestSyncReport } from '~/api/sync';
```

Disallowed example:

```ts
import { getAlbum } from '~/api';
```

## 3. Domain Modules
- `~/api/auth`: auth session and logout calls.
- `~/api/graphql`: GraphQL request helpers only.
- `~/api/library`: music, artist, album, and playlist GraphQL calls.
- `~/api/playback`: audio playback HTTP calls.
- `~/api/sync`: sync report GraphQL calls.
- `~/api/query-keys`: React Query key builders.

## 4. Barrel Compatibility
- `packages/client/src/api/index.ts` remains for compatibility with older code and external references.
- Do not use the barrel as the default import path for new or touched production code.
- A broad barrel-removal refactor is not required; prefer updating touched imports only.

## 5. Verification
Run this scan before PR when touching client API usage:

```bash
python3 - <<'PY'
from pathlib import Path
for path in sorted(Path('packages/client/src').rglob('*')):
    if path.suffix in {'.ts', '.tsx'}:
        for line_no, line in enumerate(path.read_text().splitlines(), 1):
            if "from '~/api'" in line:
                print(f'{path}:{line_no}:{line}')
PY
```

Expected result: no production imports from `~/api`.
