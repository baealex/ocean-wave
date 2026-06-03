import type { Music } from '~/models/type';

export const DORMANT_FAVORITE_DAYS = 30;

export const DEFAULT_SMART_MUSIC_FILTER_ID = 'all';

const HEAVY_ROTATION_RATIO = 0.25;

export type SmartMusicFilterId =
    | 'all'
    | 'unplayed'
    | 'dormant-liked'
    | 'lossless'
    | 'heavy-rotation';

type SmartMusic = Pick<
    Music,
    'codec' | 'isHated' | 'isLiked' | 'lastPlayedAt' | 'playCount' | 'totalPlayedMs'
>;

interface SmartMusicFilterOption {
    id: SmartMusicFilterId;
    label: string;
    shortLabel: string;
    description: string;
}

export const SMART_MUSIC_FILTER_OPTIONS: SmartMusicFilterOption[] = [{
    id: 'all',
    label: 'All tracks',
    shortLabel: 'All',
    description: 'Show every visible track in the library.'
}, {
    id: 'unplayed',
    label: 'Unplayed tracks',
    shortLabel: 'Unplayed',
    description: 'Songs that have not been counted as played yet.'
}, {
    id: 'dormant-liked',
    label: 'Favorites to revisit',
    shortLabel: 'Revisit',
    description: `Liked songs quiet for ${DORMANT_FAVORITE_DAYS}+ days.`
}, {
    id: 'lossless',
    label: 'Lossless tracks',
    shortLabel: 'Lossless',
    description: 'FLAC, ALAC, WAV, and AIFF files.'
}, {
    id: 'heavy-rotation',
    label: 'Heavy rotation',
    shortLabel: 'Heavy',
    description: 'Top quarter of tracks by counted plays.'
}];

const SMART_MUSIC_FILTER_IDS = new Set<SmartMusicFilterId>(
    SMART_MUSIC_FILTER_OPTIONS.map(option => option.id)
);

export const resolveSmartMusicFilterId = (value: string | null | undefined): SmartMusicFilterId => {
    if (value && SMART_MUSIC_FILTER_IDS.has(value as SmartMusicFilterId)) {
        return value as SmartMusicFilterId;
    }

    return DEFAULT_SMART_MUSIC_FILTER_ID;
};

export const getSmartMusicFilterOption = (id: SmartMusicFilterId) => {
    return SMART_MUSIC_FILTER_OPTIONS.find(option => option.id === id) ?? SMART_MUSIC_FILTER_OPTIONS[0];
};

export const isLosslessMusic = <T extends Pick<Music, 'codec'>>(music: T) => {
    const codec = music.codec.toLowerCase();

    return codec.includes('flac') ||
        codec.includes('alac') ||
        codec.includes('wav') ||
        codec.includes('aiff');
};

export const isDormantMusic = <T extends Pick<Music, 'lastPlayedAt'>>(
    music: T,
    now = Date.now(),
    days = DORMANT_FAVORITE_DAYS
) => {
    if (!music.lastPlayedAt) return true;

    const lastPlayedAt = new Date(music.lastPlayedAt).getTime();

    if (Number.isNaN(lastPlayedAt)) return true;

    return now - lastPlayedAt > days * 24 * 60 * 60 * 1000;
};

export const buildSmartMusicBuckets = <T extends SmartMusic>(musics: T[], now = Date.now()) => {
    const availableMusics = musics.filter(music => !music.isHated);
    const likedMusics = availableMusics.filter(music => music.isLiked);
    const playedMusics = availableMusics.filter(music => music.playCount > 0);
    const unplayedMusics = availableMusics.filter(music => music.playCount === 0);
    const losslessMusics = availableMusics.filter(isLosslessMusic);
    const dormantFavorites = likedMusics.filter(music => isDormantMusic(music, now));

    return {
        availableMusics,
        likedMusics,
        playedMusics,
        unplayedMusics,
        losslessMusics,
        dormantFavorites
    };
};

const getHeavyRotationThreshold = <T extends Pick<Music, 'playCount'>>(musics: T[]) => {
    const playedCounts = musics
        .map(music => music.playCount)
        .filter(playCount => playCount > 0)
        .sort((a, b) => b - a);

    if (playedCounts.length === 0) {
        return Number.POSITIVE_INFINITY;
    }

    const thresholdIndex = Math.max(Math.ceil(playedCounts.length * HEAVY_ROTATION_RATIO), 1) - 1;

    return playedCounts[thresholdIndex];
};

export const filterMusicsBySmartFilter = <T extends SmartMusic>(
    musics: T[],
    filterId: SmartMusicFilterId,
    now = Date.now()
) => {
    switch (filterId) {
        case 'unplayed':
            return musics.filter(music => music.playCount === 0);
        case 'dormant-liked':
            return musics.filter(music => music.isLiked && isDormantMusic(music, now));
        case 'lossless':
            return musics.filter(isLosslessMusic);
        case 'heavy-rotation': {
            const threshold = getHeavyRotationThreshold(musics);

            return musics.filter(music => music.playCount >= threshold);
        }
        case 'all':
        default:
            return musics;
    }
};

export const sortMusicsByRecentPlay = <T extends Pick<Music, 'lastPlayedAt'>>(musics: T[]) => {
    return [...musics].sort((a, b) =>
        new Date(b.lastPlayedAt ?? 0).getTime() - new Date(a.lastPlayedAt ?? 0).getTime()
    );
};

export const sortMusicsByHeavyRotation = <T extends Pick<Music, 'playCount'>>(musics: T[]) => {
    return [...musics].sort((a, b) => b.playCount - a.playCount);
};

export const sortMusicsByLeastHeard = <T extends Pick<Music, 'playCount' | 'totalPlayedMs'>>(musics: T[]) => {
    return [...musics].sort((a, b) => {
        if (a.playCount === 0 && b.playCount !== 0) return -1;
        if (a.playCount !== 0 && b.playCount === 0) return 1;

        return a.totalPlayedMs - b.totalPlayedMs;
    });
};
