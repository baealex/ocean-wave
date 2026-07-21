import {
    type PersonalListeningSessionTrackInput,
    rankPersonalListeningSession
} from './personal-listening-session-ranking';

const NOW = Date.parse('2026-07-21T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;

const track = (
    id: number,
    overrides: Partial<PersonalListeningSessionTrackInput> = {}
): PersonalListeningSessionTrackInput => ({
    albumId: id,
    artistId: id,
    completionCount: 0,
    genreIds: [],
    id,
    isLiked: false,
    lastPlayedAtMs: null,
    playCount: 0,
    skipCount: 0,
    tagIds: [],
    ...overrides
});

describe('personal listening session ranking', () => {
    it('keeps the start track first and explains every related follow-up', () => {
        const seed = track(1, {
            albumId: 10,
            artistId: 20,
            genreIds: [30],
            tagIds: [40, 41]
        });
        const sameAlbum = track(2, {
            albumId: 10,
            artistId: 20
        });
        const sharedMetadata = track(3, {
            albumId: 11,
            artistId: 21,
            genreIds: [30],
            tagIds: [41]
        });
        const sharedView = track(4, {
            albumId: 12,
            artistId: 22,
            tagIds: [42]
        });

        const result = rankPersonalListeningSession({
            candidates: [sameAlbum, sharedMetadata, sharedView],
            existingQueueMusicIds: [],
            limit: 4,
            nowMs: NOW,
            scope: 'explore',
            seed,
            smartViews: [{ id: 1, tagIds: [40, 42], tagMode: 'any' }]
        });

        expect(result[0]).toEqual({
            musicId: seed.id,
            reasonCodes: ['START_TRACK']
        });
        expect(result).toEqual(expect.arrayContaining([
            {
                musicId: sameAlbum.id,
                reasonCodes: expect.arrayContaining(['SAME_ALBUM', 'SAME_ARTIST'])
            },
            {
                musicId: sharedMetadata.id,
                reasonCodes: expect.arrayContaining(['SHARED_TAG', 'SHARED_GENRE'])
            },
            {
                musicId: sharedView.id,
                reasonCodes: expect.arrayContaining(['SHARED_SMART_VIEW'])
            }
        ]));
        expect(result.slice(1).every(item => item.reasonCodes.length > 0)).toBe(true);
    });

    it('is deterministic and avoids consecutive artist repetition when alternatives exist', () => {
        const seed = track(1, {
            albumId: 10,
            artistId: 20,
            genreIds: [30]
        });
        const candidates = [
            track(2, { albumId: 10, artistId: 20 }),
            track(3, { albumId: 11, artistId: 20, genreIds: [30] }),
            track(4, { albumId: 12, artistId: 21, genreIds: [30] }),
            track(5, { albumId: 13, artistId: 21, genreIds: [30] }),
            track(6, { albumId: 14, artistId: 22, genreIds: [30] })
        ];
        const input = {
            candidates,
            existingQueueMusicIds: [],
            limit: 6,
            nowMs: NOW,
            scope: 'explore' as const,
            seed,
            smartViews: []
        };

        const first = rankPersonalListeningSession(input);
        const second = rankPersonalListeningSession(input);
        const artistByMusicId = new Map([
            [seed.id, seed.artistId],
            ...candidates.map(candidate => [candidate.id, candidate.artistId] as const)
        ]);
        const selectedArtists = first.map(item => artistByMusicId.get(item.musicId));

        expect(first).toEqual(second);
        expect(selectedArtists.every((artistId, index) => (
            index === 0 || artistId !== selectedArtists[index - 1]
        ))).toBe(true);
        expect(Math.max(...[...new Set(selectedArtists)].map(artistId => (
            selectedArtists.filter(value => value === artistId).length
        )))).toBeLessThanOrEqual(2);
    });

    it('skips recent repeats and existing queue tracks instead of padding a short session', () => {
        const seed = track(1, { genreIds: [30] });
        const recent = track(2, {
            genreIds: [30],
            lastPlayedAtMs: NOW - 2 * DAY_MS
        });
        const alreadyQueued = track(3, { genreIds: [30] });
        const eligible = track(4, { genreIds: [30] });

        const result = rankPersonalListeningSession({
            candidates: [recent, alreadyQueued, eligible, eligible],
            existingQueueMusicIds: [seed.id, alreadyQueued.id],
            limit: 8,
            nowMs: NOW,
            scope: 'explore',
            seed,
            smartViews: []
        });

        expect(result.map(item => item.musicId)).toEqual([seed.id, eligible.id]);
    });

    it('uses focused scope for stronger links and explore scope for broad genre links', () => {
        const seed = track(1, {
            genreIds: [30],
            tagIds: [40, 41]
        });
        const genreOnly = track(2, { genreIds: [30] });
        const twoTags = track(3, { tagIds: [40, 41] });
        const base = {
            candidates: [genreOnly, twoTags],
            existingQueueMusicIds: [],
            limit: 8,
            nowMs: NOW,
            seed,
            smartViews: []
        };

        expect(rankPersonalListeningSession({
            ...base,
            scope: 'focused'
        }).map(item => item.musicId)).toEqual([seed.id, twoTags.id]);
        expect(rankPersonalListeningSession({
            ...base,
            scope: 'explore'
        }).map(item => item.musicId)).toEqual([
            seed.id,
            twoTags.id,
            genreOnly.id
        ]);
    });
});
