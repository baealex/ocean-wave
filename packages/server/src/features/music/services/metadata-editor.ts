import models from '~/models';
import {
    createCompatibilityAlbumInTransaction,
    updateCompatibilityAlbumInTransaction,
    updateCompatibilityMusicInTransaction
} from '~/models/music-compatibility';
import {
    AudioMetadataWriteError,
    writeTrackMetadataToFile
} from '~/modules/audio-metadata-writer';
import {
    ArtistCreditValidationError,
    findOrCreateArtist,
    formatArtistCredits,
    getEffectiveMusicArtistCredits,
    getReleaseArtistCredits,
    normalizeArtistCredits,
    replaceArtistCredits,
    resolveArtistCreditArtists,
    type ArtistCreditValue,
    type ArtistCreditWithArtist
} from '~/modules/artist-credits';
import { resolveMusicFilePath } from '~/modules/storage-paths';
import type { MusicMetadataOverride } from '~/modules/track-metadata';

export interface UpdateArtistCreditInput {
    name: string;
    role: string;
    creditedName?: string | null;
    joinPhrase?: string | null;
}

export interface UpdateMusicMetadataInput {
    id: string;
    title: string;
    artist?: string | null;
    artistCredits?: UpdateArtistCreditInput[] | null;
    album: string;
    albumArtist?: string | null;
    albumArtistCredits?: UpdateArtistCreditInput[] | null;
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

interface MusicMetadataDependencies {
    writeTrackMetadata: typeof writeTrackMetadataToFile;
}

const defaultDependencies: MusicMetadataDependencies = {
    writeTrackMetadata: writeTrackMetadataToFile
};

const musicMetadataUpdateLocks = new Map<number, Promise<void>>();

const withMusicMetadataUpdateLock = async <T>(
    musicId: number,
    operation: () => Promise<T>
) => {
    const previousUpdate = musicMetadataUpdateLocks.get(musicId) ?? Promise.resolve();
    let releaseUpdate!: () => void;
    const updateGate = new Promise<void>((resolve) => {
        releaseUpdate = resolve;
    });
    const currentUpdate = previousUpdate.then(() => updateGate);

    musicMetadataUpdateLocks.set(musicId, currentUpdate);
    await previousUpdate;

    try {
        return await operation();
    } finally {
        releaseUpdate();

        if (musicMetadataUpdateLocks.get(musicId) === currentUpdate) {
            musicMetadataUpdateLocks.delete(musicId);
        }
    }
};

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

const toArtistCreditValues = (credits: ArtistCreditWithArtist[]): ArtistCreditValue[] => {
    if (!credits.length) return [];

    return normalizeArtistCredits(credits.map(credit => ({
        name: credit.Artist.name,
        role: credit.role,
        creditedName: credit.creditedName,
        joinPhrase: credit.joinPhrase
    })));
};

const legacyArtistMatchesCredits = (
    legacyArtist: string,
    credits: ArtistCreditValue[]
) => {
    const primaryCredit = credits.find(credit => credit.role === 'primary') ?? credits[0];

    return legacyArtist === primaryCredit.name
        || legacyArtist === primaryCredit.creditedName
        || legacyArtist === formatArtistCredits(credits);
};

const resolveTrackArtistCredits = (
    input: UpdateMusicMetadataInput,
    existingCredits: ArtistCreditValue[]
) => {
    if (input.artistCredits !== undefined && input.artistCredits !== null) {
        return normalizeArtistCredits(input.artistCredits, 'Track artist credits');
    }

    const legacyArtist = input.artist?.trim() ?? '';

    if (existingCredits.length && (
        !legacyArtist || legacyArtistMatchesCredits(legacyArtist, existingCredits)
    )) {
        return existingCredits;
    }

    return normalizeArtistCredits(
        [{ name: legacyArtist, role: 'primary' }],
        'Track artist credits'
    );
};

const resolveAlbumArtistCredits = (
    input: UpdateMusicMetadataInput,
    existingCredits: ArtistCreditValue[],
    trackCredits: ArtistCreditValue[]
) => {
    if (input.albumArtistCredits !== undefined && input.albumArtistCredits !== null) {
        return normalizeArtistCredits(input.albumArtistCredits, 'Album artist credits');
    }

    if (input.albumArtist === undefined && existingCredits.length > 1) {
        return existingCredits;
    }

    const legacyAlbumArtist = input.albumArtist?.trim() ?? '';

    if (legacyAlbumArtist && existingCredits.length
        && legacyArtistMatchesCredits(legacyAlbumArtist, existingCredits)) {
        return existingCredits;
    }

    if (legacyAlbumArtist) {
        return normalizeArtistCredits([{
            name: legacyAlbumArtist,
            role: 'primary'
        }], 'Album artist credits');
    }

    return trackCredits.map(credit => ({ ...credit }));
};

const normalizeInput = (
    input: UpdateMusicMetadataInput,
    existingTrackCreditRows: ArtistCreditWithArtist[],
    existingAlbumCreditRows: ArtistCreditWithArtist[]
): MusicMetadataOverride => {
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

    const publishedYear = requireText(input.publishedYear, 'Release year', 4);

    if (!/^\d{4}$/.test(publishedYear)) {
        throw new MusicMetadataServiceError(
            'Release year must use four digits.',
            'INVALID_MUSIC_METADATA'
        );
    }

    let artistCredits: ArtistCreditValue[];
    let albumArtistCredits: ArtistCreditValue[];

    try {
        const existingTrackCredits = toArtistCreditValues(existingTrackCreditRows);
        const existingAlbumCredits = toArtistCreditValues(existingAlbumCreditRows);

        artistCredits = resolveTrackArtistCredits(input, existingTrackCredits);
        albumArtistCredits = resolveAlbumArtistCredits(
            input,
            existingAlbumCredits,
            artistCredits
        );
    } catch (error) {
        if (error instanceof ArtistCreditValidationError) {
            throw new MusicMetadataServiceError(error.message, 'INVALID_MUSIC_METADATA');
        }

        throw error;
    }

    return {
        title: requireText(input.title, 'Title'),
        artist: formatArtistCredits(artistCredits),
        artistCredits,
        album: requireText(input.album, 'Album'),
        albumArtist: formatArtistCredits(albumArtistCredits),
        albumArtistCredits,
        year: publishedYear,
        trackNumber: input.trackNumber,
        genres
    };
};

export const updateMusicMetadata = async (
    input: UpdateMusicMetadataInput,
    dependencies = defaultDependencies
) => {
    const musicId = Number(input.id);

    if (!Number.isInteger(musicId) || musicId < 1) {
        throw new MusicMetadataServiceError('Music not found.', 'MUSIC_NOT_FOUND');
    }

    return withMusicMetadataUpdateLock(musicId, async () => {
        const existingMusic = await models.music.findUnique({ where: { id: musicId } });

        if (!existingMusic) {
            throw new MusicMetadataServiceError('Music not found.', 'MUSIC_NOT_FOUND');
        }

        const [groupedFileCount, recordingAppearanceCount] = await Promise.all([
            models.physicalFile.count({
                where: { releaseTrackId: existingMusic.releaseTrackId }
            }),
            models.releaseTrack.count({
                where: { recordingId: existingMusic.recordingId }
            })
        ]);

        if (groupedFileCount > 1 || recordingAppearanceCount > 1) {
            throw new MusicMetadataServiceError(
                'Separate alternate files and linked release appearances before editing shared metadata.',
                'RELATIONAL_METADATA_EDIT_REQUIRED'
            );
        }

        const [existingTrackCredits, existingAlbumCredits] = await Promise.all([
            getEffectiveMusicArtistCredits(existingMusic),
            getReleaseArtistCredits(existingMusic.albumId)
        ]);
        const metadata = normalizeInput(
            input,
            existingTrackCredits,
            existingAlbumCredits
        );

        let writtenTrack: Awaited<ReturnType<typeof writeTrackMetadataToFile>>;

        try {
            writtenTrack = await dependencies.writeTrackMetadata(
                resolveMusicFilePath(existingMusic.filePath),
                metadata
            );
        } catch (error) {
            if (error instanceof AudioMetadataWriteError) {
                throw new MusicMetadataServiceError(error.message, error.code);
            }

            throw error;
        }

        return models.$transaction(async (transaction) => {
            const trackArtists = await resolveArtistCreditArtists(
                transaction,
                metadata.artistCredits
            );
            const albumArtists = await resolveArtistCreditArtists(
                transaction,
                metadata.albumArtistCredits ?? metadata.artistCredits
            );
            const candidateReleases = await transaction.release.findMany({
                where: { title: metadata.album },
                include: {
                    ArtistCredit: { orderBy: [{ position: 'asc' }, { id: 'asc' }] }
                }
            });
            const existingRelease = candidateReleases
                .sort((left, right) => (
                    Number(right.id === existingMusic.albumId)
                    - Number(left.id === existingMusic.albumId)
                    || left.id - right.id
                ))
                .find((release) => (
                    release.ArtistCredit.length === albumArtists.length
                    && release.ArtistCredit.every((credit, index) => (
                        credit.artistId === albumArtists[index].id
                    ))
                ));
            const primaryAlbumArtist = metadata.albumArtistCredits
                ?.map((credit, index) => ({ credit, artist: albumArtists[index] }))
                .find(({ credit }) => credit.role === 'primary')
                ?.artist
                ?? albumArtists[0];
            const album = existingRelease
                ? await updateCompatibilityAlbumInTransaction(
                    transaction,
                    existingRelease.id,
                    { publishedYear: metadata.year }
                )
                : await createCompatibilityAlbumInTransaction(
                    transaction,
                    {
                        name: metadata.album,
                        cover: '',
                        publishedYear: metadata.year,
                        artistId: primaryAlbumArtist.id
                    }
                );

            await replaceArtistCredits(
                transaction,
                { releaseId: album.id },
                metadata.albumArtistCredits ?? metadata.artistCredits
            );
            const genres = await Promise.all(metadata.genres.map((name) => {
                return transaction.genre.upsert({
                    where: { name },
                    update: {},
                    create: { name }
                });
            }));

            const releaseTrackCreditCount = await transaction.artistCredit.count({
                where: { releaseTrackId: existingMusic.releaseTrackId }
            });
            const primaryTrackArtist = metadata.artistCredits
                .map((credit, index) => ({ credit, artist: trackArtists[index] }))
                .find(({ credit }) => credit.role === 'primary')
                ?.artist
                ?? await findOrCreateArtist(transaction, metadata.artistCredits[0].name);
            const updatedMusic = await updateCompatibilityMusicInTransaction(
                transaction,
                musicId,
                {
                    name: metadata.title,
                    ...(releaseTrackCreditCount ? {} : { artistId: primaryTrackArtist.id }),
                    albumId: album.id,
                    trackNumber: metadata.trackNumber,
                    metadataOverride: null,
                    contentHash: writtenTrack.contentHash,
                    hashVersion: writtenTrack.hashVersion,
                    Genre: { set: genres.map((genre) => ({ id: genre.id })) }
                }
            );

            await replaceArtistCredits(
                transaction,
                releaseTrackCreditCount
                    ? { releaseTrackId: existingMusic.releaseTrackId }
                    : { recordingId: existingMusic.recordingId },
                metadata.artistCredits
            );

            return transaction.music.findUniqueOrThrow({ where: { id: updatedMusic.id } });
        });
    });
};
