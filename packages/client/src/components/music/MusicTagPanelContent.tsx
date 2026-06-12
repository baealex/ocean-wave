import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore as useStore } from '~/store/base-store';

import {
    Button,
    Input,
    Loading,
    TagButton
} from '~/components/shared';
import * as Icon from '~/icon';

import {
    addTagToMusic,
    createAndAddTagToMusic,
    fetchTags,
    removeTagFromMusic
} from '~/api/tags';
import { queryKeys } from '~/api/query-keys';
import { toast } from '~/modules/toast';

import { musicStore } from '~/store/music';

interface MusicTagPanelContentProps {
    id: string;
}

const TAG_LIST_LIMIT = 100;

const getGraphQueryErrorMessage = (response: {
    type: 'error';
    errors: { message: string }[];
}) => response.errors[0]?.message ?? 'Tag request failed';

export default function MusicTagPanelContent({ id }: MusicTagPanelContentProps) {
    const queryClient = useQueryClient();
    const [{ musicMap }] = useStore(musicStore);
    const [draftName, setDraftName] = useState('');
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const music = musicMap.get(id);

    const tagQuery = useQuery({
        queryKey: queryKeys.tags.list({ limit: TAG_LIST_LIMIT }),
        queryFn: () => fetchTags({ limit: TAG_LIST_LIMIT })
    });

    if (!music) {
        return null;
    }

    const allTags = tagQuery.data?.type === 'success'
        ? tagQuery.data.allTags.tags
        : [];
    const musicTagIds = new Set(music.tags.map(tag => tag.id));
    const availableTags = allTags.filter(tag => !musicTagIds.has(tag.id));
    const isBusy = pendingAction !== null;

    const refreshTagList = () => {
        queryClient.invalidateQueries({
            queryKey: queryKeys.tags.all()
        });
    };

    const handleCreateAndAdd = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const name = draftName.trim();

        if (!name || isBusy) {
            return;
        }

        setPendingAction(`create:${name}`);

        try {
            const response = await createAndAddTagToMusic({
                musicId: music.id,
                name
            });

            if (response.type === 'error') {
                toast.error(getGraphQueryErrorMessage(response));
                return;
            }

            musicStore.updateMusicTags(music.id, response.createAndAddTagToMusic.tags);
            setDraftName('');
            refreshTagList();
            toast.success('Added tag');
        } finally {
            setPendingAction(null);
        }
    };

    const handleAdd = async (tagId: string) => {
        if (isBusy) {
            return;
        }

        setPendingAction(`add:${tagId}`);

        try {
            const response = await addTagToMusic({
                musicId: music.id,
                tagId
            });

            if (response.type === 'error') {
                toast.error(getGraphQueryErrorMessage(response));
                return;
            }

            musicStore.updateMusicTags(music.id, response.addTagToMusic.tags);
            refreshTagList();
            toast.success('Added tag');
        } finally {
            setPendingAction(null);
        }
    };

    const handleRemove = async (tagId: string) => {
        if (isBusy) {
            return;
        }

        setPendingAction(`remove:${tagId}`);

        try {
            const response = await removeTagFromMusic({
                musicId: music.id,
                tagId
            });

            if (response.type === 'error') {
                toast.error(getGraphQueryErrorMessage(response));
                return;
            }

            musicStore.updateMusicTags(music.id, response.removeTagFromMusic.tags);
            refreshTagList();
            toast.success('Removed tag');
        } finally {
            setPendingAction(null);
        }
    };

    return (
        <div className="flex flex-col gap-5 pb-1 pt-2">
            <section className="flex flex-col gap-2">
                <h3 className="m-0 text-xs font-semibold uppercase text-[var(--b-color-text-muted)]">Current tags</h3>
                {music.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {music.tags.map(tag => (
                            <TagButton
                                key={tag.id}
                                selected
                                disabled={isBusy}
                                aria-label={`Remove ${tag.name}`}
                                onClick={() => void handleRemove(tag.id)}>
                                <span className="min-w-0 truncate">{tag.name}</span>
                                <Icon.Close className="h-3.5 w-3.5 shrink-0" />
                            </TagButton>
                        ))}
                    </div>
                ) : (
                    <p className="m-0 text-sm text-[var(--b-color-text-muted)]">No tags on this track.</p>
                )}
            </section>

            <form className="flex gap-2" onSubmit={handleCreateAndAdd}>
                <Input
                    value={draftName}
                    tone="panel"
                    placeholder="New tag"
                    aria-label="New tag name"
                    disabled={isBusy}
                    maxLength={64}
                    onChange={(event) => setDraftName(event.currentTarget.value)}
                />
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!draftName.trim() || isBusy}
                    aria-label="Create and add tag">
                    <Icon.Plus />
                </Button>
            </form>

            <section className="flex flex-col gap-2">
                <h3 className="m-0 text-xs font-semibold uppercase text-[var(--b-color-text-muted)]">Available tags</h3>
                {tagQuery.isLoading && <Loading />}
                {!tagQuery.isLoading && tagQuery.data?.type === 'error' && (
                    <p className="m-0 text-sm text-[var(--b-color-text-muted)]">
                        {getGraphQueryErrorMessage(tagQuery.data)}
                    </p>
                )}
                {!tagQuery.isLoading && tagQuery.data?.type !== 'error' && (
                    availableTags.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {availableTags.map(tag => (
                                <TagButton
                                    key={tag.id}
                                    disabled={isBusy}
                                    onClick={() => void handleAdd(tag.id)}>
                                    <Icon.Plus className="h-3.5 w-3.5 shrink-0" />
                                    <span className="min-w-0 truncate">{tag.name}</span>
                                </TagButton>
                            ))}
                        </div>
                    ) : (
                        <p className="m-0 text-sm text-[var(--b-color-text-muted)]">No more tags to add.</p>
                    )
                )}
            </section>
        </div>
    );
}
