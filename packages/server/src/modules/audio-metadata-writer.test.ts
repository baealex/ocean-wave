import fs from 'fs';
import os from 'os';
import path from 'path';

import { createTrackContentHash } from './track-hash';
import {
    AudioMetadataWriteError,
    writeTrackMetadataToFile,
    type AudioTagLibraryLoader
} from './audio-metadata-writer';

const createSilentWav = () => {
    const channelCount = 1;
    const sampleRate = 8_000;
    const bitsPerSample = 16;
    const sampleCount = 800;
    const blockAlign = channelCount * (bitsPerSample / 8);
    const dataSize = sampleCount * blockAlign;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channelCount, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * blockAlign, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
};

describe('audio metadata writer', () => {
    const tempDirectories: string[] = [];

    afterEach(() => {
        while (tempDirectories.length > 0) {
            fs.rmSync(tempDirectories.pop()!, { recursive: true, force: true });
        }
    });

    it('writes portable tags and atomically replaces the audio file', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project441-metadata-writer-'));
        const filePath = path.join(directory, 'track.wav');
        tempDirectories.push(directory);
        fs.writeFileSync(filePath, createSilentWav());

        const writtenTags: Record<string, unknown> = {};
        const tagLibrary: AudioTagLibraryLoader = async () => ({
            applyTags: async () => {
                throw new Error('unexpected buffer write');
            },
            applyTagsToFile: async (targetFilePath, tags) => {
                Object.assign(writtenTags, tags);
                fs.appendFileSync(targetFilePath, 'updated');
            },
            readTags: async () => ({
                title: [writtenTags.title as string],
                artist: [writtenTags.artist as string],
                album: [writtenTags.album as string],
                albumArtist: [writtenTags.albumArtist as string],
                date: writtenTags.date as string,
                year: Number(writtenTags.date),
                track: writtenTags.track as number,
                genre: writtenTags.genre as string[],
                comment: []
            })
        });
        const result = await writeTrackMetadataToFile(filePath, {
            title: 'Portable Track',
            artist: 'Track Artist',
            album: 'Portable Album',
            albumArtist: 'Album Artist',
            year: '2026',
            trackNumber: 3,
            genres: ['Ambient', 'Electronic']
        }, tagLibrary);
        const writtenData = fs.readFileSync(filePath);

        expect(result.contentHash).toBe(createTrackContentHash(writtenData));
        expect(writtenData).not.toEqual(createSilentWav());
        expect(fs.readdirSync(directory).filter((name) => name.includes('.project441.tmp')))
            .toEqual([]);
    });

    it('uses the in-memory TagLib API for raw AAC files', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project441-metadata-aac-'));
        const filePath = path.join(directory, 'track.aac');
        const originalData = Buffer.from('raw AAC fixture');
        tempDirectories.push(directory);
        fs.writeFileSync(filePath, originalData);

        const applyTags = jest.fn(async (_data, tags) => {
            return Buffer.concat([originalData, Buffer.from(JSON.stringify(tags))]);
        });
        const result = await writeTrackMetadataToFile(filePath, {
            title: 'AAC Track',
            artist: 'Track Artist',
            album: 'Portable Album',
            albumArtist: null,
            year: '2026',
            trackNumber: 2,
            genres: ['Ambient']
        }, async () => ({
            applyTags,
            applyTagsToFile: async () => {
                throw new Error('unexpected path-backed write');
            },
            readTags: async () => ({
                title: ['AAC Track'],
                artist: ['Track Artist'],
                album: ['Portable Album'],
                albumArtist: [],
                date: '2026',
                year: 2026,
                track: 2,
                genre: ['Ambient'],
                comment: []
            })
        }));
        const writtenData = fs.readFileSync(filePath);

        expect(applyTags).toHaveBeenCalledTimes(1);
        expect(writtenData).not.toEqual(originalData);
        expect(result.contentHash).toBe(createTrackContentHash(writtenData));
    });

    it('leaves the original file untouched when tag writing fails', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project441-metadata-invalid-'));
        const filePath = path.join(directory, 'invalid.mp3');
        const originalData = Buffer.from('not an audio file');
        tempDirectories.push(directory);
        fs.writeFileSync(filePath, originalData);

        await expect(writeTrackMetadataToFile(filePath, {
            title: 'Track',
            artist: 'Artist',
            album: 'Album',
            albumArtist: null,
            year: '2026',
            trackNumber: 1,
            genres: []
        }, async () => ({
            applyTags: async () => {
                throw new Error('invalid audio');
            },
            applyTagsToFile: async () => {
                throw new Error('invalid audio');
            },
            readTags: async () => {
                throw new Error('invalid audio');
            }
        }))).rejects.toEqual(expect.objectContaining<Partial<AudioMetadataWriteError>>({
            code: 'AUDIO_METADATA_WRITE_FAILED'
        }));
        expect(fs.readFileSync(filePath)).toEqual(originalData);
        expect(fs.readdirSync(directory).filter((name) => name.includes('.project441.tmp')))
            .toEqual([]);
    });
});
