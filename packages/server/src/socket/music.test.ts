import models from '~/models';
import { connectors } from './connectors';
import { count } from './music';

type TestConnector = Parameters<typeof connectors.set>[0][number];

const createMusic = async (overrides?: { duration?: number }) => {
    const unique = Date.now().toString() + Math.random().toString(16).slice(2);
    const artist = await models.artist.create({ data: { name: `Artist ${unique}` } });
    const album = await models.album.create({
        data: {
            name: `Album ${unique}`,
            cover: `/covers/${unique}.jpg`,
            publishedYear: '2026',
            artistId: artist.id
        }
    });

    return models.music.create({
        data: {
            name: `Track ${unique}`,
            artistId: artist.id,
            albumId: album.id,
            filePath: `/music/${unique}.mp3`,
            duration: overrides?.duration ?? 200,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320,
            sampleRate: 44100,
            trackNumber: 1
        }
    });
};

describe('music playback counting', () => {
    beforeEach(async () => {
        jest.restoreAllMocks();
        connectors.set([]);

        await models.playbackEvent.deleteMany();
        await models.musicLike.deleteMany();
        await models.musicHate.deleteMany();
        await models.playlistMusic.deleteMany();
        await models.music.deleteMany();
        await models.album.deleteMany();
        await models.artist.deleteMany();
    });

    it('creates a playback event and updates aggregates for a meaningful listen', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const music = await createMusic({ duration: 180 });

        await count({
            id: music.id.toString(),
            playedMs: 35_000,
            completionRate: 35_000 / 180_000,
            source: 'queue-track-change'
        });

        const updatedMusic = await models.music.findUniqueOrThrow({ where: { id: music.id } });
        const events = await models.playbackEvent.findMany({ where: { musicId: music.id } });

        expect(updatedMusic.playCount).toBe(1);
        expect(updatedMusic.totalPlayedMs).toBe(35_000);
        expect(updatedMusic.lastPlayedAt).not.toBeNull();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            musicId: music.id,
            playedMs: 35_000,
            countedAsPlay: true,
            source: 'queue-track-change'
        });
        expect(notifySpy).toHaveBeenCalledWith('music-count', expect.objectContaining({
            id: music.id.toString(),
            playCount: 1,
            totalPlayedMs: 35_000,
            countedAsPlay: true
        }));
    });

    it('records partial playback without incrementing play count', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const music = await createMusic({ duration: 240 });

        await count({
            id: music.id.toString(),
            playedMs: 10_000,
            completionRate: 10_000 / 240_000,
            source: 'queue-stop'
        });

        const updatedMusic = await models.music.findUniqueOrThrow({ where: { id: music.id } });
        const event = await models.playbackEvent.findFirstOrThrow({ where: { musicId: music.id } });

        expect(updatedMusic.playCount).toBe(0);
        expect(updatedMusic.totalPlayedMs).toBe(10_000);
        expect(event.countedAsPlay).toBe(false);
        expect(notifySpy).toHaveBeenCalledWith('music-count', expect.objectContaining({
            id: music.id.toString(),
            playCount: 0,
            totalPlayedMs: 10_000,
            countedAsPlay: false
        }));
    });

    it('returns count result without waiting for realtime broadcast acknowledgements', async () => {
        const emit = jest.fn();
        connectors.set([{
            id: 'socket-1',
            userAgent: 'test',
            connectedAt: Date.now(),
            disconnect: jest.fn(),
            emit
        } as TestConnector]);
        const music = await createMusic({ duration: 180 });

        await expect(Promise.race([
            count({
                id: music.id.toString(),
                playedMs: 35_000,
                completionRate: 35_000 / 180_000,
                source: 'queue-track-change'
            }),
            new Promise((resolve) => {
                setTimeout(() => {
                    resolve('timed-out');
                }, 1000);
            })
        ])).resolves.toMatchObject({
            id: music.id.toString(),
            playCount: 1,
            countedAsPlay: true,
            deduped: false
        });
        expect(emit).toHaveBeenCalledWith('music-count', expect.objectContaining({
            id: music.id.toString(),
            playCount: 1
        }));
        expect(emit.mock.calls[0]).toHaveLength(2);
    });

    it('clamps playedMs to the session wall-clock duration when startedAt is provided', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const music = await createMusic({ duration: 180 });
        const startedAt = new Date(Date.now() - 5_000).toISOString();

        await count({
            id: music.id.toString(),
            playedMs: 60_000,
            completionRate: 60_000 / 180_000,
            startedAt,
            source: 'queue-stop'
        });

        const updatedMusic = await models.music.findUniqueOrThrow({ where: { id: music.id } });
        const event = await models.playbackEvent.findFirstOrThrow({ where: { musicId: music.id } });

        expect(updatedMusic.playCount).toBe(0);
        expect(updatedMusic.totalPlayedMs).toBeLessThanOrEqual(5_100);
        expect(event.playedMs).toBeLessThanOrEqual(5_100);
        expect(Math.abs(event.startedAt.getTime() - new Date(startedAt).getTime())).toBeLessThan(50);
        expect(notifySpy).toHaveBeenCalledWith('music-count', expect.objectContaining({
            id: music.id.toString(),
            playCount: 0,
            countedAsPlay: false
        }));
    });

    it('dedupes repeated recovery commits with the same clientSessionId', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const music = await createMusic({ duration: 180 });
        const clientSessionId = 'session-dedupe-1';

        await count({
            id: music.id.toString(),
            clientSessionId,
            playedMs: 35_000,
            completionRate: 35_000 / 180_000,
            source: 'queue-recovery'
        });
        await count({
            id: music.id.toString(),
            clientSessionId,
            playedMs: 35_000,
            completionRate: 35_000 / 180_000,
            source: 'queue-recovery'
        });

        const updatedMusic = await models.music.findUniqueOrThrow({ where: { id: music.id } });
        const events = await models.playbackEvent.findMany({ where: { musicId: music.id } });

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            musicId: music.id,
            clientSessionId,
            playedMs: 35_000,
            source: 'queue-recovery'
        });
        expect(updatedMusic.playCount).toBe(1);
        expect(updatedMusic.totalPlayedMs).toBe(35_000);
        expect(notifySpy).toHaveBeenCalledTimes(1);
    });

    it('dedupes concurrent recovery commits with the same clientSessionId', async () => {
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const music = await createMusic({ duration: 180 });
        const clientSessionId = 'session-dedupe-race';

        const results = await Promise.all([
            count({
                id: music.id.toString(),
                clientSessionId,
                playedMs: 35_000,
                completionRate: 35_000 / 180_000,
                source: 'queue-recovery'
            }),
            count({
                id: music.id.toString(),
                clientSessionId,
                playedMs: 35_000,
                completionRate: 35_000 / 180_000,
                source: 'queue-recovery'
            })
        ]);

        const updatedMusic = await models.music.findUniqueOrThrow({ where: { id: music.id } });
        const events = await models.playbackEvent.findMany({ where: { musicId: music.id } });

        expect(events).toHaveLength(1);
        expect(updatedMusic.playCount).toBe(1);
        expect(updatedMusic.totalPlayedMs).toBe(35_000);
        expect(results).toEqual(expect.arrayContaining([
            expect.objectContaining({ deduped: false }),
            expect.objectContaining({ deduped: true })
        ]));
        expect(notifySpy).toHaveBeenCalledTimes(1);
    });
});
