const DAY_MS = 24 * 60 * 60 * 1_000;

export const LIBRARY_REDISCOVERY_THRESHOLDS = {
    recentlyAddedDays: 45,
    dormantLikedDays: 30,
    forgottenAlbumDays: 60,
    forgottenAlbumMinimumAgeDays: 30,
    recentRepeatDays: 7,
    underplayedEquivalentListens: 2.5
} as const;

export const LIBRARY_REDISCOVERY_REASON_CODES = [
    'RECENTLY_ADDED',
    'LIKED_NOT_RECENTLY_PLAYED',
    'NEVER_PLAYED',
    'RARELY_PLAYED',
    'FORGOTTEN_ALBUM',
    'FREQUENTLY_COMPLETED',
    'TAG_AFFINITY',
    'GENRE_AFFINITY',
    'LIBRARY_FALLBACK'
] as const;

export type LibraryRediscoveryReasonCode =
    typeof LIBRARY_REDISCOVERY_REASON_CODES[number];

export interface LibraryRediscoveryTrackInput {
    id: number;
    artistId: number;
    albumId: number;
    createdAtMs: number;
    lastPlayedAtMs: number | null;
    durationMs: number;
    playCount: number;
    totalPlayedMs: number;
    skipCount: number;
    completionCount: number;
    isLiked: boolean;
    isAffinitySeed: boolean;
    tagIds: number[];
    genreIds: number[];
}

export interface LibraryRediscoveryAlbumInput {
    id: number;
    artistId: number;
    representativeMusicId: number;
    createdAtMs: number;
    lastPlayedAtMs: number | null;
    trackCount: number;
    totalPlayCount: number;
    totalSkipCount: number;
    totalCompletionCount: number;
    likedTrackCount: number;
}

export interface RankedLibraryRediscoveryTrack {
    musicId: number;
    score: number;
    reasonCodes: LibraryRediscoveryReasonCode[];
}

export interface RankedLibraryRediscoveryAlbum {
    albumId: number;
    representativeMusicId: number;
    trackCount: number;
    lastPlayedAtMs: number | null;
    score: number;
    reasonCodes: LibraryRediscoveryReasonCode[];
}

export interface LibraryRediscoveryRanking {
    recentlyAdded: RankedLibraryRediscoveryTrack[];
    dormantLiked: RankedLibraryRediscoveryTrack[];
    underplayed: RankedLibraryRediscoveryTrack[];
    forgottenAlbums: RankedLibraryRediscoveryAlbum[];
    fallback: RankedLibraryRediscoveryTrack[];
}

interface AffinityStat {
    count: number;
    weight: number;
}

interface AffinityContext {
    genres: Map<number, AffinityStat>;
    tags: Map<number, AffinityStat>;
}

type TrackCategory = 'recently-added' | 'dormant-liked' | 'underplayed' | 'fallback';

interface TrackScoreCandidate extends RankedLibraryRediscoveryTrack {
    albumId: number;
    artistId: number;
    baseScore: number;
}

interface AlbumScoreCandidate extends RankedLibraryRediscoveryAlbum {
    artistId: number;
    baseScore: number;
}

const finiteNonNegative = (value: number) => (
    Number.isFinite(value) ? Math.max(value, 0) : 0
);

const daysSince = (nowMs: number, timestampMs: number | null) => {
    if (timestampMs === null || !Number.isFinite(timestampMs)) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.max(nowMs - timestampMs, 0) / DAY_MS;
};

const boundedRatio = (value: number, maximum: number) => {
    if (maximum <= 0) {
        return 0;
    }

    return Math.min(Math.max(value / maximum, 0), 1);
};

const uniqueIds = (ids: number[]) => [...new Set(ids.filter(id => (
    Number.isInteger(id) && id > 0
)))];

const effectiveListens = (track: LibraryRediscoveryTrackInput) => {
    const durationMs = finiteNonNegative(track.durationMs);
    const playedEquivalent = durationMs > 0
        ? finiteNonNegative(track.totalPlayedMs) / durationMs
        : 0;

    return Math.max(finiteNonNegative(track.playCount), playedEquivalent);
};

const addAffinity = (
    target: Map<number, AffinityStat>,
    ids: number[],
    weight: number
) => {
    uniqueIds(ids).forEach((id) => {
        const current = target.get(id) ?? { count: 0, weight: 0 };
        target.set(id, {
            count: current.count + 1,
            weight: current.weight + weight
        });
    });
};

const buildAffinityContext = (
    tracks: LibraryRediscoveryTrackInput[]
): AffinityContext => {
    const context: AffinityContext = {
        genres: new Map(),
        tags: new Map()
    };

    tracks.filter(track => track.isAffinitySeed).forEach((track) => {
        const positiveSignal = (track.isLiked ? 3 : 0)
            + Math.min(finiteNonNegative(track.completionCount), 5) * 1.5
            - Math.min(finiteNonNegative(track.skipCount), 5);

        if (positiveSignal <= 0) {
            return;
        }

        addAffinity(context.tags, track.tagIds, positiveSignal);
        addAffinity(context.genres, track.genreIds, positiveSignal);
    });

    return context;
};

const affinityStrength = (
    ids: number[],
    affinity: Map<number, AffinityStat>
) => {
    const eligible = [...affinity.values()].filter(stat => stat.count >= 2);
    const maximumWeight = Math.max(0, ...eligible.map(stat => stat.weight));

    if (maximumWeight <= 0) {
        return 0;
    }

    return Math.max(0, ...uniqueIds(ids).map((id) => {
        const stat = affinity.get(id);

        if (!stat || stat.count < 2) {
            return 0;
        }

        return boundedRatio(stat.weight, maximumWeight);
    }));
};

const commonTrackScore = (
    track: LibraryRediscoveryTrackInput,
    affinity: AffinityContext,
    nowMs: number
) => {
    const terminalSignals = finiteNonNegative(track.completionCount)
        + finiteNonNegative(track.skipCount);
    const completionShare = terminalSignals > 0
        ? finiteNonNegative(track.completionCount) / terminalSignals
        : 0.5;
    const recentDays = daysSince(nowMs, track.lastPlayedAtMs);
    const recentRepeatPenalty = recentDays < LIBRARY_REDISCOVERY_THRESHOLDS.recentRepeatDays
        ? (1 - boundedRatio(
            recentDays,
            LIBRARY_REDISCOVERY_THRESHOLDS.recentRepeatDays
        )) * (8 + Math.min(finiteNonNegative(track.playCount), 6) * 2)
        : 0;
    const tagAffinity = affinityStrength(track.tagIds, affinity.tags);
    const genreAffinity = affinityStrength(track.genreIds, affinity.genres);

    return {
        genreAffinity,
        score: (track.isLiked ? 12 : 0)
            + completionShare * 10
            - (1 - completionShare) * (terminalSignals > 0 ? 12 : 0)
            - recentRepeatPenalty
            + tagAffinity * 8
            + genreAffinity * 6,
        tagAffinity
    };
};

const trackQualifies = (
    track: LibraryRediscoveryTrackInput,
    category: TrackCategory,
    nowMs: number
) => {
    const createdDays = daysSince(nowMs, track.createdAtMs);
    const dormantDays = daysSince(nowMs, track.lastPlayedAtMs);

    switch (category) {
        case 'recently-added':
            return createdDays <= LIBRARY_REDISCOVERY_THRESHOLDS.recentlyAddedDays;
        case 'dormant-liked':
            return track.isLiked
                && dormantDays >= LIBRARY_REDISCOVERY_THRESHOLDS.dormantLikedDays;
        case 'underplayed':
            return effectiveListens(track)
                <= LIBRARY_REDISCOVERY_THRESHOLDS.underplayedEquivalentListens;
        case 'fallback':
            return true;
    }
};

const trackReasons = (
    track: LibraryRediscoveryTrackInput,
    category: TrackCategory,
    affinities: Pick<ReturnType<typeof commonTrackScore>, 'genreAffinity' | 'tagAffinity'>
) => {
    const reasons: LibraryRediscoveryReasonCode[] = [];

    if (category === 'recently-added') {
        reasons.push('RECENTLY_ADDED');
    } else if (category === 'dormant-liked') {
        reasons.push('LIKED_NOT_RECENTLY_PLAYED');
    } else if (category === 'fallback') {
        reasons.push('LIBRARY_FALLBACK');
    }

    const listens = effectiveListens(track);
    if (listens === 0) {
        reasons.push('NEVER_PLAYED');
    } else if (listens <= LIBRARY_REDISCOVERY_THRESHOLDS.underplayedEquivalentListens) {
        reasons.push('RARELY_PLAYED');
    }

    if (
        finiteNonNegative(track.completionCount) >= 2
        && track.completionCount > track.skipCount
    ) {
        reasons.push('FREQUENTLY_COMPLETED');
    }
    if (affinities.tagAffinity >= 0.65) {
        reasons.push('TAG_AFFINITY');
    }
    if (affinities.genreAffinity >= 0.65) {
        reasons.push('GENRE_AFFINITY');
    }

    return [...new Set(reasons)];
};

const categoryTrackScore = (
    track: LibraryRediscoveryTrackInput,
    category: TrackCategory,
    affinity: AffinityContext,
    nowMs: number
): TrackScoreCandidate => {
    const common = commonTrackScore(track, affinity, nowMs);
    const createdDays = daysSince(nowMs, track.createdAtMs);
    const dormantDays = daysSince(nowMs, track.lastPlayedAtMs);
    const listens = effectiveListens(track);
    let categoryScore: number;

    switch (category) {
        case 'recently-added':
            categoryScore = 38
                + (1 - boundedRatio(
                    createdDays,
                    LIBRARY_REDISCOVERY_THRESHOLDS.recentlyAddedDays
                )) * 28
                + (1 - boundedRatio(
                    listens,
                    LIBRARY_REDISCOVERY_THRESHOLDS.underplayedEquivalentListens
                )) * 12;
            break;
        case 'dormant-liked':
            categoryScore = 48
                + boundedRatio(
                    dormantDays,
                    365
                ) * 28
                + (listens === 0 ? 8 : 0);
            break;
        case 'underplayed':
            categoryScore = 35
                + (1 - boundedRatio(
                    listens,
                    LIBRARY_REDISCOVERY_THRESHOLDS.underplayedEquivalentListens
                )) * 30
                + boundedRatio(createdDays, 365) * 8;
            break;
        case 'fallback':
            categoryScore = 24
                + boundedRatio(dormantDays, 180) * 18
                + (1 - boundedRatio(listens, 8)) * 16;
            break;
    }

    return {
        albumId: track.albumId,
        artistId: track.artistId,
        baseScore: categoryScore + common.score,
        musicId: track.id,
        reasonCodes: trackReasons(track, category, common),
        score: 0
    };
};

const roundedScore = (score: number) => Math.round(Math.min(Math.max(score, 0), 100));

const chooseBestTrack = (
    candidates: TrackScoreCandidate[],
    artistCounts: Map<number, number>,
    albumCounts: Map<number, number>
) => [...candidates].sort((left, right) => {
    const leftScore = left.baseScore
        - (artistCounts.get(left.artistId) ?? 0) * 12
        - (albumCounts.get(left.albumId) ?? 0) * 18;
    const rightScore = right.baseScore
        - (artistCounts.get(right.artistId) ?? 0) * 12
        - (albumCounts.get(right.albumId) ?? 0) * 18;

    return rightScore - leftScore || left.musicId - right.musicId;
})[0];

const diversifyTracks = (
    candidates: TrackScoreCandidate[],
    limit: number
) => {
    const selected: RankedLibraryRediscoveryTrack[] = [];
    const remaining = [...candidates];
    const artistCounts = new Map<number, number>();
    const albumCounts = new Map<number, number>();

    while (selected.length < limit && remaining.length > 0) {
        const strictPool = remaining.filter(candidate => (
            (albumCounts.get(candidate.albumId) ?? 0) === 0
            && (artistCounts.get(candidate.artistId) ?? 0) < 2
        ));
        const artistDiversePool = remaining.filter(candidate => (
            (artistCounts.get(candidate.artistId) ?? 0) < 2
        ));
        const albumDiversePool = remaining.filter(candidate => (
            (albumCounts.get(candidate.albumId) ?? 0) === 0
        ));
        const pool = strictPool.length > 0
            ? strictPool
            : artistDiversePool.length > 0
                ? artistDiversePool
                : albumDiversePool.length > 0 ? albumDiversePool : remaining;
        const best = chooseBestTrack(pool, artistCounts, albumCounts);
        const adjustedScore = best.baseScore
            - (artistCounts.get(best.artistId) ?? 0) * 12
            - (albumCounts.get(best.albumId) ?? 0) * 18;

        selected.push({
            musicId: best.musicId,
            reasonCodes: best.reasonCodes,
            score: roundedScore(adjustedScore)
        });
        artistCounts.set(best.artistId, (artistCounts.get(best.artistId) ?? 0) + 1);
        albumCounts.set(best.albumId, (albumCounts.get(best.albumId) ?? 0) + 1);
        remaining.splice(remaining.indexOf(best), 1);
    }

    return selected;
};

const rankTrackCategory = (
    tracks: LibraryRediscoveryTrackInput[],
    category: TrackCategory,
    affinity: AffinityContext,
    nowMs: number,
    limit: number,
    excludedMusicIds: Set<number>
) => diversifyTracks(tracks
    .filter(track => !excludedMusicIds.has(track.id))
    .filter(track => trackQualifies(track, category, nowMs))
    .map(track => categoryTrackScore(track, category, affinity, nowMs)), limit);

const albumQualifies = (
    album: LibraryRediscoveryAlbumInput,
    nowMs: number
) => daysSince(nowMs, album.createdAtMs)
    >= LIBRARY_REDISCOVERY_THRESHOLDS.forgottenAlbumMinimumAgeDays
    && daysSince(nowMs, album.lastPlayedAtMs)
    >= LIBRARY_REDISCOVERY_THRESHOLDS.forgottenAlbumDays;

const scoreAlbum = (
    album: LibraryRediscoveryAlbumInput,
    nowMs: number
): AlbumScoreCandidate => {
    const trackCount = Math.max(Math.round(finiteNonNegative(album.trackCount)), 1);
    const terminalSignals = finiteNonNegative(album.totalCompletionCount)
        + finiteNonNegative(album.totalSkipCount);
    const completionShare = terminalSignals > 0
        ? finiteNonNegative(album.totalCompletionCount) / terminalSignals
        : 0.5;
    const dormancy = boundedRatio(daysSince(nowMs, album.lastPlayedAtMs), 365);
    const likedShare = boundedRatio(album.likedTrackCount, trackCount);
    const averagePlayCount = finiteNonNegative(album.totalPlayCount) / trackCount;
    const baseScore = 46
        + dormancy * 28
        + likedShare * 12
        + completionShare * 10
        - (1 - completionShare) * (terminalSignals > 0 ? 10 : 0)
        + (1 - boundedRatio(averagePlayCount, 8)) * 8;

    return {
        albumId: album.id,
        artistId: album.artistId,
        baseScore,
        lastPlayedAtMs: album.lastPlayedAtMs,
        reasonCodes: ['FORGOTTEN_ALBUM'],
        representativeMusicId: album.representativeMusicId,
        score: 0,
        trackCount
    };
};

const diversifyAlbums = (
    candidates: AlbumScoreCandidate[],
    limit: number
) => {
    const selected: RankedLibraryRediscoveryAlbum[] = [];
    const remaining = [...candidates];
    const artistCounts = new Map<number, number>();

    while (selected.length < limit && remaining.length > 0) {
        const strictPool = remaining.filter(candidate => (
            (artistCounts.get(candidate.artistId) ?? 0) < 2
        ));
        const pool = strictPool.length > 0 ? strictPool : remaining;
        const best = [...pool].sort((left, right) => {
            const leftScore = left.baseScore
                - (artistCounts.get(left.artistId) ?? 0) * 14;
            const rightScore = right.baseScore
                - (artistCounts.get(right.artistId) ?? 0) * 14;

            return rightScore - leftScore || left.albumId - right.albumId;
        })[0];
        const adjustedScore = best.baseScore
            - (artistCounts.get(best.artistId) ?? 0) * 14;

        selected.push({
            albumId: best.albumId,
            lastPlayedAtMs: best.lastPlayedAtMs,
            reasonCodes: best.reasonCodes,
            representativeMusicId: best.representativeMusicId,
            score: roundedScore(adjustedScore),
            trackCount: best.trackCount
        });
        artistCounts.set(best.artistId, (artistCounts.get(best.artistId) ?? 0) + 1);
        remaining.splice(remaining.indexOf(best), 1);
    }

    return selected;
};

const addMusicIds = (
    target: Set<number>,
    candidates: RankedLibraryRediscoveryTrack[]
) => candidates.forEach(candidate => target.add(candidate.musicId));

export const rankLibraryRediscovery = ({
    albums,
    limit,
    nowMs,
    tracks
}: {
    albums: LibraryRediscoveryAlbumInput[];
    limit: number;
    nowMs: number;
    tracks: LibraryRediscoveryTrackInput[];
}): LibraryRediscoveryRanking => {
    const normalizedLimit = Math.max(Math.floor(finiteNonNegative(limit)), 1);
    const affinity = buildAffinityContext(tracks);
    const usedMusicIds = new Set<number>();
    const recentlyAdded = rankTrackCategory(
        tracks,
        'recently-added',
        affinity,
        nowMs,
        normalizedLimit,
        usedMusicIds
    );
    addMusicIds(usedMusicIds, recentlyAdded);
    const dormantLiked = rankTrackCategory(
        tracks,
        'dormant-liked',
        affinity,
        nowMs,
        normalizedLimit,
        usedMusicIds
    );
    addMusicIds(usedMusicIds, dormantLiked);
    const underplayed = rankTrackCategory(
        tracks,
        'underplayed',
        affinity,
        nowMs,
        normalizedLimit,
        usedMusicIds
    );
    addMusicIds(usedMusicIds, underplayed);
    const fallback = rankTrackCategory(
        tracks,
        'fallback',
        affinity,
        nowMs,
        normalizedLimit,
        usedMusicIds
    );
    const forgottenAlbums = diversifyAlbums(
        albums
            .filter(album => albumQualifies(album, nowMs))
            .map(album => scoreAlbum(album, nowMs)),
        normalizedLimit
    );

    return {
        dormantLiked,
        fallback,
        forgottenAlbums,
        recentlyAdded,
        underplayed
    };
};
