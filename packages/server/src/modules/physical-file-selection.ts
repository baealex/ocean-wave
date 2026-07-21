import fs from 'fs';

import models, { type PhysicalFile } from '~/models';
import { resolveMusicFilePath } from './storage-paths';
import { TRACK_SYNC_STATUS } from './track-identity';

const LOSSLESS_CODEC_PATTERN = /^(flac|alac|wav|wave|pcm|aiff|ape|wavpack)$/i;

const syncStatusRank = (status: string) => {
    if (status === TRACK_SYNC_STATUS.active) return 0;
    if (status === TRACK_SYNC_STATUS.missing) return 1;
    return 2;
};

const codecRank = (codec: string) => LOSSLESS_CODEC_PATTERN.test(codec.trim()) ? 0 : 1;

export const comparePhysicalFilePreference = (
    left: Pick<PhysicalFile, 'id' | 'syncStatus' | 'preferenceRank' | 'codec' | 'sampleRate' | 'bitrate' | 'fileSizeBytes'>,
    right: Pick<PhysicalFile, 'id' | 'syncStatus' | 'preferenceRank' | 'codec' | 'sampleRate' | 'bitrate' | 'fileSizeBytes'>
) => {
    const statusDifference = syncStatusRank(left.syncStatus) - syncStatusRank(right.syncStatus);
    if (statusDifference) return statusDifference;

    const leftHasPreference = left.preferenceRank !== null;
    const rightHasPreference = right.preferenceRank !== null;
    if (leftHasPreference !== rightHasPreference) return leftHasPreference ? -1 : 1;

    const preferenceDifference = (left.preferenceRank ?? 0) - (right.preferenceRank ?? 0);
    if (preferenceDifference) return preferenceDifference;

    const codecDifference = codecRank(left.codec) - codecRank(right.codec);
    if (codecDifference) return codecDifference;

    const sampleRateDifference = right.sampleRate - left.sampleRate;
    if (sampleRateDifference) return sampleRateDifference;

    const bitrateDifference = right.bitrate - left.bitrate;
    if (bitrateDifference) return bitrateDifference;

    const leftSize = left.fileSizeBytes ?? 0n;
    const rightSize = right.fileSizeBytes ?? 0n;
    if (leftSize !== rightSize) return leftSize > rightSize ? -1 : 1;

    return left.id - right.id;
};

export const sortPhysicalFilesByPreference = <File extends Parameters<
typeof comparePhysicalFilePreference
>[0]>(files: File[]) => [...files].sort(comparePhysicalFilePreference);

export const isPhysicalFileReadable = (
    file: Pick<PhysicalFile, 'filePath' | 'syncStatus'>
) => {
    if (file.syncStatus !== TRACK_SYNC_STATUS.active) return false;

    try {
        const absolutePath = resolveMusicFilePath(file.filePath);
        fs.accessSync(absolutePath, fs.constants.R_OK);
        return fs.statSync(absolutePath).isFile();
    } catch {
        return false;
    }
};

export const selectReadablePhysicalFile = <File extends Parameters<
typeof comparePhysicalFilePreference
>[0] & Pick<PhysicalFile, 'filePath'>>(
    files: File[],
    isReadable: (file: File) => boolean = isPhysicalFileReadable
) => sortPhysicalFilesByPreference(files).find(file => (
    file.syncStatus === TRACK_SYNC_STATUS.active && isReadable(file)
)) ?? null;

export const getPhysicalFilesForReleaseTrack = (releaseTrackId: number) => {
    return models.physicalFile.findMany({
        where: { releaseTrackId },
        orderBy: { id: 'asc' }
    });
};

export const selectPhysicalFileForReleaseTrack = async (
    releaseTrackId: number,
    currentPhysicalFileId?: number | null
) => {
    const files = await getPhysicalFilesForReleaseTrack(releaseTrackId);
    const currentFile = currentPhysicalFileId
        ? files.find(file => file.id === currentPhysicalFileId)
        : null;

    if (currentFile && isPhysicalFileReadable(currentFile)) {
        return currentFile;
    }

    return selectReadablePhysicalFile(files);
};

export const resolvePlayableReleaseTrack = async (
    releaseTrackId: number,
    currentPhysicalFileId?: number | null
) => {
    const releaseTrack = await models.releaseTrack.findUnique({
        where: { id: releaseTrackId },
        select: { id: true, recordingId: true }
    });
    if (!releaseTrack) return null;

    const physicalFile = await selectPhysicalFileForReleaseTrack(
        releaseTrackId,
        currentPhysicalFileId
    );
    if (!physicalFile) return null;

    return {
        recordingId: releaseTrack.recordingId,
        releaseTrackId: releaseTrack.id,
        physicalFileId: physicalFile.id,
        duration: physicalFile.durationMs / 1_000
    };
};
