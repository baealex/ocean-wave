import { Prisma } from '@prisma/client';

import models, {
    type SmartView
} from '~/models';

import {
    normalizeTagName,
    TAG_SCOPE_KEY
} from './normalization';

export const SMART_VIEW_ERROR_CODE = {
    invalidViewId: 'INVALID_SMART_VIEW_ID',
    invalidViewName: 'INVALID_SMART_VIEW_NAME',
    invalidTagIds: 'INVALID_SMART_VIEW_TAG_IDS',
    invalidTagMode: 'INVALID_SMART_VIEW_MODE',
    viewNameConflict: 'SMART_VIEW_NAME_CONFLICT',
    viewNotFound: 'SMART_VIEW_NOT_FOUND',
    tagNotFound: 'SMART_VIEW_TAG_NOT_FOUND'
} as const;

export type SmartViewMode = 'all' | 'any';

export class SmartViewServiceError extends Error {
    code: typeof SMART_VIEW_ERROR_CODE[keyof typeof SMART_VIEW_ERROR_CODE];

    constructor(code: typeof SMART_VIEW_ERROR_CODE[keyof typeof SMART_VIEW_ERROR_CODE], message: string) {
        super(message);
        this.name = 'SmartViewServiceError';
        this.code = code;
    }
}

export interface SmartViewDeleteResult {
    id: string;
}

const parseId = (value: string | number) => {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.invalidViewId, 'Smart view id is invalid.');
    }

    return id;
};

const isUniqueConstraintError = (error: unknown) => {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
};

const parseTagIds = (tagIds: string[]) => {
    const parsedTagIds = [...new Set(tagIds.map((tagId) => Number(tagId)))];

    if (
        parsedTagIds.length === 0 ||
        parsedTagIds.some(tagId => !Number.isInteger(tagId) || tagId <= 0)
    ) {
        throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.invalidTagIds, 'Smart view needs at least one valid tag.');
    }

    return parsedTagIds;
};

const parseTagMode = (tagMode: string): SmartViewMode => {
    if (tagMode === 'all' || tagMode === 'any') {
        return tagMode;
    }

    throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.invalidTagMode, 'Smart view match mode is invalid.');
};

const ensureTagsExist = async (tagIds: number[]) => {
    const tags = await models.tag.findMany({
        where: {
            id: { in: tagIds },
            scopeKey: TAG_SCOPE_KEY
        },
        select: { id: true }
    });

    if (tags.length !== tagIds.length) {
        throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.tagNotFound, 'One or more tags were not found.');
    }
};

export const listSmartViews = async (): Promise<SmartView[]> => {
    return models.smartView.findMany({
        where: { scopeKey: TAG_SCOPE_KEY },
        orderBy: [
            { order: 'asc' },
            { name: 'asc' }
        ]
    });
};

export const createSmartView = async ({
    name,
    tagIds,
    tagMode
}: {
    name: string;
    tagIds: string[];
    tagMode: string;
}): Promise<SmartView> => {
    const normalized = normalizeTagName(name);
    const parsedTagIds = parseTagIds(tagIds);
    const parsedTagMode = parseTagMode(tagMode);

    if (!normalized) {
        throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.invalidViewName, 'Smart view name is invalid.');
    }

    await ensureTagsExist(parsedTagIds);

    try {
        return await models.$transaction(async (transaction) => {
            const view = await transaction.smartView.create({
                data: {
                    scopeKey: TAG_SCOPE_KEY,
                    name: normalized.name,
                    normalizedName: normalized.normalizedName,
                    tagMode: parsedTagMode
                }
            });

            await transaction.smartViewTag.createMany({
                data: parsedTagIds.map((tagId, index) => ({
                    smartViewId: view.id,
                    tagId,
                    order: index
                }))
            });

            return view;
        });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.viewNameConflict, 'Smart view name already exists.');
        }

        throw error;
    }
};

export const renameSmartView = async ({
    id,
    name
}: {
    id: string;
    name: string;
}): Promise<SmartView> => {
    const viewId = parseId(id);
    const normalized = normalizeTagName(name);

    if (!normalized) {
        throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.invalidViewName, 'Smart view name is invalid.');
    }

    try {
        return await models.smartView.update({
            where: { id: viewId },
            data: {
                name: normalized.name,
                normalizedName: normalized.normalizedName
            }
        });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.viewNameConflict, 'Smart view name already exists.');
        }

        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.viewNotFound, 'Smart view not found.');
        }

        throw error;
    }
};

export const deleteSmartView = async ({ id }: { id: string }): Promise<SmartViewDeleteResult> => {
    const viewId = parseId(id);

    try {
        await models.smartView.delete({ where: { id: viewId } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            throw new SmartViewServiceError(SMART_VIEW_ERROR_CODE.viewNotFound, 'Smart view not found.');
        }

        throw error;
    }

    return { id: viewId.toString() };
};

export const isSmartViewServiceError = (error: unknown): error is SmartViewServiceError => {
    return error instanceof SmartViewServiceError;
};
