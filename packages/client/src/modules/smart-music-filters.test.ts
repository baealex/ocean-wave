import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SMART_MUSIC_FILTER_ID,
    buildSmartMusicBuckets,
    filterMusicsBySmartFilter,
    getSmartMusicFilterOption,
    isDormantMusic,
    isLosslessMusic,
    resolveSmartMusicFilterId,
    sortMusicsByHeavyRotation,
    sortMusicsByLeastHeard,
    sortMusicsByRecentPlay
} from './smart-music-filters';

const now = new Date('2026-06-03T00:00:00.000Z').getTime();

type TestMusic = Parameters<typeof buildSmartMusicBuckets>[0][number] & {
    id: string;
};

const createMusic = ({ id, ...overrides }: Partial<TestMusic> & { id: string }): TestMusic => ({
    codec: 'mp3',
    id,
    isHated: false,
    isLiked: false,
    lastPlayedAt: null,
    playCount: 0,
    totalPlayedMs: 0,
    ...overrides
});

describe('smart music filters', () => {
    it('resolves unknown filter ids to the default filter', () => {
        expect(resolveSmartMusicFilterId('lossless')).toBe('lossless');
        expect(resolveSmartMusicFilterId('unknown')).toBe(DEFAULT_SMART_MUSIC_FILTER_ID);
        expect(resolveSmartMusicFilterId(null)).toBe(DEFAULT_SMART_MUSIC_FILTER_ID);
        expect(getSmartMusicFilterOption('dormant-liked').shortLabel).toBe('Revisit');
    });

    it('groups library tracks into reusable smart buckets', () => {
        const recentFavorite = createMusic({
            id: 'recent-favorite',
            isLiked: true,
            lastPlayedAt: '2026-05-20T00:00:00.000Z',
            playCount: 4
        });
        const dormantFavorite = createMusic({
            id: 'dormant-favorite',
            isLiked: true,
            lastPlayedAt: '2026-04-01T00:00:00.000Z',
            playCount: 2
        });
        const lossless = createMusic({
            codec: 'flac',
            id: 'lossless',
            playCount: 1
        });
        const hated = createMusic({
            id: 'hated',
            isHated: true,
            isLiked: true,
            playCount: 0
        });

        const buckets = buildSmartMusicBuckets([
            recentFavorite,
            dormantFavorite,
            lossless,
            hated
        ], now);

        expect(buckets.availableMusics.map(music => music.id)).toEqual([
            'recent-favorite',
            'dormant-favorite',
            'lossless'
        ]);
        expect(buckets.likedMusics.map(music => music.id)).toEqual([
            'recent-favorite',
            'dormant-favorite'
        ]);
        expect(buckets.playedMusics.map(music => music.id)).toEqual([
            'recent-favorite',
            'dormant-favorite',
            'lossless'
        ]);
        expect(buckets.unplayedMusics).toEqual([]);
        expect(buckets.losslessMusics.map(music => music.id)).toEqual(['lossless']);
        expect(buckets.dormantFavorites.map(music => music.id)).toEqual(['dormant-favorite']);
    });

    it('matches smart filter modes without mutating the input order', () => {
        const musics = [
            createMusic({ id: 'unplayed' }),
            createMusic({
                id: 'dormant-liked',
                isLiked: true,
                lastPlayedAt: '2026-04-01T00:00:00.000Z',
                playCount: 1
            }),
            createMusic({
                codec: 'ALAC',
                id: 'lossless',
                playCount: 3
            }),
            createMusic({
                id: 'runner-up',
                playCount: 2
            })
        ];

        expect(filterMusicsBySmartFilter(musics, 'all', now).map(music => music.id)).toEqual([
            'unplayed',
            'dormant-liked',
            'lossless',
            'runner-up'
        ]);
        expect(filterMusicsBySmartFilter(musics, 'unplayed', now).map(music => music.id)).toEqual(['unplayed']);
        expect(filterMusicsBySmartFilter(musics, 'dormant-liked', now).map(music => music.id)).toEqual(['dormant-liked']);
        expect(filterMusicsBySmartFilter(musics, 'lossless', now).map(music => music.id)).toEqual(['lossless']);
        expect(filterMusicsBySmartFilter(musics, 'heavy-rotation', now).map(music => music.id)).toEqual(['lossless']);
    });

    it('treats heavy rotation as the top quarter of counted plays', () => {
        const musics = [
            createMusic({ id: 'top', playCount: 20 }),
            createMusic({ id: 'cutoff-a', playCount: 12 }),
            createMusic({ id: 'cutoff-b', playCount: 12 }),
            createMusic({ id: 'third', playCount: 10 }),
            createMusic({ id: 'fourth', playCount: 8 }),
            createMusic({ id: 'fifth', playCount: 6 }),
            createMusic({ id: 'sixth', playCount: 4 }),
            createMusic({ id: 'seventh', playCount: 2 }),
            createMusic({ id: 'unplayed', playCount: 0 })
        ];

        expect(filterMusicsBySmartFilter(musics, 'heavy-rotation', now).map(music => music.id)).toEqual([
            'top',
            'cutoff-a',
            'cutoff-b'
        ]);
        expect(filterMusicsBySmartFilter([createMusic({ id: 'unplayed' })], 'heavy-rotation', now)).toEqual([]);
    });

    it('detects dormant and lossless tracks defensively', () => {
        expect(isDormantMusic({ lastPlayedAt: null }, now)).toBe(true);
        expect(isDormantMusic({ lastPlayedAt: 'not-a-date' }, now)).toBe(true);
        expect(isDormantMusic({ lastPlayedAt: '2026-05-20T00:00:00.000Z' }, now)).toBe(false);
        expect(isLosslessMusic({ codec: 'wav' })).toBe(true);
        expect(isLosslessMusic({ codec: 'mp3' })).toBe(false);
    });

    it('sorts derived track lists on copies', () => {
        const musics = [
            createMusic({
                id: 'middle',
                lastPlayedAt: '2026-05-01T00:00:00.000Z',
                playCount: 2,
                totalPlayedMs: 20_000
            }),
            createMusic({
                id: 'top',
                lastPlayedAt: '2026-06-01T00:00:00.000Z',
                playCount: 7,
                totalPlayedMs: 70_000
            }),
            createMusic({
                id: 'unplayed',
                playCount: 0,
                totalPlayedMs: 0
            })
        ];

        expect(sortMusicsByRecentPlay(musics).map(music => music.id)).toEqual([
            'top',
            'middle',
            'unplayed'
        ]);
        expect(sortMusicsByHeavyRotation(musics).map(music => music.id)).toEqual([
            'top',
            'middle',
            'unplayed'
        ]);
        expect(sortMusicsByLeastHeard(musics).map(music => music.id)).toEqual([
            'unplayed',
            'middle',
            'top'
        ]);
        expect(musics.map(music => music.id)).toEqual([
            'middle',
            'top',
            'unplayed'
        ]);
    });
});
