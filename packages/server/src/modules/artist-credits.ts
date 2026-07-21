import type {
    Artist,
    ArtistCredit,
    Prisma
} from '@prisma/client';

import models, { type Music } from '~/models';
import { normalizeArtistName } from './artist-identity';
import { TRACK_SYNC_STATUS } from './track-identity';

export const ARTIST_CREDIT_ROLES = [
    'primary',
    'featured',
    'remixer',
    'performer',
    'composer',
    'conductor',
    'unknown'
] as const;

export type ArtistCreditRole = typeof ARTIST_CREDIT_ROLES[number];

export interface ArtistCreditValue {
    name: string;
    role: ArtistCreditRole;
    creditedName: string | null;
    joinPhrase: string;
}

export type ArtistCreditWithArtist = ArtistCredit & { Artist: Artist };

export class ArtistCreditValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ArtistCreditValidationError';
    }
}

const FEATURED_JOIN_PHRASE = /(?:^|\s)(?:feat\.?|ft\.?|featuring)(?:\s|$)/i;
const DEFAULT_JOIN_PHRASE = ' & ';

const normalizeRole = (role: string): ArtistCreditRole => {
    const normalizedRole = role.trim().toLowerCase();

    if (!ARTIST_CREDIT_ROLES.includes(normalizedRole as ArtistCreditRole)) {
        throw new ArtistCreditValidationError(`Unsupported artist credit role: ${role}`);
    }

    return normalizedRole as ArtistCreditRole;
};

export const normalizeArtistCredits = (
    credits: ReadonlyArray<{
        name: string;
        role: string;
        creditedName?: string | null;
        joinPhrase?: string | null;
    }>,
    label = 'Artist credits'
): ArtistCreditValue[] => {
    if (credits.length < 1) {
        throw new ArtistCreditValidationError(`${label} must include at least one artist.`);
    }

    if (credits.length > 50) {
        throw new ArtistCreditValidationError(`${label} cannot include more than 50 artists.`);
    }

    const normalized = credits.map((credit, index) => {
        const name = credit.name.trim();
        const creditedName = credit.creditedName?.trim() || null;
        const requestedJoinPhrase = credit.joinPhrase ?? '';
        const hasRequestedJoinPhrase = credit.joinPhrase !== undefined
            && credit.joinPhrase !== null;

        if (!name) {
            throw new ArtistCreditValidationError(`${label} artist names are required.`);
        }

        if (name.length > 255 || (creditedName?.length ?? 0) > 255) {
            throw new ArtistCreditValidationError(
                `${label} artist names must be 255 characters or fewer.`
            );
        }

        if (requestedJoinPhrase.length > 64) {
            throw new ArtistCreditValidationError(
                `${label} join phrases must be 64 characters or fewer.`
            );
        }

        return {
            name,
            role: normalizeRole(credit.role),
            creditedName,
            joinPhrase: index < credits.length - 1 && !hasRequestedJoinPhrase
                ? DEFAULT_JOIN_PHRASE
                : requestedJoinPhrase
        };
    });

    if (!normalized.some(({ role }) => role === 'primary')) {
        throw new ArtistCreditValidationError(`${label} must include a primary artist.`);
    }

    return normalized;
};

const inferRole = (previousJoinPhrase: string): ArtistCreditRole => {
    return FEATURED_JOIN_PHRASE.test(previousJoinPhrase) ? 'featured' : 'primary';
};

const defaultCredits = (names: string[]): ArtistCreditValue[] => {
    return names.map((name, index) => ({
        name,
        role: 'primary',
        creditedName: null,
        joinPhrase: index < names.length - 1 ? DEFAULT_JOIN_PHRASE : ''
    }));
};

/**
 * Uses explicit multi-value tags as artist boundaries. A singular display tag
 * is never comma-split because commas are valid inside artist names.
 */
export const parseArtistCredits = ({
    displayName,
    names,
    fallbackName = 'unknown'
}: {
    displayName?: string | null;
    names?: string[] | null;
    fallbackName?: string;
}): ArtistCreditValue[] => {
    const display = displayName?.trim() ?? '';
    const explicitNames = (names ?? [])
        .map(name => name.trim())
        .filter(Boolean);

    if (!explicitNames.length) {
        return [{
            name: display || fallbackName,
            role: 'primary',
            creditedName: null,
            joinPhrase: ''
        }];
    }

    if (explicitNames.length === 1) {
        return [{
            name: explicitNames[0],
            role: 'primary',
            creditedName: display && display !== explicitNames[0] ? display : null,
            joinPhrase: ''
        }];
    }

    if (!display) {
        return defaultCredits(explicitNames);
    }

    const starts: number[] = [];
    let cursor = 0;

    for (const name of explicitNames) {
        const start = display.indexOf(name, cursor);

        if (start < 0 || starts.length === 0 && start !== 0) {
            return defaultCredits(explicitNames);
        }

        starts.push(start);
        cursor = start + name.length;
    }

    return explicitNames.map((name, index) => {
        const end = starts[index] + name.length;
        const nextStart = starts[index + 1] ?? display.length;
        const joinPhrase = display.slice(end, nextStart);
        const displayedArtistName = display.slice(starts[index], end);

        return {
            name,
            role: index === 0 ? 'primary' : inferRole(
                display.slice(
                    starts[index - 1] + explicitNames[index - 1].length,
                    starts[index]
                )
            ),
            creditedName: displayedArtistName !== name ? displayedArtistName : null,
            joinPhrase
        };
    });
};

export const formatArtistCredits = (
    credits: ReadonlyArray<{
        name?: string;
        creditedName?: string | null;
        joinPhrase: string;
        position?: number;
        Artist?: Pick<Artist, 'name'>;
    }>
) => {
    return [...credits]
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
        .map(credit => `${credit.creditedName || credit.Artist?.name || credit.name || ''}${credit.joinPhrase}`)
        .join('');
};

export const preserveArtistCreditPresentation = (
    incoming: ArtistCreditValue[],
    existing: ArtistCreditWithArtist[]
): ArtistCreditValue[] => {
    const orderedExisting = [...existing].sort((left, right) => left.position - right.position);

    if (
        incoming.length !== orderedExisting.length
        || incoming.some((credit, index) => credit.name !== orderedExisting[index].Artist.name)
    ) {
        return incoming;
    }

    return incoming.map((credit, index) => ({
        ...credit,
        role: normalizeRole(orderedExisting[index].role),
        creditedName: orderedExisting[index].creditedName,
        joinPhrase: orderedExisting[index].joinPhrase
    }));
};

export const findOrCreateArtist = async (
    transaction: Prisma.TransactionClient,
    name: string
) => {
    const normalizedName = normalizeArtistName(name);
    const existing = await transaction.artist.findFirst({
        where: { name },
        orderBy: { id: 'asc' }
    });

    if (!existing) {
        return transaction.artist.create({ data: { name, normalizedName } });
    }

    return existing.normalizedName === normalizedName
        ? existing
        : transaction.artist.update({
            where: { id: existing.id },
            data: { normalizedName }
        });
};

export const resolveArtistCreditArtists = async (
    transaction: Prisma.TransactionClient,
    credits: ArtistCreditValue[]
) => {
    return Promise.all(credits.map(credit => findOrCreateArtist(transaction, credit.name)));
};

type ArtistCreditOwner =
    | { recordingId: number; releaseId?: never; releaseTrackId?: never }
    | { recordingId?: never; releaseId: number; releaseTrackId?: never }
    | { recordingId?: never; releaseId?: never; releaseTrackId: number };

export const replaceArtistCredits = async (
    transaction: Prisma.TransactionClient,
    owner: ArtistCreditOwner,
    credits: ArtistCreditValue[]
) => {
    const artists = await resolveArtistCreditArtists(transaction, credits);

    await transaction.artistCredit.deleteMany({ where: owner });
    await transaction.artistCredit.createMany({
        data: credits.map((credit, position) => ({
            ...owner,
            artistId: artists[position].id,
            role: credit.role,
            position,
            creditedName: credit.creditedName,
            joinPhrase: credit.joinPhrase
        }))
    });

    return artists;
};

export const getEffectiveMusicArtistCredits = async (
    music: Pick<Music, 'recordingId' | 'releaseTrackId'>
): Promise<ArtistCreditWithArtist[]> => {
    const releaseTrackCredits = await models.artistCredit.findMany({
        where: { releaseTrackId: music.releaseTrackId },
        include: { Artist: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }]
    });

    if (releaseTrackCredits.length) {
        return releaseTrackCredits;
    }

    return models.artistCredit.findMany({
        where: { recordingId: music.recordingId },
        include: { Artist: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }]
    });
};

export const getReleaseArtistCredits = (releaseId: number) => {
    return models.artistCredit.findMany({
        where: { releaseId },
        include: { Artist: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }]
    });
};

export const toArtistCreditGraphQL = (credit: ArtistCreditWithArtist) => ({
    artist: credit.Artist,
    role: credit.role.toUpperCase(),
    position: credit.position,
    creditedName: credit.creditedName,
    joinPhrase: credit.joinPhrase
});

export const findActiveMusicIdsForArtist = async (artistId: number) => {
    const releaseTracks = await models.releaseTrack.findMany({
        where: {
            PhysicalFile: { some: { syncStatus: TRACK_SYNC_STATUS.active } },
            OR: [
                { ArtistCredit: { some: { artistId } } },
                {
                    ArtistCredit: { none: {} },
                    Recording: { ArtistCredit: { some: { artistId } } }
                }
            ]
        },
        select: { id: true }
    });

    return releaseTracks.map(({ id }) => id);
};

export const findActiveAlbumIdsForArtist = async (artistId: number) => {
    const releases = await models.release.findMany({
        where: {
            ArtistCredit: { some: { artistId } },
            ReleaseTrack: {
                some: { PhysicalFile: { some: { syncStatus: TRACK_SYNC_STATUS.active } } }
            }
        },
        select: { id: true }
    });

    return releases.map(({ id }) => id);
};

export const findActiveAppearsOnAlbumIdsForArtist = async (artistId: number) => {
    const regularAlbumIds = new Set(await findActiveAlbumIdsForArtist(artistId));
    const appearances = await models.releaseTrack.findMany({
        where: {
            releaseId: { notIn: [...regularAlbumIds] },
            PhysicalFile: { some: { syncStatus: TRACK_SYNC_STATUS.active } },
            OR: [
                { ArtistCredit: { some: { artistId } } },
                {
                    ArtistCredit: { none: {} },
                    Recording: { ArtistCredit: { some: { artistId } } }
                }
            ]
        },
        select: { releaseId: true }
    });

    return [...new Set(appearances.map(({ releaseId }) => releaseId))];
};

export const findActiveCreditedArtistIds = async () => {
    const activeMusic = await models.music.findMany({
        where: { syncStatus: TRACK_SYNC_STATUS.active },
        select: { recordingId: true, releaseTrackId: true, albumId: true }
    });
    const releaseTrackIds = [...new Set(activeMusic.map(music => music.releaseTrackId))];
    const releaseIds = [...new Set(activeMusic.map(music => music.albumId))];
    const releaseTrackOverrides = await models.artistCredit.findMany({
        where: { releaseTrackId: { in: releaseTrackIds } },
        select: { artistId: true, releaseTrackId: true }
    });
    const overriddenReleaseTrackIds = new Set(
        releaseTrackOverrides
            .map(credit => credit.releaseTrackId)
            .filter((id): id is number => id !== null)
    );
    const fallbackRecordingIds = activeMusic
        .filter(music => !overriddenReleaseTrackIds.has(music.releaseTrackId))
        .map(music => music.recordingId);
    const fallbackCredits = await models.artistCredit.findMany({
        where: { recordingId: { in: fallbackRecordingIds } },
        select: { artistId: true }
    });
    const releaseCredits = await models.artistCredit.findMany({
        where: { releaseId: { in: releaseIds } },
        select: { artistId: true }
    });

    return [...new Set([
        ...releaseTrackOverrides.map(credit => credit.artistId),
        ...fallbackCredits.map(credit => credit.artistId),
        ...releaseCredits.map(credit => credit.artistId)
    ])];
};
