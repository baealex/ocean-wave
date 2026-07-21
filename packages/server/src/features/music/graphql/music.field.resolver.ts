import type { IResolvers } from '@graphql-tools/utils';

import models, { type Music } from '~/models';
import {
    formatArtistCredits,
    getEffectiveMusicArtistCredits,
    toArtistCreditGraphQL,
    type ArtistCreditWithArtist
} from '~/modules/artist-credits';

type MusicFieldResolvers = NonNullable<IResolvers['Music']>;

const toIsoString = (value: Date | null) => value?.toISOString() ?? null;
const artistCreditRequests = new WeakMap<object, Promise<ArtistCreditWithArtist[]>>();

const getArtistCredits = (music: Music) => {
    const existingRequest = artistCreditRequests.get(music);

    if (existingRequest) {
        return existingRequest;
    }

    const request = getEffectiveMusicArtistCredits(music);
    artistCreditRequests.set(music, request);
    return request;
};

export const musicFieldResolvers: MusicFieldResolvers = {
    hasMetadataOverride: (music: Music) => Boolean(music.metadataOverride),
    lastPlayedAt: (music: Music) => toIsoString(music.lastPlayedAt),
    lastSkippedAt: (music: Music) => toIsoString(music.lastSkippedAt),
    lastCompletedAt: (music: Music) => toIsoString(music.lastCompletedAt),
    artist: (music: Music) => models.artist.findUnique({ where: { id: music.artistId } }),
    artistDisplayName: async (music: Music) => formatArtistCredits(await getArtistCredits(music)),
    artistCredits: async (music: Music) => (
        (await getArtistCredits(music)).map(toArtistCreditGraphQL)
    ),
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
