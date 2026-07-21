import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import models from '../src/models';
import {
    previewMusicMetadataUpdate,
    updateMusicMetadata
} from '../src/features/music/services/metadata-editor';
import { writeTrackMetadataToFile } from '../src/modules/audio-metadata-writer';
import { parseTrackMetadata } from '../src/modules/track-metadata';
import { syncMusic } from '../src/socket/sync';

type TagLibModule = typeof import('taglib-wasm');

const loadTagLibModule = new Function(
    'return import("taglib-wasm")'
) as () => Promise<TagLibModule>;

const ARTWORK = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

const createSilentMp3 = () => Buffer.from(
    [
        'SUQzAwAAAAAAIlRTU0UAAAAOAAAATGF2ZjYyLjMuMTAwAAAAAAAAAAAAAAD/4zjAAAAAAAAAAAAASW5mbwAAAA8AAAAGAAAEOABV',
        'VVVVVVVVVVVVVVVVVVVVd3d3d3d3d3d3d3d3d3d3d3eZmZmZmZmZmZmZmZmZmZmZu7u7u7u7u7u7u7u7u7u7u7vd3d3d3d3d3d3d',
        '3d3d3d3d3f////////////////////8AAAAATGF2YzYyLjExAAAAAAAAAAAAAAAAJANwAAAAAAAABDi9KN09AAAAAAAAAAAAAAAA',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/4yjEAAAAA0gAAAAATEFNRVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/4yjEfAAAA0gAAAAAVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/4yjEfAAAA0gAAAAAVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVVVVVVVVVX/4yjEfAAAA0gAAAAAVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVX/4yjEfAAAA0gAAAAAVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVX/4yjEfAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=',
    ].join(''),
    'base64'
);

const clearLibrary = () => models.$transaction(async transaction => {
    await transaction.syncReport.deleteMany();
    await transaction.musicMetadataOperation.deleteMany();
    await transaction.physicalFile.deleteMany();
    await transaction.releaseTrack.deleteMany();
    await transaction.recording.deleteMany();
    await transaction.release.deleteMany();
    await transaction.genre.deleteMany();
    await transaction.artist.deleteMany();
});

export const testAudioMetadataWriter = async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-tag-integration-'));
    const freshDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-fresh-import-'));
    const filePath = path.join(directory, 'track.mp3');
    const copiedFilePath = path.join(freshDirectory, 'track.mp3');
    const originalMusicPath = process.env.OCEAN_WAVE_MUSIC_PATH;
    const originalCachePath = process.env.OCEAN_WAVE_CACHE_PATH;

    const assertRelationalMetadata = async (
        music: Awaited<ReturnType<typeof models.music.findFirstOrThrow>>,
        expectDatabaseOnlyPresentation: boolean,
        expected: {
            recordingTitle: string;
            recordingVersionTitle: string | null;
            releaseDate: string | null;
        } = {
            recordingTitle: 'Portable Track',
            recordingVersionTitle: 'Studio Cut',
            releaseDate: '2026-07-21'
        }
    ) => {
        const recording = await models.recording.findUniqueOrThrow({
            where: { id: music.recordingId },
            include: {
                ArtistCredit: {
                    include: { Artist: true },
                    orderBy: { position: 'asc' }
                },
                RecordingGenre: { include: { Genre: true } }
            }
        });
        const release = await models.release.findUniqueOrThrow({
            where: { id: music.albumId },
            include: {
                ArtistCredit: {
                    include: { Artist: true },
                    orderBy: { position: 'asc' }
                }
            }
        });
        const releaseTrack = await models.releaseTrack.findUniqueOrThrow({
            where: { id: music.releaseTrackId }
        });

        assert.equal(recording.title, expected.recordingTitle);
        assert.equal(recording.versionTitle, expected.recordingVersionTitle);
        assert.deepEqual(
            recording.ArtistCredit.map(credit => credit.Artist.name),
            ['Track Artist', 'Guest Artist']
        );
        if (expectDatabaseOnlyPresentation) {
            assert.deepEqual(
                recording.ArtistCredit.map(credit => ({
                    role: credit.role,
                    creditedName: credit.creditedName,
                    joinPhrase: credit.joinPhrase
                })),
                [
                    {
                        role: 'primary',
                        creditedName: 'Lead Alias',
                        joinPhrase: ' feat. '
                    },
                    {
                        role: 'featured',
                        creditedName: 'Guest Alias',
                        joinPhrase: ''
                    }
                ]
            );
        }
        assert.deepEqual(
            recording.RecordingGenre.map(({ Genre }) => Genre.name).sort(),
            ['Ambient', 'Electronic']
        );
        assert.equal(release.title, 'Portable Album');
        assert.equal(release.releaseDate, expected.releaseDate);
        assert.equal(release.releaseType, 'ep');
        assert.equal(release.totalDiscs, 3);
        assert.deepEqual(
            release.ArtistCredit.map(credit => credit.Artist.name),
            ['Various Artists']
        );
        assert.equal(releaseTrack.versionTitle, 'Archive Edition');
        assert.equal(releaseTrack.discNumber, 2);
        assert.equal(releaseTrack.trackNumber, 3);
    };

    try {
        fs.writeFileSync(filePath, createSilentMp3());
        const { TagLib } = await loadTagLibModule();
        const tagLib = await TagLib.initialize();
        const artworkFile = await tagLib.open(fs.readFileSync(filePath));

        try {
            artworkFile.setPictures([{
                mimeType: 'image/png',
                data: ARTWORK,
                type: 'FrontCover',
                description: 'Portable artwork'
            }]);
            assert.equal(artworkFile.save(), true);
            fs.writeFileSync(filePath, artworkFile.getFileBuffer());
        } finally {
            artworkFile.dispose();
        }

        await writeTrackMetadataToFile(filePath, {
            title: 'Initial Track',
            artist: 'Initial Artist',
            artistCredits: [{
                name: 'Initial Artist',
                role: 'primary',
                creditedName: null,
                joinPhrase: ''
            }],
            album: 'Initial Album',
            albumArtist: 'Initial Artist',
            albumArtistCredits: [{
                name: 'Initial Artist',
                role: 'primary',
                creditedName: null,
                joinPhrase: ''
            }],
            year: '2024',
            trackNumber: 1,
            genres: ['Rock'],
            releaseType: 'album',
            discNumber: 1,
            totalDiscs: 1,
            recordingVersionTitle: null,
            releaseVersionTitle: null
        });

        process.env.OCEAN_WAVE_MUSIC_PATH = directory;
        process.env.OCEAN_WAVE_CACHE_PATH = path.join(directory, 'cache');
        const initialImport = await syncMusic({ emit: () => true } as never);
        assert.equal(initialImport?.created.length, 1);
        const initialMusic = await models.music.findFirstOrThrow({
            where: { filePath: 'track.mp3' }
        });
        const input = {
            id: initialMusic.id.toString(),
            title: 'Portable Track',
            titleOverride: null,
            recordingVersionTitle: 'Studio Cut',
            recordingArtistCredits: [
                {
                    name: 'Track Artist',
                    role: 'PRIMARY',
                    creditedName: 'Lead Alias',
                    joinPhrase: ' feat. '
                },
                {
                    name: 'Guest Artist',
                    role: 'FEATURED',
                    creditedName: 'Guest Alias',
                    joinPhrase: ''
                }
            ],
            releaseTrackArtistCredits: null,
            album: 'Portable Album',
            albumArtistCredits: [{
                name: 'Various Artists',
                role: 'PRIMARY',
                creditedName: null,
                joinPhrase: ''
            }],
            publishedYear: '2026-07-21',
            releaseType: 'EP',
            totalDiscs: 3,
            releaseVersionTitle: 'Archive Edition',
            discNumber: 2,
            trackNumber: 3,
            genres: ['Ambient', 'Electronic']
        };
        const preview = await previewMusicMetadataUpdate(input);
        assert.equal(preview.hasChanges, true);
        assert.equal(preview.files.length, 1);
        assert.equal(preview.files[0]?.willWrite, true);
        const operation = await updateMusicMetadata(input, preview.token);
        assert.equal(operation.status, 'cleaned');
        assert.equal(operation.targets.length, 1);

        const metadata = await parseTrackMetadata(
            filePath,
            fs.readFileSync(filePath)
        );

        assert.equal(metadata.title, 'Portable Track');
        assert.deepEqual(
            metadata.artistCredits.map(credit => credit.name),
            ['Track Artist', 'Guest Artist']
        );
        assert.equal(metadata.album, 'Portable Album');
        assert.equal(metadata.albumArtist, 'Various Artists');
        assert.equal(metadata.year, '2026-07-21');
        assert.equal(metadata.trackNumber, 3);
        assert.equal(metadata.discNumber, 2);
        assert.equal(metadata.totalDiscs, 3);
        assert.equal(metadata.releaseType, 'ep');
        assert.equal(metadata.recordingVersionTitle, 'Studio Cut');
        assert.equal(metadata.releaseVersionTitle, 'Archive Edition');
        assert.deepEqual(metadata.genres, ['Ambient', 'Electronic']);
        assert.deepEqual(metadata.pictureData, ARTWORK);

        const rescan = await syncMusic({ emit: () => true } as never, true);
        assert.equal(rescan?.reconcile.length, 0);
        await assertRelationalMetadata(initialMusic, true);

        const clearedInput = {
            ...input,
            title: 'Portable Track (Live)',
            recordingVersionTitle: null,
            publishedYear: ''
        };
        const clearedPreview = await previewMusicMetadataUpdate(clearedInput);
        assert.equal(clearedPreview.hasChanges, true);
        const clearedOperation = await updateMusicMetadata(
            clearedInput,
            clearedPreview.token
        );
        assert.equal(clearedOperation.status, 'cleaned');
        const clearedMetadata = await parseTrackMetadata(
            filePath,
            fs.readFileSync(filePath)
        );
        assert.equal(clearedMetadata.title, 'Portable Track (Live)');
        assert.equal(clearedMetadata.year, '');
        assert.equal(clearedMetadata.recordingVersionTitle, null);
        assert.equal(clearedMetadata.releaseVersionTitle, 'Archive Edition');
        assert.deepEqual(clearedMetadata.pictureData, ARTWORK);
        const clearedRescan = await syncMusic({ emit: () => true } as never, true);
        assert.equal(clearedRescan?.reconcile.length, 0);
        await assertRelationalMetadata(initialMusic, true, {
            recordingTitle: 'Portable Track (Live)',
            recordingVersionTitle: null,
            releaseDate: null
        });

        fs.copyFileSync(filePath, copiedFilePath);
        await clearLibrary();
        process.env.OCEAN_WAVE_MUSIC_PATH = freshDirectory;
        const freshImport = await syncMusic({ emit: () => true } as never);
        assert.equal(freshImport?.created.length, 1);
        const freshMusic = await models.music.findFirstOrThrow({
            where: { filePath: 'track.mp3' }
        });
        await assertRelationalMetadata(freshMusic, false, {
            recordingTitle: 'Portable Track (Live)',
            recordingVersionTitle: null,
            releaseDate: null
        });
    } finally {
        await clearLibrary().catch(() => undefined);
        if (originalMusicPath === undefined) {
            delete process.env.OCEAN_WAVE_MUSIC_PATH;
        } else {
            process.env.OCEAN_WAVE_MUSIC_PATH = originalMusicPath;
        }
        if (originalCachePath === undefined) {
            delete process.env.OCEAN_WAVE_CACHE_PATH;
        } else {
            process.env.OCEAN_WAVE_CACHE_PATH = originalCachePath;
        }
        fs.rmSync(directory, { recursive: true, force: true });
        fs.rmSync(freshDirectory, { recursive: true, force: true });
    }
};
