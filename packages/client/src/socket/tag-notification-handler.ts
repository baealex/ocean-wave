import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '~/api/query-keys';
import type { Tag } from '~/models/type';
import { musicStore as defaultMusicStore } from '~/store/music';

import type { TagListInvalidatedPayload } from './tag-listener';

interface MusicTagStore {
    replaceTag: (tag: Tag) => void;
    removeTagFromMusics: (tagId: string, affectedMusicIds?: string[]) => void;
}

export const createTagNotificationHandlers = ({
    queryClient,
    musicStore = defaultMusicStore
}: {
    queryClient: Pick<QueryClient, 'invalidateQueries'>;
    musicStore?: MusicTagStore;
}) => {
    const invalidateTagLists = () => {
        queryClient.invalidateQueries({
            queryKey: queryKeys.tags.all(),
            exact: false
        });
    };

    return {
        onCreated: (_tag: Tag) => {
            invalidateTagLists();
        },
        onRenamed: (tag: Tag) => {
            musicStore.replaceTag(tag);
            invalidateTagLists();
        },
        onListInvalidated: (payload: TagListInvalidatedPayload) => {
            invalidateTagLists();

            if (payload.reason === 'tag-deleted') {
                for (const tagId of payload.affectedTagIds ?? []) {
                    musicStore.removeTagFromMusics(tagId, payload.affectedMusicIds);
                }
            }
        }
    };
};
