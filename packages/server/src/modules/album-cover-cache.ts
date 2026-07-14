import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export const ALBUM_COVER_CACHE_PREFIX = '/cache/resized/';

const ensureDirectory = (directoryPath: string) => {
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }
};

export const getAlbumCoverFileName = (albumId: number) => {
    return `${albumId}.jpg`;
};

export const getAlbumCoverPath = (albumId: number) => {
    return `${ALBUM_COVER_CACHE_PREFIX}${getAlbumCoverFileName(albumId)}`;
};

export const getVersionedAlbumCoverPath = (albumId: number, updatedAt: Date) => {
    return `${getAlbumCoverPath(albumId)}?v=${updatedAt.getTime()}`;
};

export const parseAlbumIdFromCoverRequestPath = (requestPath: string) => {
    const match = requestPath.match(/^\/resized\/(\d+)\.jpg$/);

    if (!match) {
        return null;
    }

    const albumId = Number(match[1]);

    return Number.isInteger(albumId)
        ? albumId
        : null;
};

export const hasHealthyAlbumCoverCache = ({
    coverPath,
    cachePath,
    resizedPath
}: {
    coverPath: string;
    cachePath: string;
    resizedPath: string;
}) => {
    if (!coverPath.startsWith(ALBUM_COVER_CACHE_PREFIX)) {
        return true;
    }

    const fileName = path.basename(coverPath);

    return (
        fs.existsSync(path.join(cachePath, fileName))
        && fs.existsSync(path.join(resizedPath, fileName))
    );
};

export const syncAlbumCoverCache = async ({
    albumId,
    currentCoverPath,
    pictureData,
    cachePath,
    resizedPath
}: {
    albumId: number;
    currentCoverPath: string;
    pictureData: Buffer | null;
    cachePath: string;
    resizedPath: string;
}) => {
    if (!pictureData) {
        return currentCoverPath;
    }

    ensureDirectory(cachePath);
    ensureDirectory(resizedPath);

    const fileName = getAlbumCoverFileName(albumId);
    const savePath = path.join(cachePath, fileName);
    const resizedSavePath = path.join(resizedPath, fileName);
    const hasOriginalCache = fs.existsSync(savePath);
    const shouldUpdate = !hasOriginalCache || !fs.readFileSync(savePath).equals(pictureData);

    if (shouldUpdate) {
        fs.writeFileSync(savePath, pictureData);
    }

    if (!fs.existsSync(resizedSavePath) || shouldUpdate) {
        await sharp(savePath)
            .resize(300, 300)
            .toFile(resizedSavePath);
    }

    return getAlbumCoverPath(albumId);
};

export const saveCustomAlbumCover = async ({
    albumId,
    pictureData,
    cachePath,
    resizedPath
}: {
    albumId: number;
    pictureData: Buffer;
    cachePath: string;
    resizedPath: string;
}) => {
    ensureDirectory(cachePath);
    ensureDirectory(resizedPath);

    const normalizedPicture = await sharp(pictureData, {
        limitInputPixels: 40_000_000
    })
        .rotate()
        .jpeg({ quality: 90 })
        .toBuffer();
    const fileName = getAlbumCoverFileName(albumId);

    fs.writeFileSync(path.join(cachePath, fileName), normalizedPicture);
    await sharp(normalizedPicture)
        .resize(300, 300, { fit: 'cover' })
        .toFile(path.join(resizedPath, fileName));

    return getAlbumCoverPath(albumId);
};

export const removeAlbumCoverCache = ({
    albumId,
    cachePath,
    resizedPath
}: {
    albumId: number;
    cachePath: string;
    resizedPath: string;
}) => {
    const fileName = getAlbumCoverFileName(albumId);

    fs.rmSync(path.join(cachePath, fileName), { force: true });
    fs.rmSync(path.join(resizedPath, fileName), { force: true });
};
