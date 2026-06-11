import models from '../src/models';

const TRACKS = [
    {
        name: 'Runtime Smoke One',
        duration: 182,
        playCount: 8,
        totalPlayedMs: 320_000
    },
    {
        name: 'Runtime Smoke Two',
        duration: 214,
        playCount: 3,
        totalPlayedMs: 110_000
    },
    {
        name: 'Runtime Smoke Three',
        duration: 196,
        playCount: 0,
        totalPlayedMs: 0
    }
] as const;

const resetRuntimeFixture = async () => {
    await models.playlistMusic.deleteMany();
    await models.playlist.deleteMany();
    await models.playbackEvent.deleteMany();
    await models.musicTag.deleteMany();
    await models.smartViewTag.deleteMany();
    await models.smartView.deleteMany();
    await models.tag.deleteMany();
    await models.musicLike.deleteMany();
    await models.musicHate.deleteMany();
    await models.music.deleteMany();
    await models.genre.deleteMany();
    await models.album.deleteMany();
    await models.artist.deleteMany();
};

const seedRuntimeFixture = async () => {
    await resetRuntimeFixture();

    const artist = await models.artist.create({
        data: { name: 'Runtime Smoke Artist' }
    });
    const album = await models.album.create({
        data: {
            artistId: artist.id,
            cover: '',
            name: 'Runtime Smoke Album',
            publishedYear: '2026'
        }
    });
    const genre = await models.genre.create({
        data: { name: 'Runtime Smoke' }
    });
    const musics = await Promise.all(TRACKS.map((track, index) => models.music.create({
        data: {
            albumId: album.id,
            artistId: artist.id,
            bitrate: 960,
            codec: 'flac',
            container: 'flac',
            duration: track.duration,
            filePath: `/runtime-smoke/${index + 1}.flac`,
            Genre: { connect: { id: genre.id } },
            lastPlayedAt: track.playCount > 0 ? new Date(Date.UTC(2026, 0, index + 1)) : null,
            name: track.name,
            playCount: track.playCount,
            sampleRate: 44_100,
            totalPlayedMs: track.totalPlayedMs,
            trackNumber: index + 1
        }
    })));

    const tag = await models.tag.create({
        data: {
            name: 'Runtime Smoke Tag',
            normalizedName: 'runtime smoke tag',
            order: 1
        }
    });

    await models.musicTag.create({
        data: {
            musicId: musics[0].id,
            tagId: tag.id
        }
    });
    await models.musicLike.create({
        data: { musicId: musics[0].id }
    });

    const playlist = await models.playlist.create({
        data: {
            name: 'Runtime Smoke Playlist',
            order: 1
        }
    });

    await models.playlistMusic.createMany({
        data: musics.map((music, index) => ({
            musicId: music.id,
            order: index,
            playlistId: playlist.id
        }))
    });
};

seedRuntimeFixture()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await models.$disconnect();
    });
