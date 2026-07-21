import models from '~/models';
import { serializeTrackTagSnapshot } from '~/modules/track-version';
import {
    MUSIC_VERSION_ERROR_CODE,
    getMusicGroupingCandidates,
    groupMusicAsAlternateFile,
    linkMusicRecordings,
    setPreferredMusicFile,
    ungroupMusicFile,
    unlinkMusicRecording
} from './version-groups';

const clearFixtures = async () => {
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
    await models.syncReportItem.deleteMany();
    await models.syncReport.deleteMany();
    await models.physicalFile.deleteMany();
    await models.releaseTrack.deleteMany();
    await models.recordingGenre.deleteMany();
    await models.genre.deleteMany();
    await models.recording.deleteMany();
    await models.artistCredit.deleteMany();
    await models.release.deleteMany();
    await models.artist.deleteMany();
};

describe('recording and physical-file version groups', () => {
    beforeEach(clearFixtures);
    afterEach(clearFixtures);

    const createLibraryBase = async () => {
        const artist = await models.artist.create({
            data: { name: 'Version Artist', normalizedName: 'version artist' }
        });
        const release = await models.release.create({
            data: {
                title: 'Version Release',
                releaseType: 'album',
                ArtistCredit: {
                    create: { artistId: artist.id, role: 'primary', position: 0 }
                }
            }
        });
        return { artist, release };
    };

    const createTrack = async ({
        artistId,
        releaseId,
        title = 'Signal',
        recordingVersionTitle = null,
        releaseVersionTitle = null,
        filePath,
        codec = 'mp3',
        durationMs = 180_000,
        trackNumber = 1
    }: {
        artistId: number;
        releaseId: number;
        title?: string;
        recordingVersionTitle?: string | null;
        releaseVersionTitle?: string | null;
        filePath: string;
        codec?: string;
        durationMs?: number;
        trackNumber?: number;
    }) => {
        const recording = await models.recording.create({
            data: {
                title,
                versionTitle: recordingVersionTitle,
                ArtistCredit: {
                    create: { artistId, role: 'primary', position: 0 }
                }
            }
        });
        const releaseTrack = await models.releaseTrack.create({
            data: {
                recordingId: recording.id,
                releaseId,
                versionTitle: releaseVersionTitle,
                discNumber: 1,
                trackNumber
            }
        });
        const file = await models.physicalFile.create({
            data: {
                releaseTrackId: releaseTrack.id,
                filePath,
                durationMs,
                codec,
                container: codec,
                bitrate: codec === 'flac' ? 900_000 : 320_000,
                sampleRate: codec === 'flac' ? 96_000 : 44_100,
                syncStatus: 'active'
            }
        });
        return { recording, releaseTrack, file };
    };

    it('suggests strict alternate files while rejecting conflicting performance versions', async () => {
        const { artist, release } = await createLibraryBase();
        const current = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/signal.flac',
            codec: 'flac'
        });
        const alternate = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/signal.mp3',
            durationMs: 180_750
        });
        const live = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/signal-live.mp3',
            recordingVersionTitle: 'Live',
            durationMs: 180_400
        });
        const legacyLive = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/signal-legacy-live.mp3',
            durationMs: 180_300
        });
        const conflictingIdentifier = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/signal-conflict.aac',
            codec: 'aac',
            durationMs: 180_200
        });
        const snapshot = (value: string, recordingVersionTitle: string | null = null) => serializeTrackTagSnapshot({
            identifiers: [{ scheme: 'musicbrainz-recording', value }],
            recordingVersionTitle,
            releaseVersionTitle: null
        });
        await models.physicalFile.update({
            where: { id: current.file.id },
            data: { tagSnapshotJson: snapshot('recording-a'), tagSnapshotVersion: 1 }
        });
        await models.physicalFile.update({
            where: { id: alternate.file.id },
            data: { tagSnapshotJson: snapshot('recording-a'), tagSnapshotVersion: 1 }
        });
        await models.physicalFile.update({
            where: { id: conflictingIdentifier.file.id },
            data: { tagSnapshotJson: snapshot('recording-b'), tagSnapshotVersion: 1 }
        });
        await models.physicalFile.update({
            where: { id: legacyLive.file.id },
            data: {
                tagSnapshotJson: snapshot('recording-a', 'Live'),
                tagSnapshotVersion: 1
            }
        });

        const candidates = await getMusicGroupingCandidates(current.releaseTrack.id);

        expect(candidates).toEqual([
            expect.objectContaining({
                kind: 'ALTERNATE_FILE',
                music: expect.objectContaining({ id: alternate.releaseTrack.id }),
                reasons: expect.arrayContaining(['Same release and disc/track position'])
            })
        ]);
        expect(candidates.some(candidate => candidate.music.id === live.releaseTrack.id))
            .toBe(false);
        expect(candidates.some(candidate => candidate.music.id === legacyLive.releaseTrack.id))
            .toBe(false);
        expect(candidates.some(candidate => (
            candidate.music.id === conflictingIdentifier.releaseTrack.id
        ))).toBe(false);
    });

    it('remembers an unavailable preference while the compatibility view falls back', async () => {
        const { artist, release } = await createLibraryBase();
        const track = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/signal.mp3'
        });
        const missingPreferred = await models.physicalFile.create({
            data: {
                releaseTrackId: track.releaseTrack.id,
                filePath: '/music/signal-preferred.flac',
                durationMs: 180_000,
                codec: 'flac',
                container: 'flac',
                bitrate: 900_000,
                sampleRate: 96_000,
                syncStatus: 'missing'
            }
        });

        await setPreferredMusicFile({
            musicId: track.releaseTrack.id,
            fileId: missingPreferred.id
        });

        await expect(models.physicalFile.findUniqueOrThrow({
            where: { id: missingPreferred.id }
        })).resolves.toMatchObject({ preferenceRank: 0 });
        await expect(models.music.findUniqueOrThrow({
            where: { id: track.releaseTrack.id }
        })).resolves.toMatchObject({ physicalFileId: track.file.id });
    });

    it('treats choosing a hidden exact copy as explicit activation', async () => {
        const { artist, release } = await createLibraryBase();
        const track = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/signal-original.flac',
            codec: 'flac'
        });
        const copy = await models.physicalFile.create({
            data: {
                releaseTrackId: track.releaseTrack.id,
                filePath: '/music/signal-copy.flac',
                durationMs: 180_000,
                codec: 'flac',
                container: 'flac',
                bitrate: 900_000,
                sampleRate: 96_000,
                syncStatus: 'duplicate'
            }
        });

        await setPreferredMusicFile({
            musicId: track.releaseTrack.id,
            fileId: copy.id
        });

        await expect(models.physicalFile.findUniqueOrThrow({ where: { id: copy.id } }))
            .resolves.toMatchObject({ preferenceRank: 0, syncStatus: 'active' });
        await expect(models.music.findUniqueOrThrow({ where: { id: track.releaseTrack.id } }))
            .resolves.toMatchObject({ physicalFileId: copy.id });
    });

    it('links release appearances without duplicating playlist items and can split them again', async () => {
        const { artist, release } = await createLibraryBase();
        const single = await models.release.create({
            data: {
                title: 'Signal Single',
                releaseType: 'single',
                ArtistCredit: {
                    create: { artistId: artist.id, role: 'primary', position: 0 }
                }
            }
        });
        const albumTrack = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/album-signal.flac',
            codec: 'flac'
        });
        const singleTrack = await createTrack({
            artistId: artist.id,
            releaseId: single.id,
            filePath: '/music/single-signal.mp3',
            releaseVersionTitle: '2026 Remaster'
        });
        const playlist = await models.playlist.create({ data: { name: 'Versions' } });
        await models.playlistMusic.createMany({
            data: [
                { playlistId: playlist.id, musicId: albumTrack.releaseTrack.id, order: 0 },
                { playlistId: playlist.id, musicId: singleTrack.releaseTrack.id, order: 1 }
            ]
        });

        await linkMusicRecordings({
            musicId: singleTrack.releaseTrack.id,
            targetMusicId: albumTrack.releaseTrack.id
        });

        const linkedTracks = await models.releaseTrack.findMany({
            where: { id: { in: [albumTrack.releaseTrack.id, singleTrack.releaseTrack.id] } }
        });
        expect(new Set(linkedTracks.map(track => track.recordingId)).size).toBe(1);
        await expect(models.playlistMusic.count({ where: { playlistId: playlist.id } }))
            .resolves.toBe(2);

        const linkedRecordingId = linkedTracks[0].recordingId;
        const albumPlayedAt = new Date('2026-07-20T10:00:00.000Z');
        const singleSkippedAt = new Date('2026-07-21T10:00:00.000Z');
        await models.playbackEvent.createMany({
            data: [
                {
                    musicId: linkedRecordingId,
                    releaseTrackId: albumTrack.releaseTrack.id,
                    physicalFileId: albumTrack.file.id,
                    startedAt: new Date(albumPlayedAt.getTime() - 40_000),
                    endedAt: albumPlayedAt,
                    playedMs: 40_000,
                    completionRate: 0.22,
                    countedAsPlay: true,
                    outcome: 'listen',
                    endReason: 'stopped',
                    source: 'test'
                },
                {
                    musicId: linkedRecordingId,
                    releaseTrackId: singleTrack.releaseTrack.id,
                    physicalFileId: singleTrack.file.id,
                    startedAt: new Date(singleSkippedAt.getTime() - 10_000),
                    endedAt: singleSkippedAt,
                    playedMs: 10_000,
                    completionRate: 0.05,
                    countedAsPlay: false,
                    outcome: 'skip',
                    endReason: 'skipped',
                    source: 'test'
                }
            ]
        });
        await models.recording.update({
            where: { id: linkedRecordingId },
            data: {
                playCount: 1,
                lastPlayedAt: singleSkippedAt,
                skipCount: 1,
                lastSkippedAt: singleSkippedAt,
                totalPlayedMs: 50_000
            }
        });
        const tag = await models.tag.create({
            data: {
                name: 'Keep on split',
                normalizedName: 'keep on split'
            }
        });
        await models.musicLike.create({ data: { musicId: linkedRecordingId } });
        await models.musicTag.create({
            data: { musicId: linkedRecordingId, tagId: tag.id }
        });

        await unlinkMusicRecording({ musicId: singleTrack.releaseTrack.id });
        const splitTracks = await models.releaseTrack.findMany({
            where: { id: { in: [albumTrack.releaseTrack.id, singleTrack.releaseTrack.id] } }
        });
        expect(new Set(splitTracks.map(track => track.recordingId)).size).toBe(2);
        const albumRecordingId = splitTracks.find(track => (
            track.id === albumTrack.releaseTrack.id
        ))!.recordingId;
        const singleRecordingId = splitTracks.find(track => (
            track.id === singleTrack.releaseTrack.id
        ))!.recordingId;
        await expect(models.recording.findUniqueOrThrow({
            where: { id: albumRecordingId }
        })).resolves.toMatchObject({
            playCount: 1,
            lastPlayedAt: albumPlayedAt,
            skipCount: 0,
            lastSkippedAt: null,
            totalPlayedMs: 40_000
        });
        await expect(models.recording.findUniqueOrThrow({
            where: { id: singleRecordingId }
        })).resolves.toMatchObject({
            playCount: 0,
            lastPlayedAt: singleSkippedAt,
            skipCount: 1,
            lastSkippedAt: singleSkippedAt,
            totalPlayedMs: 10_000
        });
        await expect(models.musicLike.count({
            where: { musicId: { in: [albumRecordingId, singleRecordingId] } }
        })).resolves.toBe(2);
        await expect(models.musicTag.count({
            where: {
                musicId: { in: [albumRecordingId, singleRecordingId] },
                tagId: tag.id
            }
        })).resolves.toBe(2);
    });

    it('collapses a clean duplicate into one playlist item and supports manual ungrouping', async () => {
        const { artist, release } = await createLibraryBase();
        const target = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/signal.flac',
            codec: 'flac'
        });
        const source = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/signal.mp3'
        });
        const playlist = await models.playlist.create({ data: { name: 'One Signal' } });
        await models.playlistMusic.createMany({
            data: [
                { playlistId: playlist.id, musicId: target.releaseTrack.id, order: 0 },
                { playlistId: playlist.id, musicId: source.releaseTrack.id, order: 1 }
            ]
        });

        await groupMusicAsAlternateFile({
            musicId: source.releaseTrack.id,
            targetMusicId: target.releaseTrack.id
        });

        await expect(models.releaseTrack.findUnique({ where: { id: source.releaseTrack.id } }))
            .resolves.toBeNull();
        await expect(models.physicalFile.count({
            where: { releaseTrackId: target.releaseTrack.id }
        })).resolves.toBe(2);
        await expect(models.playlistMusic.count({ where: { playlistId: playlist.id } }))
            .resolves.toBe(1);

        const separated = await ungroupMusicFile({
            musicId: target.releaseTrack.id,
            fileId: source.file.id
        });
        expect(separated.id).not.toBe(target.releaseTrack.id);
        await expect(models.physicalFile.findUniqueOrThrow({ where: { id: source.file.id } }))
            .resolves.toMatchObject({ releaseTrackId: separated.id, syncStatus: 'active' });
    });

    it('refuses to collapse a source that already owns personal state', async () => {
        const { artist, release } = await createLibraryBase();
        const target = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/target.mp3'
        });
        const source = await createTrack({
            artistId: artist.id,
            releaseId: release.id,
            filePath: '/music/source.mp3'
        });
        await models.musicLike.create({ data: { musicId: source.recording.id } });

        await expect(groupMusicAsAlternateFile({
            musicId: source.releaseTrack.id,
            targetMusicId: target.releaseTrack.id
        })).rejects.toMatchObject({
            code: MUSIC_VERSION_ERROR_CODE.unsafeGrouping
        });
    });
});
