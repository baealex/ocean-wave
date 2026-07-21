import models from '~/models';
import { recordPlayback } from '~/features/music/services/playback-records';
import { setMusicLiked } from '~/features/music/services/preferences';
import { reportPlaybackState } from '~/features/playback/services/playback-session';
import { savePlaybackQueue } from '~/features/playback/services/playback-queue';
import { createPlaylist } from '~/features/playlist/services/playlists';
import {
    addMusicTagToMusic,
    createMusicTag
} from '~/features/tag/services/music-tags';

const clearRelationshipFixture = async () => {
    await models.playbackEventBranch.deleteMany();
    await models.playbackEvent.deleteMany();
    await models.playbackQueueItem.deleteMany();
    await models.playbackQueue.deleteMany();
    await models.playbackSession.deleteMany();
    await models.playlistMusic.deleteMany();
    await models.playlist.deleteMany();
    await models.musicLike.deleteMany();
    await models.musicHate.deleteMany();
    await models.musicTag.deleteMany();
    await models.tag.deleteMany();
    await models.physicalFile.deleteMany();
    await models.releaseTrack.deleteMany();
    await models.recording.deleteMany();
    await models.release.deleteMany();
    await models.artist.deleteMany();
};

describe('music relationship compatibility boundary', () => {
    beforeEach(clearRelationshipFixture);
    afterEach(clearRelationshipFixture);

    it('maps a public ReleaseTrack id to every canonical dependent owner', async () => {
        const artist = await models.artist.create({
            data: {
                id: 101,
                name: 'Relationship Artist',
                normalizedName: 'relationship artist'
            }
        });
        const release = await models.release.create({
            data: {
                id: 201,
                title: 'Relationship Release',
                releaseDate: '2026',
                releaseType: 'album',
                totalDiscs: 1,
                ArtistCredit: {
                    create: {
                        artistId: artist.id,
                        role: 'primary',
                        position: 0
                    }
                }
            }
        });
        const recording = await models.recording.create({
            data: {
                id: 301,
                title: 'Relationship Recording',
                ArtistCredit: {
                    create: {
                        artistId: artist.id,
                        role: 'primary',
                        position: 0
                    }
                }
            }
        });
        const releaseTrack = await models.releaseTrack.create({
            data: {
                id: 401,
                recordingId: recording.id,
                releaseId: release.id,
                discNumber: 1,
                trackNumber: 1
            }
        });
        const physicalFile = await models.physicalFile.create({
            data: {
                id: 501,
                releaseTrackId: releaseTrack.id,
                filePath: '/music/relationship.flac',
                durationMs: 180_000,
                codec: 'flac',
                container: 'flac',
                bitrate: 900,
                sampleRate: 48_000,
                syncStatus: 'active'
            }
        });
        const music = await models.music.findUniqueOrThrow({
            where: { id: releaseTrack.id }
        });

        expect(music).toMatchObject({
            id: releaseTrack.id,
            recordingId: recording.id,
            releaseTrackId: releaseTrack.id,
            physicalFileId: physicalFile.id
        });

        await setMusicLiked({ id: music.id.toString(), isLiked: true });
        const tag = await createMusicTag({ name: 'Relationship Tag' });
        await addMusicTagToMusic({
            musicId: music.id.toString(),
            tagId: tag.id.toString()
        });
        const playlist = await createPlaylist({
            name: 'Relationship Playlist',
            musicIds: [music.id.toString()]
        });
        const playbackHistory = {
            clientSessionId: 'relationship-history',
            branchId: 'relationship-history',
            parentBranchId: null,
            branchBasePlayedMs: 0,
            startedAt: '2026-07-21T00:00:00.000Z',
            accumulatedPlayedMs: 12_000,
            hadSeek: false,
            updatedAt: '2026-07-21T00:00:12.000Z'
        };

        await reportPlaybackState({
            deviceId: 'relationship-browser',
            sequence: 1,
            expectedRevision: 0,
            claimActive: true,
            state: 'paused',
            currentMusicId: music.id.toString(),
            positionMs: 12_000,
            playbackHistory
        });
        await savePlaybackQueue({
            musicIds: [music.id.toString()],
            sourceMusicIds: [],
            currentIndex: 0,
            contextType: 'playlist',
            contextId: playlist.id.toString(),
            contextTitle: playlist.name,
            shuffle: false,
            repeatMode: 'none',
            expectedRevision: 0
        });
        await recordPlayback({
            id: music.id.toString(),
            playedMs: 60_000,
            endReason: 'stopped',
            clientSessionId: 'relationship-event'
        }, new Date('2026-07-21T00:01:00.000Z'));

        await expect(models.musicLike.findUnique({
            where: { musicId: recording.id }
        })).resolves.toMatchObject({ musicId: recording.id });
        await expect(models.musicTag.findUnique({
            where: {
                musicId_tagId: {
                    musicId: recording.id,
                    tagId: tag.id
                }
            }
        })).resolves.toMatchObject({ musicId: recording.id });
        await expect(models.playlistMusic.findFirst({
            where: { playlistId: playlist.id }
        })).resolves.toMatchObject({ musicId: releaseTrack.id });
        await expect(models.playbackQueueItem.findFirst()).resolves.toMatchObject({
            musicId: releaseTrack.id
        });
        await expect(models.playbackSession.findUnique({
            where: { scopeKey: 'local' }
        })).resolves.toMatchObject({
            currentMusicId: releaseTrack.id,
            historyMusicId: recording.id,
            historyReleaseTrackId: releaseTrack.id,
            historyPhysicalFileId: physicalFile.id
        });
        await expect(models.playbackEvent.findUnique({
            where: { clientSessionId: 'relationship-event' }
        })).resolves.toMatchObject({
            musicId: recording.id,
            releaseTrackId: releaseTrack.id,
            physicalFileId: physicalFile.id
        });
        await expect(models.recording.findUnique({
            where: { id: recording.id }
        })).resolves.toMatchObject({
            playCount: 1,
            totalPlayedMs: 60_000
        });
    });
});
