import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as views from './views';
import { requireAuthenticatedRequest } from './modules/auth';
import type { AuthConfig } from './modules/auth-mode';
import useAsync from './modules/use-async';

export const createApiRouter = (authConfig: AuthConfig) => {
    const apiRateLimit = rateLimit({
        windowMs: 60_000,
        limit: 300,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { message: 'Too many API requests. Please try again later.' }
    });
    const resourceAccessRateLimit = rateLimit({
        windowMs: 60_000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { message: 'Too many resource-intensive requests. Please try again later.' }
    });

    return Router()
        .use(apiRateLimit)
        .get('/auth/session', useAsync(views.createSessionStatusHandler(authConfig)))
        .post('/auth/login', useAsync(views.createApiLoginHandler(authConfig)))
        .post('/auth/logout', useAsync(views.createApiLogoutHandler(authConfig)))
        .use('/auth', (_req, res) => {
            res.status(404).json({ message: 'Not Found' }).end();
        })
        .use(requireAuthenticatedRequest(authConfig))
        .put(
            '/music/:id/artwork',
            resourceAccessRateLimit,
            express.raw({
                type: ['image/jpeg', 'image/png', 'image/webp'],
                limit: '10mb'
            }),
            useAsync(views.putMusicArtwork)
        )
        .delete('/music/:id/artwork', resourceAccessRateLimit, useAsync(views.deleteMusicArtwork))
        .get('/library/backup', resourceAccessRateLimit, useAsync(views.downloadLibraryBackup))
        .post('/library/restore/preview', useAsync(views.previewLibraryRestore))
        .post('/library/restore/apply', useAsync(views.applyLibraryRestore))
        .use('/diagnostics/connectivity', resourceAccessRateLimit)
        .get('/diagnostics/connectivity', useAsync(views.connectivityDiagnostics))
        .post('/playlists/imports/preview', useAsync(views.previewPlaylist))
        .get('/playlists/imports/:id', useAsync(views.getPlaylistReport))
        .patch('/playlists/imports/:id/mappings', useAsync(views.mapPlaylistItems))
        .post('/playlists/imports/:id/relink', useAsync(views.relinkPlaylistItems))
        .post('/playlists/imports/:id/apply', useAsync(views.applyPlaylist))
        .get('/playlists/:id/export', useAsync(views.downloadPlaylist))
        .get('/playlists/:id/offline-assets', useAsync(views.getPlaylistOfflineAssets))
        .get('/audio/:id', useAsync(views.audio))
        .get('/home', useAsync(views.home));
};

export default createApiRouter;
