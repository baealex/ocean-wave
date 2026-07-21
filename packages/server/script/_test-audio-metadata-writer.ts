import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { writeTrackMetadataToFile } from '../src/modules/audio-metadata-writer';
import { parseTrackMetadata } from '../src/modules/track-metadata';

const createSilentWav = () => {
    const sampleRate = 8_000;
    const sampleCount = 800;
    const dataSize = sampleCount * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
};

export const testAudioMetadataWriter = async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project441-tag-integration-'));
    const filePath = path.join(directory, 'track.wav');
    const copiedFilePath = path.join(directory, 'new-server-library', 'track.wav');

    try {
        fs.writeFileSync(filePath, createSilentWav());
        await writeTrackMetadataToFile(filePath, {
            title: 'Portable Track',
            artist: 'Track Artist feat. Guest Artist',
            artistCredits: [
                {
                    name: 'Track Artist',
                    role: 'primary',
                    creditedName: null,
                    joinPhrase: ' feat. '
                },
                {
                    name: 'Guest Artist',
                    role: 'featured',
                    creditedName: null,
                    joinPhrase: ''
                }
            ],
            album: 'Portable Album',
            albumArtist: 'Various Artists',
            albumArtistCredits: [{
                name: 'Various Artists',
                role: 'primary',
                creditedName: null,
                joinPhrase: ''
            }],
            year: '2026',
            trackNumber: 3,
            genres: ['Ambient', 'Electronic']
        });
        fs.mkdirSync(path.dirname(copiedFilePath), { recursive: true });
        fs.copyFileSync(filePath, copiedFilePath);

        const metadata = await parseTrackMetadata(
            copiedFilePath,
            fs.readFileSync(copiedFilePath)
        );

        assert.equal(metadata.title, 'Portable Track');
        assert.deepEqual(
            metadata.artistCredits.map(credit => credit.name),
            ['Track Artist', 'Guest Artist']
        );
        assert.equal(metadata.album, 'Portable Album');
        assert.equal(metadata.albumArtist, 'Various Artists');
        assert.equal(metadata.year, '2026');
        assert.equal(metadata.trackNumber, 3);
        assert.deepEqual(metadata.genres, ['Ambient', 'Electronic']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
};
