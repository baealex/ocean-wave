import type { Prisma } from '@prisma/client';

import models from '~/models';
import {
    serializeMusicMetadataOverride,
    type MusicMetadataOverride
} from '~/modules/track-metadata';

export interface UpdateMusicMetadataInput {
    id: string;
    title: string;
    artist: string;
    album: string;
    albumArtist?: string | null;
    publishedYear: string;
    trackNumber: number;
    genres: string[];
}

export class MusicMetadataServiceError extends Error {
    code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'MusicMetadataServiceError';
        this.code = code;
    }
}

export const isMusicMetadataServiceError = (
    error: unknown
): error is MusicMetadataServiceError => {
    return error instanceof MusicMetadataServiceError;
};

const requireText = (value: string, label: string, maxLength = 255) => {
    const normalized = value.trim();

    if (!normalized) {
        throw new MusicMetadataServiceError(`${label} is required.`, 'INVALID_MUSIC_METADATA');
    }

    if (normalized.length > maxLength) {
        throw new MusicMetadataServiceError(
            `${label} must be ${maxLength} characters or fewer.`,
            'INVALID_MUSIC_METADATA'
        );
    }

    return normalized;
};

const normalizeInput = (input: UpdateMusicMetadataInput): MusicMetadataOverride => {
    if (!Number.isInteger(input.trackNumber) || input.trackNumber < 1 || input.trackNumber > 9999) {
        throw new MusicMetadataServiceError(
            'Track number must be an integer between 1 and 9999.',
            'INVALID_MUSIC_METADATA'
        );
    }

    const genres = [...new Set(input.genres
        .map((genre) => genre.trim())
        .filter(Boolean))];

    if (genres.length > 50 || genres.some((genre) => genre.length > 128)) {
        throw new MusicMetadataServiceError(
            'Use no more than 50 genres, with 128 characters or fewer per genre.',
            'INVALID_MUSIC_METADATA'
        );
    }

    const albumArtist = input.albumArtist?.trim() || null;

    if (albumArtist && albumArtist.length > 255) {
        throw new MusicMetadataServiceError(
            'Album artist must be 255 characters or fewer.',
            'INVALID_MUSIC_METADATA'
        );
    }

    return {
        title: requireText(input.title, 'Title'),
        artist: requireText(input.artist, 'Artist'),
        album: requireText(input.album, 'Album'),
        albumArtist,
        year: requireText(input.publishedYear, 'Release year', 32),
        trackNumber: input.trackNumber,
        genres
    };
};

const findOrCreateArtist = (transaction: Prisma.TransactionClient, name: string) => {
    return transaction.artist.upsert({
        where: { name },
        update: {},
        create: { name }
    });
};

export const updateMusicMetadata = async (input: UpdateMusicMetadataInput) => {
    const musicId = Number(input.id);

    if (!Number.isInteger(musicId) || musicId < 1) {
        throw new MusicMetadataServiceError('Music not found.', 'MUSIC_NOT_FOUND');
    }

    const metadata = normalizeInput(input);

    return models.$transaction(async (transaction) => {
        const existingMusic = await transaction.music.findUnique({ where: { id: musicId } });

        if (!existingMusic) {
            throw new MusicMetadataServiceError('Music not found.', 'MUSIC_NOT_FOUND');
        }

        const artist = await findOrCreateArtist(transaction, metadata.artist);
        const albumArtist = metadata.albumArtist
            ? await findOrCreateArtist(transaction, metadata.albumArtist)
            : artist;
        const existingAlbum = await transaction.album.findFirst({
            where: {
                name: metadata.album,
                artistId: albumArtist.id
            }
        });
        const album = existingAlbum
            ? await transaction.album.update({
                where: { id: existingAlbum.id },
                data: { publishedYear: metadata.year }
            })
            : await transaction.album.create({
                data: {
                    name: metadata.album,
                    cover: '',
                    publishedYear: metadata.year,
                    artistId: albumArtist.id
                }
            });
        const genres = await Promise.all(metadata.genres.map((name) => {
            return transaction.genre.upsert({
                where: { name },
                update: {},
                create: { name }
            });
        }));

        return transaction.music.update({
            where: { id: musicId },
            data: {
                name: metadata.title,
                artistId: artist.id,
                albumId: album.id,
                trackNumber: metadata.trackNumber,
                metadataOverride: serializeMusicMetadataOverride(metadata),
                Genre: { set: genres.map((genre) => ({ id: genre.id })) }
            }
        });
    });
};
