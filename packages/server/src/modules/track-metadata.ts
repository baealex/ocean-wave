import path from 'path';

import { parseBuffer } from './music-metadata';

export interface ParsedTrackMetadata {
    title: string;
    albumArtist: string | null;
    artist: string;
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
    artist: string;
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
        artist = 'unknown',
        album = 'unknown',
        picture,
        genre = [],
        year = (new Date()).getFullYear(),
        track
    } = common;

    return {
        title,
        albumArtist,
        artist,
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
        const override = JSON.parse(serializedOverride) as MusicMetadataOverride;

        return {
            ...metadata,
            ...override,
            pictureData: metadata.pictureData
        };
    } catch {
        return metadata;
    }
};
