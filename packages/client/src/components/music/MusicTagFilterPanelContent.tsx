import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
    Button,
    Loading
} from '~/components/shared';
import * as Icon from '~/icon';

import { fetchTags } from '~/api/tags';
import { queryKeys } from '~/api/query-keys';
import {
    DEFAULT_MUSIC_TAG_FILTER_MODE,
    pruneUnavailableMusicTagIds,
    type MusicTagFilterMode
} from '~/modules/music-tags';

interface MusicTagFilterPanelContentProps {
    selectedTagIds: string[];
    mode: MusicTagFilterMode;
    onApply: (selectedTagIds: string[], mode: MusicTagFilterMode) => void;
}

const TAG_LIST_LIMIT = 100;

const getGraphQueryErrorMessage = (response: {
    type: 'error';
    errors: { message: string }[];
}) => response.errors[0]?.message ?? 'Could not load tags';

export default function MusicTagFilterPanelContent({
    selectedTagIds,
    mode,
    onApply
}: MusicTagFilterPanelContentProps) {
    const [draftTagIds, setDraftTagIds] = useState(selectedTagIds);
    const [draftMode, setDraftMode] = useState(mode);
    const tagsQuery = useQuery({
        queryKey: queryKeys.tags.list({ limit: TAG_LIST_LIMIT }),
        queryFn: () => fetchTags({ limit: TAG_LIST_LIMIT })
    });

    useEffect(() => {
        setDraftTagIds(selectedTagIds);
    }, [selectedTagIds]);

    useEffect(() => {
        setDraftMode(mode);
    }, [mode]);

    const tags = tagsQuery.data?.type === 'success'
        ? tagsQuery.data.allTags.tags
        : [];
    const hasCompleteTagList = tagsQuery.data?.type === 'success'
        && tagsQuery.data.allTags.totalCount === tags.length;
    const selectedSet = new Set(draftTagIds);

    useEffect(() => {
        if (!hasCompleteTagList) {
            return;
        }

        setDraftTagIds((currentTagIds) => {
            const nextTagIds = pruneUnavailableMusicTagIds(currentTagIds, tags.map(tag => tag.id));

            return nextTagIds.length === currentTagIds.length
                ? currentTagIds
                : nextTagIds;
        });
    }, [hasCompleteTagList, tags]);

    const toggleTag = (tagId: string) => {
        setDraftTagIds((currentTagIds) => {
            if (currentTagIds.includes(tagId)) {
                return currentTagIds.filter(id => id !== tagId);
            }

            return [...currentTagIds, tagId];
        });
    };

    return (
        <div className="flex flex-col gap-5 pb-1 pt-2">
            <div className="flex gap-2">
                <Button
                    fullWidth
                    aria-pressed={draftMode === 'all'}
                    className={draftMode === 'all'
                        ? 'min-h-14 justify-start border-[var(--b-color-focus)] bg-[var(--b-color-active)] text-left !text-[var(--b-color-point)]'
                        : 'min-h-14 justify-start text-left'}
                    onClick={() => setDraftMode('all')}>
                    <Icon.DoubleCheck />
                    <span className="flex min-w-0 flex-col gap-0.5">
                        <span>AND filter</span>
                        <span className="text-[0.6875rem] font-medium leading-tight text-[var(--b-color-text-muted)]">
                            Music with every selected tag
                        </span>
                    </span>
                </Button>
                <Button
                    fullWidth
                    aria-pressed={draftMode === 'any'}
                    className={draftMode === 'any'
                        ? 'min-h-14 justify-start border-[var(--b-color-focus)] bg-[var(--b-color-active)] text-left !text-[var(--b-color-point)]'
                        : 'min-h-14 justify-start text-left'}
                    onClick={() => setDraftMode('any')}>
                    <Icon.Check />
                    <span className="flex min-w-0 flex-col gap-0.5">
                        <span>OR filter</span>
                        <span className="text-[0.6875rem] font-medium leading-tight text-[var(--b-color-text-muted)]">
                            Music with any selected tag
                        </span>
                    </span>
                </Button>
            </div>

            <section className="flex flex-col gap-2">
                <h3 className="m-0 text-xs font-semibold uppercase text-[var(--b-color-text-muted)]">Tags</h3>
                {tagsQuery.isLoading && <Loading />}
                {!tagsQuery.isLoading && tagsQuery.data?.type === 'error' && (
                    <p className="m-0 text-sm text-[var(--b-color-text-muted)]">
                        {getGraphQueryErrorMessage(tagsQuery.data)}
                    </p>
                )}
                {!tagsQuery.isLoading && tagsQuery.data?.type !== 'error' && (
                    tags.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {tags.map(tag => {
                                const selected = selectedSet.has(tag.id);

                                return (
                                    <button
                                        key={tag.id}
                                        type="button"
                                        className={selected
                                            ? 'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-[var(--b-color-focus)] bg-[var(--b-color-active)] px-3 py-1.5 text-sm font-semibold text-[var(--b-color-text)] transition-[background-color,color]'
                                            : 'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-input)] px-3 py-1.5 text-sm font-semibold text-[var(--b-color-text-secondary)] transition-[background-color,color,border-color] hover:border-[var(--b-color-focus)] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)]'}
                                        aria-pressed={selected}
                                        onClick={() => toggleTag(tag.id)}>
                                        {selected && <Icon.Check className="h-3.5 w-3.5 shrink-0" />}
                                        <span className="min-w-0 truncate">{tag.name}</span>
                                        <span className="text-xs text-[var(--b-color-text-muted)]">{tag.musicCount}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="m-0 text-sm text-[var(--b-color-text-muted)]">No tags yet.</p>
                    )
                )}
            </section>

            <div className="flex gap-2 border-t border-[var(--b-color-border)] pt-4">
                <Button
                    fullWidth
                    disabled={draftTagIds.length === 0 && draftMode === DEFAULT_MUSIC_TAG_FILTER_MODE}
                    onClick={() => {
                        setDraftTagIds([]);
                        setDraftMode(DEFAULT_MUSIC_TAG_FILTER_MODE);
                    }}>
                    Clear
                </Button>
                <Button
                    fullWidth
                    variant="primary"
                    onClick={() => onApply(draftTagIds, draftMode)}>
                    Apply
                </Button>
            </div>
        </div>
    );
}
