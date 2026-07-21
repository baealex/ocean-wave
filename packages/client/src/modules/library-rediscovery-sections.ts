import type {
    LibraryRediscovery,
    LibraryRediscoveryAlbumCandidate,
    LibraryRediscoveryReasonCode,
    LibraryRediscoveryTrackCandidate
} from '~/api/rediscovery';
import type { Music } from '~/models/type';

const DAY_MS = 24 * 60 * 60 * 1_000;
const RECENT_PLAY_WINDOW_DAYS = 7;

export const LIBRARY_REDISCOVERY_SECTION_LIMIT = 2;
export const LIBRARY_REDISCOVERY_ITEM_LIMIT = 5;
export const LIBRARY_REDISCOVERY_MINIMUM_ITEMS = 2;

export const LIBRARY_REDISCOVERY_REASON_COPY = {
    RECENTLY_ADDED: 'Added to your library recently',
    LIKED_NOT_RECENTLY_PLAYED: 'Liked, but not played in a while',
    NEVER_PLAYED: 'Still waiting for a first listen',
    RARELY_PLAYED: 'Only played a few times',
    FORGOTTEN_ALBUM: 'Not played in a while',
    FREQUENTLY_COMPLETED: 'A track you often finish',
    TAG_AFFINITY: 'Matches tags you return to',
    GENRE_AFFINITY: 'Fits genres you return to',
    LIBRARY_FALLBACK: 'A quieter corner of your library'
} satisfies Record<LibraryRediscoveryReasonCode, string>;

export type LibraryRediscoverySectionId =
    | 'dormant-liked'
    | 'forgotten-albums'
    | 'recently-added';

interface LibraryRediscoveryReason {
    code: LibraryRediscoveryReasonCode;
    copy: string;
}

export interface LibraryRediscoveryTrackItem {
    kind: 'track';
    music: Music;
    reason: LibraryRediscoveryReason;
    score: number;
}

export interface LibraryRediscoveryAlbumItem {
    kind: 'album';
    album: Pick<Music['album'], 'cover' | 'id' | 'name'>;
    artistName: string;
    reason: LibraryRediscoveryReason;
    representativeMusicId: string;
    score: number;
    trackCount: number;
}

export type LibraryRediscoverySectionItem =
    | LibraryRediscoveryTrackItem
    | LibraryRediscoveryAlbumItem;

export interface LibraryRediscoverySection {
    eyebrow: string;
    heading: string;
    id: LibraryRediscoverySectionId;
    items: LibraryRediscoverySectionItem[];
}

interface LibraryRediscoverySectionSource extends Omit<LibraryRediscoverySection, 'items'> {
    items: LibraryRediscoverySectionItem[];
}

interface ResolveLibraryRediscoverySectionsOptions {
    itemLimit?: number;
    minimumItems?: number;
    sectionLimit?: number;
}

const sectionDefinition = {
    'dormant-liked': {
        eyebrow: 'Rediscover',
        heading: 'Favorites worth revisiting',
        preferredReasonCode: 'LIKED_NOT_RECENTLY_PLAYED'
    },
    'forgotten-albums': {
        eyebrow: 'From your shelves',
        heading: 'Albums you may have forgotten',
        preferredReasonCode: 'FORGOTTEN_ALBUM'
    },
    'recently-added': {
        eyebrow: 'New in your library',
        heading: 'Recently added',
        preferredReasonCode: 'RECENTLY_ADDED'
    }
} as const satisfies Record<LibraryRediscoverySectionId, {
    eyebrow: string;
    heading: string;
    preferredReasonCode: LibraryRediscoveryReasonCode;
}>;

const resolveReason = (
    reasonCodes: LibraryRediscoveryReasonCode[],
    preferredReasonCode: LibraryRediscoveryReasonCode
): LibraryRediscoveryReason => {
    const code = reasonCodes.includes(preferredReasonCode)
        ? preferredReasonCode
        : (reasonCodes[0] ?? preferredReasonCode);

    return {
        code,
        copy: LIBRARY_REDISCOVERY_REASON_COPY[code]
    };
};

const parseTimestamp = (value: string | null) => {
    if (!value) {
        return null;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
};

const wasPlayedRecently = (
    lastPlayedAt: string | null,
    generatedAtMs: number | null
) => {
    if (generatedAtMs === null) {
        return false;
    }

    const lastPlayedAtMs = parseTimestamp(lastPlayedAt);

    return lastPlayedAtMs !== null
        && lastPlayedAtMs >= generatedAtMs - RECENT_PLAY_WINDOW_DAYS * DAY_MS;
};

const resolveTrackItems = ({
    candidates,
    generatedAtMs,
    musicMap,
    preferredReasonCode
}: {
    candidates: LibraryRediscoveryTrackCandidate[];
    generatedAtMs: number | null;
    musicMap: ReadonlyMap<string, Music>;
    preferredReasonCode: LibraryRediscoveryReasonCode;
}): LibraryRediscoveryTrackItem[] => candidates.flatMap((candidate) => {
    const music = musicMap.get(candidate.musicId);

    if (
        !music
        || music.isHated
        || wasPlayedRecently(music.lastPlayedAt, generatedAtMs)
    ) {
        return [];
    }

    return [{
        kind: 'track',
        music,
        reason: resolveReason(candidate.reasonCodes, preferredReasonCode),
        score: candidate.score
    }];
});

const resolveAlbumItems = ({
    candidates,
    generatedAtMs,
    musicMap,
    preferredReasonCode
}: {
    candidates: LibraryRediscoveryAlbumCandidate[];
    generatedAtMs: number | null;
    musicMap: ReadonlyMap<string, Music>;
    preferredReasonCode: LibraryRediscoveryReasonCode;
}): LibraryRediscoveryAlbumItem[] => candidates.flatMap((candidate) => {
    const representativeMusic = musicMap.get(candidate.representativeMusicId);

    if (
        !representativeMusic
        || representativeMusic.isHated
        || representativeMusic.album.id !== candidate.albumId
        || wasPlayedRecently(candidate.lastPlayedAt, generatedAtMs)
    ) {
        return [];
    }

    return [{
        album: {
            cover: representativeMusic.album.cover,
            id: representativeMusic.album.id,
            name: representativeMusic.album.name
        },
        artistName: representativeMusic.artistDisplayName,
        kind: 'album',
        reason: resolveReason(candidate.reasonCodes, preferredReasonCode),
        representativeMusicId: candidate.representativeMusicId,
        score: candidate.score,
        trackCount: candidate.trackCount
    }];
});

const resolveGeneratedAtMs = (generatedAt: string) => {
    const timestamp = Date.parse(generatedAt);
    return Number.isFinite(timestamp) ? timestamp : null;
};

const createSectionSources = (
    rediscovery: LibraryRediscovery,
    musicMap: ReadonlyMap<string, Music>
): LibraryRediscoverySectionSource[] => {
    const generatedAtMs = resolveGeneratedAtMs(rediscovery.generatedAt);

    const createTrackSource = (
        id: Extract<LibraryRediscoverySectionId, 'dormant-liked' | 'recently-added'>,
        candidates: LibraryRediscoveryTrackCandidate[]
    ): LibraryRediscoverySectionSource => {
        const definition = sectionDefinition[id];

        return {
            eyebrow: definition.eyebrow,
            heading: definition.heading,
            id,
            items: resolveTrackItems({
                candidates,
                generatedAtMs,
                musicMap,
                preferredReasonCode: definition.preferredReasonCode
            })
        };
    };
    const forgottenDefinition = sectionDefinition['forgotten-albums'];

    return [
        createTrackSource('dormant-liked', rediscovery.dormantLiked),
        {
            eyebrow: forgottenDefinition.eyebrow,
            heading: forgottenDefinition.heading,
            id: 'forgotten-albums',
            items: resolveAlbumItems({
                candidates: rediscovery.forgottenAlbums,
                generatedAtMs,
                musicMap,
                preferredReasonCode: forgottenDefinition.preferredReasonCode
            })
        },
        createTrackSource('recently-added', rediscovery.recentlyAdded)
    ];
};

const getItemAlbumId = (item: LibraryRediscoverySectionItem) => (
    item.kind === 'track' ? item.music.album.id : item.album.id
);

const getItemMusicId = (item: LibraryRediscoverySectionItem) => (
    item.kind === 'track' ? item.music.id : item.representativeMusicId
);

const selectDistinctItems = ({
    itemLimit,
    items,
    usedAlbumIds,
    usedMusicIds
}: {
    itemLimit: number;
    items: LibraryRediscoverySectionItem[];
    usedAlbumIds: ReadonlySet<string>;
    usedMusicIds: ReadonlySet<string>;
}) => {
    const selected: LibraryRediscoverySectionItem[] = [];
    const selectedAlbumIds = new Set(usedAlbumIds);
    const selectedMusicIds = new Set(usedMusicIds);

    for (const item of items) {
        const albumId = getItemAlbumId(item);
        const musicId = getItemMusicId(item);

        if (selectedAlbumIds.has(albumId) || selectedMusicIds.has(musicId)) {
            continue;
        }

        selected.push(item);
        selectedAlbumIds.add(albumId);
        selectedMusicIds.add(musicId);

        if (selected.length >= itemLimit) {
            break;
        }
    }

    return selected;
};

const rotateSources = (
    sources: LibraryRediscoverySectionSource[],
    generatedAtMs: number | null
) => {
    if (sources.length < 2) {
        return sources;
    }

    const dayIndex = generatedAtMs === null
        ? 0
        : Math.floor(generatedAtMs / DAY_MS);
    const offset = dayIndex % sources.length;

    return [...sources.slice(offset), ...sources.slice(0, offset)];
};

export const resolveLibraryRediscoverySections = (
    rediscovery: LibraryRediscovery,
    musicMap: ReadonlyMap<string, Music>,
    {
        itemLimit = LIBRARY_REDISCOVERY_ITEM_LIMIT,
        minimumItems = LIBRARY_REDISCOVERY_MINIMUM_ITEMS,
        sectionLimit = LIBRARY_REDISCOVERY_SECTION_LIMIT
    }: ResolveLibraryRediscoverySectionsOptions = {}
): LibraryRediscoverySection[] => {
    const normalizedItemLimit = Math.max(Math.floor(itemLimit), 1);
    const normalizedMinimumItems = Math.max(
        Math.min(Math.floor(minimumItems), normalizedItemLimit),
        1
    );
    const normalizedSectionLimit = Math.max(Math.floor(sectionLimit), 1);
    const sources = createSectionSources(rediscovery, musicMap);
    const primarySource = sources.find((source) => (
        selectDistinctItems({
            itemLimit: normalizedItemLimit,
            items: source.items,
            usedAlbumIds: new Set(),
            usedMusicIds: new Set()
        }).length >= normalizedMinimumItems
    ));

    if (!primarySource) {
        return [];
    }

    const generatedAtMs = resolveGeneratedAtMs(rediscovery.generatedAt);
    const secondarySources = rotateSources(
        sources.filter(source => source.id !== primarySource.id),
        generatedAtMs
    );
    const orderedSources = [primarySource, ...secondarySources];
    const selectedSections: LibraryRediscoverySection[] = [];
    const usedAlbumIds = new Set<string>();
    const usedMusicIds = new Set<string>();

    for (const source of orderedSources) {
        const items = selectDistinctItems({
            itemLimit: normalizedItemLimit,
            items: source.items,
            usedAlbumIds,
            usedMusicIds
        });

        if (items.length < normalizedMinimumItems) {
            continue;
        }

        items.forEach((item) => {
            usedAlbumIds.add(getItemAlbumId(item));
            usedMusicIds.add(getItemMusicId(item));
        });
        selectedSections.push({
            eyebrow: source.eyebrow,
            heading: source.heading,
            id: source.id,
            items
        });

        if (selectedSections.length >= normalizedSectionLimit) {
            break;
        }
    }

    return selectedSections;
};
