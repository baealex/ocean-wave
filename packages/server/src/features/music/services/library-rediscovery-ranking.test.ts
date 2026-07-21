import {
    type LibraryRediscoveryAlbumInput,
    type LibraryRediscoveryTrackInput,
    rankLibraryRediscovery
} from './library-rediscovery-ranking';

const NOW_MS = Date.UTC(2026, 6, 21, 0, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1_000;
const daysAgo = (days: number) => NOW_MS - days * DAY_MS;

const createTrack = (
    id: number,
    overrides: Partial<LibraryRediscoveryTrackInput> = {}
): LibraryRediscoveryTrackInput => ({
    albumId: id,
    artistId: id,
    completionCount: 3,
    createdAtMs: daysAgo(100),
    durationMs: 180_000,
    genreIds: [],
    id,
    isAffinitySeed: false,
    isLiked: false,
    lastPlayedAtMs: daysAgo(100),
    playCount: 6,
    skipCount: 1,
    tagIds: [],
    totalPlayedMs: 1_080_000,
    ...overrides
});

const createAlbum = (
    id: number,
    overrides: Partial<LibraryRediscoveryAlbumInput> = {}
): LibraryRediscoveryAlbumInput => ({
    artistId: id,
    createdAtMs: daysAgo(300),
    id,
    lastPlayedAtMs: daysAgo(120),
    likedTrackCount: 1,
    representativeMusicId: id * 10,
    totalCompletionCount: 4,
    totalPlayCount: 8,
    totalSkipCount: 1,
    trackCount: 4,
    ...overrides
});

describe('library rediscovery ranking', () => {
    it('returns deterministic sections and reason codes for the same reference time', () => {
        const tracks = [
            createTrack(1, {
                completionCount: 0,
                createdAtMs: daysAgo(2),
                lastPlayedAtMs: null,
                playCount: 0,
                skipCount: 0,
                totalPlayedMs: 0
            }),
            createTrack(2, {
                isLiked: true,
                lastPlayedAtMs: daysAgo(90)
            }),
            createTrack(3, {
                lastPlayedAtMs: daysAgo(80),
                playCount: 1,
                totalPlayedMs: 90_000
            }),
            createTrack(4)
        ];
        const input = {
            albums: [createAlbum(7)],
            limit: 4,
            nowMs: NOW_MS,
            tracks
        };

        const first = rankLibraryRediscovery(input);
        const second = rankLibraryRediscovery(input);

        expect(second).toEqual(first);
        expect(first.recentlyAdded).toEqual([expect.objectContaining({
            musicId: 1,
            reasonCodes: ['RECENTLY_ADDED', 'NEVER_PLAYED']
        })]);
        expect(first.dormantLiked).toEqual([expect.objectContaining({
            musicId: 2,
            reasonCodes: expect.arrayContaining([
                'LIKED_NOT_RECENTLY_PLAYED',
                'FREQUENTLY_COMPLETED'
            ])
        })]);
        expect(first.underplayed).toEqual([expect.objectContaining({
            musicId: 3,
            reasonCodes: expect.arrayContaining(['RARELY_PLAYED'])
        })]);
        expect(first.forgottenAlbums).toEqual([expect.objectContaining({
            albumId: 7,
            reasonCodes: ['FORGOTTEN_ALBUM']
        })]);
        expect(first.fallback).toEqual([expect.objectContaining({
            musicId: 4,
            reasonCodes: expect.arrayContaining(['LIBRARY_FALLBACK'])
        })]);
    });

    it('includes recently added tracks through the exact 45-day boundary', () => {
        const ranking = rankLibraryRediscovery({
            albums: [],
            limit: 2,
            nowMs: NOW_MS,
            tracks: [
                createTrack(1, { createdAtMs: daysAgo(45) }),
                createTrack(2, { createdAtMs: daysAgo(45) - 1 })
            ]
        });

        expect(ranking.recentlyAdded.map(candidate => candidate.musicId)).toEqual([1]);
    });

    it('includes liked tracks from the exact 30-day dormant boundary', () => {
        const ranking = rankLibraryRediscovery({
            albums: [],
            limit: 2,
            nowMs: NOW_MS,
            tracks: [
                createTrack(1, {
                    isLiked: true,
                    lastPlayedAtMs: daysAgo(30)
                }),
                createTrack(2, {
                    isLiked: true,
                    lastPlayedAtMs: daysAgo(30) + 1
                })
            ]
        });

        expect(ranking.dormantLiked.map(candidate => candidate.musicId)).toEqual([1]);
    });

    it('includes tracks through the exact 2.5-equivalent-listen boundary', () => {
        const ranking = rankLibraryRediscovery({
            albums: [],
            limit: 2,
            nowMs: NOW_MS,
            tracks: [
                createTrack(1, {
                    playCount: 2,
                    totalPlayedMs: 450_000
                }),
                createTrack(2, {
                    playCount: 2,
                    totalPlayedMs: 450_001
                })
            ]
        });

        expect(ranking.underplayed.map(candidate => candidate.musicId)).toEqual([1]);
    });

    it('includes albums at both exact age and dormancy boundaries', () => {
        const ranking = rankLibraryRediscovery({
            albums: [
                createAlbum(1, {
                    createdAtMs: daysAgo(30),
                    lastPlayedAtMs: daysAgo(60)
                }),
                createAlbum(2, {
                    createdAtMs: daysAgo(30) + 1,
                    lastPlayedAtMs: daysAgo(120)
                }),
                createAlbum(3, {
                    createdAtMs: daysAgo(100),
                    lastPlayedAtMs: daysAgo(60) + 1
                })
            ],
            limit: 3,
            nowMs: NOW_MS,
            tracks: []
        });

        expect(ranking.forgottenAlbums.map(candidate => candidate.albumId)).toEqual([1]);
    });

    it('applies the replay penalty only inside the exact seven-day boundary', () => {
        const ranking = rankLibraryRediscovery({
            albums: [],
            limit: 2,
            nowMs: NOW_MS,
            tracks: [
                createTrack(1, {
                    lastPlayedAtMs: daysAgo(7) + 1,
                    playCount: 1,
                    totalPlayedMs: 90_000
                }),
                createTrack(2, {
                    lastPlayedAtMs: daysAgo(7),
                    playCount: 1,
                    totalPlayedMs: 90_000
                })
            ]
        });

        expect(ranking.underplayed.map(candidate => candidate.musicId)).toEqual([2, 1]);
    });

    it('penalizes a recently repeated track against an otherwise equal dormant track', () => {
        const ranking = rankLibraryRediscovery({
            albums: [],
            limit: 2,
            nowMs: NOW_MS,
            tracks: [
                createTrack(1, {
                    lastPlayedAtMs: daysAgo(1),
                    playCount: 1,
                    totalPlayedMs: 90_000
                }),
                createTrack(2, {
                    lastPlayedAtMs: daysAgo(80),
                    playCount: 1,
                    totalPlayedMs: 90_000
                })
            ]
        });

        expect(ranking.underplayed.map(candidate => candidate.musicId)).toEqual([2, 1]);
        expect(ranking.underplayed[0].score).toBeGreaterThan(ranking.underplayed[1].score);
    });

    it('prevents one artist or album from monopolizing a diverse result', () => {
        const ranking = rankLibraryRediscovery({
            albums: [],
            limit: 4,
            nowMs: NOW_MS,
            tracks: [
                createTrack(1, {
                    albumId: 1,
                    artistId: 1,
                    playCount: 0,
                    totalPlayedMs: 0
                }),
                createTrack(2, {
                    albumId: 2,
                    artistId: 1,
                    playCount: 0,
                    totalPlayedMs: 0
                }),
                createTrack(3, {
                    albumId: 3,
                    artistId: 1,
                    playCount: 0,
                    totalPlayedMs: 0
                }),
                createTrack(10, {
                    albumId: 10,
                    artistId: 10,
                    playCount: 1,
                    totalPlayedMs: 30_000
                }),
                createTrack(11, {
                    albumId: 11,
                    artistId: 11,
                    playCount: 1,
                    totalPlayedMs: 30_000
                })
            ]
        });
        const artistIds = new Map([
            [1, 1],
            [2, 1],
            [3, 1],
            [10, 10],
            [11, 11]
        ]);
        const selectedArtistIds = ranking.underplayed.map(candidate => (
            artistIds.get(candidate.musicId)
        ));

        expect(selectedArtistIds.filter(id => id === 1)).toHaveLength(2);
        expect(new Set(selectedArtistIds).size).toBe(3);
    });

    it('prefers another artist even when that artist reuses a selected album', () => {
        const ranking = rankLibraryRediscovery({
            albums: [],
            limit: 3,
            nowMs: NOW_MS,
            tracks: [
                createTrack(1, {
                    albumId: 1,
                    artistId: 1,
                    playCount: 0,
                    totalPlayedMs: 0
                }),
                createTrack(2, {
                    albumId: 2,
                    artistId: 1,
                    playCount: 0,
                    totalPlayedMs: 0
                }),
                createTrack(3, {
                    albumId: 3,
                    artistId: 1,
                    playCount: 0,
                    totalPlayedMs: 0
                }),
                createTrack(10, {
                    albumId: 1,
                    artistId: 10,
                    playCount: 1,
                    totalPlayedMs: 30_000
                })
            ]
        });

        expect(ranking.underplayed.map(candidate => candidate.musicId)).toEqual([1, 2, 10]);
    });

    it('uses repeated positive tag and genre signals as explainable affinity', () => {
        const seedOverrides: Partial<LibraryRediscoveryTrackInput> = {
            completionCount: 5,
            genreIds: [8],
            isAffinitySeed: true,
            isLiked: true,
            playCount: 8,
            skipCount: 0,
            tagIds: [7],
            totalPlayedMs: 1_440_000
        };
        const ranking = rankLibraryRediscovery({
            albums: [],
            limit: 2,
            nowMs: NOW_MS,
            tracks: [
                createTrack(1, {
                    genreIds: [8],
                    playCount: 1,
                    tagIds: [7],
                    totalPlayedMs: 60_000
                }),
                createTrack(2, {
                    genreIds: [18],
                    playCount: 1,
                    tagIds: [17],
                    totalPlayedMs: 60_000
                }),
                createTrack(20, seedOverrides),
                createTrack(21, seedOverrides)
            ]
        });

        expect(ranking.underplayed[0]).toEqual(expect.objectContaining({
            musicId: 1,
            reasonCodes: expect.arrayContaining(['TAG_AFFINITY', 'GENRE_AFFINITY'])
        }));
        expect(ranking.underplayed[0].score).toBeGreaterThan(ranking.underplayed[1].score);
    });

    it('returns a general fallback when no specialized track pool qualifies', () => {
        const ranking = rankLibraryRediscovery({
            albums: [],
            limit: 3,
            nowMs: NOW_MS,
            tracks: [
                createTrack(1, {
                    createdAtMs: daysAgo(200),
                    lastPlayedAtMs: daysAgo(10),
                    playCount: 10,
                    totalPlayedMs: 1_800_000
                }),
                createTrack(2, {
                    createdAtMs: daysAgo(300),
                    lastPlayedAtMs: daysAgo(20),
                    playCount: 12,
                    totalPlayedMs: 2_160_000
                })
            ]
        });

        expect(ranking.recentlyAdded).toEqual([]);
        expect(ranking.dormantLiked).toEqual([]);
        expect(ranking.underplayed).toEqual([]);
        expect(ranking.fallback.map(candidate => candidate.musicId)).toEqual([2, 1]);
        expect(ranking.fallback.every(candidate => (
            candidate.reasonCodes.includes('LIBRARY_FALLBACK')
        ))).toBe(true);
    });

    it('requires an album to be old enough and wholly dormant', () => {
        const ranking = rankLibraryRediscovery({
            albums: [
                createAlbum(1),
                createAlbum(2, { createdAtMs: daysAgo(10) }),
                createAlbum(3, { lastPlayedAtMs: daysAgo(5) })
            ],
            limit: 4,
            nowMs: NOW_MS,
            tracks: []
        });

        expect(ranking.forgottenAlbums.map(candidate => candidate.albumId)).toEqual([1]);
    });

    it('diversifies forgotten albums by artist when alternatives exist', () => {
        const ranking = rankLibraryRediscovery({
            albums: [
                createAlbum(1, { artistId: 1 }),
                createAlbum(2, { artistId: 1 }),
                createAlbum(3, { artistId: 1 }),
                createAlbum(10, { artistId: 10, totalPlayCount: 12 }),
                createAlbum(11, { artistId: 11, totalPlayCount: 12 })
            ],
            limit: 4,
            nowMs: NOW_MS,
            tracks: []
        });
        const artistIds = new Map([
            [1, 1],
            [2, 1],
            [3, 1],
            [10, 10],
            [11, 11]
        ]);
        const selectedArtistIds = ranking.forgottenAlbums.map(candidate => (
            artistIds.get(candidate.albumId)
        ));

        expect(selectedArtistIds.filter(id => id === 1)).toHaveLength(2);
        expect(new Set(selectedArtistIds).size).toBe(3);
    });
});
