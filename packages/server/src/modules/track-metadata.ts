import path from 'path';

import {
    formatArtistCredits,
    normalizeArtistCredits,
    parseArtistCredits,
    type ArtistCreditValue
} from './artist-credits';
import { parseBuffer } from './music-metadata';
import {
    normalizePositiveInteger,
    normalizeReleaseType,
    type ReleaseType
} from './release-metadata';
import {
    parseTrackIdentifiers,
    resolveTrackVersionMetadata,
    serializeTrackTagSnapshot,
    type TrackIdentifier
} from './track-version';

export interface ParsedTrackMetadata {
    title: string;
    albumArtist: string | null;
    albumArtistCredits: ArtistCreditValue[] | null;
    artist: string;
    artistCredits: ArtistCreditValue[];
    album: string;
    pictureData: Buffer | null;
    genres: string[];
    year: string;
    releaseType: ReleaseType;
    discNumber: number | null;
    totalDiscs: number | null;
    trackNumber: number | null;
    recordingVersionTitle: string | null;
    releaseVersionTitle: string | null;
    identifiers: TrackIdentifier[];
    codec: string;
    container: string;
    bitrate: number;
    duration: number;
    sampleRate: number;
}

export interface MusicMetadataOverride {
    title: string;
    albumArtist: string | null;
    albumArtistCredits: ArtistCreditValue[] | null;
    artist: string;
    artistCredits: ArtistCreditValue[];
    album: string;
    genres: string[];
    year: string;
    trackNumber: number;
    releaseType?: ReleaseType;
    discNumber?: number | null;
    totalDiscs?: number | null;
}

export const parseTrackMetadata = async (
    filePath: string,
    data: Buffer
): Promise<ParsedTrackMetadata> => {
    const { format, common } = await parseBuffer(data);
    const {
        container = '',
        codec = '',
        bitrate = 0,
        duration = 0,
        sampleRate = 0
    } = format;
    const {
        title = path.parse(filePath).name,
        albumartist: albumArtist = null,
        albumartists,
        artist = 'unknown',
        artists,
        album = 'unknown',
        picture,
        genre = [],
        year = (new Date()).getFullYear(),
        track,
        disk,
        totaldiscs,
        releasetype,
        compilation,
        subtitle,
        remixer
    } = common;

    const artistCredits = parseArtistCredits({
        displayName: artist,
        names: artists,
        fallbackName: 'unknown'
    });
    const albumArtistCredits = albumArtist || albumartists?.length
        ? parseArtistCredits({
            displayName: albumArtist,
            names: albumartists,
            fallbackName: artistCredits[0].name
        })
        : null;
    const versionMetadata = resolveTrackVersionMetadata({
        title,
        subtitles: subtitle,
        remixers: remixer
    });

    return {
        title,
        albumArtist: albumArtistCredits ? formatArtistCredits(albumArtistCredits) : null,
        albumArtistCredits,
        artist: formatArtistCredits(artistCredits),
        artistCredits,
        album,
        pictureData: picture?.[0]?.data ? Buffer.from(picture[0].data) : null,
        genres: genre,
        year: year.toString(),
        releaseType: normalizeReleaseType({ values: releasetype, compilation }),
        discNumber: normalizePositiveInteger(disk?.no),
        totalDiscs: normalizePositiveInteger(disk?.of)
            ?? normalizePositiveInteger(totaldiscs),
        trackNumber: normalizePositiveInteger(track?.no),
        ...versionMetadata,
        identifiers: parseTrackIdentifiers(common),
        codec,
        container,
        bitrate,
        duration,
        sampleRate
    };
};

export const createTrackTagSnapshot = (metadata: ParsedTrackMetadata) => {
    return serializeTrackTagSnapshot({
        identifiers: metadata.identifiers,
        recordingVersionTitle: metadata.recordingVersionTitle,
        releaseVersionTitle: metadata.releaseVersionTitle
    });
};

export const serializeMusicMetadataOverride = (metadata: MusicMetadataOverride) => {
    return JSON.stringify(metadata);
};

export const applyMusicMetadataOverride = (
    metadata: ParsedTrackMetadata,
    serializedOverride: string | null | undefined
): ParsedTrackMetadata => {
    if (!serializedOverride) {
        return metadata;
    }

    try {
        const override = JSON.parse(serializedOverride) as Partial<MusicMetadataOverride>;
        const artistCredits = Array.isArray(override.artistCredits)
            ? normalizeArtistCredits(override.artistCredits)
            : parseArtistCredits({
                displayName: override.artist ?? metadata.artist,
                fallbackName: metadata.artistCredits[0].name
            });
        const albumArtistCredits = Array.isArray(override.albumArtistCredits)
            ? normalizeArtistCredits(override.albumArtistCredits, 'Album artist credits')
            : override.albumArtist
                ? parseArtistCredits({ displayName: override.albumArtist })
                : override.albumArtist === null
                    ? null
                    : metadata.albumArtistCredits;
        const releaseType = override.releaseType === undefined
            ? metadata.releaseType
            : normalizeReleaseType({ values: override.releaseType });
        const discNumber = override.discNumber === undefined
            ? metadata.discNumber
            : normalizePositiveInteger(override.discNumber);
        const totalDiscs = override.totalDiscs === undefined
            ? metadata.totalDiscs
            : normalizePositiveInteger(override.totalDiscs);
        const trackNumber = override.trackNumber === undefined
            ? metadata.trackNumber
            : normalizePositiveInteger(override.trackNumber);

        return {
            ...metadata,
            ...override,
            artist: formatArtistCredits(artistCredits),
            artistCredits,
            albumArtist: albumArtistCredits ? formatArtistCredits(albumArtistCredits) : null,
            albumArtistCredits,
            releaseType,
            discNumber,
            totalDiscs,
            trackNumber,
            pictureData: metadata.pictureData
        };
    } catch {
        return metadata;
    }
};
