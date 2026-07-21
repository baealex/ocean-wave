import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    AudioMetadataWriteError,
    type AudioTagEditorLoader,
    cleanupPreparedTrackMetadata,
    installPreparedTrackMetadata,
    isTrackMetadataOperationFilePath,
    prepareTrackMetadataFile,
    restorePreparedTrackMetadata,
    type WritableTrackMetadata,
    writeTrackMetadataToFile
} from './audio-metadata-writer';
import { createTrackContentHash } from './track-hash';
import {
    OCEAN_WAVE_RECORDING_VERSION_PROPERTY,
    OCEAN_WAVE_RECORDING_VERSION_STATE_PROPERTY,
    OCEAN_WAVE_RELEASE_VERSION_PROPERTY,
    OCEAN_WAVE_RELEASE_VERSION_STATE_PROPERTY,
    OCEAN_WAVE_VERSION_STATE_NONE,
    OCEAN_WAVE_VERSION_STATE_VALUE
} from './track-version';

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

const metadata = (overrides: Partial<WritableTrackMetadata> = {}): WritableTrackMetadata => ({
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
    albumArtist: 'Album Artist',
    albumArtistCredits: [{
        name: 'Album Artist',
        role: 'primary',
        creditedName: null,
        joinPhrase: ''
    }],
    year: '2026-07-21',
    trackNumber: 3,
    genres: ['Ambient', 'Electronic'],
    releaseType: 'ep',
    discNumber: 2,
    totalDiscs: 3,
    recordingVersionTitle: 'Live',
    releaseVersionTitle: '2026 Remaster',
    ...overrides
});

const propertyMap = (value: WritableTrackMetadata) => ({
    title: [value.title],
    artist: value.artistCredits.map(credit => credit.name),
    album: [value.album],
    albumArtist: value.albumArtistCredits?.map(credit => credit.name) ?? [],
    date: value.year ? [value.year] : [],
    trackNumber: value.trackNumber === null ? [] : [value.trackNumber.toString()],
    genre: value.genres,
    discNumber: value.discNumber ? [value.discNumber.toString()] : [],
    totalDiscs: value.totalDiscs ? [value.totalDiscs.toString()] : [],
    subtitle: [value.recordingVersionTitle, value.releaseVersionTitle]
        .filter((entry): entry is string => Boolean(entry)),
    [OCEAN_WAVE_RECORDING_VERSION_PROPERTY]: value.recordingVersionTitle
        ? [value.recordingVersionTitle]
        : [''],
    [OCEAN_WAVE_RELEASE_VERSION_PROPERTY]: value.releaseVersionTitle
        ? [value.releaseVersionTitle]
        : [''],
    [OCEAN_WAVE_RECORDING_VERSION_STATE_PROPERTY]: [
        value.recordingVersionTitle
            ? OCEAN_WAVE_VERSION_STATE_VALUE
            : OCEAN_WAVE_VERSION_STATE_NONE
    ],
    [OCEAN_WAVE_RELEASE_VERSION_STATE_PROPERTY]: [
        value.releaseVersionTitle
            ? OCEAN_WAVE_VERSION_STATE_VALUE
            : OCEAN_WAVE_VERSION_STATE_NONE
    ],
    OCEANWAVE_RELEASE_TYPE: [value.releaseType ?? 'unknown']
});

const createTagEditor = ({ fail = false } = {}): AudioTagEditorLoader => {
    let properties: Record<string, string[]> = {};

    return async () => ({
        write: async (data, value) => {
            if (fail) throw new Error('invalid audio');
            properties = propertyMap(value);
            return Buffer.concat([data, Buffer.from('updated')]);
        },
        read: async () => properties
    });
};

describe('audio metadata writer', () => {
    const tempDirectories: string[] = [];

    afterEach(() => {
        while (tempDirectories.length > 0) {
            fs.rmSync(tempDirectories.pop()!, { recursive: true, force: true });
        }
    });

    const createFile = (name = 'track.wav') => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-metadata-writer-'));
        const filePath = path.join(directory, name);
        tempDirectories.push(directory);
        fs.writeFileSync(filePath, createSilentWav());
        return { directory, filePath };
    };

    it('stages, installs, and cleans a verified replacement without touching the original early', async () => {
        const { directory, filePath } = createFile();
        const originalData = fs.readFileSync(filePath);
        const prepared = await prepareTrackMetadataFile(
            filePath,
            metadata(),
            'operation-1',
            createTagEditor()
        );

        expect(fs.readFileSync(filePath)).toEqual(originalData);
        expect(fs.existsSync(prepared.stagingPath)).toBe(true);
        expect(prepared.stagingPath.endsWith('.ocean-wave.stage')).toBe(true);
        expect(prepared.backupPath.endsWith('.ocean-wave.backup')).toBe(true);
        expect(path.extname(prepared.stagingPath)).not.toBe('.wav');
        expect(prepared.oldContentHash).toBe(createTrackContentHash(originalData));

        await installPreparedTrackMetadata(prepared);

        expect(fs.existsSync(prepared.backupPath)).toBe(true);
        expect(createTrackContentHash(fs.readFileSync(filePath))).toBe(prepared.newContentHash);

        await cleanupPreparedTrackMetadata(prepared);

        expect(fs.existsSync(prepared.backupPath)).toBe(false);
        expect(fs.readdirSync(directory).filter(name => name.includes('ocean-wave.')))
            .toEqual([]);
    });

    it('restores the exact original after a prepared file was installed', async () => {
        const { filePath } = createFile();
        const originalData = fs.readFileSync(filePath);
        const prepared = await prepareTrackMetadataFile(
            filePath,
            metadata(),
            'operation-restore',
            createTagEditor()
        );

        await installPreparedTrackMetadata(prepared);
        await restorePreparedTrackMetadata(prepared);

        expect(fs.readFileSync(filePath)).toEqual(originalData);
        expect(createTrackContentHash(fs.readFileSync(filePath)))
            .toBe(prepared.oldContentHash);
    });

    it('writes relational tag fields through the buffer adapter contract', async () => {
        const { directory, filePath } = createFile();
        const result = await writeTrackMetadataToFile(
            filePath,
            metadata(),
            createTagEditor()
        );

        expect(result.contentHash).toBe(createTrackContentHash(fs.readFileSync(filePath)));
        expect(fs.readdirSync(directory).filter(name => name.includes('ocean-wave.')))
            .toEqual([]);
    });

    it('allows an optional release date to be cleared', async () => {
        const { filePath } = createFile();

        await expect(writeTrackMetadataToFile(
            filePath,
            metadata({ year: '' }),
            createTagEditor()
        )).resolves.toEqual(expect.objectContaining({
            contentHash: expect.any(String)
        }));
    });

    it('accepts empty format values when version scopes are explicitly cleared', async () => {
        const { filePath } = createFile();

        await expect(writeTrackMetadataToFile(
            filePath,
            metadata({
                recordingVersionTitle: null,
                releaseVersionTitle: null
            }),
            createTagEditor()
        )).resolves.toEqual(expect.objectContaining({
            contentHash: expect.any(String)
        }));
    });

    it('reserves current and legacy journal paths from library scans', () => {
        expect(isTrackMetadataOperationFilePath(
            '/music/.track.operation.ocean-wave.stage'
        )).toBe(true);
        expect(isTrackMetadataOperationFilePath(
            '/music/.track.operation.ocean-wave.backup.wav'
        )).toBe(true);
        expect(isTrackMetadataOperationFilePath('/music/ocean-wave.stage-session.wav'))
            .toBe(false);
    });

    it('leaves the original untouched when staged tag writing fails', async () => {
        const { directory, filePath } = createFile('invalid.mp3');
        const originalData = fs.readFileSync(filePath);

        await expect(prepareTrackMetadataFile(
            filePath,
            metadata(),
            'operation-invalid',
            createTagEditor({ fail: true })
        )).rejects.toEqual(expect.objectContaining<Partial<AudioMetadataWriteError>>({
            code: 'AUDIO_METADATA_WRITE_FAILED'
        }));
        expect(fs.readFileSync(filePath)).toEqual(originalData);
        expect(fs.readdirSync(directory).filter(name => name.includes('ocean-wave.')))
            .toEqual([]);
    });

    it('rejects installation if the source changed after preparation', async () => {
        const { filePath } = createFile();
        const prepared = await prepareTrackMetadataFile(
            filePath,
            metadata(),
            'operation-stale',
            createTagEditor()
        );
        fs.appendFileSync(filePath, 'external change');

        await expect(installPreparedTrackMetadata(prepared)).rejects.toMatchObject({
            code: 'AUDIO_METADATA_SOURCE_CHANGED'
        });
    });

    it('rejects preparation if the source changed after preview', async () => {
        const { directory, filePath } = createFile();
        const expectedContentHash = createTrackContentHash(fs.readFileSync(filePath));
        fs.appendFileSync(filePath, 'external change');

        await expect(prepareTrackMetadataFile(
            filePath,
            metadata(),
            'operation-preview-stale',
            createTagEditor(),
            expectedContentHash
        )).rejects.toMatchObject({
            code: 'AUDIO_METADATA_SOURCE_CHANGED'
        });
        expect(fs.readdirSync(directory).filter(name => name.includes('ocean-wave.')))
            .toEqual([]);
    });

    it('keeps backup evidence when the installed file changes before rollback', async () => {
        const { filePath } = createFile();
        const prepared = await prepareTrackMetadataFile(
            filePath,
            metadata(),
            'operation-external-change',
            createTagEditor()
        );
        await installPreparedTrackMetadata(prepared);
        fs.appendFileSync(filePath, 'external change');
        const changedData = fs.readFileSync(filePath);

        await expect(restorePreparedTrackMetadata(prepared)).rejects.toMatchObject({
            code: 'AUDIO_METADATA_RESTORE_FAILED'
        });
        expect(fs.readFileSync(filePath)).toEqual(changedData);
        expect(fs.existsSync(prepared.backupPath)).toBe(true);
    });
});
