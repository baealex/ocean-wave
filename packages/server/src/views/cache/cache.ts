import fs from 'fs';
import path from 'path';
import { parseBuffer } from '../../modules/music-metadata';

import models from '~/models';
import type { Controller } from '~/types';

import {
    parseAlbumIdFromCoverRequestPath,
    syncAlbumCoverCache
} from '../../modules/album-cover-cache';
import {
    resolveCachePath,
    resolveMusicFilePath
} from '../../modules/storage-paths';

export const cacheAsset: Controller = async (req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        next?.();
        return;
    }

    const cachePath = resolveCachePath();
    const requestedFilePath = path.join(cachePath, req.path);

    if (fs.existsSync(requestedFilePath)) {
        next?.();
        return;
    }

    const albumId = parseAlbumIdFromCoverRequestPath(req.path);

    if (albumId === null) {
        next?.();
        return;
    }

    const music = await models.music.findFirst({
        where: { albumId },
        orderBy: { id: 'asc' },
        select: {
            filePath: true,
            Album: { select: { isCoverCustom: true } }
        }
    });

    if (!music || music.Album.isCoverCustom) {
        next?.();
        return;
    }

    const sourceFilePath = resolveMusicFilePath(music.filePath);

    if (!fs.existsSync(sourceFilePath)) {
        next?.();
        return;
    }

    const fileData = fs.readFileSync(sourceFilePath);
    const metadata = await parseBuffer(fileData);
    const rawPictureData = metadata.common.picture?.[0]?.data;
    const pictureData = rawPictureData ? Buffer.from(rawPictureData) : null;

    if (!pictureData) {
        next?.();
        return;
    }

    await syncAlbumCoverCache({
        albumId,
        currentCoverPath: req.path,
        pictureData,
        cachePath,
        resizedPath: path.join(cachePath, 'resized')
    });

    next?.();
};
