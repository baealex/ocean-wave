import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseBuffer } from '../../modules/music-metadata';
import request from 'supertest';

import models from '~/models';
import { createApp } from '~/app';
import { AUTH_SESSION_COOKIE_NAME, type AuthConfig } from '~/modules/auth-mode';
import { resolveCachePath } from '~/modules/storage-paths';

jest.mock('../../modules/music-metadata', () => ({ parseBuffer: jest.fn() }));

jest.mock('sharp', () => {
    return jest.fn(() => ({
        resize: jest.fn().mockReturnThis(),
        toFile: jest.fn().mockImplementation(async (outputPath: string) => {
            fs.writeFileSync(outputPath, 'resized-artwork');
        })
    }));
});

const parseBufferMock = jest.mocked(parseBuffer);
const openAuthConfig: AuthConfig = {
    mode: 'open',
    source: 'explicit-open',
    cookieName: AUTH_SESSION_COOKIE_NAME
};

const createTempTrackFile = ({
    directory,
    relativePath,
    contents
}: {
    directory: string;
    relativePath: string;
    contents: string;
}) => {
    const absolutePath = path.join(directory, relativePath);

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);

    return absolutePath;
};

describe('GET /cache/resized/:albumId.jpg', () => {
    const tempDirectories: string[] = [];
    const workspaceDirectories: string[] = [];
    const originalCachePath = process.env.OCEAN_WAVE_CACHE_PATH;

    beforeEach(async () => {
        jest.restoreAllMocks();
        parseBufferMock.mockReset();
        parseBufferMock.mockImplementation(async (data) => {
            const entries = Object.fromEntries(
                data.toString().split('|').map((entry) => entry.split('='))
            );

            return {
                format: {},
                common: {
                    picture: entries.picture
                        ? [
                            {
                                data: Buffer.from(entries.picture),
                                format: 'image/jpeg'
                            }
                        ]
                        : []
                }
            } as never;
        });

        const workspaceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-cache-view-workspace-'));
        workspaceDirectories.push(workspaceDirectory);
        process.env.OCEAN_WAVE_CACHE_PATH = path.join(workspaceDirectory, 'cache');

        await models.playbackEvent.deleteMany();
        await models.syncReportItem.deleteMany();
        await models.syncReport.deleteMany();
        await models.playlistMusic.deleteMany();
        await models.playlist.deleteMany();
        await models.musicLike.deleteMany();
        await models.musicHate.deleteMany();
        await models.music.deleteMany();
        await models.album.deleteMany();
        await models.artist.deleteMany();
        await models.genre.deleteMany();
    });

    afterEach(() => {
        process.env.OCEAN_WAVE_CACHE_PATH = originalCachePath;

        while (tempDirectories.length > 0) {
            fs.rmSync(tempDirectories.pop()!, {
                recursive: true,
                force: true
            });
        }

        while (workspaceDirectories.length > 0) {
            fs.rmSync(workspaceDirectories.pop()!, {
                recursive: true,
                force: true
            });
        }
    });

    it('regenerates a missing cached cover from track metadata on request', async () => {
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-wave-cover-view-'));
        tempDirectories.push(tempDirectory);

        const trackPath = createTempTrackFile({
            directory: tempDirectory,
            relativePath: 'library/track-a.mp3',
            contents: 'picture=cover-art-a'
        });

        const artist = await models.artist.create({ data: { name: 'Artist A' } });
        const album = await models.album.create({
            data: {
                name: 'Album A',
                cover: '/cache/resized/1.jpg',
                publishedYear: '2026',
                artistId: artist.id
            }
        });
        await models.music.create({
            data: {
                name: 'Track A',
                artistId: artist.id,
                albumId: album.id,
                filePath: trackPath,
                duration: 180,
                codec: 'mp3',
                container: 'mp3',
                bitrate: 320,
                sampleRate: 44100,
                trackNumber: 1
            }
        });

        const app = createApp(openAuthConfig);
        const response = await request(app).get(`/cache/resized/${album.id}.jpg`);

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/image\/jpeg/);
        expect(parseBufferMock).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(path.join(resolveCachePath(), `${album.id}.jpg`))).toBe(true);
        expect(fs.existsSync(path.join(resolveCachePath(), 'resized', `${album.id}.jpg`))).toBe(true);
    });

    it('does not replace missing custom artwork with embedded artwork', async () => {
        const artist = await models.artist.create({ data: { name: 'Custom Cover Artist' } });
        const album = await models.album.create({
            data: {
                name: 'Custom Cover Album',
                cover: '/cache/resized/999.jpg',
                isCoverCustom: true,
                publishedYear: '2026',
                artistId: artist.id
            }
        });
        await models.music.create({
            data: {
                name: 'Custom Cover Track',
                artistId: artist.id,
                albumId: album.id,
                filePath: 'missing/custom-cover.mp3',
                duration: 180,
                codec: 'mp3',
                container: 'mp3',
                bitrate: 320,
                sampleRate: 44_100,
                trackNumber: 1
            }
        });

        const response = await request(createApp(openAuthConfig))
            .get(`/cache/resized/${album.id}.jpg`);

        expect(response.status).toBe(404);
        expect(parseBufferMock).not.toHaveBeenCalled();
    });
});
