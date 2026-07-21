import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
    OCEAN_WAVE_RELEASE_TYPE_PROPERTY,
    type ReleaseType
} from './release-metadata';
import {
    createTrackContentHashFromFile,
    TRACK_CONTENT_HASH_VERSION
} from './track-hash';
import type { MusicMetadataOverride } from './track-metadata';
import {
    OCEAN_WAVE_RECORDING_VERSION_PROPERTY,
    OCEAN_WAVE_RECORDING_VERSION_STATE_PROPERTY,
    OCEAN_WAVE_RELEASE_VERSION_PROPERTY,
    OCEAN_WAVE_RELEASE_VERSION_STATE_PROPERTY,
    OCEAN_WAVE_VERSION_STATE_NONE,
    OCEAN_WAVE_VERSION_STATE_VALUE
} from './track-version';

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
    '.mp3',
    '.aac',
    '.wav',
    '.ogg',
    '.flac'
]);

const STAGING_MARKER = 'ocean-wave.stage';
const BACKUP_MARKER = 'ocean-wave.backup';
const OPERATION_FILE_MARKERS = [STAGING_MARKER, BACKUP_MARKER];

type PropertyMap = Record<string, string[] | undefined>;

type TagLibModule = typeof import('taglib-wasm');
type TagLibInstance = Awaited<ReturnType<TagLibModule['TagLib']['initialize']>>;

const loadTagLibModule = new Function(
    'return import("taglib-wasm")'
) as () => Promise<TagLibModule>;

interface NormalizedWritableTrackMetadata extends MusicMetadataOverride {
    releaseType: ReleaseType;
    discNumber: number | null;
    totalDiscs: number | null;
    recordingVersionTitle: string | null;
    releaseVersionTitle: string | null;
}

export type WritableTrackMetadata = MusicMetadataOverride;

export interface AudioTagEditor {
    write(data: Buffer, metadata: NormalizedWritableTrackMetadata): Promise<Buffer>;
    read(data: Buffer): Promise<PropertyMap>;
}

export type AudioTagEditorLoader = () => Promise<AudioTagEditor>;

let tagLibPromise: Promise<TagLibInstance> | null = null;

const getTagLib = async () => {
    if (!tagLibPromise) {
        tagLibPromise = loadTagLibModule()
            .then(({ TagLib }) => TagLib.initialize());
    }

    return tagLibPromise;
};

const withAudioFile = async <T>(
    data: Buffer,
    callback: (file: Awaited<ReturnType<TagLibInstance['open']>>) => Promise<T> | T
) => {
    const tagLib = await getTagLib();
    const file = await tagLib.open(data);

    try {
        return await callback(file);
    } finally {
        file.dispose();
    }
};

const toPropertyMap = (metadata: NormalizedWritableTrackMetadata): PropertyMap => ({
    title: [metadata.title],
    artist: metadata.artistCredits.map(credit => credit.name),
    album: [metadata.album],
    albumArtist: metadata.albumArtistCredits?.map(credit => credit.name) ?? [],
    date: metadata.year ? [metadata.year] : [],
    trackNumber: metadata.trackNumber === null ? [] : [metadata.trackNumber.toString()],
    genre: metadata.genres,
    discNumber: metadata.discNumber === null ? [] : [metadata.discNumber.toString()],
    totalDiscs: metadata.totalDiscs === null ? [] : [metadata.totalDiscs.toString()],
    subtitle: [
        metadata.recordingVersionTitle,
        metadata.releaseVersionTitle
    ].filter((value): value is string => Boolean(value)),
    [OCEAN_WAVE_RECORDING_VERSION_PROPERTY]: metadata.recordingVersionTitle
        ? [metadata.recordingVersionTitle]
        : [],
    [OCEAN_WAVE_RELEASE_VERSION_PROPERTY]: metadata.releaseVersionTitle
        ? [metadata.releaseVersionTitle]
        : [],
    [OCEAN_WAVE_RECORDING_VERSION_STATE_PROPERTY]: [
        metadata.recordingVersionTitle
            ? OCEAN_WAVE_VERSION_STATE_VALUE
            : OCEAN_WAVE_VERSION_STATE_NONE
    ],
    [OCEAN_WAVE_RELEASE_VERSION_STATE_PROPERTY]: [
        metadata.releaseVersionTitle
            ? OCEAN_WAVE_VERSION_STATE_VALUE
            : OCEAN_WAVE_VERSION_STATE_NONE
    ],
    compilation: [metadata.releaseType === 'compilation' ? '1' : '0'],
    [OCEAN_WAVE_RELEASE_TYPE_PROPERTY]: [metadata.releaseType]
});

const pictureFingerprints = (pictures: Array<{
    mimeType: string;
    data: Uint8Array;
    type: string;
    description?: string;
}>) => pictures.map(picture => ({
    mimeType: picture.mimeType,
    type: picture.type,
    description: picture.description ?? '',
    dataHash: createHash('sha256').update(picture.data).digest('hex')
}));

const defaultTagEditorLoader: AudioTagEditorLoader = async () => ({
    write: (data, metadata) => withAudioFile(data, async (file) => {
        const artworkBefore = pictureFingerprints(file.getPictures());
        file.setProperties({
            ...file.properties(),
            ...toPropertyMap(metadata)
        });

        if (!file.save()) {
            throw new Error('TagLib could not save the updated metadata.');
        }

        const rewritten = Buffer.from(file.getFileBuffer());
        const artworkAfter = await withAudioFile(
            rewritten,
            rewrittenFile => pictureFingerprints(rewrittenFile.getPictures())
        );

        if (JSON.stringify(artworkAfter) !== JSON.stringify(artworkBefore)) {
            throw new AudioMetadataWriteError(
                'Embedded artwork changed while writing metadata.',
                'AUDIO_METADATA_ARTWORK_CHANGED'
            );
        }

        return rewritten;
    }),
    read: data => withAudioFile(data, file => file.properties())
});

export interface PreparedTrackMetadataFile {
    filePath: string;
    stagingPath: string;
    backupPath: string;
    oldContentHash: string;
    newContentHash: string;
    hashVersion: number;
    oldFileSizeBytes: bigint;
    newFileSizeBytes: bigint;
}

export interface WrittenTrackMetadata {
    contentHash: string;
    hashVersion: number;
}

export class AudioMetadataWriteError extends Error {
    code: string;

    constructor(message: string, code: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'AudioMetadataWriteError';
        this.code = code;
    }
}

const sameStringSet = (left: string[], right: string[]) => {
    return [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0');
};

const sameStringList = (left: string[], right: string[]) => {
    return left.join('\0') === right.join('\0');
};

const propertyValues = (properties: PropertyMap, key: string) => {
    const direct = properties[key];

    if (direct) return direct;

    const normalizedKey = key.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, '');
    const matchingEntry = Object.entries(properties).find(([candidate]) => (
        candidate.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, '')
            === normalizedKey
    ));

    return matchingEntry?.[1] ?? [];
};

const verifyWrittenMetadata = (
    expected: NormalizedWritableTrackMetadata,
    actual: PropertyMap
) => {
    const expectedSubtitles = [
        expected.recordingVersionTitle,
        expected.releaseVersionTitle
    ].filter((value): value is string => Boolean(value));
    const matches = propertyValues(actual, 'title')[0] === expected.title
        && sameStringList(
            propertyValues(actual, 'artist'),
            expected.artistCredits.map(credit => credit.name)
        )
        && propertyValues(actual, 'album')[0] === expected.album
        && sameStringList(
            propertyValues(actual, 'albumArtist'),
            expected.albumArtistCredits?.map(credit => credit.name) ?? []
        )
        && (propertyValues(actual, 'date')[0] ?? '') === expected.year
        && propertyValues(actual, 'trackNumber')[0] === (
            expected.trackNumber?.toString()
        )
        && sameStringSet(propertyValues(actual, 'genre'), expected.genres)
        && propertyValues(actual, 'discNumber')[0] === expected.discNumber?.toString()
        && propertyValues(actual, 'totalDiscs')[0] === expected.totalDiscs?.toString()
        && sameStringList(propertyValues(actual, 'subtitle'), expectedSubtitles)
        && (propertyValues(actual, OCEAN_WAVE_RECORDING_VERSION_PROPERTY)[0] || null)
            === expected.recordingVersionTitle
        && (propertyValues(actual, OCEAN_WAVE_RELEASE_VERSION_PROPERTY)[0] || null)
            === expected.releaseVersionTitle
        && propertyValues(actual, OCEAN_WAVE_RECORDING_VERSION_STATE_PROPERTY)[0]
            === (expected.recordingVersionTitle
                ? OCEAN_WAVE_VERSION_STATE_VALUE
                : OCEAN_WAVE_VERSION_STATE_NONE)
        && propertyValues(actual, OCEAN_WAVE_RELEASE_VERSION_STATE_PROPERTY)[0]
            === (expected.releaseVersionTitle
                ? OCEAN_WAVE_VERSION_STATE_VALUE
                : OCEAN_WAVE_VERSION_STATE_NONE)
        && propertyValues(actual, OCEAN_WAVE_RELEASE_TYPE_PROPERTY)[0]
            === expected.releaseType;

    if (!matches) {
        throw new AudioMetadataWriteError(
            'The audio file did not retain all metadata changes.',
            'AUDIO_METADATA_VERIFICATION_FAILED'
        );
    }
};

const pathExists = async (filePath: string) => {
    try {
        await fs.promises.lstat(filePath);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
};

const removeFile = async (filePath: string) => {
    try {
        await fs.promises.rm(filePath, { force: true });
    } catch {
        // Recovery keeps the operation journal until cleanup can be retried.
    }
};

export const fsyncDirectory = async (directoryPath: string) => {
    const directory = await fs.promises.open(directoryPath, 'r');

    try {
        await directory.sync();
    } finally {
        await directory.close();
    }
};

const fsyncFile = async (filePath: string) => {
    const file = await fs.promises.open(filePath, 'r');

    try {
        await file.sync();
    } finally {
        await file.close();
    }
};

const requireWritableAudioFile = async (filePath: string) => {
    const extension = path.extname(filePath).toLowerCase();

    if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
        throw new AudioMetadataWriteError(
            `Metadata writing is not supported for ${extension || 'this file type'}.`,
            'UNSUPPORTED_AUDIO_FORMAT'
        );
    }

    try {
        const realFilePath = await fs.promises.realpath(filePath);
        await fs.promises.access(realFilePath, fs.constants.R_OK | fs.constants.W_OK);
        const fileStat = await fs.promises.stat(realFilePath);

        if (!fileStat.isFile()) {
            throw new AudioMetadataWriteError(
                'The audio path does not point to a regular file.',
                'MUSIC_FILE_NOT_WRITABLE'
            );
        }

        return { realFilePath, fileStat, extension };
    } catch (error) {
        if (error instanceof AudioMetadataWriteError) throw error;

        const code = (error as NodeJS.ErrnoException).code;

        throw new AudioMetadataWriteError(
            code === 'ENOENT'
                ? 'The audio file could not be found.'
                : 'The audio file is not writable.',
            code === 'ENOENT' ? 'MUSIC_FILE_NOT_FOUND' : 'MUSIC_FILE_NOT_WRITABLE',
            { cause: error }
        );
    }
};

const operationFilePath = ({
    filePath,
    extension,
    operationId,
    marker
}: {
    filePath: string;
    extension: string;
    operationId: string;
    marker: string;
}) => path.join(
    path.dirname(filePath),
    `.${path.basename(filePath, extension)}.${operationId}.${marker}`
);

export const isTrackMetadataOperationFilePath = (filePath: string) => {
    const fileName = path.basename(filePath);
    return OPERATION_FILE_MARKERS.some(marker => fileName.includes(`.${marker}`));
};

export const createTrackMetadataOperationPaths = (
    filePath: string,
    operationId: string
) => {
    const extension = path.extname(filePath).toLowerCase();

    return {
        stagingPath: operationFilePath({
            filePath,
            extension,
            operationId,
            marker: STAGING_MARKER
        }),
        backupPath: operationFilePath({
            filePath,
            extension,
            operationId,
            marker: BACKUP_MARKER
        })
    };
};

export const inspectTrackMetadataFile = async (filePath: string) => {
    const { realFilePath, fileStat } = await requireWritableAudioFile(filePath);

    return {
        filePath: realFilePath,
        contentHash: await createTrackContentHashFromFile(realFilePath),
        fileSizeBytes: BigInt(fileStat.size)
    };
};

export const prepareTrackMetadataFile = async (
    filePath: string,
    metadata: WritableTrackMetadata,
    operationId: string,
    loadTagEditor: AudioTagEditorLoader = defaultTagEditorLoader,
    expectedContentHash?: string
): Promise<PreparedTrackMetadataFile> => {
    const normalizedMetadata: NormalizedWritableTrackMetadata = {
        ...metadata,
        releaseType: metadata.releaseType ?? 'unknown',
        discNumber: metadata.discNumber ?? null,
        totalDiscs: metadata.totalDiscs ?? null,
        recordingVersionTitle: metadata.recordingVersionTitle ?? null,
        releaseVersionTitle: metadata.releaseVersionTitle ?? null
    };
    const {
        realFilePath,
        fileStat
    } = await requireWritableAudioFile(filePath);
    const { stagingPath, backupPath } = createTrackMetadataOperationPaths(
        realFilePath,
        operationId
    );

    if (await pathExists(stagingPath) || await pathExists(backupPath)) {
        throw new AudioMetadataWriteError(
            'A previous metadata operation still owns recovery files for this track.',
            'AUDIO_METADATA_RECOVERY_REQUIRED'
        );
    }

    try {
        const oldContentHash = await createTrackContentHashFromFile(realFilePath);

        if (expectedContentHash && oldContentHash !== expectedContentHash) {
            throw new AudioMetadataWriteError(
                'The audio file changed after metadata preview.',
                'AUDIO_METADATA_SOURCE_CHANGED'
            );
        }

        await fs.promises.copyFile(realFilePath, stagingPath, fs.constants.COPYFILE_EXCL);
        await fs.promises.chmod(stagingPath, fileStat.mode & 0o777);

        try {
            await fs.promises.chown(stagingPath, fileStat.uid, fileStat.gid);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
        }

        if (await createTrackContentHashFromFile(stagingPath) !== oldContentHash) {
            throw new AudioMetadataWriteError(
                'The staged audio copy did not match the original file.',
                'AUDIO_METADATA_STAGE_VERIFICATION_FAILED'
            );
        }

        const tagEditor = await loadTagEditor();
        const rewritten = await tagEditor.write(
            await fs.promises.readFile(stagingPath),
            normalizedMetadata
        );
        await fs.promises.writeFile(stagingPath, rewritten);
        verifyWrittenMetadata(normalizedMetadata, await tagEditor.read(rewritten));
        await fsyncFile(stagingPath);
        await fsyncDirectory(path.dirname(stagingPath));

        const newContentHash = await createTrackContentHashFromFile(stagingPath);
        const newStat = await fs.promises.stat(stagingPath);

        return {
            filePath: realFilePath,
            stagingPath,
            backupPath,
            oldContentHash,
            newContentHash,
            hashVersion: TRACK_CONTENT_HASH_VERSION,
            oldFileSizeBytes: BigInt(fileStat.size),
            newFileSizeBytes: BigInt(newStat.size)
        };
    } catch (error) {
        await removeFile(stagingPath);
        await fsyncDirectory(path.dirname(stagingPath)).catch(() => undefined);

        if (await pathExists(stagingPath)) {
            throw new AudioMetadataWriteError(
                'The staged metadata file could not be removed and must be recovered.',
                'AUDIO_METADATA_RECOVERY_REQUIRED',
                { cause: error }
            );
        }

        if (error instanceof AudioMetadataWriteError) throw error;

        throw new AudioMetadataWriteError(
            'The audio file metadata could not be prepared.',
            'AUDIO_METADATA_WRITE_FAILED',
            { cause: error }
        );
    }
};

export const installPreparedTrackMetadata = async (
    prepared: PreparedTrackMetadataFile
) => {
    try {
        if (await createTrackContentHashFromFile(prepared.filePath) !== prepared.oldContentHash) {
            throw new AudioMetadataWriteError(
                'The audio file changed after metadata preview.',
                'AUDIO_METADATA_SOURCE_CHANGED'
            );
        }

        if (await pathExists(prepared.backupPath)) {
            throw new AudioMetadataWriteError(
                'A metadata backup already exists and must be reconciled.',
                'AUDIO_METADATA_RECOVERY_REQUIRED'
            );
        }

        await fs.promises.rename(prepared.filePath, prepared.backupPath);
        await fsyncDirectory(path.dirname(prepared.filePath));
        await fs.promises.rename(prepared.stagingPath, prepared.filePath);
        await fsyncFile(prepared.filePath);
        await fsyncDirectory(path.dirname(prepared.filePath));

        if (await createTrackContentHashFromFile(prepared.filePath) !== prepared.newContentHash) {
            throw new AudioMetadataWriteError(
                'The installed audio file did not match the verified staged copy.',
                'AUDIO_METADATA_INSTALL_VERIFICATION_FAILED'
            );
        }
    } catch (error) {
        if (error instanceof AudioMetadataWriteError) throw error;

        throw new AudioMetadataWriteError(
            'The prepared audio metadata could not be installed.',
            'AUDIO_METADATA_REPLACEMENT_FAILED',
            { cause: error }
        );
    }
};

const contentHashIfFile = async (filePath: string) => {
    if (!await pathExists(filePath)) return null;

    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? createTrackContentHashFromFile(filePath) : null;
};

export const restorePreparedTrackMetadata = async (
    prepared: PreparedTrackMetadataFile
) => {
    const currentHash = await contentHashIfFile(prepared.filePath);
    const backupHash = await contentHashIfFile(prepared.backupPath);

    if (currentHash === prepared.oldContentHash) {
        return;
    }

    if (backupHash !== prepared.oldContentHash) {
        throw new AudioMetadataWriteError(
            'The original audio backup could not be verified.',
            'AUDIO_METADATA_RESTORE_FAILED'
        );
    }

    try {
        if (currentHash !== null) {
            if (currentHash !== prepared.newContentHash) {
                throw new AudioMetadataWriteError(
                    'The installed audio file changed during recovery.',
                    'AUDIO_METADATA_RESTORE_FAILED'
                );
            }

            if (!await pathExists(prepared.stagingPath)) {
                await fs.promises.rename(prepared.filePath, prepared.stagingPath);
            } else {
                await fs.promises.rm(prepared.filePath, { force: true });
            }
        }

        await fs.promises.rename(prepared.backupPath, prepared.filePath);
        await fsyncFile(prepared.filePath);
        await fsyncDirectory(path.dirname(prepared.filePath));

        if (await createTrackContentHashFromFile(prepared.filePath) !== prepared.oldContentHash) {
            throw new AudioMetadataWriteError(
                'The restored audio file did not match the original hash.',
                'AUDIO_METADATA_RESTORE_FAILED'
            );
        }
    } catch (error) {
        if (error instanceof AudioMetadataWriteError) throw error;

        throw new AudioMetadataWriteError(
            'The original audio file could not be restored.',
            'AUDIO_METADATA_RESTORE_FAILED',
            { cause: error }
        );
    }
};

export const discardPreparedTrackMetadata = async (
    prepared: Pick<PreparedTrackMetadataFile, 'stagingPath' | 'backupPath' | 'filePath'>
) => {
    await removeFile(prepared.stagingPath);

    if (await pathExists(prepared.stagingPath)) {
        throw new AudioMetadataWriteError(
            'The staged metadata file could not be removed.',
            'AUDIO_METADATA_CLEANUP_FAILED'
        );
    }

    if (await pathExists(prepared.backupPath)) {
        throw new AudioMetadataWriteError(
            'The original audio backup must be restored before cleanup.',
            'AUDIO_METADATA_RECOVERY_REQUIRED'
        );
    }

    await fsyncDirectory(path.dirname(prepared.filePath));
};

export const validatePreparedTrackMetadataCleanup = async (
    prepared: PreparedTrackMetadataFile
) => {
    if (await contentHashIfFile(prepared.filePath) !== prepared.newContentHash) {
        throw new AudioMetadataWriteError(
            'The committed audio file changed before backup cleanup.',
            'AUDIO_METADATA_CLEANUP_BLOCKED'
        );
    }

    const backupHash = await contentHashIfFile(prepared.backupPath);
    const stagingExists = await pathExists(prepared.stagingPath);

    if (backupHash === null && !stagingExists) {
        return;
    }

    if (backupHash !== prepared.oldContentHash) {
        throw new AudioMetadataWriteError(
            'The original audio backup could not be verified before cleanup.',
            'AUDIO_METADATA_RECOVERY_EVIDENCE_INVALID'
        );
    }
};

export const cleanupPreparedTrackMetadata = async (
    prepared: PreparedTrackMetadataFile
) => {
    await validatePreparedTrackMetadataCleanup(prepared);

    await removeFile(prepared.backupPath);
    await removeFile(prepared.stagingPath);

    if (await pathExists(prepared.backupPath) || await pathExists(prepared.stagingPath)) {
        throw new AudioMetadataWriteError(
            'Metadata recovery files could not be removed.',
            'AUDIO_METADATA_CLEANUP_FAILED'
        );
    }

    await fsyncDirectory(path.dirname(prepared.filePath));
};

export const writeTrackMetadataToFile = async (
    filePath: string,
    metadata: WritableTrackMetadata,
    loadTagEditor: AudioTagEditorLoader = defaultTagEditorLoader
): Promise<WrittenTrackMetadata> => {
    const prepared = await prepareTrackMetadataFile(
        filePath,
        metadata,
        randomUUID(),
        loadTagEditor
    );

    try {
        await installPreparedTrackMetadata(prepared);
        await cleanupPreparedTrackMetadata(prepared);
    } catch (error) {
        try {
            await restorePreparedTrackMetadata(prepared);
            await discardPreparedTrackMetadata(prepared);
        } catch (restoreError) {
            throw restoreError;
        }

        throw error;
    }

    return {
        contentHash: prepared.newContentHash,
        hashVersion: prepared.hashVersion
    };
};
