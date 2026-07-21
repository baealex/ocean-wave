import fs from 'fs';
import { promises as fsPromises } from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';
import os from 'node:os';
import path from 'node:path';

import models from '~/models';
import { selectPhysicalFileForReleaseTrack } from '~/modules/physical-file-selection';
import { resolveMusicFilePath } from '~/modules/storage-paths';
import { parseByteRange, resolveStreamProfile, transcodeCacheKey, transcodePool } from '~/modules/audio-streaming';

import type { Controller } from '~/types';
import type { Response } from 'express';

const validBitrates = ['64k', '96k', '128k', '192k', '256k', '320k'];
const validTranscodeFormats = ['mp3', 'aac'] as const;

type TranscodeFormat = typeof validTranscodeFormats[number];

const contentTypeMap: Record<TranscodeFormat, string> = {
    mp3: 'audio/mpeg',
    aac: 'audio/aac'
};

const directStreamMimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    wav: 'audio/wav'
};
const transcodeCacheDirectory = path.join(os.tmpdir(), 'ocean-wave-transcodes-v1');
const TRANSCODE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const prepareTranscodeCache = async () => {
    await fsPromises.mkdir(transcodeCacheDirectory, { recursive: true });
    const now = Date.now();
    await Promise.all((await fsPromises.readdir(transcodeCacheDirectory)).map(async name => {
        const target = path.join(transcodeCacheDirectory, name);
        try { if (now - (await fsPromises.stat(target)).mtimeMs > TRANSCODE_CACHE_MAX_AGE_MS) await fsPromises.rm(target, { force: true }); } catch { /* another request cleaned it */ }
    }));
};

function isTranscodeFormat(format: string): format is TranscodeFormat {
    return validTranscodeFormats.includes(format as TranscodeFormat);
}

const streamFile = (filePath: string, res: Response): void => {
    try {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;

        // Set Content-Length header
        res.setHeader('Content-Length', fileSize);

        // Handle range requests
        const range = parseByteRange(res.req.headers.range, fileSize);

        if (range === undefined) {
            res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
            res.end();
        } else if (range) {
            const { start, end } = range;
            const chunkSize = (end - start) + 1;

            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Content-Length', chunkSize);

            const stream = fs.createReadStream(filePath, {
                start,
                end
            });
            stream.on('error', (err) => {
                console.error('Error streaming file:', err);
                if (!res.headersSent) {
                    res.status(500).send('Error streaming audio').end();
                }
            });
            stream.pipe(res);
        } else {
            // No range requested, stream the entire file
            const stream = fs.createReadStream(filePath);
            stream.on('error', (err) => {
                console.error('Error streaming file:', err);
                if (!res.headersSent) {
                    res.status(500).send('Error streaming audio').end();
                }
            });
            stream.pipe(res);
        }
    } catch (error) {
        console.error('Error accessing file stats:', error);
        if (!res.headersSent) {
            res.status(500).send('Error accessing audio file').end();
        }
    }
};

export const audio: Controller = async (req, res) => {
    const { id } = req.params;

    const requestedBitrate = (req.query.bitrate as string) || '128k';
    const requestedFormat = (req.query.format as string) || 'mp3';

    const bitrate = validBitrates.includes(requestedBitrate) ? requestedBitrate : '128k';
    const outputFormat = isTranscodeFormat(requestedFormat) ? requestedFormat : 'mp3';

    if (!id || !Number.isInteger(Number(id))) {
        res.status(400).send('Bad Request').end();
        return;
    }

    try {
        const releaseTrackId = Number(id);
        const releaseTrack = await models.releaseTrack.findUnique({
            where: { id: releaseTrackId },
            select: { id: true }
        });

        if (!releaseTrack) {
            res.status(404).send('Music not found').end();
            return;
        }

        const selectedFile = await selectPhysicalFileForReleaseTrack(releaseTrackId);

        if (!selectedFile) {
            res.status(404).send('Audio file not found').end();
            return;
        }

        const filePath = resolveMusicFilePath(selectedFile.filePath);

        const fileExtension = selectedFile.filePath.split('.').pop()?.toLowerCase() || '';

        const supportedCodecs = typeof req.query.codecs === 'string' ? req.query.codecs.split(',').map(value => value.toLowerCase()) : [];
        const profile = resolveStreamProfile({
            profile: req.query.profile ?? (req.query.notranscode === 'true' ? 'original' : undefined),
            sourceCodec: selectedFile.codec || fileExtension,
            supportedCodecs
        });
        const noTranscode = req.query.notranscode === 'true' || profile.direct;

        if (noTranscode) {
            res.setHeader('Content-Type', directStreamMimeTypes[fileExtension] || 'audio/mpeg');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'max-age=604800');

            streamFile(filePath, res);
            return;
        }

        try {
            const selectedBitrate = req.query.profile ? profile.bitrate ?? bitrate : bitrate;
            const selectedFormat = req.query.profile ? profile.format ?? outputFormat : outputFormat;
            await prepareTranscodeCache();
            const sourceStat = await fsPromises.stat(filePath);
            const cachePath = path.join(transcodeCacheDirectory, `${transcodeCacheKey({ stableId: selectedFile.stableId, updatedAtMs: sourceStat.mtimeMs, profile: profile.name })}.${selectedFormat}`);
            try {
                await fsPromises.access(cachePath);
                res.setHeader('Content-Type', contentTypeMap[selectedFormat] || 'audio/mpeg');
                res.setHeader('X-Ocean-Wave-Stream-Profile', profile.name);
                res.setHeader('X-Ocean-Wave-Transcode-Cache', 'hit');
                streamFile(cachePath, res);
                return;
            } catch { /* cache miss */ }
            if (!transcodePool.acquire()) {
                res.status(503).setHeader('Retry-After', '3');
                res.json({ code: 'TRANSCODE_BUSY', message: 'The server is at its transcoding limit. Retry shortly.' });
                return;
            }
            console.log(`Starting audio transcoding with bitrate: ${selectedBitrate}, format: ${selectedFormat}`);

            // Create a pass-through stream for buffering
            const outputStream = new PassThrough();
            const temporaryCachePath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
            const cacheStream = fs.createWriteStream(temporaryCachePath);
            cacheStream.on('finish', () => { void fsPromises.rename(temporaryCachePath, cachePath).catch(() => fsPromises.rm(temporaryCachePath, { force: true })); });

            // Set headers
            res.setHeader('Content-Type', contentTypeMap[selectedFormat] || 'audio/mpeg');
            res.setHeader('Cache-Control', 'max-age=604800');
            res.setHeader('X-Ocean-Wave-Stream-Profile', profile.name);
            if (profile.estimatedBytesPerHour) res.setHeader('X-Estimated-Bytes-Per-Hour', profile.estimatedBytesPerHour.toString());

            // Create ffmpeg command configuration
            const cmd = ffmpeg(filePath)
                .audioBitrate(selectedBitrate)
                .audioFrequency(44100)
                .audioChannels(2)
                .on('start', (commandLine) => {
                    console.log('FFmpeg process started:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log(`Processing: ${progress.percent ? progress.percent.toFixed(1) : 0}% done`);
                })
                .on('error', (err) => {
                    cacheStream.destroy();
                    void fsPromises.rm(temporaryCachePath, { force: true });
                    console.error('Error during transcoding:', err);
                    if (!res.headersSent) {
                        console.log('Falling back to direct streaming');
                        res.setHeader('Content-Type', directStreamMimeTypes[fileExtension] || 'audio/mpeg');
                        res.setHeader('Accept-Ranges', 'bytes');
                        streamFile(filePath, res);
                    } else if (!res.writableEnded) {
                        res.end();
                    }
                })
                .on('end', () => {
                    console.log('Transcoding completed successfully');
                });

            if (selectedFormat === 'mp3') {
                const outputOptions = [
                    '-id3v2_version', '3',
                    '-write_xing', '1'
                ];

                cmd
                    .format('mp3')
                    .audioCodec('libmp3lame')
                    .outputOptions(outputOptions);
            } else if (selectedFormat === 'aac') {
                const outputOptions = [
                    '-strict', '-2'
                ];

                cmd
                    .format('adts')
                    .audioCodec('aac')
                    .outputOptions(outputOptions);
            }

            // Pipe the output directly to the response
            cmd.pipe(outputStream, { end: true });
            outputStream.pipe(res);
            outputStream.pipe(cacheStream);

            // Handle client disconnect
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                clearTimeout(timeout);
                transcodePool.release();
            };
            const timeout = setTimeout(() => {
                cmd.kill('SIGKILL');
                cacheStream.destroy();
                void fsPromises.rm(temporaryCachePath, { force: true });
                if (!res.writableEnded) res.end();
            }, 5 * 60 * 1_000);
            res.on('finish', release);
            res.on('close', () => {
                console.log('Client disconnected, ending transcoding process');
                cmd.kill('SIGKILL');
                release();
            });
        } catch (err) {
            transcodePool.release();
            console.error('Error setting up ffmpeg:', err);
            if (!res.headersSent) {
                res.status(500).send('Error setting up audio streaming').end();
            }
        }

    } catch (error) {
        console.error('Error in audio controller:', error);
        if (!res.headersSent) {
            res.status(500).send('Server error');
        }
    }
};
