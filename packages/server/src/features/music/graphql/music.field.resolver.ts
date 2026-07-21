import type { IResolvers } from '@graphql-tools/utils';

import models, {
    type Music,
    type PhysicalFile,
    type Prisma
} from '~/models';
import {
    type ArtistCreditWithArtist,
    formatArtistCredits,
    getEffectiveMusicArtistCredits,
    toArtistCreditGraphQL
} from '~/modules/artist-credits';
import { selectPhysicalFileForReleaseTrack } from '~/modules/physical-file-selection';
import {
    getEffectiveVersionMetadata,
    parseTrackTagSnapshot
} from '~/modules/track-version';
import {
    getMusicFileVersions,
    getMusicGroupingCandidates,
    getMusicRecordingAppearances
} from '../services/version-groups';

type MusicFieldResolvers = NonNullable<IResolvers['Music']>;

const toIsoString = (value: Date | null) => value?.toISOString() ?? null;
const artistCreditRequests = new WeakMap<object, Promise<ArtistCreditWithArtist[]>>();
type ReleaseTrackWithRecording = Prisma.ReleaseTrackGetPayload<{
    include: { Recording: true; PhysicalFile: true };
}>;
const releaseTrackRequests = new WeakMap<object, Promise<ReleaseTrackWithRecording | null>>();
const selectedFileRequests = new WeakMap<object, Promise<PhysicalFile | null>>();
const versionMetadataRequests = new WeakMap<object, Promise<ReturnType<
typeof getEffectiveVersionMetadata
>>>();

const getArtistCredits = (music: Music) => {
    const existingRequest = artistCreditRequests.get(music);

    if (existingRequest) {
        return existingRequest;
    }

    const request = getEffectiveMusicArtistCredits(music);
    artistCreditRequests.set(music, request);
    return request;
};

const getReleaseTrack = (music: Music) => {
    const existingRequest = releaseTrackRequests.get(music);

    if (existingRequest) return existingRequest;

    const request = models.releaseTrack.findUnique({
        where: { id: music.releaseTrackId },
        include: {
            Recording: true,
            PhysicalFile: { orderBy: { id: 'asc' } }
        }
    });
    releaseTrackRequests.set(music, request);
    return request;
};

const getVersionMetadata = (music: Music) => {
    const existingRequest = versionMetadataRequests.get(music);
    if (existingRequest) return existingRequest;

    const request = Promise.all([getReleaseTrack(music), getSelectedFile(music)])
        .then(([track, selectedFile]) => {
            if (!track) {
                return getEffectiveVersionMetadata({
                    title: music.name,
                    recordingVersionTitle: null,
                    releaseVersionTitle: null
                });
            }

            const orderedFiles = selectedFile
                ? [
                    selectedFile,
                    ...track.PhysicalFile.filter(file => file.id !== selectedFile.id)
                ]
                : track.PhysicalFile;
            const snapshots = orderedFiles.map(file => (
                parseTrackTagSnapshot(file.tagSnapshotJson)
            ));

            return getEffectiveVersionMetadata({
                title: track.titleOverride ?? track.Recording.title,
                recordingVersionTitle: track.Recording.versionTitle
                    ?? snapshots.find(snapshot => snapshot?.recordingVersionTitle)
                        ?.recordingVersionTitle
                    ?? null,
                releaseVersionTitle: track.versionTitle
                    ?? snapshots.find(snapshot => snapshot?.releaseVersionTitle)
                        ?.releaseVersionTitle
                    ?? null
            });
        });
    versionMetadataRequests.set(music, request);
    return request;
};

const getSelectedFile = (music: Music) => {
    const existingRequest = selectedFileRequests.get(music);

    if (existingRequest) return existingRequest;

    const request = selectPhysicalFileForReleaseTrack(music.releaseTrackId);
    selectedFileRequests.set(music, request);
    return request;
};

export const musicFieldResolvers: MusicFieldResolvers = {
    recordingTitle: async (music: Music) => (
        (await getReleaseTrack(music))?.Recording.title ?? music.name
    ),
    titleOverride: async (music: Music) => (
        (await getReleaseTrack(music))?.titleOverride ?? null
    ),
    duration: async (music: Music) => (
        (await getSelectedFile(music))?.durationMs ?? Math.round(music.duration * 1_000)
    ) / 1_000,
    codec: async (music: Music) => (await getSelectedFile(music))?.codec ?? music.codec,
    bitrate: async (music: Music) => (await getSelectedFile(music))?.bitrate ?? music.bitrate,
    sampleRate: async (music: Music) => (
        (await getSelectedFile(music))?.sampleRate ?? music.sampleRate
    ),
    filePath: async (music: Music) => (await getSelectedFile(music))?.filePath ?? music.filePath,
    hasMetadataOverride: async (music: Music) => {
        const selectedFile = await getSelectedFile(music);
        return Boolean(selectedFile
            ? selectedFile.legacyMetadataOverride
            : music.metadataOverride);
    },
    lastPlayedAt: (music: Music) => toIsoString(music.lastPlayedAt),
    lastSkippedAt: (music: Music) => toIsoString(music.lastSkippedAt),
    lastCompletedAt: (music: Music) => toIsoString(music.lastCompletedAt),
    discNumber: async (music: Music) => (await getReleaseTrack(music))?.discNumber ?? null,
    trackNumber: async (music: Music) => (await getReleaseTrack(music))?.trackNumber ?? null,
    recordingVersionTitle: async (music: Music) => (
        (await getVersionMetadata(music)).recordingVersionTitle
    ),
    releaseVersionTitle: async (music: Music) => (
        (await getVersionMetadata(music)).releaseVersionTitle
    ),
    files: (music: Music) => getMusicFileVersions(music.releaseTrackId),
    recordingAppearances: (music: Music) => getMusicRecordingAppearances(
        music.releaseTrackId
    ),
    groupingCandidates: (music: Music) => getMusicGroupingCandidates(music.releaseTrackId),
    artist: (music: Music) => models.artist.findUnique({ where: { id: music.artistId } }),
    artistDisplayName: async (music: Music) => formatArtistCredits(await getArtistCredits(music)),
    artistCredits: async (music: Music) => (
        (await getArtistCredits(music)).map(toArtistCreditGraphQL)
    ),
    recordingArtistCredits: async (music: Music) => (
        (await models.artistCredit.findMany({
            where: { recordingId: music.recordingId },
            include: { Artist: true },
            orderBy: [{ position: 'asc' }, { id: 'asc' }]
        })).map(toArtistCreditGraphQL)
    ),
    hasReleaseTrackArtistCredits: (music: Music) => models.artistCredit.count({
        where: { releaseTrackId: music.releaseTrackId }
    }).then(count => count > 0),
    album: (music: Music) => models.album.findUnique({ where: { id: music.albumId } }),
    genres: (music: Music) => models.genre.findMany({
        where: { RecordingGenre: { some: { recordingId: music.recordingId } } }
    }),
    tags: (music: Music) => models.tag.findMany({
        where: { MusicTag: { some: { musicId: music.recordingId } } },
        orderBy: [
            { order: 'asc' },
            { name: 'asc' }
        ]
    }),
    isLiked: (music: Music) => models.musicLike.findFirst({ where: { musicId: music.recordingId } }).then((like) => !!like),
    isHated: (music: Music) => models.musicHate.findFirst({ where: { musicId: music.recordingId } }).then((hate) => !!hate)
};
