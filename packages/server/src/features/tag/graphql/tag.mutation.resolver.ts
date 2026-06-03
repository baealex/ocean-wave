import type { IResolvers } from '@graphql-tools/utils';

import {
    addMusicTagToMusic,
    createAndAddMusicTagToMusic,
    createMusicTag,
    deleteMusicTag,
    isTagServiceError,
    removeMusicTagFromMusic,
    renameMusicTag
} from '../services/music-tags';

class TagGraphQLError extends Error {
    extensions: {
        code: string;
    };

    constructor(message: string, code: string) {
        super(message);
        this.name = 'TagGraphQLError';
        this.extensions = { code };
    }
}

const toGraphQLError = (error: unknown) => {
    if (isTagServiceError(error)) {
        return new TagGraphQLError(error.message, error.code);
    }

    return error;
};

export const createCreateTagMutationResolver = (
    createTag = createMusicTag
) => {
    return async (_: unknown, {
        name,
        color,
        description
    }: {
        name: string;
        color?: string | null;
        description?: string | null;
    }) => {
        try {
            return await createTag({ name, color, description });
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createRenameTagMutationResolver = (
    renameTag = renameMusicTag
) => {
    return async (_: unknown, { id, name }: { id: string; name: string }) => {
        try {
            return await renameTag({ id, name });
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createDeleteTagMutationResolver = (
    deleteTag = deleteMusicTag
) => {
    return async (_: unknown, { id }: { id: string }) => {
        try {
            return await deleteTag({ id });
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createAddTagToMusicMutationResolver = (
    addTagToMusic = addMusicTagToMusic
) => {
    return async (_: unknown, { musicId, tagId }: { musicId: string; tagId: string }) => {
        try {
            return await addTagToMusic({ musicId, tagId });
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createCreateAndAddTagToMusicMutationResolver = (
    createAndAddTagToMusic = createAndAddMusicTagToMusic
) => {
    return async (_: unknown, { musicId, name }: { musicId: string; name: string }) => {
        try {
            return await createAndAddTagToMusic({ musicId, name });
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createRemoveTagFromMusicMutationResolver = (
    removeTagFromMusic = removeMusicTagFromMusic
) => {
    return async (_: unknown, { musicId, tagId }: { musicId: string; tagId: string }) => {
        try {
            return await removeTagFromMusic({ musicId, tagId });
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

type TagMutationResolvers = NonNullable<IResolvers['Mutation']>;

export const tagMutationResolvers: TagMutationResolvers = {
    createTag: createCreateTagMutationResolver(),
    renameTag: createRenameTagMutationResolver(),
    deleteTag: createDeleteTagMutationResolver(),
    addTagToMusic: createAddTagToMusicMutationResolver(),
    createAndAddTagToMusic: createCreateAndAddTagToMusicMutationResolver(),
    removeTagFromMusic: createRemoveTagFromMusicMutationResolver()
};
