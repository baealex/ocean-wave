import type { IResolvers } from '@graphql-tools/utils';

import models, { type Tag } from '~/models';
import { TRACK_SYNC_STATUS } from '~/modules/track-identity';
import { connectors } from '~/socket/connectors';
import { MUSIC_TAGS_UPDATED } from '~/socket/music';
import { withOriginClientId } from '~/socket/origin-client';
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

const notifyTagCreated = (tag: Tag, originClientId?: string | null) => notifySafely(async () => {
    connectors.notify(TAG_CREATED, withOriginClientId(await toRealtimeTag(tag), originClientId));
});

const notifyTagRenamed = (tag: Tag, originClientId?: string | null) => notifySafely(async () => {
    connectors.notify(TAG_RENAMED, withOriginClientId(await toRealtimeTag(tag), originClientId));
});

const notifyTagListInvalidated = (
    payload: {
        reason: 'tag-deleted' | 'music-tags-changed';
        affectedTagIds?: string[];
        affectedMusicIds?: string[];
        affectedSmartViewIds?: string[];
    },
    originClientId?: string | null
) => notifySafely(() => {
    connectors.notify(TAG_LIST_INVALIDATED, withOriginClientId(payload, originClientId));
});

const notifyMusicTagsUpdated = (musicId: string | number, originClientId?: string | null) => notifySafely(async () => {
    connectors.notify(MUSIC_TAGS_UPDATED, withOriginClientId({
        musicId: musicId.toString(),
        tags: await resolveRealtimeMusicTags(musicId)
    }, originClientId));
});

export const createCreateTagMutationResolver = (
    createTag = createMusicTag
) => {
    return async (_: unknown, {
        name,
        color,
        description,
        originClientId
    }: {
        name: string;
        color?: string | null;
        description?: string | null;
        originClientId?: string | null;
    }) => {
        try {
            const tag = await createTag({ name, color, description });

            await notifyTagCreated(tag, originClientId);

            return tag;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createRenameTagMutationResolver = (
    renameTag = renameMusicTag
) => {
    return async (_: unknown, {
        id,
        name,
        originClientId
    }: { id: string; name: string; originClientId?: string | null }) => {
        try {
            const tag = await renameTag({ id, name });

            await notifyTagRenamed(tag, originClientId);

            return tag;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createDeleteTagMutationResolver = (
    deleteTag = deleteMusicTag
) => {
    return async (_: unknown, {
        id,
        originClientId
    }: { id: string; originClientId?: string | null }) => {
        try {
            const result = await deleteTag({ id });

            await notifyTagListInvalidated({
                reason: 'tag-deleted',
                affectedTagIds: [result.id],
                affectedMusicIds: result.affectedMusicIds,
                affectedSmartViewIds: result.affectedSmartViewIds
            }, originClientId);

            return result;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createAddTagToMusicMutationResolver = (
    addTagToMusic = addMusicTagToMusic
) => {
    return async (_: unknown, {
        musicId,
        tagId,
        originClientId
    }: { musicId: string; tagId: string; originClientId?: string | null }) => {
        try {
            const music = await addTagToMusic({ musicId, tagId });

            await notifyMusicTagsUpdated(music.id, originClientId);
            await notifyTagListInvalidated({
                reason: 'music-tags-changed',
                affectedTagIds: [tagId],
                affectedMusicIds: [music.id.toString()]
            }, originClientId);

            return music;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createCreateAndAddTagToMusicMutationResolver = (
    createAndAddTagToMusic = createAndAddMusicTagToMusic
) => {
    return async (_: unknown, {
        musicId,
        name,
        originClientId
    }: { musicId: string; name: string; originClientId?: string | null }) => {
        try {
            const music = await createAndAddTagToMusic({ musicId, name });

            await notifyMusicTagsUpdated(music.id, originClientId);
            await notifyTagListInvalidated({
                reason: 'music-tags-changed',
                affectedMusicIds: [music.id.toString()]
            }, originClientId);

            return music;
        } catch (error) {
            throw toGraphQLError(error);
        }
    };
};

export const createRemoveTagFromMusicMutationResolver = (
    removeTagFromMusic = removeMusicTagFromMusic
) => {
    return async (_: unknown, {
        musicId,
        tagId,
        originClientId
    }: { musicId: string; tagId: string; originClientId?: string | null }) => {
        try {
            const music = await removeTagFromMusic({ musicId, tagId });

            await notifyMusicTagsUpdated(music.id, originClientId);
            await notifyTagListInvalidated({
                reason: 'music-tags-changed',
                affectedTagIds: [tagId],
                affectedMusicIds: [music.id.toString()]
            }, originClientId);

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
