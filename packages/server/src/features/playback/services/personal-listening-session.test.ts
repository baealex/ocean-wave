import models from '~/models';

import { savePlaybackQueue } from './playback-queue';
import { createPersonalListeningSession } from './personal-listening-session';

const NOW = new Date('2026-07-21T00:00:00.000Z');

const createTrack = async ({
    albumId,
    artistId,
    name,
    trackNumber
}: {
    albumId: number;
    artistId: number;
    name: string;
    trackNumber: number;
}) => models.music.create({
    data: {
        albumId,
        artistId,
        bitrate: 320_000,
        codec: 'mp3',
        container: 'mp3',
        duration: 180,
        filePath: `/music/session-${name}.mp3`,
        name,
        sampleRate: 44_100,
        trackNumber
    }
});

const createCollection = async (suffix: string) => {
    const artist = await models.artist.create({
        data: { name: `Session Artist ${suffix}` }
    });
    const album = await models.album.create({
        data: {
            artistId: artist.id,
            cover: '',
            name: `Session Album ${suffix}`,
            publishedYear: '2026'
        }
    });

    return { album, artist };
};

describe('personal listening session service', () => {
    beforeEach(async () => {
        await models.playbackQueueItem.deleteMany();
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
        await models.playbackEventBranch.deleteMany();
        await models.playbackEvent.deleteMany();
        await models.playlistMusic.deleteMany();
        await models.musicTag.deleteMany();
        await models.smartViewTag.deleteMany();
        await models.smartView.deleteMany();
        await models.musicLike.deleteMany();
        await models.musicHate.deleteMany();
        await models.music.deleteMany();
        await models.album.deleteMany();
        await models.artist.deleteMany();
        await models.tag.deleteMany();
        await models.genre.deleteMany();
    });

    it('builds an explainable related queue and advances its revision once', async () => {
        const firstCollection = await createCollection('first');
        const secondCollection = await createCollection('second');
        const seed = await createTrack({
            albumId: firstCollection.album.id,
            artistId: firstCollection.artist.id,
            name: 'Seed',
            trackNumber: 1
        });
        const sameAlbum = await createTrack({
            albumId: firstCollection.album.id,
            artistId: firstCollection.artist.id,
            name: 'Same Album',
            trackNumber: 2
        });
        const sharedTag = await createTrack({
            albumId: secondCollection.album.id,
            artistId: secondCollection.artist.id,
            name: 'Shared Tag',
            trackNumber: 1
        });
        const tag = await models.tag.create({
            data: {
                name: 'Night',
                normalizedName: 'night'
            }
        });
        await models.musicTag.createMany({
            data: [seed.id, sharedTag.id].map(musicId => ({
                musicId,
                tagId: tag.id
            }))
        });

        const result = await createPersonalListeningSession({
            expectedRevision: 0,
            expectedPlaybackSessionRevision: 0,
            length: 'short',
            requestingEndpointId: 'local-tab',
            scope: 'explore',
            startMusicId: seed.id.toString()
        }, { now: NOW });

        expect(result).toMatchObject({
            type: 'accepted',
            changed: true,
            queue: {
                currentIndex: 0,
                musicIds: expect.arrayContaining([
                    seed.id.toString(),
                    sameAlbum.id.toString(),
                    sharedTag.id.toString()
                ]),
                revision: 1
            }
        });
        expect(result.items[0]).toEqual({
            musicId: seed.id.toString(),
            reasonCodes: ['START_TRACK']
        });
        expect(result.items.find(item => item.musicId === sameAlbum.id.toString()))
            .toEqual(expect.objectContaining({
                reasonCodes: expect.arrayContaining(['SAME_ALBUM', 'SAME_ARTIST'])
            }));
        expect(result.items.find(item => item.musicId === sharedTag.id.toString()))
            .toEqual(expect.objectContaining({
                reasonCodes: expect.arrayContaining(['SHARED_TAG'])
            }));
    });

    it('returns the newest queue on conflict without changing current playback', async () => {
        const collection = await createCollection('conflict');
        const seed = await createTrack({
            albumId: collection.album.id,
            artistId: collection.artist.id,
            name: 'Conflict Seed',
            trackNumber: 1
        });
        const queued = await createTrack({
            albumId: collection.album.id,
            artistId: collection.artist.id,
            name: 'Already Queued',
            trackNumber: 2
        });
        const saved = await savePlaybackQueue({
            musicIds: [queued.id.toString()],
            sourceMusicIds: [],
            currentIndex: 0,
            shuffle: false,
            repeatMode: 'none',
            expectedRevision: 0
        });
        await models.playbackSession.update({
            where: { scopeKey: 'local' },
            data: {
                activeDeviceId: 'active-tab',
                currentMusicId: queued.id,
                state: 'playing'
            }
        });

        const result = await createPersonalListeningSession({
            expectedRevision: 0,
            expectedPlaybackSessionRevision: 0,
            length: 'short',
            requestingEndpointId: 'active-tab',
            scope: 'explore',
            startMusicId: seed.id.toString()
        }, { now: NOW });

        expect(result).toMatchObject({
            type: 'conflict',
            changed: false,
            queue: saved.queue,
            conflict: {
                reason: 'stale-revision',
                queue: saved.queue
            }
        });
        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' },
            select: {
                activeDeviceId: true,
                currentMusicId: true,
                state: true
            }
        })).resolves.toEqual({
            activeDeviceId: 'active-tab',
            currentMusicId: queued.id,
            state: 'playing'
        });
    });

    it('keeps scanning when one candidate page cannot fill a diverse session', async () => {
        const dominant = await createCollection('dominant-page');
        const seed = await createTrack({
            albumId: dominant.album.id,
            artistId: dominant.artist.id,
            name: 'Paged Seed',
            trackNumber: 1
        });
        await models.music.createMany({
            data: Array.from({ length: 128 }, (_, index) => ({
                albumId: dominant.album.id,
                artistId: dominant.artist.id,
                bitrate: 320_000,
                codec: 'mp3',
                container: 'mp3',
                duration: 180,
                filePath: `/music/session-dominant-${index}.mp3`,
                name: `Dominant ${index}`,
                sampleRate: 44_100,
                trackNumber: index + 2
            }))
        });
        const laterTracks = [];
        for (let index = 0; index < 6; index += 1) {
            const collection = await createCollection(`later-${index}`);
            laterTracks.push(await createTrack({
                albumId: collection.album.id,
                artistId: collection.artist.id,
                name: `Later ${index}`,
                trackNumber: 1
            }));
        }
        const tag = await models.tag.create({
            data: {
                name: 'Paged relation',
                normalizedName: 'paged relation'
            }
        });
        await models.musicTag.createMany({
            data: [seed, ...laterTracks].map(track => ({
                musicId: track.id,
                tagId: tag.id
            }))
        });

        const result = await createPersonalListeningSession({
            expectedRevision: 0,
            expectedPlaybackSessionRevision: 0,
            length: 'short',
            requestingEndpointId: 'local-tab',
            scope: 'explore',
            startMusicId: seed.id.toString()
        }, { now: NOW });

        expect(result.items).toHaveLength(8);
        expect(result.items.map(item => item.musicId)).toEqual(expect.arrayContaining(
            laterTracks.map(track => track.id.toString())
        ));
    });

    it('rejects stale or remote-owned playback before replacing the queue', async () => {
        const collection = await createCollection('remote-owner');
        const seed = await createTrack({
            albumId: collection.album.id,
            artistId: collection.artist.id,
            name: 'Remote Owner Seed',
            trackNumber: 1
        });
        const queued = await createTrack({
            albumId: collection.album.id,
            artistId: collection.artist.id,
            name: 'Remote Owner Queue',
            trackNumber: 2
        });
        const saved = await savePlaybackQueue({
            musicIds: [queued.id.toString()],
            sourceMusicIds: [],
            currentIndex: 0,
            shuffle: false,
            repeatMode: 'none',
            expectedRevision: 0
        });
        await models.playbackSession.update({
            where: { scopeKey: 'local' },
            data: {
                activeDeviceId: 'remote-tab',
                currentMusicId: queued.id,
                revision: 3,
                state: 'playing'
            }
        });

        await expect(createPersonalListeningSession({
            expectedRevision: saved.queue.revision,
            expectedPlaybackSessionRevision: 2,
            length: 'short',
            requestingEndpointId: 'remote-tab',
            scope: 'explore',
            startMusicId: seed.id.toString()
        }, { now: NOW })).rejects.toMatchObject({
            code: 'STALE_PERSONAL_LISTENING_SESSION_PLAYBACK'
        });
        await expect(createPersonalListeningSession({
            expectedRevision: saved.queue.revision,
            expectedPlaybackSessionRevision: 3,
            length: 'short',
            requestingEndpointId: 'local-tab',
            scope: 'explore',
            startMusicId: seed.id.toString()
        }, { now: NOW })).rejects.toMatchObject({
            code: 'PERSONAL_LISTENING_SESSION_REMOTE_PLAYBACK'
        });
        await expect(models.playbackQueue.findFirst({
            where: { Session: { scopeKey: 'local' } },
            select: {
                revision: true,
                Item: {
                    orderBy: { order: 'asc' },
                    select: { musicId: true }
                }
            }
        })).resolves.toEqual({
            revision: saved.queue.revision,
            Item: [{ musicId: queued.id }]
        });
    });
});
