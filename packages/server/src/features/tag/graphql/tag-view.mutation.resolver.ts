import type { IResolvers } from '@graphql-tools/utils';

import { connectors } from '~/socket/connectors';
import { withOriginClientId } from '~/socket/origin-client';
import { TAG_LIST_INVALIDATED } from '~/socket/tag';

import {
    createTagView,
    deleteTagView,
    isTagViewServiceError,
    renameTagView
} from '../services/tag-views';

class TagViewGraphQLError extends Error {
    extensions: {
        code: string;
    };

    constructor(message: string, code: string) {
        super(message);
        this.name = 'TagViewGraphQLError';
        this.extensions = { code };
    }
}

const toGraphQLError = (error: unknown) => {
    if (isTagViewServiceError(error)) {
        return new TagViewGraphQLError(error.message, error.code);
    }

    return error;
};

const notifySafely = (callback: () => void) => {
    try {
        callback();
    } catch (error) {
        console.error(error);
    }
};

const notifyTagViewsChanged = (
    affectedSmartViewIds: string[],
    originClientId?: string | null
) => notifySafely(() => {
    connectors.notify(TAG_LIST_INVALIDATED, withOriginClientId({
        reason: 'tag-views-changed',
        affectedSmartViewIds
    }, originClientId));
});

export const createCreateTagViewMutationResolver = (
    createView = createTagView
) => {
    return async (_: unknown, {
        name,
        tagIds,
        tagMode,
        originClientId
    }: {
        name: string;
        tagIds: string[];
        tagMode: string;
        originClientId?: string | null;
    }) => {
        try {
            const view = await createView({ name, tagIds, tagMode });

            notifyTagViewsChanged([view.id.toString()], originClientId);

            return view;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createRenameTagViewMutationResolver = (
    renameView = renameTagView
) => {
    return async (_: unknown, {
        id,
        name,
        originClientId
    }: {
        id: string;
        name: string;
        originClientId?: string | null;
    }) => {
        try {
            const view = await renameView({ id, name });

            notifyTagViewsChanged([view.id.toString()], originClientId);

            return view;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createDeleteTagViewMutationResolver = (
    deleteView = deleteTagView
) => {
    return async (_: unknown, {
        id,
        originClientId
    }: {
        id: string;
        originClientId?: string | null;
    }) => {
        try {
            const result = await deleteView({ id });

            notifyTagViewsChanged([result.id], originClientId);

            return result;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

type TagViewMutationResolvers = NonNullable<IResolvers['Mutation']>;

export const tagViewMutationResolvers: TagViewMutationResolvers = {
    createTagView: createCreateTagViewMutationResolver(),
    renameTagView: createRenameTagViewMutationResolver(),
    deleteTagView: createDeleteTagViewMutationResolver()
};
