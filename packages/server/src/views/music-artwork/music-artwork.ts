import { connectors } from '~/socket/connectors';
import { MUSIC_UPDATED } from '~/socket/music';
import { withOriginClientId } from '~/socket/origin-client';
import {
    isAlbumArtworkServiceError,
    restoreAlbumArtwork,
    updateAlbumArtwork
} from '~/features/music/services/album-artwork';
import type { Controller } from '~/types';

const getOriginClientId = (value: string | string[] | undefined) => {
    return Array.isArray(value) ? value[0] : value;
};

const getRouteParam = (value: string | string[] | undefined) => {
    return getOriginClientId(value) ?? '';
};

const notifyArtworkUpdate = async (musicId: string, originClientId?: string) => {
    try {
        await connectors.notify(MUSIC_UPDATED, withOriginClientId({ musicId }, originClientId));
    } catch (error) {
        console.error(error);
    }
};

const handleArtworkError = (error: unknown, res: Parameters<Controller>[1]) => {
    if (isAlbumArtworkServiceError(error)) {
        const status = error.code === 'MUSIC_NOT_FOUND' ? 404 : 400;
        res.status(status).json({
            code: error.code,
            message: error.message
        }).end();
        return;
    }

    throw error;
};

export const putMusicArtwork: Controller = async (req, res) => {
    try {
        const musicId = getRouteParam(req.params.id);
        const result = await updateAlbumArtwork({
            musicId,
            pictureData: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
        });

        await notifyArtworkUpdate(
            musicId,
            getOriginClientId(req.headers['x-ocean-origin-client-id'])
        );
        res.status(200).json(result).end();
    } catch (error) {
        handleArtworkError(error, res);
    }
};

export const deleteMusicArtwork: Controller = async (req, res) => {
    try {
        const musicId = getRouteParam(req.params.id);
        const result = await restoreAlbumArtwork(musicId);

        await notifyArtworkUpdate(
            musicId,
            getOriginClientId(req.headers['x-ocean-origin-client-id'])
        );
        res.status(200).json(result).end();
    } catch (error) {
        handleArtworkError(error, res);
    }
};
