import models from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

import {
    DEFAULT_LIBRARY_REDISCOVERY_LIMIT,
    getLibraryRediscovery,
    LIBRARY_REDISCOVERY_LOGICAL_QUERY_COUNT,
    MAX_LIBRARY_REDISCOVERY_LIMIT,
    normalizeLibraryRediscoveryLimit
} from './library-rediscovery';

const NOW = new Date('2026-07-21T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const createAlbum = async (suffix: string, createdAt = daysAgo(10)) => {
    const artist = await models.artist.create({
        data: { name: `Rediscovery Artist ${suffix}` }
    });
    const album = await models.album.create({
        data: {
            artistId: artist.id,
            cover: '',
            createdAt,
            name: `Rediscovery Album ${suffix}`,
            publishedYear: '2026'
        }
    });

    return { album, artist };
};

const createMusic = async ({
    suffix,
    syncStatus = TRACK_SYNC_STATUS.active,
    ...overrides
}: {
    suffix: string;
    syncStatus?: string;
} & Partial<{
    completionCount: number;
    createdAt: Date;
    lastPlayedAt: Date | null;
    playCount: number;
    skipCount: number;
    totalPlayedMs: number;
}>) => {
    const { album, artist } = await createAlbum(suffix);

    return models.music.create({
        data: {
            albumId: album.id,
            artistId: artist.id,
            bitrate: 320_000,
            codec: 'mp3',
            completionCount: overrides.completionCount ?? 0,
            container: 'mp3',
            createdAt: overrides.createdAt ?? daysAgo(10),
            duration: 180,
            filePath: `/music/rediscovery-${suffix}.mp3`,
            lastPlayedAt: overrides.lastPlayedAt,
            name: `Rediscovery Track ${suffix}`,
            playCount: overrides.playCount ?? 0,
            sampleRate: 44_100,
            skipCount: overrides.skipCount ?? 0,
            syncStatus,
            totalPlayedMs: overrides.totalPlayedMs ?? 0,
            trackNumber: 1
        }
    });
};

describe('library rediscovery service', () => {
    beforeEach(async () => {
        await models.playbackQueueItem.deleteMany();
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
        await models.playbackEventBranch.deleteMany();
        await models.playbackEvent.deleteMany();
        await models.playlistMusic.deleteMany();
        await models.musicTag.deleteMany();
        await models.musicLike.deleteMany();
        await models.musicHate.deleteMany();
        await models.music.deleteMany();
        await models.album.deleteMany();
        await models.artist.deleteMany();
    });

    it('loads active candidates and excludes hated or missing tracks', async () => {
        const recent = await createMusic({
            createdAt: daysAgo(2),
            suffix: 'recent'
        });
        const dormantLiked = await createMusic({
            completionCount: 4,
            createdAt: daysAgo(300),
            lastPlayedAt: daysAgo(90),
            playCount: 5,
            suffix: 'dormant-liked',
            totalPlayedMs: 900_000
        });
        await models.musicLike.create({ data: { musicId: dormantLiked.id } });
        const underplayed = await createMusic({
            createdAt: daysAgo(200),
            lastPlayedAt: daysAgo(80),
            playCount: 1,
            suffix: 'underplayed',
            totalPlayedMs: 60_000
        });
        const forgottenAlbum = await createAlbum('forgotten', daysAgo(400));
        const forgotten = await models.music.create({
            data: {
                albumId: forgottenAlbum.album.id,
                artistId: forgottenAlbum.artist.id,
                bitrate: 320_000,
                codec: 'mp3',
                completionCount: 3,
                container: 'mp3',
                createdAt: daysAgo(400),
                duration: 180,
                filePath: '/music/rediscovery-forgotten.mp3',
                lastPlayedAt: daysAgo(120),
                name: 'Rediscovery Track Forgotten',
                playCount: 4,
                sampleRate: 44_100,
                skipCount: 1,
                totalPlayedMs: 720_000,
                trackNumber: 1
            }
        });
        const hated = await createMusic({
            createdAt: daysAgo(1),
            suffix: 'hated'
        });
        await models.musicHate.create({ data: { musicId: hated.id } });
        const missing = await createMusic({
            createdAt: daysAgo(1),
            suffix: 'missing',
            syncStatus: TRACK_SYNC_STATUS.missing
        });

        const result = await getLibraryRediscovery({ limit: 3, now: NOW });
        const trackCandidateIds = [
            ...result.recentlyAdded,
            ...result.dormantLiked,
            ...result.underplayed,
            ...result.fallback
        ].map(candidate => candidate.musicId);

        expect(result.generatedAt).toBe(NOW.toISOString());
        expect(result.eligibleMusicCount).toBe(4);
        expect(result.recentlyAdded.map(candidate => candidate.musicId)).toContain(recent.id);
        expect(result.dormantLiked.map(candidate => candidate.musicId)).toContain(dormantLiked.id);
        expect(result.underplayed.map(candidate => candidate.musicId)).toContain(underplayed.id);
        expect(result.forgottenAlbums).toContainEqual(expect.objectContaining({
            albumId: forgottenAlbum.album.id,
            lastPlayedAt: daysAgo(120).toISOString(),
            representativeMusicId: forgotten.id
        }));
        expect(trackCandidateIds).not.toContain(hated.id);
        expect(trackCandidateIds).not.toContain(missing.id);
        expect(result.forgottenAlbums.map(candidate => candidate.albumId))
            .not.toContain(hated.albumId);
        expect(result.forgottenAlbums.map(candidate => candidate.albumId))
            .not.toContain(missing.albumId);
    });

    it('keeps source loading bounded as the library grows', async () => {
        const { album, artist } = await createAlbum('bounded');
        await models.music.createMany({
            data: Array.from({ length: 70 }, (_, index) => ({
                albumId: album.id,
                artistId: artist.id,
                bitrate: 320_000,
                codec: 'mp3',
                container: 'mp3',
                createdAt: new Date(NOW.getTime() - index * 1_000),
                duration: 180,
                filePath: `/music/rediscovery-bounded-${index}.mp3`,
                name: `Rediscovery Bounded ${index}`,
                sampleRate: 44_100,
                trackNumber: index + 1
            }))
        });

        const result = await getLibraryRediscovery({ limit: 1, now: NOW });

        expect(result.eligibleMusicCount).toBe(70);
        expect(result.metrics).toEqual({
            candidatePoolSize: 48,
            logicalQueryCount: LIBRARY_REDISCOVERY_LOGICAL_QUERY_COUNT,
            sourcePoolLimit: 48
        });
        expect(result.recentlyAdded).toHaveLength(1);
        expect(result.dormantLiked).toHaveLength(0);
        expect(result.underplayed).toHaveLength(1);
        expect(result.fallback).toHaveLength(1);
    });

    it('applies the underplayed predicate before bounding its source pool', async () => {
        const { album, artist } = await createAlbum('underplayed-source');
        await models.music.createMany({
            data: Array.from({ length: 48 }, (_, index) => ({
                albumId: album.id,
                artistId: artist.id,
                bitrate: 320_000,
                codec: 'mp3',
                container: 'mp3',
                createdAt: daysAgo(200),
                duration: 1,
                filePath: `/music/rediscovery-invalid-underplayed-${index}.mp3`,
                name: `Rediscovery Invalid Underplayed ${index}`,
                sampleRate: 44_100,
                totalPlayedMs: 3_000,
                trackNumber: index + 1
            }))
        });
        const boundaryTrack = await models.music.create({
            data: {
                albumId: album.id,
                artistId: artist.id,
                bitrate: 320_000,
                codec: 'mp3',
                container: 'mp3',
                createdAt: daysAgo(200),
                duration: 1_000,
                filePath: '/music/rediscovery-valid-underplayed.mp3',
                name: 'Rediscovery Valid Underplayed',
                sampleRate: 44_100,
                totalPlayedMs: 2_500_000,
                trackNumber: 49
            }
        });

        const result = await getLibraryRediscovery({ limit: 1, now: NOW });

        expect(result.underplayed.map(candidate => candidate.musicId))
            .toEqual([boundaryTrack.id]);
    });

    it('applies forgotten album thresholds before bounding aggregates', async () => {
        const artist = await models.artist.create({
            data: { name: 'Rediscovery Album Source Artist' }
        });
        await models.album.createMany({
            data: Array.from({ length: 48 }, (_, index) => ({
                artistId: artist.id,
                cover: '',
                createdAt: daysAgo(1),
                name: `Rediscovery Young Album ${index}`,
                publishedYear: '2026'
            }))
        });
        const oldAlbum = await models.album.create({
            data: {
                artistId: artist.id,
                cover: '',
                createdAt: daysAgo(100),
                name: 'Rediscovery Old Album',
                publishedYear: '2025'
            }
        });
        const albums = await models.album.findMany({
            where: { artistId: artist.id },
            orderBy: { id: 'asc' }
        });
        await models.music.createMany({
            data: albums.map((album, index) => ({
                albumId: album.id,
                artistId: artist.id,
                bitrate: 320_000,
                codec: 'mp3',
                container: 'mp3',
                createdAt: daysAgo(200),
                duration: 180,
                filePath: `/music/rediscovery-album-source-${index}.mp3`,
                name: `Rediscovery Album Source ${index}`,
                playCount: 6,
                sampleRate: 44_100,
                totalPlayedMs: 1_080_000,
                trackNumber: 1
            }))
        });

        const result = await getLibraryRediscovery({ limit: 1, now: NOW });

        expect(result.forgottenAlbums.map(candidate => candidate.albumId))
            .toEqual([oldAlbum.id]);
    });

    it('loads a bounded general source for libraries without specialized signals', async () => {
        const track = await createMusic({
            createdAt: daysAgo(200),
            lastPlayedAt: daysAgo(10),
            playCount: 10,
            suffix: 'general-fallback',
            totalPlayedMs: 1_800_000
        });

        const result = await getLibraryRediscovery({ limit: 1, now: NOW });

        expect(result.recentlyAdded).toEqual([]);
        expect(result.dormantLiked).toEqual([]);
        expect(result.underplayed).toEqual([]);
        expect(result.fallback.map(candidate => candidate.musicId)).toEqual([track.id]);
    });

    it('normalizes requested limits before deriving source bounds', () => {
        expect(normalizeLibraryRediscoveryLimit(undefined))
            .toBe(DEFAULT_LIBRARY_REDISCOVERY_LIMIT);
        expect(normalizeLibraryRediscoveryLimit(Number.NaN))
            .toBe(DEFAULT_LIBRARY_REDISCOVERY_LIMIT);
        expect(normalizeLibraryRediscoveryLimit(-5)).toBe(1);
        expect(normalizeLibraryRediscoveryLimit(3.9)).toBe(3);
        expect(normalizeLibraryRediscoveryLimit(100))
            .toBe(MAX_LIBRARY_REDISCOVERY_LIMIT);
    });
});
