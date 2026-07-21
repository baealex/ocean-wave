import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import type { MusicMetadataOverride } from './track-metadata';
import {
    TRACK_CONTENT_HASH_VERSION,
    createTrackContentHashFromFile
} from './track-hash';

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
    '.mp3',
    '.aac',
    '.wav',
    '.ogg',
    '.flac'
]);

type TagLibSimpleModule = typeof import('taglib-wasm/simple');

export type AudioTagLibraryLoader = () => Promise<Pick<
    TagLibSimpleModule,
    'applyTags' | 'applyTagsToFile' | 'readTags'
>>;

const loadTagLib = new Function(
    'return import("taglib-wasm/simple")'
) as AudioTagLibraryLoader;

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

const stringList = (value: string | string[] | undefined) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
};

const firstString = (value: string | string[] | undefined) => {
    return Array.isArray(value) ? value[0] : value;
};

const verifyWrittenMetadata = (
    expected: MusicMetadataOverride,
    actual: Awaited<ReturnType<TagLibSimpleModule['readTags']>>
) => {
    const actualYear = firstString(actual.date) ?? actual.year?.toString();
    const matches = firstString(actual.title) === expected.title
        && sameStringList(
            stringList(actual.artist),
            expected.artistCredits.map(credit => credit.name)
        )
        && firstString(actual.album) === expected.album
        && sameStringList(
            stringList(actual.albumArtist),
            expected.albumArtistCredits?.map(credit => credit.name) ?? []
        )
        && actualYear === expected.year
        && actual.track === expected.trackNumber
        && sameStringSet(actual.genre ?? [], expected.genres);

    if (!matches) {
        throw new AudioMetadataWriteError(
            'The audio file did not retain all metadata changes.',
            'AUDIO_METADATA_VERIFICATION_FAILED'
        );
    }
};

const removeTemporaryFile = async (filePath: string) => {
    try {
        await fs.promises.rm(filePath, { force: true });
    } catch {
        // The original audio file is still intact, so cleanup can be retried later.
    }
};

export const writeTrackMetadataToFile = async (
    filePath: string,
    metadata: MusicMetadataOverride,
    loadTagLibrary: AudioTagLibraryLoader = loadTagLib
): Promise<WrittenTrackMetadata> => {
    const extension = path.extname(filePath).toLowerCase();

    if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
        throw new AudioMetadataWriteError(
            `Metadata writing is not supported for ${extension || 'this file type'}.`,
            'UNSUPPORTED_AUDIO_FORMAT'
        );
    }

    let realFilePath: string;
    let fileStat: fs.Stats;

    try {
        realFilePath = await fs.promises.realpath(filePath);
        await fs.promises.access(realFilePath, fs.constants.R_OK | fs.constants.W_OK);
        fileStat = await fs.promises.stat(realFilePath);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;

        throw new AudioMetadataWriteError(
            code === 'ENOENT'
                ? 'The audio file could not be found.'
                : 'The audio file is not writable.',
            code === 'ENOENT' ? 'MUSIC_FILE_NOT_FOUND' : 'MUSIC_FILE_NOT_WRITABLE',
            { cause: error }
        );
    }

    if (!fileStat.isFile()) {
        throw new AudioMetadataWriteError(
            'The audio path does not point to a regular file.',
            'MUSIC_FILE_NOT_WRITABLE'
        );
    }

    const temporaryFilePath = path.join(
        path.dirname(realFilePath),
        `.${path.basename(realFilePath, extension)}.${randomUUID()}.project441.tmp${extension}`
    );
    let contentHash: string;

    try {
        const tagLib = await loadTagLibrary();
        await fs.promises.copyFile(
            realFilePath,
            temporaryFilePath,
            fs.constants.COPYFILE_EXCL
        );
        await fs.promises.chmod(temporaryFilePath, fileStat.mode & 0o777);

        try {
            await fs.promises.chown(temporaryFilePath, fileStat.uid, fileStat.gid);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
                throw error;
            }
        }

        const tags = {
            title: metadata.title,
            artist: metadata.artistCredits.map(credit => credit.name),
            album: metadata.album,
            albumArtist: metadata.albumArtistCredits?.map(credit => credit.name) ?? [],
            date: metadata.year,
            track: metadata.trackNumber,
            genre: metadata.genres
        };

        // TagLib's path-backed WASI adapter cannot currently seek through raw AAC
        // reliably, while its in-memory API handles the same files correctly.
        if (extension === '.aac') {
            const taggedFile = await tagLib.applyTags(
                await fs.promises.readFile(temporaryFilePath),
                tags
            );
            await fs.promises.writeFile(temporaryFilePath, taggedFile);
        } else {
            await tagLib.applyTagsToFile(temporaryFilePath, tags);
        }

        verifyWrittenMetadata(metadata, await tagLib.readTags(temporaryFilePath));

        const temporaryFile = await fs.promises.open(temporaryFilePath, 'r');

        try {
            await temporaryFile.sync();
        } finally {
            await temporaryFile.close();
        }

        contentHash = await createTrackContentHashFromFile(temporaryFilePath);
        await fs.promises.rename(temporaryFilePath, realFilePath);
    } catch (error) {
        await removeTemporaryFile(temporaryFilePath);

        if (error instanceof AudioMetadataWriteError) {
            throw error;
        }

        throw new AudioMetadataWriteError(
            'The audio file metadata could not be updated.',
            'AUDIO_METADATA_WRITE_FAILED',
            { cause: error }
        );
    }

    return {
        contentHash,
        hashVersion: TRACK_CONTENT_HASH_VERSION
    };
};
