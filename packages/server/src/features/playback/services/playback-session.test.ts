import models from '~/models';
import {
    PlaybackSessionServiceError,
    getPlaybackSessionSnapshot,
    reportPlaybackState
} from './playback-session';

const createMusic = async (duration = 180) => {
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
            duration,
            codec: 'mp3',
            container: 'mp3',
            bitrate: 320,
            sampleRate: 44100,
            trackNumber: 1
        }
    });
};

describe('playback session service', () => {
    beforeEach(async () => {
        await models.playbackSession.deleteMany();
    });

    afterEach(async () => {
        await models.playbackSession.deleteMany();
    });

    it('creates an authoritative snapshot when the first web player claims it', async () => {
        const music = await createMusic();
        const now = new Date('2026-07-14T00:00:00.000Z');

        const result = await reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 12_000
        }, now);

        expect(result).toMatchObject({
            type: 'accepted',
            changed: true,
            conflict: null,
            session: {
                state: 'playing',
                activeDeviceId: 'web-tab-1',
                currentMusicId: music.id.toString(),
                positionMs: 12_000,
                positionUpdatedAt: now.toISOString(),
                revision: 1,
                serverTime: now.toISOString()
            }
        });
        await expect(getPlaybackSessionSnapshot(now)).resolves.toMatchObject({
            activeDeviceId: 'web-tab-1',
            revision: 1
        });
    });

    it('dedupes an accepted sequence and rejects an older active-device report', async () => {
        const music = await createMusic();
        const firstInput = {
            deviceId: 'web-tab-1',
            sequence: 4,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing' as const,
            currentMusicId: music.id.toString(),
            positionMs: 1_000
        };

        const first = await reportPlaybackState(firstInput);
        const repeated = await reportPlaybackState(firstInput);
        const stale = await reportPlaybackState({
            ...firstInput,
            sequence: 3,
            claimActive: false
        });

        expect(repeated).toMatchObject({
            type: 'accepted',
            changed: false,
            session: { revision: first.session.revision }
        });
        expect(stale).toMatchObject({
            type: 'conflict',
            changed: false,
            conflict: { reason: 'stale-sequence' },
            session: { revision: first.session.revision }
        });
    });

    it('requires an explicit claim before another web player can publish', async () => {
        const music = await createMusic();

        await reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 0
        });
        const rejected = await reportPlaybackState({
            deviceId: 'web-tab-2',
            sequence: 1,
            expectedRevision: 1,
            claimActive: false,
            state: 'paused',
            currentMusicId: music.id.toString(),
            positionMs: 2_000
        });
        const claimed = await reportPlaybackState({
            deviceId: 'web-tab-2',
            sequence: 2,
            expectedRevision: 1,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 2_000
        });

        expect(rejected).toMatchObject({
            type: 'conflict',
            conflict: { reason: 'active-device' },
            session: { activeDeviceId: 'web-tab-1', revision: 1 }
        });
        expect(claimed).toMatchObject({
            type: 'accepted',
            session: { activeDeviceId: 'web-tab-2', revision: 2 }
        });
    });

    it('rejects a delayed reconnect claim after another endpoint advanced the revision', async () => {
        const music = await createMusic();
        const first = await reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 1_000
        });
        const takeover = await reportPlaybackState({
            deviceId: 'web-tab-2',
            sequence: 1,
            expectedRevision: first.session.revision,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 2_000
        });

        const delayed = await reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 2,
            expectedRevision: first.session.revision,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 3_000
        });

        expect(delayed).toMatchObject({
            type: 'conflict',
            changed: false,
            conflict: { reason: 'stale-revision' },
            session: {
                activeDeviceId: 'web-tab-2',
                activeDeviceSequence: 1,
                revision: takeover.session.revision,
                positionMs: 2_000
            }
        });
        await expect(getPlaybackSessionSnapshot()).resolves.toMatchObject({
            activeDeviceId: 'web-tab-2',
            revision: takeover.session.revision,
            positionMs: 2_000
        });
    });

    it('clamps position to duration and rejects unavailable music', async () => {
        const music = await createMusic(30);
        const accepted = await reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'paused',
            currentMusicId: music.id.toString(),
            positionMs: 90_000
        });

        expect(accepted.session.positionMs).toBe(30_000);
        await expect(reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 2,
            expectedRevision: 1,
            claimActive: false,
            state: 'playing',
            currentMusicId: '999999999',
            positionMs: 0
        })).rejects.toEqual(expect.objectContaining({
            code: 'PLAYBACK_MUSIC_NOT_FOUND'
        } satisfies Partial<PlaybackSessionServiceError>));
    });
});
