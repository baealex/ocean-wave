import { Prisma } from '@prisma/client';

import models, {
    type Music,
    type Tag
} from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';

import {
    normalizeTagName,
    TAG_SCOPE_KEY,
    TAG_SOURCE_MANUAL
} from './normalization';

export const TAG_ERROR_CODE = {
    invalidTagName: 'INVALID_TAG_NAME',
    invalidTagId: 'INVALID_TAG_ID',
    invalidMusicId: 'INVALID_MUSIC_ID',
    tagNameConflict: 'TAG_NAME_CONFLICT',
    tagNotFound: 'TAG_NOT_FOUND',
    musicNotFound: 'MUSIC_NOT_FOUND'
} as const;

export class TagServiceError extends Error {
    code: typeof TAG_ERROR_CODE[keyof typeof TAG_ERROR_CODE];

    constructor(code: typeof TAG_ERROR_CODE[keyof typeof TAG_ERROR_CODE], message: string) {
        super(message);
        this.name = 'TagServiceError';
        this.code = code;
    }
}

export interface TagDeleteResult {
    id: string;
    affectedMusicIds: string[];
    affectedSmartViewIds: string[];
}

const parseId = (
    value: string | number,
    errorCode: typeof TAG_ERROR_CODE.invalidTagId | typeof TAG_ERROR_CODE.invalidMusicId,
    errorMessage: string
) => {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new TagServiceError(errorCode, errorMessage);
    }

    return id;
};

const isUniqueConstraintError = (error: unknown) => {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
};

const getActiveMusicOrThrow = async (musicId: number) => {
    const music = await models.music.findFirst({
        where: {
            id: musicId,
            syncStatus: TRACK_SYNC_STATUS.active
        }
    });

    if (!music) {
        throw new TagServiceError(TAG_ERROR_CODE.musicNotFound, 'Music not found.');
    }

    return music;
};

const getTagOrThrow = async (tagId: number) => {
    const tag = await models.tag.findUnique({ where: { id: tagId } });

    if (!tag) {
        throw new TagServiceError(TAG_ERROR_CODE.tagNotFound, 'Tag not found.');
    }

    return tag;
};

const ensureTagByName = async (name: string) => {
    const normalized = normalizeTagName(name);

    if (!normalized) {
        throw new TagServiceError(TAG_ERROR_CODE.invalidTagName, 'Tag name is invalid.');
    }

    const where = {
        scopeKey_normalizedName: {
            scopeKey: TAG_SCOPE_KEY,
            normalizedName: normalized.normalizedName
        }
    };
    const existingTag = await models.tag.findUnique({ where });

    if (existingTag) {
        return existingTag;
    }

    try {
        return await models.tag.create({
            data: {
                scopeKey: TAG_SCOPE_KEY,
                name: normalized.name,
                normalizedName: normalized.normalizedName
            }
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) {
            throw error;
        }

        const retryTag = await models.tag.findUnique({
            where
        });

        if (!retryTag) {
            throw error;
        }

        return retryTag;
    }
};

const getMusicTagWhere = (musicId: number, tagId: number) => {
    return {
        musicId_tagId: {
            musicId,
            tagId
        }
    };
};

export const createMusicTag = async ({
    name,
    color = null,
    description = null
}: {
    name: string;
    color?: string | null;
    description?: string | null;
}): Promise<Tag> => {
    const normalized = normalizeTagName(name);

    if (!normalized) {
        throw new TagServiceError(TAG_ERROR_CODE.invalidTagName, 'Tag name is invalid.');
    }

    try {
        return await models.tag.create({
            data: {
                scopeKey: TAG_SCOPE_KEY,
                name: normalized.name,
                normalizedName: normalized.normalizedName,
                color,
                description
            }
        });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            throw new TagServiceError(TAG_ERROR_CODE.tagNameConflict, 'Tag name already exists.');
        }

        throw error;
    }
};

export const renameMusicTag = async ({
    id,
    name
}: {
    id: string;
    name: string;
}): Promise<Tag> => {
    const tagId = parseId(id, TAG_ERROR_CODE.invalidTagId, 'Tag id is invalid.');
    const normalized = normalizeTagName(name);

    if (!normalized) {
        throw new TagServiceError(TAG_ERROR_CODE.invalidTagName, 'Tag name is invalid.');
    }

    try {
        return await models.tag.update({
            where: { id: tagId },
            data: {
                name: normalized.name,
                normalizedName: normalized.normalizedName
            }
        });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            throw new TagServiceError(TAG_ERROR_CODE.tagNameConflict, 'Tag name already exists.');
        }

        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            throw new TagServiceError(TAG_ERROR_CODE.tagNotFound, 'Tag not found.');
        }

        throw error;
    }
};

export const deleteMusicTag = async ({ id }: { id: string }): Promise<TagDeleteResult> => {
    const tagId = parseId(id, TAG_ERROR_CODE.invalidTagId, 'Tag id is invalid.');

    await getTagOrThrow(tagId);

    const [musicTags, smartViewTags] = await Promise.all([
        models.musicTag.findMany({
            where: { tagId },
            select: { musicId: true }
        }),
        models.smartViewTag.findMany({
            where: { tagId },
            select: { smartViewId: true }
        })
    ]);
    const affectedMusicIds = musicTags.map((musicTag) => musicTag.musicId.toString());
    const affectedSmartViewIds = smartViewTags.map((smartViewTag) => smartViewTag.smartViewId.toString());

    await models.tag.delete({ where: { id: tagId } });

    return {
        id: tagId.toString(),
        affectedMusicIds,
        affectedSmartViewIds
    };
};

export const addMusicTagToMusic = async ({
    musicId,
    tagId
}: {
    musicId: string;
    tagId: string;
}): Promise<Music> => {
    const parsedMusicId = parseId(musicId, TAG_ERROR_CODE.invalidMusicId, 'Music id is invalid.');
    const parsedTagId = parseId(tagId, TAG_ERROR_CODE.invalidTagId, 'Tag id is invalid.');

    await Promise.all([
        getActiveMusicOrThrow(parsedMusicId),
        getTagOrThrow(parsedTagId)
    ]);

    await models.musicTag.upsert({
        where: getMusicTagWhere(parsedMusicId, parsedTagId),
        update: {},
        create: {
            musicId: parsedMusicId,
            tagId: parsedTagId,
            source: TAG_SOURCE_MANUAL
        }
    });

    return getActiveMusicOrThrow(parsedMusicId);
};

export const createAndAddMusicTagToMusic = async ({
    musicId,
    name
}: {
    musicId: string;
    name: string;
}): Promise<Music> => {
    const parsedMusicId = parseId(musicId, TAG_ERROR_CODE.invalidMusicId, 'Music id is invalid.');

    await getActiveMusicOrThrow(parsedMusicId);

    const tag = await ensureTagByName(name);

    await models.musicTag.upsert({
        where: getMusicTagWhere(parsedMusicId, tag.id),
        update: {},
        create: {
            musicId: parsedMusicId,
            tagId: tag.id,
            source: TAG_SOURCE_MANUAL
        }
    });

    return getActiveMusicOrThrow(parsedMusicId);
};

export const removeMusicTagFromMusic = async ({
    musicId,
    tagId
}: {
    musicId: string;
    tagId: string;
}): Promise<Music> => {
    const parsedMusicId = parseId(musicId, TAG_ERROR_CODE.invalidMusicId, 'Music id is invalid.');
    const parsedTagId = parseId(tagId, TAG_ERROR_CODE.invalidTagId, 'Tag id is invalid.');

    await getActiveMusicOrThrow(parsedMusicId);

    await models.musicTag.deleteMany({
        where: {
            musicId: parsedMusicId,
            tagId: parsedTagId
        }
    });

    return getActiveMusicOrThrow(parsedMusicId);
};

export const isTagServiceError = (error: unknown): error is TagServiceError => {
    return error instanceof TagServiceError;
};
