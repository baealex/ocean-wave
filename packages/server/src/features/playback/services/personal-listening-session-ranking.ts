const DAY_MS = 24 * 60 * 60 * 1_000;

export const PERSONAL_LISTENING_SESSION_RECENT_REPEAT_DAYS = 7;
const MAX_TRACKS_PER_ARTIST = 2;
const MAX_TRACKS_PER_ALBUM = 2;

export const PERSONAL_LISTENING_SESSION_REASON_CODES = [
    'START_TRACK',
    'SAME_ALBUM',
    'SAME_ARTIST',
    'SHARED_SMART_VIEW',
    'SHARED_TAG',
    'SHARED_GENRE'
] as const;

export type PersonalListeningSessionReasonCode =
    typeof PERSONAL_LISTENING_SESSION_REASON_CODES[number];

export type PersonalListeningSessionScope = 'focused' | 'explore';

export interface PersonalListeningSessionTrackInput {
    id: number;
    albumId: number;
    artistId: number;
    completionCount: number;
    genreIds: number[];
    isLiked: boolean;
    lastPlayedAtMs: number | null;
    playCount: number;
    skipCount: number;
    tagIds: number[];
}

export interface PersonalListeningSessionSmartViewInput {
    id: number;
    tagIds: number[];
    tagMode: 'all' | 'any';
}

export interface RankedPersonalListeningSessionItem {
    musicId: number;
    reasonCodes: PersonalListeningSessionReasonCode[];
}

interface SessionCandidate extends RankedPersonalListeningSessionItem {
    albumId: number;
    artistId: number;
    score: number;
}

const uniqueIds = (ids: number[]) => [...new Set(ids.filter(id => (
    Number.isInteger(id) && id > 0
)))];

const sharedCount = (left: number[], right: number[]) => {
    const rightIds = new Set(uniqueIds(right));
    return uniqueIds(left).filter(id => rightIds.has(id)).length;
};

const matchesSmartView = (
    track: PersonalListeningSessionTrackInput,
    view: PersonalListeningSessionSmartViewInput
) => {
    const viewTagIds = uniqueIds(view.tagIds);

    if (viewTagIds.length === 0) {
        return false;
    }

    const trackTagIds = new Set(uniqueIds(track.tagIds));
    return view.tagMode === 'all'
        ? viewTagIds.every(tagId => trackTagIds.has(tagId))
        : viewTagIds.some(tagId => trackTagIds.has(tagId));
};

const isRecentRepeat = (
    lastPlayedAtMs: number | null,
    nowMs: number
) => lastPlayedAtMs !== null
    && Number.isFinite(lastPlayedAtMs)
    && Math.max(nowMs - lastPlayedAtMs, 0)
        < PERSONAL_LISTENING_SESSION_RECENT_REPEAT_DAYS * DAY_MS;

const relationshipReasons = ({
    candidate,
    seed,
    seedSmartViews
}: {
    candidate: PersonalListeningSessionTrackInput;
    seed: PersonalListeningSessionTrackInput;
    seedSmartViews: PersonalListeningSessionSmartViewInput[];
}) => {
    const reasons: PersonalListeningSessionReasonCode[] = [];

    if (candidate.albumId === seed.albumId) {
        reasons.push('SAME_ALBUM');
    }
    if (candidate.artistId === seed.artistId) {
        reasons.push('SAME_ARTIST');
    }
    if (seedSmartViews.some(view => matchesSmartView(candidate, view))) {
        reasons.push('SHARED_SMART_VIEW');
    }
    if (sharedCount(candidate.tagIds, seed.tagIds) > 0) {
        reasons.push('SHARED_TAG');
    }
    if (sharedCount(candidate.genreIds, seed.genreIds) > 0) {
        reasons.push('SHARED_GENRE');
    }

    return reasons;
};

const qualifiesForScope = ({
    candidate,
    reasons,
    scope,
    seed
}: {
    candidate: PersonalListeningSessionTrackInput;
    reasons: PersonalListeningSessionReasonCode[];
    scope: PersonalListeningSessionScope;
    seed: PersonalListeningSessionTrackInput;
}) => {
    if (reasons.length === 0) {
        return false;
    }

    if (scope === 'explore') {
        return true;
    }

    const sharedTagCount = sharedCount(candidate.tagIds, seed.tagIds);
    const sharedGenreCount = sharedCount(candidate.genreIds, seed.genreIds);

    return reasons.includes('SAME_ALBUM')
        || reasons.includes('SAME_ARTIST')
        || reasons.includes('SHARED_SMART_VIEW')
        || sharedTagCount >= 2
        || (sharedTagCount >= 1 && sharedGenreCount >= 1);
};

const candidateScore = ({
    candidate,
    nowMs,
    reasons,
    scope,
    seed
}: {
    candidate: PersonalListeningSessionTrackInput;
    nowMs: number;
    reasons: PersonalListeningSessionReasonCode[];
    scope: PersonalListeningSessionScope;
    seed: PersonalListeningSessionTrackInput;
}) => {
    const sharedTagCount = Math.min(sharedCount(candidate.tagIds, seed.tagIds), 3);
    const sharedGenreCount = Math.min(sharedCount(candidate.genreIds, seed.genreIds), 2);
    const terminalSignals = Math.max(candidate.completionCount, 0)
        + Math.max(candidate.skipCount, 0);
    const completionShare = terminalSignals > 0
        ? Math.max(candidate.completionCount, 0) / terminalSignals
        : 0.5;
    const daysSincePlay = candidate.lastPlayedAtMs === null
        ? 180
        : Math.min(Math.max(nowMs - candidate.lastPlayedAtMs, 0) / DAY_MS, 180);
    const relationshipScore = scope === 'focused'
        ? (reasons.includes('SAME_ALBUM') ? 34 : 0)
            + (reasons.includes('SAME_ARTIST') ? 25 : 0)
            + (reasons.includes('SHARED_SMART_VIEW') ? 28 : 0)
            + sharedTagCount * 10
            + sharedGenreCount * 7
        : (reasons.includes('SAME_ALBUM') ? 16 : 0)
            + (reasons.includes('SAME_ARTIST') ? 12 : 0)
            + (reasons.includes('SHARED_SMART_VIEW') ? 30 : 0)
            + sharedTagCount * 15
            + sharedGenreCount * 13;

    return relationshipScore
        + (candidate.isLiked ? 5 : 0)
        + completionShare * 8
        + daysSincePlay / 30
        - Math.min(Math.max(candidate.skipCount, 0), 5) * 2
        - Math.min(Math.max(candidate.playCount, 0), 20) * 0.15;
};

const toCandidate = ({
    candidate,
    nowMs,
    scope,
    seed,
    seedSmartViews
}: {
    candidate: PersonalListeningSessionTrackInput;
    nowMs: number;
    scope: PersonalListeningSessionScope;
    seed: PersonalListeningSessionTrackInput;
    seedSmartViews: PersonalListeningSessionSmartViewInput[];
}): SessionCandidate | null => {
    const reasonCodes = relationshipReasons({ candidate, seed, seedSmartViews });

    if (!qualifiesForScope({ candidate, reasons: reasonCodes, scope, seed })) {
        return null;
    }

    return {
        albumId: candidate.albumId,
        artistId: candidate.artistId,
        musicId: candidate.id,
        reasonCodes,
        score: candidateScore({ candidate, nowMs, reasons: reasonCodes, scope, seed })
    };
};

export const rankPersonalListeningSession = ({
    candidates,
    existingQueueMusicIds,
    limit,
    nowMs,
    scope,
    seed,
    smartViews
}: {
    candidates: PersonalListeningSessionTrackInput[];
    existingQueueMusicIds: number[];
    limit: number;
    nowMs: number;
    scope: PersonalListeningSessionScope;
    seed: PersonalListeningSessionTrackInput;
    smartViews: PersonalListeningSessionSmartViewInput[];
}): RankedPersonalListeningSessionItem[] => {
    const normalizedLimit = Math.max(Math.trunc(limit), 1);
    const excludedMusicIds = new Set(existingQueueMusicIds);
    excludedMusicIds.delete(seed.id);
    const seedSmartViews = smartViews.filter(view => matchesSmartView(seed, view));
    const seenMusicIds = new Set<number>([seed.id]);
    const remaining = candidates.flatMap((candidate) => {
        if (
            seenMusicIds.has(candidate.id)
            || excludedMusicIds.has(candidate.id)
            || isRecentRepeat(candidate.lastPlayedAtMs, nowMs)
        ) {
            return [];
        }

        seenMusicIds.add(candidate.id);
        const ranked = toCandidate({ candidate, nowMs, scope, seed, seedSmartViews });
        return ranked ? [ranked] : [];
    });
    const selected: RankedPersonalListeningSessionItem[] = [{
        musicId: seed.id,
        reasonCodes: ['START_TRACK']
    }];
    const artistCounts = new Map<number, number>([[seed.artistId, 1]]);
    const albumCounts = new Map<number, number>([[seed.albumId, 1]]);
    let lastArtistId = seed.artistId;

    while (selected.length < normalizedLimit) {
        const eligible = remaining.filter(candidate => (
            (artistCounts.get(candidate.artistId) ?? 0) < MAX_TRACKS_PER_ARTIST
            && (albumCounts.get(candidate.albumId) ?? 0) < MAX_TRACKS_PER_ALBUM
        ));

        if (eligible.length === 0) {
            break;
        }

        const artistDiverse = eligible.filter(candidate => candidate.artistId !== lastArtistId);
        const pool = artistDiverse.length > 0 ? artistDiverse : eligible;
        const best = [...pool].sort((left, right) => (
            right.score - left.score || left.musicId - right.musicId
        ))[0];

        selected.push({
            musicId: best.musicId,
            reasonCodes: best.reasonCodes
        });
        artistCounts.set(best.artistId, (artistCounts.get(best.artistId) ?? 0) + 1);
        albumCounts.set(best.albumId, (albumCounts.get(best.albumId) ?? 0) + 1);
        lastArtistId = best.artistId;
        remaining.splice(remaining.indexOf(best), 1);
    }

    return selected;
};
