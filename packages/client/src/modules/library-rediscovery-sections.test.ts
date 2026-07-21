import { describe, expect, it } from 'vitest';

import type {
    LibraryRediscovery,
    LibraryRediscoveryAlbumCandidate,
    LibraryRediscoveryReasonCode,
    LibraryRediscoveryTrackCandidate
} from '~/api/rediscovery';
import type { Music } from '~/models/type';

import {
    LIBRARY_REDISCOVERY_REASON_COPY,
    resolveLibraryRediscoverySections
} from './library-rediscovery-sections';

const createMusic = ({
    albumId,
    hated = false,
    id,
    lastPlayedAt = null
}: {
    albumId: string;
    hated?: boolean;
    id: string;
    lastPlayedAt?: string | null;
}): Music => ({
    album: {
        artist: { id: `artist-${albumId}`, name: `Artist ${albumId}` },
        artistDisplayName: `Artist ${albumId}`,
        artistCredits: [{
            artist: { id: `artist-${albumId}`, name: `Artist ${albumId}` },
            role: 'PRIMARY',
            position: 0,
            creditedName: null,
            joinPhrase: ''
        }],
        cover: `/covers/${albumId}.jpg`,
        createdAt: 1,
        id: albumId,
        isCoverCustom: false,
        musics: [{ id }],
        name: `Album ${albumId}`,
        publishedYear: '2026',
        releaseType: 'ALBUM',
        totalDiscs: 1
    },
    artist: {
        albumCount: 1,
        albums: [],
        appearsOn: [],
        appearsOnCount: 0,
        createdAt: 1,
        id: `artist-${albumId}`,
        musicCount: 1,
        musics: [{ id }],
        name: `Artist ${albumId}`
    },
    artistDisplayName: `Artist ${albumId}`,
    artistCredits: [{
        artist: { id: `artist-${albumId}`, name: `Artist ${albumId}` },
        role: 'PRIMARY',
        position: 0,
        creditedName: null,
        joinPhrase: ''
    }],
    recordingArtistCredits: [{
        artist: { id: `artist-${albumId}`, name: `Artist ${albumId}` },
        role: 'PRIMARY',
        position: 0,
        creditedName: null,
        joinPhrase: ''
    }],
    hasReleaseTrackArtistCredits: false,
    bitrate: 320_000,
    codec: 'FLAC',
    completionCount: 0,
    createdAt: 1,
    duration: 180,
    discNumber: 1,
    filePath: `/${id}.flac`,
    genres: [],
    hasMetadataOverride: false,
    id,
    isHated: hated,
    isLiked: true,
    lastCompletedAt: null,
    lastPlayedAt,
    lastSkippedAt: null,
    name: `Track ${id}`,
    recordingTitle: `Track ${id}`,
    titleOverride: null,
    playCount: 0,
    recordingVersionTitle: null,
    releaseVersionTitle: null,
    sampleRate: 44_100,
    skipCount: 0,
    tags: [],
    totalPlayedMs: 0,
    trackNumber: 1
});

const trackCandidate = (
    musicId: string,
    reasonCode: LibraryRediscoveryReasonCode
): LibraryRediscoveryTrackCandidate => ({
    musicId,
    reasonCodes: [reasonCode],
    score: 80
});

const albumCandidate = (musicId: string): LibraryRediscoveryAlbumCandidate => ({
    albumId: `album-${musicId}`,
    lastPlayedAt: '2025-01-01T00:00:00.000Z',
    reasonCodes: ['FORGOTTEN_ALBUM'],
    representativeMusicId: musicId,
    score: 75,
    trackCount: 8
});

const createRediscovery = (
    generatedAt: string,
    overrides: Partial<LibraryRediscovery> = {}
): LibraryRediscovery => ({
    dormantLiked: [],
    eligibleMusicCount: 30,
    fallback: [],
    forgottenAlbums: [],
    generatedAt,
    recentlyAdded: [],
    underplayed: [],
    ...overrides
});

const createMusicMap = (ids: string[]) => new Map(ids.map(id => [
    id,
    createMusic({ albumId: `album-${id}`, id })
]));

describe('library rediscovery presentation', () => {
    it('keeps every stable reason code connected to concise user-facing copy', () => {
        expect(LIBRARY_REDISCOVERY_REASON_COPY).toEqual({
            FORGOTTEN_ALBUM: 'Not played in a while',
            FREQUENTLY_COMPLETED: 'A track you often finish',
            GENRE_AFFINITY: 'Fits genres you return to',
            LIBRARY_FALLBACK: 'A quieter corner of your library',
            LIKED_NOT_RECENTLY_PLAYED: 'Liked, but not played in a while',
            NEVER_PLAYED: 'Still waiting for a first listen',
            RARELY_PLAYED: 'Only played a few times',
            RECENTLY_ADDED: 'Added to your library recently',
            TAG_AFFINITY: 'Matches tags you return to'
        });
    });

    it('keeps dormant favorites first, limits cards, and rotates the secondary section daily', () => {
        const dormantIds = Array.from({ length: 6 }, (_, index) => `dormant-${index + 1}`);
        const albumIds = Array.from({ length: 6 }, (_, index) => `forgotten-${index + 1}`);
        const recentIds = Array.from({ length: 6 }, (_, index) => `recent-${index + 1}`);
        const musicMap = createMusicMap([...dormantIds, ...albumIds, ...recentIds]);
        const candidates = {
            dormantLiked: dormantIds.map(id => trackCandidate(id, 'LIKED_NOT_RECENTLY_PLAYED')),
            forgottenAlbums: albumIds.map(albumCandidate),
            recentlyAdded: recentIds.map(id => trackCandidate(id, 'RECENTLY_ADDED')),
            underplayed: recentIds.map(id => trackCandidate(id, 'RARELY_PLAYED'))
        };
        const firstDay = resolveLibraryRediscoverySections(
            createRediscovery('2026-07-20T12:00:00.000Z', candidates),
            musicMap
        );
        const secondDay = resolveLibraryRediscoverySections(
            createRediscovery('2026-07-21T12:00:00.000Z', candidates),
            musicMap
        );

        expect(firstDay).toHaveLength(2);
        expect(secondDay).toHaveLength(2);
        expect(firstDay[0]?.id).toBe('dormant-liked');
        expect(secondDay[0]?.id).toBe('dormant-liked');
        expect(firstDay[0]?.items).toHaveLength(5);
        expect(secondDay[0]?.items).toHaveLength(5);
        expect(new Set([firstDay[1]?.id, secondDay[1]?.id])).toEqual(new Set([
            'forgotten-albums',
            'recently-added'
        ]));
    });

    it('removes recent, hated, missing, and duplicate-album cards instead of forcing a sparse section', () => {
        const generatedAt = '2026-07-21T12:00:00.000Z';
        const musicMap = new Map<string, Music>([
            ['duplicate-1', createMusic({ albumId: 'shared', id: 'duplicate-1' })],
            ['duplicate-2', createMusic({ albumId: 'shared', id: 'duplicate-2' })],
            ['recent', createMusic({
                albumId: 'recent-album',
                id: 'recent',
                lastPlayedAt: '2026-07-20T12:00:00.000Z'
            })],
            ['hated', createMusic({ albumId: 'hated-album', hated: true, id: 'hated' })]
        ]);
        const rediscovery = createRediscovery(generatedAt, {
            dormantLiked: [
                trackCandidate('duplicate-1', 'LIKED_NOT_RECENTLY_PLAYED'),
                trackCandidate('duplicate-2', 'LIKED_NOT_RECENTLY_PLAYED'),
                trackCandidate('recent', 'LIKED_NOT_RECENTLY_PLAYED'),
                trackCandidate('hated', 'LIKED_NOT_RECENTLY_PLAYED'),
                trackCandidate('missing', 'LIKED_NOT_RECENTLY_PLAYED')
            ],
            fallback: [
                trackCandidate('duplicate-1', 'LIBRARY_FALLBACK'),
                trackCandidate('duplicate-2', 'LIBRARY_FALLBACK')
            ]
        });

        expect(resolveLibraryRediscoverySections(rediscovery, musicMap)).toEqual([]);
    });
});
