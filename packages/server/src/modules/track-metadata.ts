import path from 'path';

import {
    formatArtistCredits,
    normalizeArtistCredits,
    parseArtistCredits,
    type ArtistCreditValue
} from './artist-credits';
import { parseBuffer } from './music-metadata';

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
    trackNumber: number;
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
        track
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
        trackNumber: track?.no || 1,
        codec,
        container,
        bitrate,
        duration,
        sampleRate
    };
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

        return {
            ...metadata,
            ...override,
            artist: formatArtistCredits(artistCredits),
            artistCredits,
            albumArtist: albumArtistCredits ? formatArtistCredits(albumArtistCredits) : null,
            albumArtistCredits,
            pictureData: metadata.pictureData
        };
    } catch {
        return metadata;
    }
};
