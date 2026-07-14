import models from '~/models';

import {
    PlaybackQueueServiceError,
    getPlaybackQueueSnapshot,
    savePlaybackQueue
} from './playback-queue';

const createMusic = async () => {
    const unique = Date.now().toString() + Math.random().toString(16).slice(2);
    const artist = await models.artist.create({ data: { name: `Queue Artist ${unique}` } });
    const album = await models.album.create({
        data: {
            name: `Queue Album ${unique}`,
            cover: `/covers/${unique}.jpg`,
            publishedYear: '2026',
            artistId: artist.id
        }
    });

    return models.music.create({
        data: {
            name: `Queue Track ${unique}`,
            artistId: artist.id,
            albumId: album.id,
            filePath: `/music/${unique}.mp3`,
            duration: 180,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320,
            sampleRate: 44100,
            trackNumber: 1
        }
    });
};

describe('playback queue service', () => {
    beforeEach(async () => {
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
    });

    afterEach(async () => {
        await models.playbackQueue.deleteMany();
        await models.playbackSession.deleteMany();
    });

    it('persists and reads an authoritative queue snapshot', async () => {
        const first = await createMusic();
        const second = await createMusic();
        const result = await savePlaybackQueue({
            musicIds: [second.id.toString(), first.id.toString()],
            sourceMusicIds: [first.id.toString(), second.id.toString()],
            currentIndex: 0,
            shuffle: true,
            repeatMode: 'all',
            expectedRevision: 0
        });

        expect(result).toMatchObject({
            type: 'accepted',
            changed: true,
            conflict: null,
            queue: {
                musicIds: [second.id.toString(), first.id.toString()],
                sourceMusicIds: [first.id.toString(), second.id.toString()],
                currentIndex: 0,
                shuffle: true,
                repeatMode: 'all',
                revision: 1
            }
        });
        await expect(getPlaybackQueueSnapshot()).resolves.toEqual(result.queue);
    });

    it('increments revision and returns the server queue for a stale write', async () => {
        const music = await createMusic();
        const initial = await savePlaybackQueue({
            musicIds: [music.id.toString()],
            sourceMusicIds: [],
            currentIndex: 0,
            shuffle: false,
            repeatMode: 'none',
            expectedRevision: 0
        });
        const updated = await savePlaybackQueue({
            musicIds: [music.id.toString()],
            sourceMusicIds: [],
            currentIndex: 0,
            shuffle: false,
            repeatMode: 'one',
            expectedRevision: initial.queue.revision
        });
        const stale = await savePlaybackQueue({
            musicIds: [],
            sourceMusicIds: [],
            currentIndex: null,
            shuffle: false,
            repeatMode: 'none',
            expectedRevision: initial.queue.revision
        });

        expect(updated.queue).toMatchObject({ revision: 2, repeatMode: 'one' });
        expect(stale).toMatchObject({
            type: 'conflict',
            changed: false,
            queue: { revision: 2, repeatMode: 'one' },
            conflict: {
                reason: 'stale-revision',
                queue: { revision: 2 }
            }
        });
    });

    it('requires shuffled source order to be a permutation of queue items', async () => {
        const music = await createMusic();

        await expect(savePlaybackQueue({
            musicIds: [music.id.toString()],
            sourceMusicIds: [],
            currentIndex: 0,
            shuffle: true,
            repeatMode: 'none',
            expectedRevision: 0
        })).rejects.toEqual(expect.objectContaining({
            code: 'INVALID_PLAYBACK_QUEUE_SOURCE_ORDER'
        } satisfies Partial<PlaybackQueueServiceError>));
    });

    it('rejects unavailable music without replacing the current server queue', async () => {
        const music = await createMusic();
        const initial = await savePlaybackQueue({
            musicIds: [music.id.toString()],
            sourceMusicIds: [],
            currentIndex: 0,
            shuffle: false,
            repeatMode: 'none',
            expectedRevision: 0
        });

        await expect(savePlaybackQueue({
            musicIds: ['999999999'],
            sourceMusicIds: [],
            currentIndex: 0,
            shuffle: false,
            repeatMode: 'none',
            expectedRevision: initial.queue.revision
        })).rejects.toEqual(expect.objectContaining({
            code: 'PLAYBACK_QUEUE_MUSIC_NOT_FOUND'
        } satisfies Partial<PlaybackQueueServiceError>));
        await expect(getPlaybackQueueSnapshot()).resolves.toMatchObject({
            revision: 1,
            musicIds: [music.id.toString()]
        });
    });

    it('repairs a persisted queue when a library track becomes unavailable', async () => {
        const first = await createMusic();
        const missing = await createMusic();
        const third = await createMusic();
        await savePlaybackQueue({
            musicIds: [first.id, missing.id, third.id].map(String),
            sourceMusicIds: [],
            currentIndex: 1,
            shuffle: false,
            repeatMode: 'none',
            expectedRevision: 0
        });
        await models.music.update({
            where: { id: missing.id },
            data: { syncStatus: 'missing' }
        });

        await expect(getPlaybackQueueSnapshot()).resolves.toMatchObject({
            musicIds: [first.id.toString(), third.id.toString()],
            currentIndex: 1,
            revision: 2
        });
        await expect(getPlaybackQueueSnapshot()).resolves.toMatchObject({
            musicIds: [first.id.toString(), third.id.toString()],
            revision: 2
        });
    });
});
