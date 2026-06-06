import type { IResolvers } from '@graphql-tools/utils';

import models, { type Tag } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import { connectors } from '~/socket/connectors';
import { MUSIC_TAGS_UPDATED } from '~/socket/music';
import {
    TAG_CREATED,
    TAG_LIST_INVALIDATED,
    TAG_RENAMED
} from '~/socket/tag';

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

const notifySafely = async (callback: () => Promise<void> | void) => {
    try {
        await callback();
    } catch (error) {
        console.error(error);
    }
};

const toRealtimeTag = async (tag: Tag) => ({
    id: tag.id.toString(),
    scopeKey: tag.scopeKey,
    name: tag.name,
    normalizedName: tag.normalizedName,
    color: tag.color,
    description: tag.description,
    order: tag.order,
    musicCount: await models.musicTag.count({
        where: {
            tagId: tag.id,
            Music: { syncStatus: TRACK_SYNC_STATUS.active }
        }
    }),
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString()
});

const resolveRealtimeMusicTags = async (musicId: string | number) => {
    const tags = await models.tag.findMany({
        where: { MusicTag: { some: { musicId: Number(musicId) } } },
        orderBy: [
            { order: 'asc' },
            { name: 'asc' }
        ]
    });

    return Promise.all(tags.map(toRealtimeTag));
};

const notifyTagCreated = (tag: Tag) => notifySafely(async () => {
    connectors.notify(TAG_CREATED, await toRealtimeTag(tag));
});

const notifyTagRenamed = (tag: Tag) => notifySafely(async () => {
    connectors.notify(TAG_RENAMED, await toRealtimeTag(tag));
});

const notifyTagListInvalidated = (payload: {
    reason: 'tag-deleted' | 'music-tags-changed';
    affectedTagIds?: string[];
    affectedMusicIds?: string[];
    affectedSmartViewIds?: string[];
}) => notifySafely(() => {
    connectors.notify(TAG_LIST_INVALIDATED, payload);
});

const notifyMusicTagsUpdated = (musicId: string | number) => notifySafely(async () => {
    connectors.notify(MUSIC_TAGS_UPDATED, {
        musicId: musicId.toString(),
        tags: await resolveRealtimeMusicTags(musicId)
    });
});

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
            const tag = await createTag({ name, color, description });

            await notifyTagCreated(tag);

            return tag;
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
            const tag = await renameTag({ id, name });

            await notifyTagRenamed(tag);

            return tag;
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
            const result = await deleteTag({ id });

            await notifyTagListInvalidated({
                reason: 'tag-deleted',
                affectedTagIds: [result.id],
                affectedMusicIds: result.affectedMusicIds,
                affectedSmartViewIds: result.affectedSmartViewIds
            });

            return result;
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
            const music = await addTagToMusic({ musicId, tagId });

            await notifyMusicTagsUpdated(music.id);
            await notifyTagListInvalidated({
                reason: 'music-tags-changed',
                affectedTagIds: [tagId],
                affectedMusicIds: [music.id.toString()]
            });

            return music;
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
            const music = await createAndAddTagToMusic({ musicId, name });

            await notifyMusicTagsUpdated(music.id);
            await notifyTagListInvalidated({
                reason: 'music-tags-changed',
                affectedMusicIds: [music.id.toString()]
            });

            return music;
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
            const music = await removeTagFromMusic({ musicId, tagId });

            await notifyMusicTagsUpdated(music.id);
            await notifyTagListInvalidated({
                reason: 'music-tags-changed',
                affectedTagIds: [tagId],
                affectedMusicIds: [music.id.toString()]
            });

            return music;
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
