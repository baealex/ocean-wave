import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

import models from '~/models';
import { selectPhysicalFileForReleaseTrack } from '~/modules/physical-file-selection';
import { resolveMusicFilePath } from '~/modules/storage-paths';

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
        const range = res.req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
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

        const noTranscode = req.query.notranscode === 'true';

        if (noTranscode) {
            res.setHeader('Content-Type', directStreamMimeTypes[fileExtension] || 'audio/mpeg');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'max-age=604800');

            streamFile(filePath, res);
            return;
        }

        try {
            console.log(`Starting audio transcoding with bitrate: ${bitrate}, format: ${outputFormat}`);

            // Create a pass-through stream for buffering
            const outputStream = new PassThrough();

            // Set headers
            res.setHeader('Content-Type', contentTypeMap[outputFormat] || 'audio/mpeg');
            res.setHeader('Cache-Control', 'max-age=604800');

            // Create ffmpeg command configuration
            const cmd = ffmpeg(filePath)
                .audioBitrate(bitrate)
                .audioFrequency(44100)
                .audioChannels(2)
                .on('start', (commandLine) => {
                    console.log('FFmpeg process started:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log(`Processing: ${progress.percent ? progress.percent.toFixed(1) : 0}% done`);
                })
                .on('error', (err) => {
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

            if (outputFormat === 'mp3') {
                const outputOptions = [
                    '-id3v2_version', '3',
                    '-write_xing', '1'
                ];

                cmd
                    .format('mp3')
                    .audioCodec('libmp3lame')
                    .outputOptions(outputOptions);
            } else if (outputFormat === 'aac') {
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

            // Handle client disconnect
            res.on('close', () => {
                console.log('Client disconnected, ending transcoding process');
                cmd.kill('SIGKILL');
            });
        } catch (err) {
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
