import fs from 'fs';
import path from 'path';

import models from '~/models';
import {
    getVersionedAlbumCoverPath,
    removeAlbumCoverCache,
    saveCustomAlbumCover,
    syncAlbumCoverCache
} from '~/modules/album-cover-cache';
import {
    resolveCachePath,
    resolveMusicFilePath
} from '~/modules/storage-paths';
import { parseTrackMetadata } from '~/modules/track-metadata';

export class AlbumArtworkServiceError extends Error {
    code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'AlbumArtworkServiceError';
        this.code = code;
    }
}

export const isAlbumArtworkServiceError = (
    error: unknown
): error is AlbumArtworkServiceError => {
    return error instanceof AlbumArtworkServiceError;
};

const findMusicWithAlbum = async (id: string) => {
    const musicId = Number(id);

    if (!Number.isInteger(musicId) || musicId < 1) {
        throw new AlbumArtworkServiceError('Music not found.', 'MUSIC_NOT_FOUND');
    }

    const music = await models.music.findUnique({
        where: { id: musicId },
        include: { Album: true }
    });

    if (!music) {
        throw new AlbumArtworkServiceError('Music not found.', 'MUSIC_NOT_FOUND');
    }

    return music;
};

const getCoverCachePaths = () => {
    const cachePath = resolveCachePath();

    return {
        cachePath,
        resizedPath: path.join(cachePath, 'resized')
    };
};

export const updateAlbumArtwork = async ({
    musicId,
    pictureData
}: {
    musicId: string;
    pictureData: Buffer;
}) => {
    if (!pictureData.length) {
        throw new AlbumArtworkServiceError('Choose an image to upload.', 'INVALID_ALBUM_ARTWORK');
    }

    const music = await findMusicWithAlbum(musicId);
    const cachePaths = getCoverCachePaths();

    let cover: string;

    try {
        cover = await saveCustomAlbumCover({
            albumId: music.albumId,
            pictureData,
            ...cachePaths
        });
    } catch {
        throw new AlbumArtworkServiceError(
            'The selected file is not a supported image.',
            'INVALID_ALBUM_ARTWORK'
        );
    }

    const album = await models.album.update({
        where: { id: music.albumId },
        data: {
            cover,
            isCoverCustom: true
        }
    });

    return {
        albumId: album.id.toString(),
        cover: getVersionedAlbumCoverPath(album.id, album.updatedAt),
        isCoverCustom: album.isCoverCustom
    };
};

export const restoreAlbumArtwork = async (musicId: string) => {
    const music = await findMusicWithAlbum(musicId);
    const albumMusics = await models.music.findMany({
        where: { albumId: music.albumId },
        orderBy: { id: 'asc' },
        select: { filePath: true }
    });
    const cachePaths = getCoverCachePaths();
    let pictureData: Buffer | null = null;

    for (const albumMusic of albumMusics) {
        const filePath = resolveMusicFilePath(albumMusic.filePath);

        if (!fs.existsSync(filePath)) {
            continue;
        }

        try {
            const metadata = await parseTrackMetadata(filePath, fs.readFileSync(filePath));

            if (metadata.pictureData) {
                pictureData = metadata.pictureData;
                break;
            }
        } catch {
            continue;
        }
    }

    const cover = pictureData
        ? await syncAlbumCoverCache({
            albumId: music.albumId,
            currentCoverPath: music.Album.cover,
            pictureData,
            ...cachePaths
        })
        : '';

    if (!pictureData) {
        removeAlbumCoverCache({ albumId: music.albumId, ...cachePaths });
    }

    const album = await models.album.update({
        where: { id: music.albumId },
        data: {
            cover,
            isCoverCustom: false
        }
    });

    return {
        albumId: album.id.toString(),
        cover: album.cover ? getVersionedAlbumCoverPath(album.id, album.updatedAt) : '',
        isCoverCustom: album.isCoverCustom
    };
};
