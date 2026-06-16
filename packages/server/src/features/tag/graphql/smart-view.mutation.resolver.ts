import type { IResolvers } from '@graphql-tools/utils';

import { connectors } from '~/socket/connectors';
import { withOriginClientId } from '~/socket/origin-client';
import { TAG_LIST_INVALIDATED } from '~/socket/tag';

import {
    createSmartView,
    deleteSmartView,
    isSmartViewServiceError,
    renameSmartView
} from '../services/smart-views';

class SmartViewGraphQLError extends Error {
    extensions: {
        code: string;
    };

    constructor(message: string, code: string) {
        super(message);
        this.name = 'SmartViewGraphQLError';
        this.extensions = { code };
    }
}

const toGraphQLError = (error: unknown) => {
    if (isSmartViewServiceError(error)) {
        return new SmartViewGraphQLError(error.message, error.code);
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

const notifySmartViewsChanged = (
    affectedSmartViewIds: string[],
    originClientId?: string | null
) => notifySafely(() => {
    connectors.notify(TAG_LIST_INVALIDATED, withOriginClientId({
        reason: 'smart-views-changed',
        affectedSmartViewIds
    }, originClientId));
});

export const createCreateSmartViewMutationResolver = (
    createView = createSmartView
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

            notifySmartViewsChanged([view.id.toString()], originClientId);

            return view;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createRenameSmartViewMutationResolver = (
    renameView = renameSmartView
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

            notifySmartViewsChanged([view.id.toString()], originClientId);

            return view;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createDeleteSmartViewMutationResolver = (
    deleteView = deleteSmartView
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

            notifySmartViewsChanged([result.id], originClientId);

            return result;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

type SmartViewMutationResolvers = NonNullable<IResolvers['Mutation']>;

export const smartViewMutationResolvers: SmartViewMutationResolvers = {
    createSmartView: createCreateSmartViewMutationResolver(),
    renameSmartView: createRenameSmartViewMutationResolver(),
    deleteSmartView: createDeleteSmartViewMutationResolver()
};
