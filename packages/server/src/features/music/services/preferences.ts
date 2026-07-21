import models from '~/models';

export const MUSIC_PREFERENCE_ERROR_CODE = {
    invalidMusicId: 'INVALID_MUSIC_ID',
    musicNotFound: 'MUSIC_NOT_FOUND'
} as const;

export class MusicPreferenceServiceError extends Error {
    code: typeof MUSIC_PREFERENCE_ERROR_CODE[keyof typeof MUSIC_PREFERENCE_ERROR_CODE];

    constructor(code: typeof MUSIC_PREFERENCE_ERROR_CODE[keyof typeof MUSIC_PREFERENCE_ERROR_CODE], message: string) {
        super(message);
        this.name = 'MusicPreferenceServiceError';
        this.code = code;
    }
}

export interface MusicLikedResult {
    id: string;
    isLiked: boolean;
}

export interface MusicHatedResult {
    id: string;
    isHated: boolean;
}

const parseMusicId = (value: string | number) => {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new MusicPreferenceServiceError(MUSIC_PREFERENCE_ERROR_CODE.invalidMusicId, 'Music id is invalid.');
    }

    return id;
};

const getMusicOrThrow = async (musicId: number) => {
    const music = await models.music.findUnique({ where: { id: musicId } });

    if (!music) {
        throw new MusicPreferenceServiceError(MUSIC_PREFERENCE_ERROR_CODE.musicNotFound, 'Music not found.');
    }

    return music;
};

export const setMusicLiked = async ({
    id,
    isLiked
}: {
    id: string;
    isLiked: boolean;
}): Promise<MusicLikedResult> => {
    const musicId = parseMusicId(id);

    const music = await getMusicOrThrow(musicId);
    const recordingId = music.recordingId;

    if (isLiked) {
        const existingLike = await models.musicLike.findFirst({ where: { musicId: recordingId } });

        if (!existingLike) {
            await models.musicLike.create({ data: { musicId: recordingId } });
        }
    } else {
        await models.musicLike.deleteMany({ where: { musicId: recordingId } });
    }

    return {
        id: musicId.toString(),
        isLiked
    };
};

export const setMusicHated = async ({
    id,
    isHated
}: {
    id: string;
    isHated: boolean;
}): Promise<MusicHatedResult> => {
    const musicId = parseMusicId(id);

    const music = await getMusicOrThrow(musicId);
    const recordingId = music.recordingId;

    if (isHated) {
        const existingHate = await models.musicHate.findFirst({ where: { musicId: recordingId } });

        if (!existingHate) {
            await models.musicHate.create({ data: { musicId: recordingId } });
        }
    } else {
        await models.musicHate.deleteMany({ where: { musicId: recordingId } });
    }

    return {
        id: musicId.toString(),
        isHated
    };
};

export const isMusicPreferenceServiceError = (error: unknown): error is MusicPreferenceServiceError => {
    return error instanceof MusicPreferenceServiceError;
};
