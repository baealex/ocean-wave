import crypto from 'crypto';
import fs from 'fs';

export const TRACK_CONTENT_HASH_VERSION = 1;

export const createTrackContentHash = (data: Buffer) => {
    return crypto.createHash('sha256').update(data).digest('hex');
};

export const createTrackContentHashFromFile = (filePath: string) => {
    return new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
};

export const shouldRefreshTrackContentHash = ({
    contentHash,
    hashVersion
}: {
    contentHash: string | null;
    hashVersion: number | null;
}) => {
    return !contentHash || hashVersion !== TRACK_CONTENT_HASH_VERSION;
};
