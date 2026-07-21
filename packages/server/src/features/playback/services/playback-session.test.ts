import models from '~/models';
import {
    createReadableAudioTestFile,
    removeReadableAudioTestFiles
} from '~/test-support/readable-audio-file';
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
            filePath: createReadableAudioTestFile(),
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
        removeReadableAudioTestFiles();
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

    it('stores the readable fallback identity and clamps to its duration', async () => {
        const music = await createMusic(180);
        await models.physicalFile.update({
            where: { id: music.physicalFileId },
            data: {
                filePath: `/unreadable/session-preferred-${music.id}.flac`,
                preferenceRank: 0,
                codec: 'flac'
            }
        });
        const fallback = await models.physicalFile.create({
            data: {
                releaseTrackId: music.releaseTrackId,
                filePath: createReadableAudioTestFile(),
                durationMs: 45_000,
                codec: 'mp3',
                container: 'mp3',
                bitrate: 192_000,
                sampleRate: 44_100,
                syncStatus: 'active'
            }
        });

        const result = await reportPlaybackState({
            deviceId: 'web-fallback',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 90_000,
            playbackHistory: {
                clientSessionId: 'fallback-session-history',
                startedAt: '2026-07-14T00:00:00.000Z',
                accumulatedPlayedMs: 45_000,
                hadSeek: false,
                updatedAt: '2026-07-14T00:00:45.000Z'
            }
        });

        expect(result.session.positionMs).toBe(45_000);
        await expect(models.playbackSession.findUniqueOrThrow({
            where: { scopeKey: 'local' }
        })).resolves.toMatchObject({ historyPhysicalFileId: fallback.id });
    });

    it('persists current history lineage and clears it when playback stops', async () => {
        const music = await createMusic();
        const playbackHistory = {
            clientSessionId: 'logical-listen-1',
            branchId: 'logical-listen-1',
            parentBranchId: null,
            branchBasePlayedMs: 0,
            startedAt: '2026-07-14T00:00:00.000Z',
            accumulatedPlayedMs: 12_000,
            hadSeek: true,
            updatedAt: '2026-07-14T00:00:12.000Z'
        };

        await reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 12_000,
            playbackHistory
        });

        await expect(models.playbackSession.findUniqueOrThrow({
            where: { scopeKey: 'local' }
        })).resolves.toMatchObject({
            historyMusicId: music.recordingId,
            historyReleaseTrackId: music.releaseTrackId,
            historyPhysicalFileId: music.physicalFileId,
            historySessionId: playbackHistory.clientSessionId,
            historyBranchId: playbackHistory.branchId,
            historyParentBranchId: null,
            historyBranchBasePlayedMs: 0,
            historyStartedAt: new Date(playbackHistory.startedAt),
            historyPlayedMs: playbackHistory.accumulatedPlayedMs,
            historyHadSeek: true,
            historyUpdatedAt: new Date(playbackHistory.updatedAt)
        });

        await reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 2,
            expectedRevision: 1,
            claimActive: false,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 13_000,
            playbackHistory: {
                ...playbackHistory,
                accumulatedPlayedMs: 8_000,
                hadSeek: false,
                updatedAt: '2026-07-14T00:00:08.000Z'
            }
        });

        await expect(models.playbackSession.findUniqueOrThrow({
            where: { scopeKey: 'local' }
        })).resolves.toMatchObject({
            historyMusicId: music.recordingId,
            historyReleaseTrackId: music.releaseTrackId,
            historyPhysicalFileId: music.physicalFileId,
            historySessionId: playbackHistory.clientSessionId,
            historyBranchId: playbackHistory.branchId,
            historyPlayedMs: playbackHistory.accumulatedPlayedMs,
            historyHadSeek: true,
            historyUpdatedAt: new Date(playbackHistory.updatedAt)
        });

        await reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 3,
            expectedRevision: 2,
            claimActive: false,
            state: 'stopped',
            currentMusicId: music.id.toString(),
            positionMs: 12_000
        });

        await expect(models.playbackSession.findUniqueOrThrow({
            where: { scopeKey: 'local' }
        })).resolves.toMatchObject({
            historyMusicId: null,
            historyReleaseTrackId: null,
            historyPhysicalFileId: null,
            historySessionId: null,
            historyBranchId: null,
            historyParentBranchId: null,
            historyBranchBasePlayedMs: 0,
            historyStartedAt: null,
            historyPlayedMs: 0,
            historyHadSeek: false,
            historyUpdatedAt: null
        });
    });

    it('rejects malformed history identity instead of dropping deduplication', async () => {
        const music = await createMusic();

        await expect(reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 0,
            playbackHistory: {
                clientSessionId: '   ',
                startedAt: '2026-07-14T00:00:00.000Z',
                accumulatedPlayedMs: 0,
                hadSeek: false,
                updatedAt: '2026-07-14T00:00:00.000Z'
            }
        })).rejects.toEqual(expect.objectContaining({
            code: 'INVALID_PLAYBACK_HISTORY'
        } satisfies Partial<PlaybackSessionServiceError>));
    });

    it('rejects playback history with a noncanonical branch parent', async () => {
        const music = await createMusic();

        await expect(reportPlaybackState({
            deviceId: 'web-tab-1',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'playing',
            currentMusicId: music.id.toString(),
            positionMs: 30_000,
            playbackHistory: {
                clientSessionId: 'canonical-session',
                branchId: 'target-branch',
                parentBranchId: 'missing-parent',
                branchBasePlayedMs: 20_000,
                startedAt: '2026-07-14T00:00:00.000Z',
                accumulatedPlayedMs: 30_000,
                hadSeek: false,
                updatedAt: '2026-07-14T00:00:30.000Z'
            }
        })).rejects.toEqual(expect.objectContaining({
            code: 'INVALID_PLAYBACK_HISTORY'
        } satisfies Partial<PlaybackSessionServiceError>));
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
