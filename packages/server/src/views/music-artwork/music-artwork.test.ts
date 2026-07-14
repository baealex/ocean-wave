import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

import { createApp } from '~/app';
import models from '~/models';
import { AUTH_SESSION_COOKIE_NAME, type AuthConfig } from '~/modules/auth-mode';

const openAuthConfig: AuthConfig = {
    mode: 'open',
    source: 'explicit-open',
    cookieName: AUTH_SESSION_COOKIE_NAME
};
const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

describe('music artwork API', () => {
    const originalCachePath = process.env.OCEAN_WAVE_CACHE_PATH;
    let cachePath: string;

    beforeEach(() => {
        cachePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-artwork-'));
        process.env.OCEAN_WAVE_CACHE_PATH = cachePath;
    });

    afterEach(() => {
        process.env.OCEAN_WAVE_CACHE_PATH = originalCachePath;
        fs.rmSync(cachePath, { recursive: true, force: true });
    });

    it('stores custom artwork and can restore the album to embedded artwork behavior', async () => {
        const artist = await models.artist.create({ data: { name: 'Artwork Artist' } });
        const album = await models.album.create({
            data: {
                name: 'Artwork Album',
                cover: '',
                publishedYear: '2026',
                artistId: artist.id
            }
        });
        const music = await models.music.create({
            data: {
                name: 'Artwork Track',
                artistId: artist.id,
                albumId: album.id,
                filePath: 'missing/artwork-track.mp3',
                duration: 180,
                codec: 'mp3',
                container: 'mp3',
                bitrate: 320_000,
                sampleRate: 44_100,
                trackNumber: 1
            }
        });
        const app = createApp(openAuthConfig);

        const uploadResponse = await request(app)
            .put(`/api/music/${music.id}/artwork`)
            .set('Content-Type', 'image/png')
            .send(onePixelPng);

        expect(uploadResponse.status).toBe(200);
        expect(uploadResponse.body).toMatchObject({
            albumId: album.id.toString(),
            isCoverCustom: true
        });
        expect(fs.existsSync(path.join(cachePath, `${album.id}.jpg`))).toBe(true);
        expect(fs.existsSync(path.join(cachePath, 'resized', `${album.id}.jpg`))).toBe(true);
        await expect(models.album.findUniqueOrThrow({ where: { id: album.id } })).resolves.toMatchObject({
            isCoverCustom: true
        });

        const restoreResponse = await request(app).delete(`/api/music/${music.id}/artwork`);

        expect(restoreResponse.status).toBe(200);
        expect(restoreResponse.body).toMatchObject({
            albumId: album.id.toString(),
            cover: '',
            isCoverCustom: false
        });
        expect(fs.existsSync(path.join(cachePath, `${album.id}.jpg`))).toBe(false);
        expect(fs.existsSync(path.join(cachePath, 'resized', `${album.id}.jpg`))).toBe(false);
    });
});
