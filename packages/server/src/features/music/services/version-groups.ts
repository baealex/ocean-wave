import type { Prisma } from '@prisma/client';

import models, { type Music } from '~/models';
import {
    isPhysicalFileReadable,
    selectReadablePhysicalFile,
    sortPhysicalFilesByPreference
} from '~/modules/physical-file-selection';
import {
    getEffectiveVersionMetadata,
    normalizeCandidateTitle,
    normalizeVersionLabel,
    parseTrackTagSnapshot,
    type TrackIdentifierScheme
} from '~/modules/track-version';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

export const MUSIC_VERSION_ERROR_CODE = {
    invalidMusicId: 'INVALID_MUSIC_ID',
    musicNotFound: 'MUSIC_NOT_FOUND',
    invalidFileId: 'INVALID_FILE_ID',
    fileNotFound: 'MUSIC_FILE_NOT_FOUND',
    unsafeGrouping: 'UNSAFE_MUSIC_GROUPING',
    alreadyGrouped: 'MUSIC_ALREADY_GROUPED',
    notGrouped: 'MUSIC_NOT_GROUPED'
} as const;

type MusicVersionErrorCode = typeof MUSIC_VERSION_ERROR_CODE[
keyof typeof MUSIC_VERSION_ERROR_CODE
];

export class MusicVersionServiceError extends Error {
    code: MusicVersionErrorCode;

    constructor(message: string, code: MusicVersionErrorCode) {
        super(message);
        this.name = 'MusicVersionServiceError';
        this.code = code;
    }
}

export const isMusicVersionServiceError = (
    error: unknown
): error is MusicVersionServiceError => error instanceof MusicVersionServiceError;

const versionTrackInclude = {
    Recording: {
        include: {
            ArtistCredit: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
            RecordingGenre: true,
            MusicLike: true,
            MusicHate: true,
            MusicTag: true,
            ReleaseTrack: { select: { id: true } }
        }
    },
    ArtistCredit: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
    PhysicalFile: { orderBy: { id: 'asc' } }
} as const satisfies Prisma.ReleaseTrackInclude;

type VersionTrack = Prisma.ReleaseTrackGetPayload<{
    include: typeof versionTrackInclude;
}>;

export type MusicGroupingCandidateKind = 'ALTERNATE_FILE' | 'SAME_RECORDING';

export interface MusicGroupingCandidate {
    kind: MusicGroupingCandidateKind;
    music: Music;
    reasons: string[];
}

const parsePositiveId = (
    value: string | number,
    code: MusicVersionErrorCode,
    label: string
) => {
    const id = Number(value);

    if (!Number.isInteger(id) || id < 1) {
        throw new MusicVersionServiceError(`${label} is invalid.`, code);
    }

    return id;
};

const getVersionTrack = async (
    client: typeof models | Prisma.TransactionClient,
    musicId: number
) => {
    const releaseTrack = await client.releaseTrack.findUnique({
        where: { id: musicId },
        include: versionTrackInclude
    });

    if (!releaseTrack) {
        throw new MusicVersionServiceError(
            'Music not found.',
            MUSIC_VERSION_ERROR_CODE.musicNotFound
        );
    }

    return releaseTrack;
};

const effectiveCredits = (track: VersionTrack) => (
    track.ArtistCredit.length
        ? track.ArtistCredit
        : track.Recording.ArtistCredit
);

const creditSignature = (credits: VersionTrack['ArtistCredit']) => credits
    .map(credit => `${credit.artistId}:${credit.role}`)
    .join('|');

const artistSignature = (track: VersionTrack) => creditSignature(effectiveCredits(track));
const recordingArtistSignature = (track: VersionTrack) => creditSignature(
    track.Recording.ArtistCredit
);

const versionKey = (value: string | null) => (
    normalizeVersionLabel(value)?.toLocaleLowerCase('en-US') ?? ''
);

const versionEvidence = (track: VersionTrack) => {
    const effective = getEffectiveVersionMetadata({
        title: track.titleOverride ?? track.Recording.title,
        recordingVersionTitle: track.Recording.versionTitle,
        releaseVersionTitle: track.versionTitle
    });
    const recording = new Set<string>();
    const release = new Set<string>();
    const add = (target: Set<string>, value: string | null) => {
        const key = versionKey(value);
        if (key) target.add(key);
    };

    add(recording, effective.recordingVersionTitle);
    add(release, effective.releaseVersionTitle);
    for (const file of track.PhysicalFile) {
        const snapshot = parseTrackTagSnapshot(file.tagSnapshotJson);
        add(recording, snapshot?.recordingVersionTitle ?? null);
        add(release, snapshot?.releaseVersionTitle ?? null);
    }

    return { recording, release };
};

const hasSameUnambiguousEvidence = (left: Set<string>, right: Set<string>) => {
    if (left.size > 1 || right.size > 1 || left.size !== right.size) return false;
    return left.size === 0 || [...left].every(value => right.has(value));
};

const identifiersByScheme = (track: VersionTrack) => {
    const identifiers = new Map<TrackIdentifierScheme, Set<string>>();

    for (const file of track.PhysicalFile) {
        for (const identifier of parseTrackTagSnapshot(file.tagSnapshotJson)?.identifiers ?? []) {
            const values = identifiers.get(identifier.scheme) ?? new Set<string>();
            values.add(identifier.value);
            identifiers.set(identifier.scheme, values);
        }
    }

    return identifiers;
};

const getIdentifierEvidence = (left: VersionTrack, right: VersionTrack) => {
    const leftIdentifiers = identifiersByScheme(left);
    const rightIdentifiers = identifiersByScheme(right);
    const matchingSchemes: TrackIdentifierScheme[] = [];

    for (const scheme of [
        'musicbrainz-recording',
        'isrc',
        'acoustid'
    ] as const) {
        const leftValues = leftIdentifiers.get(scheme);
        const rightValues = rightIdentifiers.get(scheme);

        if (!leftValues?.size || !rightValues?.size) continue;

        const intersects = [...leftValues].some(value => rightValues.has(value));
        if (!intersects) return { conflict: true, matchingSchemes: [] };

        matchingSchemes.push(scheme);
    }

    return { conflict: false, matchingSchemes };
};

const minimumDurationDifference = (left: VersionTrack, right: VersionTrack) => {
    const activeDurations = (track: VersionTrack) => {
        const active = track.PhysicalFile.filter(file => (
            file.syncStatus === TRACK_SYNC_STATUS.active
        ));
        return (active.length ? active : track.PhysicalFile).map(file => file.durationMs);
    };
    const leftDurations = activeDurations(left);
    const rightDurations = activeDurations(right);

    if (!leftDurations.length || !rightDurations.length) return Number.POSITIVE_INFINITY;

    return Math.min(...leftDurations.flatMap(leftDuration => (
        rightDurations.map(rightDuration => Math.abs(leftDuration - rightDuration))
    )));
};

const sameNullablePosition = (left: number | null, right: number | null) => (
    left === right
);

export const classifyMusicGroupingCandidate = (
    current: VersionTrack,
    candidate: VersionTrack
): Omit<MusicGroupingCandidate, 'music'> | null => {
    if (current.id === candidate.id || current.recordingId === candidate.recordingId) {
        return null;
    }

    const currentTitle = normalizeCandidateTitle(
        current.titleOverride ?? current.Recording.title
    );
    const candidateTitle = normalizeCandidateTitle(
        candidate.titleOverride ?? candidate.Recording.title
    );

    if (!currentTitle || currentTitle !== candidateTitle) return null;
    if (artistSignature(current) !== artistSignature(candidate)) return null;
    if (recordingArtistSignature(current) !== recordingArtistSignature(candidate)) return null;

    const currentVersions = versionEvidence(current);
    const candidateVersions = versionEvidence(candidate);
    if (!hasSameUnambiguousEvidence(
        currentVersions.recording,
        candidateVersions.recording
    )) {
        return null;
    }

    const identifierEvidence = getIdentifierEvidence(current, candidate);
    if (identifierEvidence.conflict) return null;

    const durationDifference = minimumDurationDifference(current, candidate);
    if (durationDifference > 2_000) return null;

    const sameReleaseAppearance = current.releaseId === candidate.releaseId
        && sameNullablePosition(current.discNumber, candidate.discNumber)
        && sameNullablePosition(current.trackNumber, candidate.trackNumber)
        && hasSameUnambiguousEvidence(
            currentVersions.release,
            candidateVersions.release
        );
    const reasons = [
        'Same normalized title and ordered artist credits',
        `Duration differs by ${durationDifference} ms or less`
    ];

    for (const scheme of identifierEvidence.matchingSchemes) {
        reasons.push(`Matching ${scheme} identifier`);
    }

    if (sameReleaseAppearance) {
        reasons.push('Same release and disc/track position');
    }

    return {
        kind: sameReleaseAppearance ? 'ALTERNATE_FILE' : 'SAME_RECORDING',
        reasons
    };
};

export const getMusicGroupingCandidates = async (
    musicIdValue: string | number
): Promise<MusicGroupingCandidate[]> => {
    const musicId = parsePositiveId(
        musicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Music id'
    );
    const current = await getVersionTrack(models, musicId);
    const candidates = await models.releaseTrack.findMany({
        where: {
            id: { not: musicId },
            recordingId: { not: current.recordingId },
            PhysicalFile: { some: { syncStatus: TRACK_SYNC_STATUS.active } }
        },
        include: versionTrackInclude,
        orderBy: { id: 'asc' }
    });
    const classified = candidates.flatMap(candidate => {
        const classification = classifyMusicGroupingCandidate(current, candidate);
        return classification ? [{ candidate, classification }] : [];
    });
    const musicRows = await models.music.findMany({
        where: { id: { in: classified.map(({ candidate }) => candidate.id) } }
    });
    const musicById = new Map(musicRows.map(music => [music.id, music]));

    return classified.flatMap(({ candidate, classification }) => {
        const music = musicById.get(candidate.id);
        return music ? [{ ...classification, music }] : [];
    }).sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'ALTERNATE_FILE' ? -1 : 1;
        return left.music.id - right.music.id;
    });
};

export const getMusicRecordingAppearances = async (
    musicIdValue: string | number
) => {
    const musicId = parsePositiveId(
        musicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Music id'
    );
    const releaseTrack = await getVersionTrack(models, musicId);

    return models.music.findMany({
        where: {
            recordingId: releaseTrack.recordingId,
            id: { not: musicId }
        },
        orderBy: { id: 'asc' }
    });
};

export const getMusicFileVersions = async (musicIdValue: string | number) => {
    const musicId = parsePositiveId(
        musicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Music id'
    );
    const releaseTrack = await getVersionTrack(models, musicId);
    const files = sortPhysicalFilesByPreference(releaseTrack.PhysicalFile);
    const selected = selectReadablePhysicalFile(files);

    return files.map(file => ({
        id: file.id,
        filePath: file.filePath,
        codec: file.codec,
        container: file.container,
        bitrate: file.bitrate,
        sampleRate: file.sampleRate,
        duration: file.durationMs / 1_000,
        syncStatus: file.syncStatus,
        metadataSyncStatus: file.metadataSyncStatus,
        metadataSyncError: file.metadataSyncError,
        isPreferred: file.preferenceRank === 0,
        isSelected: file.id === selected?.id,
        isPlayable: isPhysicalFileReadable(file)
    }));
};

const readMusicAfterMutation = async (musicId: number) => {
    const music = await models.music.findUnique({ where: { id: musicId } });

    if (!music) {
        throw new MusicVersionServiceError(
            'Music is not currently playable.',
            MUSIC_VERSION_ERROR_CODE.musicNotFound
        );
    }

    return music;
};

export const setPreferredMusicFile = async ({
    musicId: musicIdValue,
    fileId: fileIdValue
}: {
    musicId: string | number;
    fileId?: string | number | null;
}) => {
    const musicId = parsePositiveId(
        musicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Music id'
    );
    const fileId = fileIdValue === null || fileIdValue === undefined
        ? null
        : parsePositiveId(fileIdValue, MUSIC_VERSION_ERROR_CODE.invalidFileId, 'File id');

    await models.$transaction(async transaction => {
        const releaseTrack = await getVersionTrack(transaction, musicId);

        if (fileId !== null && !releaseTrack.PhysicalFile.some(file => file.id === fileId)) {
            throw new MusicVersionServiceError(
                'The selected file is not part of this music group.',
                MUSIC_VERSION_ERROR_CODE.fileNotFound
            );
        }

        await transaction.physicalFile.updateMany({
            where: { releaseTrackId: musicId, preferenceRank: { not: null } },
            data: { preferenceRank: null }
        });

        if (fileId !== null) {
            await transaction.physicalFile.update({
                where: { id: fileId },
                data: {
                    preferenceRank: 0,
                    isExplicitlyActivated: true,
                    ...(releaseTrack.PhysicalFile.find(file => file.id === fileId)?.syncStatus
                        === TRACK_SYNC_STATUS.duplicate
                        ? {
                            syncStatus: TRACK_SYNC_STATUS.active
                        }
                        : {})
                }
            });
        }

        await transaction.releaseTrack.update({
            where: { id: musicId },
            data: { metadataRevision: { increment: 1 } }
        });
    });

    return readMusicAfterMutation(musicId);
};

const latestDate = (left: Date | null, right: Date | null) => {
    if (!left) return right;
    if (!right) return left;
    return left > right ? left : right;
};

interface RecordingPlaybackAggregate {
    playCount: number;
    lastPlayedAt: Date | null;
    skipCount: number;
    lastSkippedAt: Date | null;
    completionCount: number;
    lastCompletedAt: Date | null;
    totalPlayedMs: number;
}

const getPlaybackAggregate = async (
    transaction: Prisma.TransactionClient,
    where: Prisma.PlaybackEventWhereInput
): Promise<RecordingPlaybackAggregate> => {
    const events = await transaction.playbackEvent.findMany({
        where,
        select: {
            countedAsPlay: true,
            outcome: true,
            playedMs: true,
            endedAt: true
        }
    });

    return events.reduce<RecordingPlaybackAggregate>((aggregate, event) => ({
        playCount: aggregate.playCount + Number(event.countedAsPlay),
        lastPlayedAt: latestDate(aggregate.lastPlayedAt, event.endedAt),
        skipCount: aggregate.skipCount + Number(event.outcome === 'skip'),
        lastSkippedAt: event.outcome === 'skip'
            ? latestDate(aggregate.lastSkippedAt, event.endedAt)
            : aggregate.lastSkippedAt,
        completionCount: aggregate.completionCount + Number(event.outcome === 'complete'),
        lastCompletedAt: event.outcome === 'complete'
            ? latestDate(aggregate.lastCompletedAt, event.endedAt)
            : aggregate.lastCompletedAt,
        totalPlayedMs: aggregate.totalPlayedMs + event.playedMs
    }), {
        playCount: 0,
        lastPlayedAt: null,
        skipCount: 0,
        lastSkippedAt: null,
        completionCount: 0,
        lastCompletedAt: null,
        totalPlayedMs: 0
    });
};

const remainingLastDate = (
    stored: Date | null,
    moved: Date | null,
    remainingEvents: Date | null
) => {
    if (!stored) return remainingEvents;
    if (!moved || stored > moved) return stored;
    return remainingEvents;
};

const getRemainingRecordingAggregate = (
    stored: VersionTrack['Recording'],
    moved: RecordingPlaybackAggregate,
    remainingEvents: RecordingPlaybackAggregate
): RecordingPlaybackAggregate => ({
    playCount: Math.max(stored.playCount - moved.playCount, 0),
    lastPlayedAt: remainingLastDate(
        stored.lastPlayedAt,
        moved.lastPlayedAt,
        remainingEvents.lastPlayedAt
    ),
    skipCount: Math.max(stored.skipCount - moved.skipCount, 0),
    lastSkippedAt: remainingLastDate(
        stored.lastSkippedAt,
        moved.lastSkippedAt,
        remainingEvents.lastSkippedAt
    ),
    completionCount: Math.max(stored.completionCount - moved.completionCount, 0),
    lastCompletedAt: remainingLastDate(
        stored.lastCompletedAt,
        moved.lastCompletedAt,
        remainingEvents.lastCompletedAt
    ),
    totalPlayedMs: Math.max(stored.totalPlayedMs - moved.totalPlayedMs, 0)
});

export const linkMusicRecordings = async ({
    musicId: musicIdValue,
    targetMusicId: targetMusicIdValue
}: {
    musicId: string | number;
    targetMusicId: string | number;
}) => {
    const musicId = parsePositiveId(
        musicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Music id'
    );
    const targetMusicId = parsePositiveId(
        targetMusicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Target music id'
    );

    await models.$transaction(async transaction => {
        const source = await getVersionTrack(transaction, musicId);
        const target = await getVersionTrack(transaction, targetMusicId);

        if (source.recordingId === target.recordingId) {
            throw new MusicVersionServiceError(
                'These tracks already share one recording.',
                MUSIC_VERSION_ERROR_CODE.alreadyGrouped
            );
        }

        const classification = classifyMusicGroupingCandidate(source, target);
        if (!classification || classification.kind !== 'SAME_RECORDING') {
            throw new MusicVersionServiceError(
                'The tracks do not meet the safe same-recording rules.',
                MUSIC_VERSION_ERROR_CODE.unsafeGrouping
            );
        }

        const sourceRecording = source.Recording;
        const targetRecording = target.Recording;

        for (const genre of sourceRecording.RecordingGenre) {
            await transaction.recordingGenre.upsert({
                where: {
                    recordingId_genreId: {
                        recordingId: targetRecording.id,
                        genreId: genre.genreId
                    }
                },
                create: {
                    recordingId: targetRecording.id,
                    genreId: genre.genreId,
                    source: genre.source
                },
                update: {}
            });
        }
        for (const tag of sourceRecording.MusicTag) {
            await transaction.musicTag.upsert({
                where: {
                    musicId_tagId: {
                        musicId: targetRecording.id,
                        tagId: tag.tagId
                    }
                },
                create: {
                    musicId: targetRecording.id,
                    tagId: tag.tagId,
                    source: tag.source
                },
                update: {}
            });
        }

        if (sourceRecording.MusicLike && !targetRecording.MusicLike) {
            await transaction.musicLike.create({ data: { musicId: targetRecording.id } });
        }
        if (sourceRecording.MusicHate && !targetRecording.MusicHate) {
            await transaction.musicHate.create({ data: { musicId: targetRecording.id } });
        }

        await transaction.playbackEvent.updateMany({
            where: { musicId: sourceRecording.id },
            data: { musicId: targetRecording.id }
        });
        await transaction.playbackSession.updateMany({
            where: { historyMusicId: sourceRecording.id },
            data: { historyMusicId: targetRecording.id }
        });
        await transaction.releaseTrack.updateMany({
            where: { recordingId: sourceRecording.id },
            data: { recordingId: targetRecording.id, metadataRevision: { increment: 1 } }
        });
        await transaction.recording.update({
            where: { id: targetRecording.id },
            data: {
                playCount: { increment: sourceRecording.playCount },
                skipCount: { increment: sourceRecording.skipCount },
                completionCount: { increment: sourceRecording.completionCount },
                totalPlayedMs: { increment: sourceRecording.totalPlayedMs },
                lastPlayedAt: latestDate(targetRecording.lastPlayedAt, sourceRecording.lastPlayedAt),
                lastSkippedAt: latestDate(targetRecording.lastSkippedAt, sourceRecording.lastSkippedAt),
                lastCompletedAt: latestDate(
                    targetRecording.lastCompletedAt,
                    sourceRecording.lastCompletedAt
                ),
                metadataRevision: { increment: 1 }
            }
        });
        await transaction.musicTag.deleteMany({ where: { musicId: sourceRecording.id } });
        await transaction.recordingGenre.deleteMany({
            where: { recordingId: sourceRecording.id }
        });
        await transaction.musicLike.deleteMany({ where: { musicId: sourceRecording.id } });
        await transaction.musicHate.deleteMany({ where: { musicId: sourceRecording.id } });
        await transaction.recording.delete({ where: { id: sourceRecording.id } });
    });

    return readMusicAfterMutation(musicId);
};

const copyRecordingMetadata = async (
    transaction: Prisma.TransactionClient,
    source: VersionTrack,
    {
        playbackAggregate,
        copyPersonalState = false
    }: {
        playbackAggregate?: RecordingPlaybackAggregate;
        copyPersonalState?: boolean;
    } = {}
) => transaction.recording.create({
    data: {
        title: source.Recording.title,
        versionTitle: source.Recording.versionTitle,
        metadataRevision: source.Recording.metadataRevision + 1,
        playCount: playbackAggregate?.playCount ?? 0,
        lastPlayedAt: playbackAggregate?.lastPlayedAt ?? null,
        skipCount: playbackAggregate?.skipCount ?? 0,
        lastSkippedAt: playbackAggregate?.lastSkippedAt ?? null,
        completionCount: playbackAggregate?.completionCount ?? 0,
        lastCompletedAt: playbackAggregate?.lastCompletedAt ?? null,
        totalPlayedMs: playbackAggregate?.totalPlayedMs ?? 0,
        ArtistCredit: {
            create: source.Recording.ArtistCredit.map(credit => ({
                artistId: credit.artistId,
                role: credit.role,
                position: credit.position,
                creditedName: credit.creditedName,
                joinPhrase: credit.joinPhrase
            }))
        },
        RecordingGenre: {
            create: source.Recording.RecordingGenre.map(genre => ({
                genreId: genre.genreId,
                source: genre.source
            }))
        },
        MusicLike: copyPersonalState && source.Recording.MusicLike
            ? { create: {} }
            : undefined,
        MusicHate: copyPersonalState && source.Recording.MusicHate
            ? { create: {} }
            : undefined,
        MusicTag: copyPersonalState
            ? {
                create: source.Recording.MusicTag.map(tag => ({
                    tagId: tag.tagId,
                    source: tag.source
                }))
            }
            : undefined
    }
});

export const unlinkMusicRecording = async ({
    musicId: musicIdValue
}: {
    musicId: string | number;
}) => {
    const musicId = parsePositiveId(
        musicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Music id'
    );

    await models.$transaction(async transaction => {
        const source = await getVersionTrack(transaction, musicId);

        if (source.Recording.ReleaseTrack.length < 2) {
            throw new MusicVersionServiceError(
                'This track already has its own recording.',
                MUSIC_VERSION_ERROR_CODE.notGrouped
            );
        }

        const [movedPlayback, remainingPlayback] = await Promise.all([
            getPlaybackAggregate(transaction, {
                musicId: source.recordingId,
                releaseTrackId: source.id
            }),
            getPlaybackAggregate(transaction, {
                musicId: source.recordingId,
                NOT: { releaseTrackId: source.id }
            })
        ]);
        const recording = await copyRecordingMetadata(transaction, source, {
            playbackAggregate: movedPlayback,
            copyPersonalState: true
        });
        const remainingAggregate = getRemainingRecordingAggregate(
            source.Recording,
            movedPlayback,
            remainingPlayback
        );
        await transaction.releaseTrack.update({
            where: { id: source.id },
            data: {
                recordingId: recording.id,
                metadataRevision: { increment: 1 }
            }
        });
        await transaction.playbackEvent.updateMany({
            where: { releaseTrackId: source.id },
            data: { musicId: recording.id }
        });
        await transaction.playbackSession.updateMany({
            where: { historyReleaseTrackId: source.id },
            data: { historyMusicId: recording.id }
        });
        await transaction.recording.update({
            where: { id: source.recordingId },
            data: {
                ...remainingAggregate,
                metadataRevision: { increment: 1 }
            }
        });
    });

    return readMusicAfterMutation(musicId);
};

const assertSourceCanBecomeAlternateFile = async (
    transaction: Prisma.TransactionClient,
    source: VersionTrack
) => {
    if (source.PhysicalFile.length !== 1 || source.Recording.ReleaseTrack.length !== 1) {
        throw new MusicVersionServiceError(
            'Only a single-file, single-appearance source can be grouped as an alternate file.',
            MUSIC_VERSION_ERROR_CODE.unsafeGrouping
        );
    }

    const [eventCount, sessionCount, queueCount] = await Promise.all([
        transaction.playbackEvent.count({ where: { releaseTrackId: source.id } }),
        transaction.playbackSession.count({
            where: {
                OR: [
                    { currentMusicId: source.id },
                    { historyReleaseTrackId: source.id },
                    { historyMusicId: source.recordingId }
                ]
            }
        }),
        transaction.playbackQueueItem.count({ where: { musicId: source.id } })
    ]);
    const recordingHasState = source.Recording.playCount > 0
        || source.Recording.skipCount > 0
        || source.Recording.completionCount > 0
        || source.Recording.totalPlayedMs > 0
        || Boolean(source.Recording.MusicLike)
        || Boolean(source.Recording.MusicHate)
        || source.Recording.MusicTag.length > 0;

    if (eventCount || sessionCount || queueCount || recordingHasState) {
        throw new MusicVersionServiceError(
            'The source has playback or personal state and cannot be collapsed safely.',
            MUSIC_VERSION_ERROR_CODE.unsafeGrouping
        );
    }
};

export const groupMusicAsAlternateFile = async ({
    musicId: musicIdValue,
    targetMusicId: targetMusicIdValue
}: {
    musicId: string | number;
    targetMusicId: string | number;
}) => {
    const musicId = parsePositiveId(
        musicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Music id'
    );
    const targetMusicId = parsePositiveId(
        targetMusicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Target music id'
    );

    await models.$transaction(async transaction => {
        const source = await getVersionTrack(transaction, musicId);
        const target = await getVersionTrack(transaction, targetMusicId);
        const classification = classifyMusicGroupingCandidate(source, target);

        if (!classification || classification.kind !== 'ALTERNATE_FILE') {
            throw new MusicVersionServiceError(
                'The tracks do not meet the safe alternate-file rules.',
                MUSIC_VERSION_ERROR_CODE.unsafeGrouping
            );
        }

        await assertSourceCanBecomeAlternateFile(transaction, source);

        const playlistRows = await transaction.playlistMusic.findMany({
            where: { musicId: source.id }
        });

        for (const row of playlistRows) {
            await transaction.playlistMusic.update({
                where: { id: row.id },
                data: { musicId: target.id }
            });
        }

        await transaction.physicalFile.update({
            where: { id: source.PhysicalFile[0].id },
            data: {
                releaseTrackId: target.id,
                preferenceRank: null,
                syncStatus: TRACK_SYNC_STATUS.active,
                isExplicitlyActivated: true
            }
        });
        await transaction.releaseTrack.update({
            where: { id: target.id },
            data: { metadataRevision: { increment: 1 } }
        });
        await transaction.releaseTrack.delete({ where: { id: source.id } });
        await transaction.recording.delete({ where: { id: source.recordingId } });
    });

    return readMusicAfterMutation(targetMusicId);
};

export const ungroupMusicFile = async ({
    musicId: musicIdValue,
    fileId: fileIdValue
}: {
    musicId: string | number;
    fileId: string | number;
}) => {
    const musicId = parsePositiveId(
        musicIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidMusicId,
        'Music id'
    );
    const fileId = parsePositiveId(
        fileIdValue,
        MUSIC_VERSION_ERROR_CODE.invalidFileId,
        'File id'
    );
    let createdMusicId = 0;

    await models.$transaction(async transaction => {
        const source = await getVersionTrack(transaction, musicId);
        const file = source.PhysicalFile.find(candidate => candidate.id === fileId);

        if (!file) {
            throw new MusicVersionServiceError(
                'The selected file is not part of this music group.',
                MUSIC_VERSION_ERROR_CODE.fileNotFound
            );
        }
        if (source.PhysicalFile.length < 2) {
            throw new MusicVersionServiceError(
                'The file is already the only member of its group.',
                MUSIC_VERSION_ERROR_CODE.notGrouped
            );
        }

        const [movedPlayback, remainingPlayback] = await Promise.all([
            getPlaybackAggregate(transaction, {
                musicId: source.recordingId,
                physicalFileId: file.id
            }),
            getPlaybackAggregate(transaction, {
                musicId: source.recordingId,
                NOT: { physicalFileId: file.id }
            })
        ]);
        const recording = await copyRecordingMetadata(transaction, source, {
            playbackAggregate: movedPlayback,
            copyPersonalState: true
        });
        const remainingAggregate = getRemainingRecordingAggregate(
            source.Recording,
            movedPlayback,
            remainingPlayback
        );
        const releaseTrack = await transaction.releaseTrack.create({
            data: {
                recordingId: recording.id,
                releaseId: source.releaseId,
                titleOverride: source.titleOverride,
                versionTitle: source.versionTitle,
                discNumber: source.discNumber,
                trackNumber: source.trackNumber,
                metadataRevision: source.metadataRevision + 1,
                ArtistCredit: {
                    create: source.ArtistCredit.map(credit => ({
                        artistId: credit.artistId,
                        role: credit.role,
                        position: credit.position,
                        creditedName: credit.creditedName,
                        joinPhrase: credit.joinPhrase
                    }))
                }
            }
        });
        createdMusicId = releaseTrack.id;

        await transaction.physicalFile.update({
            where: { id: file.id },
            data: {
                releaseTrackId: releaseTrack.id,
                preferenceRank: null,
                isExplicitlyActivated: true,
                syncStatus: file.syncStatus === TRACK_SYNC_STATUS.duplicate
                    ? TRACK_SYNC_STATUS.active
                    : file.syncStatus
            }
        });
        await transaction.playbackEvent.updateMany({
            where: {
                musicId: source.recordingId,
                physicalFileId: file.id
            },
            data: {
                musicId: recording.id,
                releaseTrackId: releaseTrack.id
            }
        });
        await transaction.playbackSession.updateMany({
            where: { historyPhysicalFileId: file.id },
            data: {
                historyMusicId: recording.id,
                historyReleaseTrackId: releaseTrack.id
            }
        });
        await transaction.recording.update({
            where: { id: source.recordingId },
            data: {
                ...remainingAggregate,
                metadataRevision: { increment: 1 }
            }
        });
        await transaction.releaseTrack.update({
            where: { id: source.id },
            data: { metadataRevision: { increment: 1 } }
        });
    });

    return readMusicAfterMutation(createdMusicId);
};
