import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';

import models from '~/models';
import {
    ArtistCreditValidationError,
    type ArtistCreditValue,
    formatArtistCredits,
    normalizeArtistCredits,
    replaceArtistCredits
} from '~/modules/artist-credits';
import {
    AudioMetadataWriteError,
    cleanupPreparedTrackMetadata,
    createTrackMetadataOperationPaths,
    discardPreparedTrackMetadata,
    installPreparedTrackMetadata,
    type PreparedTrackMetadataFile,
    prepareTrackMetadataFile,
    restorePreparedTrackMetadata,
    validatePreparedTrackMetadataCleanup,
    type WritableTrackMetadata
} from '~/modules/audio-metadata-writer';
import {
    normalizeReleaseType,
    type ReleaseType
} from '~/modules/release-metadata';
import { withLibraryMetadataLock } from '~/modules/library-metadata-lock';
import { resolveMusicFilePath } from '~/modules/storage-paths';
import {
    createTrackContentHash,
    TRACK_CONTENT_HASH_VERSION
} from '~/modules/track-hash';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import {
    createTrackTagSnapshot,
    type ParsedTrackMetadata,
    parseTrackMetadata
} from '~/modules/track-metadata';
import {
    configureMetadataOperationDurability,
    recoverMusicMetadataOperationJournal
} from './metadata-operation-recovery';

export interface UpdateArtistCreditInput {
    name: string;
    role: string;
    creditedName?: string | null;
    joinPhrase?: string | null;
}

export interface UpdateMusicMetadataInput {
    id: string;
    title: string;
    titleOverride?: string | null;
    recordingVersionTitle?: string | null;
    artist?: string | null;
    artistCredits?: UpdateArtistCreditInput[] | null;
    recordingArtistCredits?: UpdateArtistCreditInput[] | null;
    releaseTrackArtistCredits?: UpdateArtistCreditInput[] | null;
    album: string;
    albumArtist?: string | null;
    albumArtistCredits?: UpdateArtistCreditInput[] | null;
    publishedYear: string;
    releaseType?: string | null;
    totalDiscs?: number | null;
    releaseVersionTitle?: string | null;
    discNumber?: number | null;
    trackNumber?: number | null;
    genres: string[];
}

export type MusicMetadataStorage = 'FILE_AND_DATABASE' | 'DATABASE_ONLY';
export type MusicMetadataOwner = 'RECORDING' | 'RELEASE' | 'RELEASE_TRACK';

export interface MusicMetadataChange {
    field: string;
    label: string;
    before: string;
    after: string;
    owner: MusicMetadataOwner;
    storage: MusicMetadataStorage;
}

export interface MusicMetadataFilePreview {
    fileId: string;
    stableId: string;
    filePath: string;
    syncStatus: string;
    willWrite: boolean;
    changes: MusicMetadataChange[];
}

export interface MusicMetadataPreviewIssue {
    code: string;
    message: string;
    blocking: boolean;
    fileId: string | null;
}

export interface MusicMetadataPreview {
    token: string;
    hasChanges: boolean;
    changes: MusicMetadataChange[];
    files: MusicMetadataFilePreview[];
    issues: MusicMetadataPreviewIssue[];
    preservedPolicies: string[];
}

export interface MusicMetadataOperationTargetResult {
    fileId: string;
    filePath: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
}

export interface MusicMetadataOperationResult {
    operationId: string;
    status: string;
    retryable: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    music: Awaited<ReturnType<typeof findMusicResult>> | null;
    targets: MusicMetadataOperationTargetResult[];
}

export class MusicMetadataServiceError extends Error {
    code: string;

    constructor(message: string, code: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'MusicMetadataServiceError';
        this.code = code;
    }
}

export const isMusicMetadataServiceError = (
    error: unknown
): error is MusicMetadataServiceError => error instanceof MusicMetadataServiceError;

const relationalTrackInclude = {
    ArtistCredit: {
        include: { Artist: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }]
    },
    PhysicalFile: { orderBy: { id: 'asc' } },
    Recording: {
        include: {
            ArtistCredit: {
                include: { Artist: true },
                orderBy: [{ position: 'asc' }, { id: 'asc' }]
            },
            RecordingGenre: {
                include: { Genre: true },
                orderBy: { genreId: 'asc' }
            }
        }
    },
    Release: {
        include: {
            ArtistCredit: {
                include: { Artist: true },
                orderBy: [{ position: 'asc' }, { id: 'asc' }]
            },
            ReleaseTrack: {
                select: { id: true, discNumber: true }
            }
        }
    }
} satisfies Prisma.ReleaseTrackInclude;

type RelationalTrack = Prisma.ReleaseTrackGetPayload<{
    include: typeof relationalTrackInclude;
}>;
type CreditRow = RelationalTrack['Recording']['ArtistCredit'][number];
type PhysicalFileRow = RelationalTrack['PhysicalFile'][number];

interface NormalizedMetadataInput {
    musicId: number;
    recordingTitle: string;
    titleOverride: string | null;
    recordingVersionTitle: string | null;
    recordingArtistCredits: ArtistCreditValue[];
    releaseTrackArtistCredits: ArtistCreditValue[] | null;
    releaseTitle: string;
    releaseArtistCredits: ArtistCreditValue[];
    releaseDate: string;
    releaseType: ReleaseType;
    totalDiscs: number | null;
    releaseVersionTitle: string | null;
    discNumber: number | null;
    trackNumber: number | null;
    genres: string[];
}

interface OwnerChangeSet {
    recording: boolean;
    recordingFile: boolean;
    release: boolean;
    releaseFile: boolean;
    releaseTrack: boolean;
    releaseTrackFile: boolean;
}

interface ExpectedOwnerRevision {
    stableId: string;
    revision: number;
}

interface ExpectedFileRevision extends ExpectedOwnerRevision {
    filePath: string;
    syncStatus: string;
    contentHash: string | null;
}

interface ExpectedRevisions {
    recordings: ExpectedOwnerRevision[];
    releases: ExpectedOwnerRevision[];
    releaseTracks: ExpectedOwnerRevision[];
    files: ExpectedFileRevision[];
}

interface PlannedFile {
    row: PhysicalFileRow;
    track: RelationalTrack;
    absolutePath: string;
    before: ParsedTrackMetadata | null;
    after: WritableTrackMetadata;
    oldContentHash: string | null;
    oldFileSizeBytes: bigint | null;
    newTagSnapshotJson: string | null;
    willWrite: boolean;
    markStale: boolean;
    changes: MusicMetadataChange[];
}

interface MetadataPlan {
    selected: RelationalTrack;
    normalized: NormalizedMetadataInput;
    ownerChanges: OwnerChangeSet;
    expected: ExpectedRevisions;
    oldRelational: Record<string, unknown>;
    files: PlannedFile[];
    changes: MusicMetadataChange[];
    issues: MusicMetadataPreviewIssue[];
    token: string;
    hasChanges: boolean;
}

interface MetadataEditorDependencies {
    prepareFile: typeof prepareTrackMetadataFile;
    installFile: typeof installPreparedTrackMetadata;
    restoreFile: typeof restorePreparedTrackMetadata;
    discardFile: typeof discardPreparedTrackMetadata;
    validateCleanupFile: typeof validatePreparedTrackMetadataCleanup;
    cleanupFile: typeof cleanupPreparedTrackMetadata;
}

const defaultDependencies: MetadataEditorDependencies = {
    prepareFile: prepareTrackMetadataFile,
    installFile: installPreparedTrackMetadata,
    restoreFile: restorePreparedTrackMetadata,
    discardFile: discardPreparedTrackMetadata,
    validateCleanupFile: validatePreparedTrackMetadataCleanup,
    cleanupFile: cleanupPreparedTrackMetadata
};

const ACTIVE_OPERATION_STATUSES = [
    'preparing',
    'prepared',
    'replacing',
    'replaced',
    'committed',
    'reconcile-required'
];

const PRESERVED_POLICIES = [
    'Embedded artwork and the existing artwork cache policy are not changed.',
    'Recording links, alternate-file grouping, and preferred playback files remain database-only and unchanged.',
    'Credit roles, credited names, and join phrases remain database-only; file tags store ordered participant names.'
];

const requireText = (value: string, label: string, maxLength = 255) => {
    const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');

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

const optionalText = (value: string | null | undefined, label: string) => {
    if (value === null || value === undefined || !value.trim()) return null;
    return requireText(value, label);
};

const normalizePosition = (
    value: number | null,
    label: string
) => {
    if (value === null) return null;

    if (!Number.isInteger(value) || value < 1 || value > 9999) {
        throw new MusicMetadataServiceError(
            `${label} must be an integer between 1 and 9999, or left blank.`,
            'INVALID_MUSIC_METADATA'
        );
    }

    return value;
};

const normalizeReleaseDate = (value: string) => {
    const normalized = value.trim();

    if (!normalized) return '';

    if (!/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(normalized)) {
        throw new MusicMetadataServiceError(
            'Release date must use YYYY, YYYY-MM, or YYYY-MM-DD.',
            'INVALID_MUSIC_METADATA'
        );
    }

    if (normalized.length === 10) {
        const [year, month, day] = normalized.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));

        if (
            date.getUTCFullYear() !== year
            || date.getUTCMonth() !== month - 1
            || date.getUTCDate() !== day
        ) {
            throw new MusicMetadataServiceError(
                'Release date must be a real calendar date.',
                'INVALID_MUSIC_METADATA'
            );
        }
    }

    return normalized;
};

const toCreditValues = (credits: CreditRow[]): ArtistCreditValue[] => credits.map(credit => ({
    name: credit.Artist.name,
    role: credit.role as ArtistCreditValue['role'],
    creditedName: credit.creditedName,
    joinPhrase: credit.joinPhrase
}));

const normalizeCredits = (
    credits: UpdateArtistCreditInput[],
    label: string
) => {
    try {
        return normalizeArtistCredits(credits, label);
    } catch (error) {
        if (error instanceof ArtistCreditValidationError) {
            throw new MusicMetadataServiceError(error.message, 'INVALID_MUSIC_METADATA');
        }

        throw error;
    }
};

const scalarCredit = (name: string | null | undefined, label: string) => {
    return normalizeCredits([{
        name: name?.trim() ?? '',
        role: 'primary'
    }], label);
};

const creditsEqual = (
    left: ArtistCreditValue[] | null,
    right: ArtistCreditValue[] | null
) => JSON.stringify(left) === JSON.stringify(right);

const creditNamesEqual = (
    left: ArtistCreditValue[] | null,
    right: ArtistCreditValue[] | null
) => JSON.stringify(left?.map(credit => credit.name) ?? null)
    === JSON.stringify(right?.map(credit => credit.name) ?? null);

const sameStringSet = (left: string[], right: string[]) => (
    [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0')
);

const normalizeInput = (
    input: UpdateMusicMetadataInput,
    selected: RelationalTrack
): NormalizedMetadataInput => {
    const existingRecordingCredits = toCreditValues(selected.Recording.ArtistCredit);
    const existingReleaseTrackCredits = selected.ArtistCredit.length
        ? toCreditValues(selected.ArtistCredit)
        : null;
    const existingReleaseCredits = toCreditValues(selected.Release.ArtistCredit);
    let recordingArtistCredits = existingRecordingCredits;
    let releaseTrackArtistCredits = existingReleaseTrackCredits;

    if (input.recordingArtistCredits !== undefined && input.recordingArtistCredits !== null) {
        recordingArtistCredits = normalizeCredits(
            input.recordingArtistCredits,
            'Recording artist credits'
        );
    } else if (!existingReleaseTrackCredits) {
        if (input.artistCredits !== undefined && input.artistCredits !== null) {
            recordingArtistCredits = normalizeCredits(input.artistCredits, 'Track artist credits');
        } else if (input.artist?.trim()) {
            const currentDisplay = formatArtistCredits(existingRecordingCredits);

            if (input.artist.trim() !== currentDisplay) {
                recordingArtistCredits = scalarCredit(input.artist, 'Track artist credits');
            }
        }
    }

    if (input.releaseTrackArtistCredits !== undefined) {
        releaseTrackArtistCredits = input.releaseTrackArtistCredits === null
            ? null
            : normalizeCredits(
                input.releaseTrackArtistCredits,
                'Release appearance artist credits'
            );
    } else if (existingReleaseTrackCredits) {
        if (input.artistCredits !== undefined && input.artistCredits !== null) {
            releaseTrackArtistCredits = normalizeCredits(input.artistCredits, 'Track artist credits');
        } else if (input.artist?.trim()) {
            const currentDisplay = formatArtistCredits(existingReleaseTrackCredits);

            if (input.artist.trim() !== currentDisplay) {
                releaseTrackArtistCredits = scalarCredit(input.artist, 'Track artist credits');
            }
        }
    }

    let releaseArtistCredits = existingReleaseCredits;

    if (input.albumArtistCredits !== undefined && input.albumArtistCredits !== null) {
        releaseArtistCredits = normalizeCredits(
            input.albumArtistCredits,
            'Release artist credits'
        );
    } else if (input.albumArtist?.trim()) {
        const currentDisplay = formatArtistCredits(existingReleaseCredits);

        if (input.albumArtist.trim() !== currentDisplay) {
            releaseArtistCredits = scalarCredit(input.albumArtist, 'Release artist credits');
        }
    }

    const genres = [...new Set(input.genres
        .map(genre => genre.normalize('NFKC').trim().replace(/\s+/g, ' '))
        .filter(Boolean))];

    if (genres.length > 50 || genres.some(genre => genre.length > 128)) {
        throw new MusicMetadataServiceError(
            'Use no more than 50 genres, with 128 characters or fewer per genre.',
            'INVALID_MUSIC_METADATA'
        );
    }

    const discNumber = input.discNumber === undefined
        ? selected.discNumber
        : normalizePosition(input.discNumber, 'Disc number');
    const totalDiscs = input.totalDiscs === undefined
        ? selected.Release.totalDiscs
        : normalizePosition(input.totalDiscs, 'Total discs');
    const highestOtherDisc = Math.max(
        0,
        ...selected.Release.ReleaseTrack
            .filter(track => track.id !== selected.id)
            .map(track => track.discNumber ?? 0)
    );

    if (totalDiscs !== null && Math.max(discNumber ?? 0, highestOtherDisc) > totalDiscs) {
        throw new MusicMetadataServiceError(
            'Total discs cannot be lower than an existing disc number.',
            'INVALID_MUSIC_METADATA'
        );
    }

    return {
        musicId: selected.id,
        recordingTitle: requireText(input.title, 'Recording title'),
        titleOverride: input.titleOverride === undefined
            ? selected.titleOverride
            : optionalText(input.titleOverride, 'Release appearance title'),
        recordingVersionTitle: input.recordingVersionTitle === undefined
            ? selected.Recording.versionTitle
            : optionalText(input.recordingVersionTitle, 'Recording version'),
        recordingArtistCredits,
        releaseTrackArtistCredits,
        releaseTitle: requireText(input.album, 'Release title'),
        releaseArtistCredits,
        releaseDate: normalizeReleaseDate(input.publishedYear),
        releaseType: input.releaseType === undefined || input.releaseType === null
            ? normalizeReleaseType({ values: selected.Release.releaseType })
            : normalizeReleaseType({ values: input.releaseType }),
        totalDiscs,
        releaseVersionTitle: input.releaseVersionTitle === undefined
            ? selected.versionTitle
            : optionalText(input.releaseVersionTitle, 'Release version'),
        discNumber,
        trackNumber: input.trackNumber === undefined
            ? selected.trackNumber
            : normalizePosition(input.trackNumber, 'Track number'),
        genres
    };
};

const change = ({
    field,
    label,
    before,
    after,
    owner,
    storage = 'FILE_AND_DATABASE'
}: {
    field: string;
    label: string;
    before: unknown;
    after: unknown;
    owner: MusicMetadataOwner;
    storage?: MusicMetadataStorage;
}): MusicMetadataChange => ({
    field,
    label,
    before: before === null || before === undefined ? 'Not set' : String(before),
    after: after === null || after === undefined ? 'Not set' : String(after),
    owner,
    storage
});

const creditNames = (credits: ArtistCreditValue[] | null) => (
    credits?.map(credit => credit.name).join(' · ') ?? 'Inherit recording credits'
);

const creditPresentation = (credits: ArtistCreditValue[] | null) => (
    credits
        ? credits.map(credit => [
            `${credit.name} (${credit.role})`,
            credit.creditedName ? `credited as “${credit.creditedName}”` : null,
            credit.joinPhrase ? `joins with ${JSON.stringify(credit.joinPhrase)}` : null
        ].filter(Boolean).join(', ')).join(' · ')
        : 'Inherit recording credits'
);

const createOwnerChanges = (
    selected: RelationalTrack,
    normalized: NormalizedMetadataInput
) => {
    const oldRecordingCredits = toCreditValues(selected.Recording.ArtistCredit);
    const oldTrackCredits = selected.ArtistCredit.length
        ? toCreditValues(selected.ArtistCredit)
        : null;
    const oldReleaseCredits = toCreditValues(selected.Release.ArtistCredit);
    const oldEffectiveTrackCredits = oldTrackCredits ?? oldRecordingCredits;
    const newEffectiveTrackCredits = normalized.releaseTrackArtistCredits
        ?? normalized.recordingArtistCredits;
    const oldGenres = selected.Recording.RecordingGenre.map(({ Genre }) => Genre.name);
    const changes: MusicMetadataChange[] = [];

    if (selected.Recording.title !== normalized.recordingTitle) {
        changes.push(change({
            field: 'recording.title',
            label: 'Recording title',
            before: selected.Recording.title,
            after: normalized.recordingTitle,
            owner: 'RECORDING'
        }));
    }

    if (selected.Recording.versionTitle !== normalized.recordingVersionTitle) {
        changes.push(change({
            field: 'recording.versionTitle',
            label: 'Recording version',
            before: selected.Recording.versionTitle,
            after: normalized.recordingVersionTitle,
            owner: 'RECORDING'
        }));
    }

    if (!creditNamesEqual(oldRecordingCredits, normalized.recordingArtistCredits)) {
        changes.push(change({
            field: 'recording.artistNames',
            label: 'Recording artists',
            before: creditNames(oldRecordingCredits),
            after: creditNames(normalized.recordingArtistCredits),
            owner: 'RECORDING'
        }));
    }

    if (!creditsEqual(oldRecordingCredits, normalized.recordingArtistCredits)) {
        changes.push(change({
            field: 'recording.artistPresentation',
            label: 'Recording credit details',
            before: creditPresentation(oldRecordingCredits),
            after: creditPresentation(normalized.recordingArtistCredits),
            owner: 'RECORDING',
            storage: 'DATABASE_ONLY'
        }));
    }

    if (!sameStringSet(oldGenres, normalized.genres)) {
        changes.push(change({
            field: 'recording.genres',
            label: 'Genres',
            before: oldGenres.join(', ') || 'Not set',
            after: normalized.genres.join(', ') || 'Not set',
            owner: 'RECORDING'
        }));
    }

    if (selected.Release.title !== normalized.releaseTitle) {
        changes.push(change({
            field: 'release.title',
            label: 'Release title',
            before: selected.Release.title,
            after: normalized.releaseTitle,
            owner: 'RELEASE'
        }));
    }

    if ((selected.Release.releaseDate ?? '') !== normalized.releaseDate) {
        changes.push(change({
            field: 'release.date',
            label: 'Release date',
            before: selected.Release.releaseDate,
            after: normalized.releaseDate || null,
            owner: 'RELEASE'
        }));
    }

    if (selected.Release.releaseType !== normalized.releaseType) {
        changes.push(change({
            field: 'release.type',
            label: 'Release type',
            before: selected.Release.releaseType,
            after: normalized.releaseType,
            owner: 'RELEASE'
        }));
    }

    if (selected.Release.totalDiscs !== normalized.totalDiscs) {
        changes.push(change({
            field: 'release.totalDiscs',
            label: 'Total discs',
            before: selected.Release.totalDiscs,
            after: normalized.totalDiscs,
            owner: 'RELEASE'
        }));
    }

    if (!creditNamesEqual(oldReleaseCredits, normalized.releaseArtistCredits)) {
        changes.push(change({
            field: 'release.artistNames',
            label: 'Release artists',
            before: creditNames(oldReleaseCredits),
            after: creditNames(normalized.releaseArtistCredits),
            owner: 'RELEASE'
        }));
    }

    if (!creditsEqual(oldReleaseCredits, normalized.releaseArtistCredits)) {
        changes.push(change({
            field: 'release.artistPresentation',
            label: 'Release credit details',
            before: creditPresentation(oldReleaseCredits),
            after: creditPresentation(normalized.releaseArtistCredits),
            owner: 'RELEASE',
            storage: 'DATABASE_ONLY'
        }));
    }

    if (selected.titleOverride !== normalized.titleOverride) {
        changes.push(change({
            field: 'releaseTrack.titleOverride',
            label: 'Release appearance title',
            before: selected.titleOverride,
            after: normalized.titleOverride,
            owner: 'RELEASE_TRACK'
        }));
    }

    if (selected.versionTitle !== normalized.releaseVersionTitle) {
        changes.push(change({
            field: 'releaseTrack.versionTitle',
            label: 'Release version',
            before: selected.versionTitle,
            after: normalized.releaseVersionTitle,
            owner: 'RELEASE_TRACK'
        }));
    }

    if (selected.discNumber !== normalized.discNumber) {
        changes.push(change({
            field: 'releaseTrack.discNumber',
            label: 'Disc number',
            before: selected.discNumber,
            after: normalized.discNumber,
            owner: 'RELEASE_TRACK'
        }));
    }

    if (selected.trackNumber !== normalized.trackNumber) {
        changes.push(change({
            field: 'releaseTrack.trackNumber',
            label: 'Track number',
            before: selected.trackNumber,
            after: normalized.trackNumber,
            owner: 'RELEASE_TRACK'
        }));
    }

    if (!creditNamesEqual(oldEffectiveTrackCredits, newEffectiveTrackCredits)) {
        changes.push(change({
            field: 'releaseTrack.artistNames',
            label: 'Appearance artists',
            before: creditNames(oldEffectiveTrackCredits),
            after: creditNames(newEffectiveTrackCredits),
            owner: 'RELEASE_TRACK'
        }));
    }

    if (!creditsEqual(oldTrackCredits, normalized.releaseTrackArtistCredits)) {
        changes.push(change({
            field: 'releaseTrack.artistPresentation',
            label: 'Appearance credit details',
            before: creditPresentation(oldTrackCredits),
            after: creditPresentation(normalized.releaseTrackArtistCredits),
            owner: 'RELEASE_TRACK',
            storage: 'DATABASE_ONLY'
        }));
    }

    const recordingChanges = changes.filter(entry => entry.owner === 'RECORDING');
    const releaseChanges = changes.filter(entry => entry.owner === 'RELEASE');
    const trackChanges = changes.filter(entry => entry.owner === 'RELEASE_TRACK');

    return {
        changes,
        ownerChanges: {
            recording: recordingChanges.length > 0,
            recordingFile: recordingChanges.some(entry => entry.storage === 'FILE_AND_DATABASE'),
            release: releaseChanges.length > 0,
            releaseFile: releaseChanges.some(entry => entry.storage === 'FILE_AND_DATABASE'),
            releaseTrack: trackChanges.length > 0,
            releaseTrackFile: trackChanges.some(entry => entry.storage === 'FILE_AND_DATABASE')
        } satisfies OwnerChangeSet
    };
};

const proposedTrackMetadata = (
    track: RelationalTrack,
    selected: RelationalTrack,
    normalized: NormalizedMetadataInput
): WritableTrackMetadata => {
    const ownsRecording = track.recordingId === selected.recordingId;
    const ownsRelease = track.releaseId === selected.releaseId;
    const isSelectedTrack = track.id === selected.id;
    const recordingCredits = ownsRecording
        ? normalized.recordingArtistCredits
        : toCreditValues(track.Recording.ArtistCredit);
    const releaseTrackCredits = isSelectedTrack
        ? normalized.releaseTrackArtistCredits
        : track.ArtistCredit.length
            ? toCreditValues(track.ArtistCredit)
            : null;
    const effectiveTrackCredits = releaseTrackCredits ?? recordingCredits;
    const releaseCredits = ownsRelease
        ? normalized.releaseArtistCredits
        : toCreditValues(track.Release.ArtistCredit);
    const recordingTitle = ownsRecording
        ? normalized.recordingTitle
        : track.Recording.title;
    const titleOverride = isSelectedTrack
        ? normalized.titleOverride
        : track.titleOverride;

    return {
        title: titleOverride ?? recordingTitle,
        artist: formatArtistCredits(effectiveTrackCredits),
        artistCredits: effectiveTrackCredits,
        album: ownsRelease ? normalized.releaseTitle : track.Release.title,
        albumArtist: formatArtistCredits(releaseCredits),
        albumArtistCredits: releaseCredits,
        year: ownsRelease
            ? normalized.releaseDate
            : track.Release.releaseDate ?? '',
        releaseType: ownsRelease
            ? normalized.releaseType
            : normalizeReleaseType({ values: track.Release.releaseType }),
        totalDiscs: ownsRelease
            ? normalized.totalDiscs
            : track.Release.totalDiscs,
        recordingVersionTitle: ownsRecording
            ? normalized.recordingVersionTitle
            : track.Recording.versionTitle,
        releaseVersionTitle: isSelectedTrack
            ? normalized.releaseVersionTitle
            : track.versionTitle,
        discNumber: isSelectedTrack ? normalized.discNumber : track.discNumber,
        trackNumber: isSelectedTrack ? normalized.trackNumber : track.trackNumber,
        genres: ownsRecording
            ? normalized.genres
            : track.Recording.RecordingGenre.map(({ Genre }) => Genre.name)
    };
};

const parsedFileChanges = (
    before: ParsedTrackMetadata,
    after: WritableTrackMetadata,
    owners: {
        title: MusicMetadataOwner;
        artists: MusicMetadataOwner;
    }
) => {
    const definitions: Array<{
        field: string;
        label: string;
        before: unknown;
        after: unknown;
        owner: MusicMetadataOwner;
    }> = [
        {
            field: 'file.title',
            label: 'Title tag',
            before: before.title,
            after: after.title,
            owner: owners.title
        },
        {
            field: 'file.artists',
            label: 'Artist tags',
            before: before.artistCredits.map(credit => credit.name).join(' · '),
            after: after.artistCredits.map(credit => credit.name).join(' · '),
            owner: owners.artists
        },
        {
            field: 'file.album',
            label: 'Release tag',
            before: before.album,
            after: after.album,
            owner: 'RELEASE'
        },
        {
            field: 'file.albumArtists',
            label: 'Release artist tags',
            before: before.albumArtistCredits?.map(credit => credit.name).join(' · ') ?? '',
            after: after.albumArtistCredits?.map(credit => credit.name).join(' · ') ?? '',
            owner: 'RELEASE'
        },
        {
            field: 'file.releaseDate',
            label: 'Release date tag',
            before: before.year,
            after: after.year,
            owner: 'RELEASE'
        },
        {
            field: 'file.releaseType',
            label: 'Release type tag',
            before: before.releaseType,
            after: after.releaseType,
            owner: 'RELEASE'
        },
        {
            field: 'file.totalDiscs',
            label: 'Total discs tag',
            before: before.totalDiscs,
            after: after.totalDiscs,
            owner: 'RELEASE'
        },
        {
            field: 'file.recordingVersion',
            label: 'Recording version tag',
            before: before.recordingVersionTitle,
            after: after.recordingVersionTitle,
            owner: 'RECORDING'
        },
        {
            field: 'file.releaseVersion',
            label: 'Release version tag',
            before: before.releaseVersionTitle,
            after: after.releaseVersionTitle,
            owner: 'RELEASE_TRACK'
        },
        {
            field: 'file.discNumber',
            label: 'Disc number tag',
            before: before.discNumber,
            after: after.discNumber,
            owner: 'RELEASE_TRACK'
        },
        {
            field: 'file.trackNumber',
            label: 'Track number tag',
            before: before.trackNumber,
            after: after.trackNumber,
            owner: 'RELEASE_TRACK'
        },
        {
            field: 'file.genres',
            label: 'Genre tags',
            before: [...before.genres].sort().join(', '),
            after: [...after.genres].sort().join(', '),
            owner: 'RECORDING'
        }
    ];

    return definitions
        .filter(definition => String(definition.before ?? '') !== String(definition.after ?? ''))
        .map(definition => change(definition));
};

const uniqueExpected = <T extends ExpectedOwnerRevision>(values: T[]) => (
    [...new Map(values.map(value => [value.stableId, value])).values()]
        .sort((left, right) => left.stableId.localeCompare(right.stableId))
);

const serializeForToken = (value: unknown) => JSON.stringify(value, (_key, entry) => (
    typeof entry === 'bigint' ? entry.toString() : entry
));

const buildPlanToken = (value: unknown) => createHash('sha256')
    .update(serializeForToken(value))
    .digest('hex');

const readPlannedFile = async (
    row: PhysicalFileRow,
    track: RelationalTrack,
    after: WritableTrackMetadata,
    owners: {
        title: MusicMetadataOwner;
        artists: MusicMetadataOwner;
    },
    markStale: boolean
): Promise<{ file: PlannedFile; issue: MusicMetadataPreviewIssue | null }> => {
    const absolutePath = resolveMusicFilePath(row.filePath);

    if (row.metadataSyncStatus === 'reconcile-required') {
        return {
            file: {
                row,
                track,
                absolutePath,
                before: null,
                after,
                oldContentHash: row.contentHash,
                oldFileSizeBytes: row.fileSizeBytes,
                newTagSnapshotJson: null,
                willWrite: false,
                markStale,
                changes: []
            },
            issue: {
                code: 'AUDIO_METADATA_RECOVERY_REQUIRED',
                message: 'This file is blocked by an unfinished metadata recovery.',
                blocking: true,
                fileId: row.id.toString()
            }
        };
    }

    if (row.syncStatus !== TRACK_SYNC_STATUS.active) {
        return {
            file: {
                row,
                track,
                absolutePath,
                before: null,
                after,
                oldContentHash: row.contentHash,
                oldFileSizeBytes: row.fileSizeBytes,
                newTagSnapshotJson: null,
                willWrite: false,
                markStale,
                changes: []
            },
            issue: markStale ? {
                code: 'MUSIC_FILE_METADATA_STALE',
                message: 'The unavailable file will be marked stale and must be reconciled when it returns.',
                blocking: false,
                fileId: row.id.toString()
            } : null
        };
    }

    try {
        const realPath = await fs.promises.realpath(absolutePath);
        await fs.promises.access(realPath, fs.constants.R_OK | fs.constants.W_OK);
        const stat = await fs.promises.stat(realPath);

        if (!stat.isFile()) {
            throw new MusicMetadataServiceError(
                'The audio path does not point to a regular file.',
                'MUSIC_FILE_NOT_WRITABLE'
            );
        }

        const data = await fs.promises.readFile(realPath);
        const before = await parseTrackMetadata(realPath, data);
        const oldContentHash = createTrackContentHash(data);
        const changes = parsedFileChanges(before, after, owners);
        const willWrite = changes.length > 0
            || Boolean(row.legacyMetadataOverride)
            || row.metadataSyncStatus === 'stale';

        return {
            file: {
                row,
                track,
                absolutePath: realPath,
                before,
                after,
                oldContentHash,
                oldFileSizeBytes: BigInt(stat.size),
                newTagSnapshotJson: createTrackTagSnapshot({
                    ...before,
                    recordingVersionTitle: after.recordingVersionTitle ?? null,
                    releaseVersionTitle: after.releaseVersionTitle ?? null
                }),
                willWrite,
                markStale: false,
                changes
            },
            issue: null
        };
    } catch (error) {
        const serviceError = error instanceof MusicMetadataServiceError
            ? error
            : new MusicMetadataServiceError(
                (error as NodeJS.ErrnoException).code === 'ENOENT'
                    ? 'The active audio file could not be found.'
                    : 'The active audio file is not readable and writable.',
                (error as NodeJS.ErrnoException).code === 'ENOENT'
                    ? 'MUSIC_FILE_NOT_FOUND'
                    : 'MUSIC_FILE_NOT_WRITABLE',
                { cause: error }
            );

        return {
            file: {
                row,
                track,
                absolutePath,
                before: null,
                after,
                oldContentHash: row.contentHash,
                oldFileSizeBytes: row.fileSizeBytes,
                newTagSnapshotJson: null,
                willWrite: false,
                markStale,
                changes: []
            },
            issue: {
                code: serviceError.code,
                message: serviceError.message,
                blocking: true,
                fileId: row.id.toString()
            }
        };
    }
};

const resolveMetadataPlan = async (
    input: UpdateMusicMetadataInput
): Promise<MetadataPlan> => {
    const musicId = Number(input.id);

    if (!Number.isInteger(musicId) || musicId < 1) {
        throw new MusicMetadataServiceError('Music not found.', 'MUSIC_NOT_FOUND');
    }

    const selected = await models.releaseTrack.findUnique({
        where: { id: musicId },
        include: relationalTrackInclude
    });

    if (!selected) {
        throw new MusicMetadataServiceError('Music not found.', 'MUSIC_NOT_FOUND');
    }

    const normalized = normalizeInput(input, selected);
    const { changes, ownerChanges } = createOwnerChanges(selected, normalized);
    const fileTrackFilters: Prisma.ReleaseTrackWhereInput[] = [];

    if (ownerChanges.recordingFile) {
        fileTrackFilters.push({ recordingId: selected.recordingId });
    }

    if (ownerChanges.releaseFile) {
        fileTrackFilters.push({ releaseId: selected.releaseId });
    }

    if (ownerChanges.releaseTrackFile) {
        fileTrackFilters.push({ id: selected.id });
    }

    if (!fileTrackFilters.length) {
        fileTrackFilters.push({ id: selected.id });
    }

    const affectedTracks = await models.releaseTrack.findMany({
        where: { OR: fileTrackFilters },
        include: relationalTrackInclude,
        orderBy: { id: 'asc' }
    });
    const forceTrackIds = new Set<number>();
    const recordingFileFields = new Set(changes
        .filter(entry => (
            entry.owner === 'RECORDING'
            && entry.storage === 'FILE_AND_DATABASE'
        ))
        .map(entry => entry.field));
    const knownRecordingFileFields = new Set([
        'recording.versionTitle',
        'recording.genres',
        'recording.title',
        'recording.artistNames'
    ]);

    if (ownerChanges.recordingFile) {
        affectedTracks
            .filter(track => track.recordingId === selected.recordingId)
            .filter(track => {
                const plannedTitleOverride = track.id === selected.id
                    ? normalized.titleOverride
                    : track.titleOverride;
                const plannedTrackCredits = track.id === selected.id
                    ? normalized.releaseTrackArtistCredits
                    : track.ArtistCredit.length
                        ? toCreditValues(track.ArtistCredit)
                        : null;
                const appliesThroughRecording = (
                    recordingFileFields.has('recording.versionTitle')
                    || recordingFileFields.has('recording.genres')
                    || recordingFileFields.has('recording.title') && !plannedTitleOverride
                    || recordingFileFields.has('recording.artistNames') && !plannedTrackCredits
                );

                return appliesThroughRecording
                    || [...recordingFileFields].some(field => (
                        !knownRecordingFileFields.has(field)
                    ));
            })
            .forEach(track => forceTrackIds.add(track.id));
    }

    if (ownerChanges.releaseFile) {
        affectedTracks
            .filter(track => track.releaseId === selected.releaseId)
            .forEach(track => forceTrackIds.add(track.id));
    }

    if (ownerChanges.releaseTrackFile) {
        forceTrackIds.add(selected.id);
    }

    const files: PlannedFile[] = [];
    const issues: MusicMetadataPreviewIssue[] = [];

    for (const track of affectedTracks) {
        const after = proposedTrackMetadata(track, selected, normalized);
        const forceWrite = forceTrackIds.has(track.id);
        const existingTrackCredits = track.ArtistCredit.length
            ? toCreditValues(track.ArtistCredit)
            : null;
        const plannedTrackCredits = track.id === selected.id
            ? normalized.releaseTrackArtistCredits
            : existingTrackCredits;
        const plannedTitleOverride = track.id === selected.id
            ? normalized.titleOverride
            : track.titleOverride;
        const owners = {
            title: track.id === selected.id
                && selected.titleOverride !== normalized.titleOverride
                ? 'RELEASE_TRACK'
                : plannedTitleOverride
                    ? 'RELEASE_TRACK'
                    : 'RECORDING',
            artists: track.id === selected.id
                && !creditNamesEqual(
                    existingTrackCredits,
                    normalized.releaseTrackArtistCredits
                )
                ? 'RELEASE_TRACK'
                : plannedTrackCredits
                    ? 'RELEASE_TRACK'
                    : 'RECORDING'
        } satisfies {
            title: MusicMetadataOwner;
            artists: MusicMetadataOwner;
        };

        for (const row of track.PhysicalFile) {
            const planned = await readPlannedFile(
                row,
                track,
                after,
                owners,
                forceWrite && row.syncStatus !== TRACK_SYNC_STATUS.active
            );
            files.push(planned.file);
            if (planned.issue) issues.push(planned.issue);
        }
    }

    const expected: ExpectedRevisions = {
        recordings: uniqueExpected(affectedTracks.map(track => ({
            stableId: track.Recording.stableId,
            revision: track.Recording.metadataRevision
        }))),
        releases: uniqueExpected(affectedTracks.map(track => ({
            stableId: track.Release.stableId,
            revision: track.Release.metadataRevision
        }))),
        releaseTracks: uniqueExpected(affectedTracks.map(track => ({
            stableId: track.stableId,
            revision: track.metadataRevision
        }))),
        files: uniqueExpected(files.map(file => ({
            stableId: file.row.stableId,
            revision: file.row.metadataRevision,
            filePath: file.row.filePath,
            syncStatus: file.row.syncStatus,
            contentHash: file.oldContentHash
        })))
    };
    const oldRelational = {
        recording: {
            stableId: selected.Recording.stableId,
            title: selected.Recording.title,
            versionTitle: selected.Recording.versionTitle,
            artistCredits: toCreditValues(selected.Recording.ArtistCredit),
            genres: selected.Recording.RecordingGenre.map(({ Genre }) => Genre.name)
        },
        release: {
            stableId: selected.Release.stableId,
            title: selected.Release.title,
            releaseDate: selected.Release.releaseDate,
            releaseType: selected.Release.releaseType,
            totalDiscs: selected.Release.totalDiscs,
            artistCredits: toCreditValues(selected.Release.ArtistCredit)
        },
        releaseTrack: {
            stableId: selected.stableId,
            titleOverride: selected.titleOverride,
            versionTitle: selected.versionTitle,
            discNumber: selected.discNumber,
            trackNumber: selected.trackNumber,
            artistCredits: selected.ArtistCredit.length
                ? toCreditValues(selected.ArtistCredit)
                : null
        },
        staleFiles: files
            .filter(file => file.markStale)
            .map(file => file.row.stableId)
    };
    const tokenValue = {
        normalized,
        expected,
        targetFiles: files.map(file => ({
            stableId: file.row.stableId,
            oldContentHash: file.oldContentHash,
            willWrite: file.willWrite,
            markStale: file.markStale,
            after: file.after
        })),
        issues: issues.map(issue => ({ code: issue.code, fileId: issue.fileId }))
    };
    const hasChanges = changes.length > 0
        || files.some(file => file.willWrite || file.markStale);

    return {
        selected,
        normalized,
        ownerChanges,
        expected,
        oldRelational,
        files,
        changes,
        issues,
        token: buildPlanToken(tokenValue),
        hasChanges
    };
};

const toPreview = (plan: MetadataPlan): MusicMetadataPreview => ({
    token: plan.token,
    hasChanges: plan.hasChanges,
    changes: plan.changes,
    files: plan.files.map(file => ({
        fileId: file.row.id.toString(),
        stableId: file.row.stableId,
        filePath: file.row.filePath,
        syncStatus: file.row.syncStatus,
        willWrite: file.willWrite,
        changes: file.changes
    })),
    issues: plan.issues,
    preservedPolicies: PRESERVED_POLICIES
});

export const previewMusicMetadataUpdate = async (
    input: UpdateMusicMetadataInput
) => toPreview(await resolveMetadataPlan(input));

const findMusicResult = (musicId: number) => models.music.findUnique({
    where: { id: musicId }
});

const operationResult = async (
    operationId: string,
    musicId: number
): Promise<MusicMetadataOperationResult> => {
    const operation = await models.musicMetadataOperation.findUniqueOrThrow({
        where: { id: operationId },
        include: { Target: { orderBy: { id: 'asc' } } }
    });
    const successful = operation.status === 'committed' || operation.status === 'cleaned';

    return {
        operationId: operation.id,
        status: operation.status,
        retryable: ['failed', 'rolled-back'].includes(operation.status),
        errorCode: operation.errorCode,
        errorMessage: operation.errorMessage,
        music: successful ? await findMusicResult(musicId) : null,
        targets: operation.Target.map(target => ({
            fileId: target.physicalFileStableId,
            filePath: target.filePath,
            status: target.status,
            errorCode: target.errorCode,
            errorMessage: target.errorMessage
        }))
    };
};

const toServiceError = (error: unknown) => {
    if (error instanceof MusicMetadataServiceError) return error;
    if (error instanceof AudioMetadataWriteError) {
        return new MusicMetadataServiceError(error.message, error.code, { cause: error });
    }

    return new MusicMetadataServiceError(
        error instanceof Error ? error.message : 'Metadata update failed.',
        'MUSIC_METADATA_UPDATE_FAILED',
        { cause: error }
    );
};

const preparedFromPlan = (
    planFile: PlannedFile,
    prepared: PreparedTrackMetadataFile
) => ({ planFile, prepared });

const rollbackPreparedFiles = async ({
    operationId,
    preparedFiles,
    error,
    dependencies
}: {
    operationId: string;
    preparedFiles: Array<ReturnType<typeof preparedFromPlan>>;
    error: MusicMetadataServiceError;
    dependencies: MetadataEditorDependencies;
}) => {
    let reconciliationRequired = error.code === 'AUDIO_METADATA_RECOVERY_REQUIRED';

    for (const { planFile, prepared } of [...preparedFiles].reverse()) {
        try {
            await dependencies.restoreFile(prepared);
            await dependencies.discardFile(prepared);
            await models.musicMetadataOperationTarget.update({
                where: {
                    operationId_physicalFileStableId: {
                        operationId,
                        physicalFileStableId: planFile.row.stableId
                    }
                },
                data: {
                    status: 'restored',
                    errorCode: error.code,
                    errorMessage: error.message
                }
            });
        } catch (restoreError) {
            reconciliationRequired = true;
            const recoveryError = toServiceError(restoreError);
            await models.musicMetadataOperationTarget.update({
                where: {
                    operationId_physicalFileStableId: {
                        operationId,
                        physicalFileStableId: planFile.row.stableId
                    }
                },
                data: {
                    status: 'reconcile-required',
                    errorCode: recoveryError.code,
                    errorMessage: recoveryError.message
                }
            });
            await models.physicalFile.update({
                where: { stableId: planFile.row.stableId },
                data: {
                    metadataSyncStatus: 'reconcile-required',
                    metadataSyncError: recoveryError.message,
                    metadataRevision: { increment: 1 }
                }
            }).catch(() => undefined);
        }
    }

    await models.musicMetadataOperation.update({
        where: { id: operationId },
        data: {
            status: reconciliationRequired ? 'reconcile-required' : 'rolled-back',
            errorCode: error.code,
            errorMessage: error.message,
            completedAt: new Date()
        }
    });

    return reconciliationRequired;
};

const markCommittedCleanupFailure = async ({
    operationId,
    planFile,
    error
}: {
    operationId: string;
    planFile: PlannedFile;
    error: MusicMetadataServiceError;
}) => {
    await models.$transaction(async (transaction) => {
        await transaction.musicMetadataOperationTarget.update({
            where: {
                operationId_physicalFileStableId: {
                    operationId,
                    physicalFileStableId: planFile.row.stableId
                }
            },
            data: {
                status: 'reconcile-required',
                errorCode: error.code,
                errorMessage: error.message
            }
        });
        await transaction.physicalFile.update({
            where: { stableId: planFile.row.stableId },
            data: {
                metadataSyncStatus: 'reconcile-required',
                metadataSyncError: error.message,
                metadataRevision: { increment: 1 }
            }
        });
        await transaction.musicMetadataOperation.update({
            where: { id: operationId },
            data: {
                status: 'reconcile-required',
                errorCode: error.code,
                errorMessage: error.message,
                completedAt: new Date()
            }
        });
    });
};

const assertExpectedRevisions = async (
    transaction: Prisma.TransactionClient,
    expected: ExpectedRevisions
) => {
    const checks: Array<{
        label: string;
        expectedRows: ExpectedOwnerRevision[];
        actualRows: Array<{ stableId: string; metadataRevision: number }>;
    }> = [
        {
            label: 'recording',
            expectedRows: expected.recordings,
            actualRows: await transaction.recording.findMany({
                where: { stableId: { in: expected.recordings.map(row => row.stableId) } },
                select: { stableId: true, metadataRevision: true }
            })
        },
        {
            label: 'release',
            expectedRows: expected.releases,
            actualRows: await transaction.release.findMany({
                where: { stableId: { in: expected.releases.map(row => row.stableId) } },
                select: { stableId: true, metadataRevision: true }
            })
        },
        {
            label: 'release track',
            expectedRows: expected.releaseTracks,
            actualRows: await transaction.releaseTrack.findMany({
                where: { stableId: { in: expected.releaseTracks.map(row => row.stableId) } },
                select: { stableId: true, metadataRevision: true }
            })
        },
        {
            label: 'physical file',
            expectedRows: expected.files,
            actualRows: await transaction.physicalFile.findMany({
                where: { stableId: { in: expected.files.map(row => row.stableId) } },
                select: { stableId: true, metadataRevision: true }
            })
        }
    ];

    for (const check of checks) {
        const actual = new Map(check.actualRows.map(row => [row.stableId, row.metadataRevision]));

        if (
            actual.size !== check.expectedRows.length
            || check.expectedRows.some(row => actual.get(row.stableId) !== row.revision)
        ) {
            throw new MusicMetadataServiceError(
                `The ${check.label} changed after preview. Review the metadata diff again.`,
                'MUSIC_METADATA_PREVIEW_STALE'
            );
        }
    }

    const actualFiles = await transaction.physicalFile.findMany({
        where: { stableId: { in: expected.files.map(row => row.stableId) } },
        select: { stableId: true, filePath: true, syncStatus: true }
    });
    const expectedFiles = new Map(expected.files.map(row => [row.stableId, row]));

    if (actualFiles.some(row => {
        const expectedFile = expectedFiles.get(row.stableId);
        return !expectedFile
            || expectedFile.filePath !== row.filePath
            || expectedFile.syncStatus !== row.syncStatus;
    })) {
        throw new MusicMetadataServiceError(
            'A target file changed after preview. Review the metadata diff again.',
            'MUSIC_METADATA_PREVIEW_STALE'
        );
    }
};

const applyRelationalCommit = async ({
    transaction,
    plan,
    operationId,
    preparedFiles
}: {
    transaction: Prisma.TransactionClient;
    plan: MetadataPlan;
    operationId: string;
    preparedFiles: Array<ReturnType<typeof preparedFromPlan>>;
}) => {
    await assertExpectedRevisions(transaction, plan.expected);
    const { selected, normalized, ownerChanges } = plan;

    if (ownerChanges.recording) {
        await transaction.recording.update({
            where: { id: selected.recordingId },
            data: {
                title: normalized.recordingTitle,
                versionTitle: normalized.recordingVersionTitle,
                metadataRevision: { increment: 1 }
            }
        });
        await replaceArtistCredits(
            transaction,
            { recordingId: selected.recordingId },
            normalized.recordingArtistCredits
        );
        const genres = [];

        for (const name of normalized.genres) {
            genres.push(await transaction.genre.upsert({
                where: { name },
                update: {},
                create: { name }
            }));
        }

        await transaction.recordingGenre.deleteMany({
            where: { recordingId: selected.recordingId }
        });

        if (genres.length) {
            await transaction.recordingGenre.createMany({
                data: genres.map(genre => ({
                    recordingId: selected.recordingId,
                    genreId: genre.id
                }))
            });
        }
    }

    if (ownerChanges.release) {
        await transaction.release.update({
            where: { id: selected.releaseId },
            data: {
                title: normalized.releaseTitle,
                releaseDate: normalized.releaseDate || null,
                releaseType: normalized.releaseType,
                totalDiscs: normalized.totalDiscs,
                metadataRevision: { increment: 1 }
            }
        });
        await replaceArtistCredits(
            transaction,
            { releaseId: selected.releaseId },
            normalized.releaseArtistCredits
        );
    }

    if (ownerChanges.releaseTrack) {
        await transaction.releaseTrack.update({
            where: { id: selected.id },
            data: {
                titleOverride: normalized.titleOverride,
                versionTitle: normalized.releaseVersionTitle,
                discNumber: normalized.discNumber,
                trackNumber: normalized.trackNumber,
                metadataRevision: { increment: 1 }
            }
        });
        await transaction.artistCredit.deleteMany({
            where: { releaseTrackId: selected.id }
        });

        if (normalized.releaseTrackArtistCredits) {
            await replaceArtistCredits(
                transaction,
                { releaseTrackId: selected.id },
                normalized.releaseTrackArtistCredits
            );
        }
    }

    for (const { planFile, prepared } of preparedFiles) {
        await transaction.physicalFile.update({
            where: { id: planFile.row.id },
            data: {
                contentHash: prepared.newContentHash,
                hashVersion: prepared.hashVersion,
                fileSizeBytes: prepared.newFileSizeBytes,
                tagSnapshotJson: planFile.newTagSnapshotJson,
                legacyMetadataOverride: null,
                metadataSyncStatus: 'current',
                metadataSyncError: null,
                metadataRevision: { increment: 1 }
            }
        });
    }

    for (const planFile of plan.files.filter(file => file.markStale)) {
        await transaction.physicalFile.update({
            where: { id: planFile.row.id },
            data: {
                legacyMetadataOverride: null,
                metadataSyncStatus: 'stale',
                metadataSyncError: 'Canonical relational metadata changed while this file was unavailable.',
                metadataRevision: { increment: 1 }
            }
        });
    }

    await transaction.musicMetadataOperation.update({
        where: { id: operationId },
        data: {
            status: 'committed',
            committedAt: new Date(),
            errorCode: null,
            errorMessage: null
        }
    });
};

const createJournal = async (
    plan: MetadataPlan,
    retryOfId?: string | null
) => {
    const operationId = randomUUID();
    const targetFiles = plan.files.filter(file => file.willWrite);

    await models.musicMetadataOperation.create({
        data: {
            id: operationId,
            selectedReleaseTrackStableId: plan.selected.stableId,
            status: 'preparing',
            previewToken: plan.token,
            requestedJson: serializeForToken(plan.normalized),
            oldRelationalJson: serializeForToken(plan.oldRelational),
            expectedRevisionsJson: serializeForToken(plan.expected),
            retryOfId: retryOfId ?? null,
            Target: {
                create: targetFiles.map(file => ({
                    physicalFileStableId: file.row.stableId,
                    releaseTrackStableId: file.track.stableId,
                    filePath: file.absolutePath,
                    status: 'pending',
                    oldContentHash: file.oldContentHash!,
                    hashVersion: TRACK_CONTENT_HASH_VERSION,
                    oldFileSizeBytes: file.oldFileSizeBytes,
                    oldTagSnapshotJson: file.row.tagSnapshotJson,
                    newTagSnapshotJson: file.newTagSnapshotJson,
                    oldMetadataSyncStatus: file.row.metadataSyncStatus,
                    oldMetadataSyncError: file.row.metadataSyncError,
                    ...createTrackMetadataOperationPaths(file.absolutePath, operationId)
                }))
            }
        }
    });

    return operationId;
};

const ensureNoConflictingOperation = async (plan: MetadataPlan) => {
    const fileStableIds = plan.files.map(file => file.row.stableId);
    const conflict = await models.musicMetadataOperation.findFirst({
        where: {
            status: { in: ACTIVE_OPERATION_STATUSES },
            OR: [
                { selectedReleaseTrackStableId: plan.selected.stableId },
                ...(fileStableIds.length ? [{
                    Target: { some: { physicalFileStableId: { in: fileStableIds } } }
                }] : [])
            ]
        },
        select: { id: true, status: true }
    });

    if (conflict) {
        throw new MusicMetadataServiceError(
            `Metadata operation ${conflict.id} must be recovered before another edit can start.`,
            'AUDIO_METADATA_RECOVERY_REQUIRED'
        );
    }
};

const applyPlan = async ({
    plan,
    previewToken,
    retryOfId,
    dependencies
}: {
    plan: MetadataPlan;
    previewToken: string;
    retryOfId?: string | null;
    dependencies: MetadataEditorDependencies;
}) => {
    if (plan.token !== previewToken) {
        throw new MusicMetadataServiceError(
            'The metadata or target files changed after preview. Review the diff again.',
            'MUSIC_METADATA_PREVIEW_STALE'
        );
    }

    const blockingIssue = plan.issues.find(issue => issue.blocking);

    if (blockingIssue) {
        throw new MusicMetadataServiceError(blockingIssue.message, blockingIssue.code);
    }

    if (!plan.hasChanges) {
        throw new MusicMetadataServiceError(
            'There are no metadata changes to apply.',
            'NO_MUSIC_METADATA_CHANGES'
        );
    }

    await configureMetadataOperationDurability();
    await ensureNoConflictingOperation(plan);
    const operationId = await createJournal(plan, retryOfId);
    const preparedFiles: Array<ReturnType<typeof preparedFromPlan>> = [];

    for (const planFile of plan.files.filter(file => file.willWrite)) {
        try {
            const prepared = await dependencies.prepareFile(
                planFile.absolutePath,
                planFile.after,
                operationId,
                undefined,
                planFile.oldContentHash ?? undefined
            );
            preparedFiles.push(preparedFromPlan(planFile, prepared));
            await models.musicMetadataOperationTarget.update({
                where: {
                    operationId_physicalFileStableId: {
                        operationId,
                        physicalFileStableId: planFile.row.stableId
                    }
                },
                data: {
                    status: 'prepared',
                    oldContentHash: prepared.oldContentHash,
                    newContentHash: prepared.newContentHash,
                    hashVersion: prepared.hashVersion,
                    oldFileSizeBytes: prepared.oldFileSizeBytes,
                    newFileSizeBytes: prepared.newFileSizeBytes,
                    stagingPath: prepared.stagingPath,
                    backupPath: prepared.backupPath
                }
            });

            if (prepared.oldContentHash !== planFile.oldContentHash) {
                throw new MusicMetadataServiceError(
                    'The audio file changed after metadata preview.',
                    'AUDIO_METADATA_SOURCE_CHANGED'
                );
            }
        } catch (error) {
            const serviceError = toServiceError(error);

            await models.musicMetadataOperationTarget.update({
                where: {
                    operationId_physicalFileStableId: {
                        operationId,
                        physicalFileStableId: planFile.row.stableId
                    }
                },
                data: {
                    status: 'failed',
                    errorCode: serviceError.code,
                    errorMessage: serviceError.message
                }
            });

            if (preparedFiles.length > 0) {
                await rollbackPreparedFiles({
                    operationId,
                    preparedFiles,
                    error: serviceError,
                    dependencies
                });
                return operationResult(operationId, plan.selected.id);
            }

            await models.musicMetadataOperation.update({
                where: { id: operationId },
                data: {
                    status: serviceError.code === 'AUDIO_METADATA_RECOVERY_REQUIRED'
                        ? 'reconcile-required'
                        : 'failed',
                    errorCode: serviceError.code,
                    errorMessage: serviceError.message,
                    completedAt: new Date()
                }
            });
            return operationResult(operationId, plan.selected.id);
        }
    }

    await models.musicMetadataOperation.update({
        where: { id: operationId },
        data: { status: 'prepared', preparedAt: new Date() }
    });

    try {
        for (const { planFile, prepared } of preparedFiles) {
            await models.$transaction(async transaction => {
                await transaction.musicMetadataOperation.update({
                    where: { id: operationId },
                    data: { status: 'replacing' }
                });
                await transaction.musicMetadataOperationTarget.update({
                    where: {
                        operationId_physicalFileStableId: {
                            operationId,
                            physicalFileStableId: planFile.row.stableId
                        }
                    },
                    data: { status: 'replacing' }
                });
            });
            await dependencies.installFile(prepared);
            await models.musicMetadataOperationTarget.update({
                where: {
                    operationId_physicalFileStableId: {
                        operationId,
                        physicalFileStableId: planFile.row.stableId
                    }
                },
                data: { status: 'replaced' }
            });
        }

        await models.musicMetadataOperation.update({
            where: { id: operationId },
            data: { status: 'replaced', replacedAt: new Date() }
        });
    } catch (error) {
        const serviceError = toServiceError(error);
        await rollbackPreparedFiles({
            operationId,
            preparedFiles,
            error: serviceError,
            dependencies
        });
        return operationResult(operationId, plan.selected.id);
    }

    try {
        await models.$transaction(transaction => applyRelationalCommit({
            transaction,
            plan,
            operationId,
            preparedFiles
        }));
    } catch (error) {
        const serviceError = toServiceError(error);
        await rollbackPreparedFiles({
            operationId,
            preparedFiles,
            error: serviceError,
            dependencies
        });
        return operationResult(operationId, plan.selected.id);
    }

    let cleanupFailure: {
        planFile: PlannedFile;
        error: MusicMetadataServiceError;
    } | null = null;

    for (const { planFile, prepared } of preparedFiles) {
        try {
            await dependencies.validateCleanupFile(prepared);
        } catch (error) {
            cleanupFailure = { planFile, error: toServiceError(error) };
            break;
        }
    }

    if (!cleanupFailure) {
        for (const { planFile, prepared } of preparedFiles) {
            try {
                await dependencies.cleanupFile(prepared);
                await models.musicMetadataOperationTarget.update({
                    where: {
                        operationId_physicalFileStableId: {
                            operationId,
                            physicalFileStableId: planFile.row.stableId
                        }
                    },
                    data: { status: 'cleaned' }
                });
            } catch (error) {
                cleanupFailure = { planFile, error: toServiceError(error) };
                break;
            }
        }
    }

    if (cleanupFailure) {
        await markCommittedCleanupFailure({
            operationId,
            planFile: cleanupFailure.planFile,
            error: cleanupFailure.error
        });
    } else {
        await models.musicMetadataOperation.update({
            where: { id: operationId },
            data: {
                status: 'cleaned',
                errorCode: null,
                errorMessage: null,
                completedAt: new Date()
            }
        });
    }

    return operationResult(operationId, plan.selected.id);
};

export const updateMusicMetadata = async (
    input: UpdateMusicMetadataInput,
    previewToken: string,
    dependencies: MetadataEditorDependencies = defaultDependencies,
    retryOfId?: string | null
) => withLibraryMetadataLock(async () => {
    const plan = await resolveMetadataPlan(input);
    return applyPlan({
        plan,
        previewToken,
        retryOfId,
        dependencies
    });
});

export const retryMusicMetadataOperation = async (
    operationId: string,
    dependencies: MetadataEditorDependencies = defaultDependencies
) => withLibraryMetadataLock(async () => {
    const operation = await models.musicMetadataOperation.findUnique({
        where: { id: operationId }
    });

    if (!operation || !['failed', 'rolled-back'].includes(operation.status)) {
        throw new MusicMetadataServiceError(
            'This metadata operation cannot be retried.',
            'MUSIC_METADATA_OPERATION_NOT_RETRYABLE'
        );
    }

    const normalized = JSON.parse(operation.requestedJson) as NormalizedMetadataInput;
    const expected = JSON.parse(operation.expectedRevisionsJson) as ExpectedRevisions;

    await models.$transaction(transaction => assertExpectedRevisions(
        transaction,
        expected
    ));
    const input: UpdateMusicMetadataInput = {
        id: normalized.musicId.toString(),
        title: normalized.recordingTitle,
        titleOverride: normalized.titleOverride,
        recordingVersionTitle: normalized.recordingVersionTitle,
        recordingArtistCredits: normalized.recordingArtistCredits,
        releaseTrackArtistCredits: normalized.releaseTrackArtistCredits,
        album: normalized.releaseTitle,
        albumArtistCredits: normalized.releaseArtistCredits,
        publishedYear: normalized.releaseDate,
        releaseType: normalized.releaseType,
        totalDiscs: normalized.totalDiscs,
        releaseVersionTitle: normalized.releaseVersionTitle,
        discNumber: normalized.discNumber,
        trackNumber: normalized.trackNumber,
        genres: normalized.genres
    };
    const plan = await resolveMetadataPlan(input);

    if (serializeForToken(plan.expected) !== serializeForToken(expected)) {
        throw new MusicMetadataServiceError(
            'The metadata or target files changed after the failed operation. Review the diff again.',
            'MUSIC_METADATA_PREVIEW_STALE'
        );
    }

    return applyPlan({
        plan,
        previewToken: plan.token,
        dependencies,
        retryOfId: operationId
    });
});

export const recoverMusicMetadataOperation = async (operationId: string) => (
    withLibraryMetadataLock(async () => {
        const operation = await models.musicMetadataOperation.findUnique({
            where: { id: operationId }
        });

        if (!operation) {
            throw new MusicMetadataServiceError(
                'Metadata operation not found.',
                'MUSIC_METADATA_OPERATION_NOT_FOUND'
            );
        }

        await configureMetadataOperationDurability();
        await recoverMusicMetadataOperationJournal(operationId);
        const track = await models.releaseTrack.findUnique({
            where: { stableId: operation.selectedReleaseTrackStableId },
            select: { id: true }
        });

        return operationResult(operationId, track?.id ?? 0);
    })
);

export const listMusicMetadataOperations = async (musicIdValue: string) => {
    const musicId = Number(musicIdValue);

    if (!Number.isInteger(musicId) || musicId < 1) {
        throw new MusicMetadataServiceError('Music not found.', 'MUSIC_NOT_FOUND');
    }

    const track = await models.releaseTrack.findUnique({
        where: { id: musicId },
        select: { stableId: true }
    });

    if (!track) {
        throw new MusicMetadataServiceError('Music not found.', 'MUSIC_NOT_FOUND');
    }

    const operations = await models.musicMetadataOperation.findMany({
        where: {
            OR: [
                { selectedReleaseTrackStableId: track.stableId },
                { Target: { some: { releaseTrackStableId: track.stableId } } }
            ]
        },
        include: { Target: { orderBy: { id: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 10
    });

    return operations.map(operation => ({
        operationId: operation.id,
        status: operation.status,
        retryable: ['failed', 'rolled-back'].includes(operation.status),
        errorCode: operation.errorCode,
        errorMessage: operation.errorMessage,
        music: null,
        targets: operation.Target.map(target => ({
            fileId: target.physicalFileStableId,
            filePath: target.filePath,
            status: target.status,
            errorCode: target.errorCode,
            errorMessage: target.errorMessage
        })),
        createdAt: operation.createdAt.toISOString(),
        updatedAt: operation.updatedAt.toISOString()
    }));
};
