import { useDeferredValue, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cva } from 'class-variance-authority';
import classNames from 'classnames';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
    Badge,
    Button,
    IconButton,
    Loading,
    SearchField,
    StickyHeader,
    StickyHeaderActions,
    Text
} from '~/components/shared';
import { TextEntryDialog } from '~/components/shared/Modal';
import * as Icon from '~/icon';

import {
    createTag,
    deleteTag,
    fetchTags,
    renameTag
} from '~/api/tags';
import { queryKeys } from '~/api/query-keys';
import { toast } from '~/modules/toast';
import {
    createMusicTagFilterSearchParams,
    DEFAULT_MUSIC_TAG_FILTER_MODE,
    type MusicTagFilterMode
} from '~/modules/music-tags';
import type { Tag } from '~/models/type';
import { musicStore } from '~/store/music';

const cx = classNames;

const TAG_LIST_LIMIT = 100;

const tagListItemIconClass = cva(
    'flex h-10 w-10 items-center justify-center rounded-[var(--b-radius-md)] border bg-[var(--b-color-surface-subtle)]',
    {
        variants: {
            selected: {
                true: 'border-[var(--b-color-focus)] text-[var(--b-color-point)]',
                false: 'border-[var(--b-color-border-subtle)] text-[var(--b-color-text-secondary)]'
            }
        }
    }
);

const tagListRowClass = cva(
    [
        'grid min-h-16 w-full items-center gap-3 border-b border-[var(--b-color-border-subtle)]',
        'px-[var(--b-spacing-lg)] py-3 text-left transition-colors hover:bg-[var(--b-color-hover)]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--b-color-focus)]'
    ],
    {
        variants: {
            interactive: {
                select: 'grid-cols-[2.5rem_minmax(0,1fr)_auto]',
                browse: 'min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto]'
            },
            selected: {
                true: 'bg-[var(--b-color-active)] text-[var(--b-color-text)]',
                false: ''
            }
        },
        defaultVariants: {
            selected: false
        }
    }
);

const getGraphQueryErrorMessage = (response: {
    type: 'error';
    errors: { message: string }[];
}) => response.errors[0]?.message ?? 'Tag request failed';

const getSongCountLabel = (count: number) => {
    return count === 1 ? '1 song' : `${count} songs`;
};

function TagListItem({
    tag,
    isSelectMode,
    selected,
    pending,
    onClick,
    onRename,
    onDelete
}: {
    tag: Tag;
    isSelectMode: boolean;
    selected: boolean;
    pending: boolean;
    onClick: () => void;
    onRename: () => void;
    onDelete: () => void;
}) {
    const content = (
        <>
            <span className={tagListItemIconClass({ selected })}>
                {isSelectMode ? <Icon.CheckBox className="h-5 w-5" /> : <Icon.Tags className="h-5 w-5" />}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
                <Text weight="semibold" truncate>
                    {tag.name}
                </Text>
                {tag.description && (
                    <Text variant="muted" size="xs" truncate>
                        {tag.description}
                    </Text>
                )}
            </span>
            <Badge>{getSongCountLabel(tag.musicCount)}</Badge>
        </>
    );

    if (isSelectMode) {
        return (
            <button
                type="button"
                aria-label={selected ? `Unselect ${tag.name}` : `Select ${tag.name}`}
                aria-pressed={selected}
                className={tagListRowClass({ interactive: 'select', selected })}
                onClick={onClick}>
                {content}
            </button>
        );
    }

    return (
        <div className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-stretch border-b border-[var(--b-color-border-subtle)] transition-colors hover:bg-[var(--b-color-hover)]">
            <button
                type="button"
                aria-label={`Filter library by ${tag.name}`}
                className={cx(
                    tagListRowClass({ interactive: 'browse' }),
                    'border-b-0 hover:bg-transparent'
                )}
                onClick={onClick}>
                {content}
            </button>
            <div className="flex items-center gap-1 pr-[var(--b-spacing-md)]">
                <IconButton
                    size="sm"
                    aria-label={`Rename ${tag.name}`}
                    disabled={pending}
                    onClick={onRename}>
                    <Icon.Pencil />
                </IconButton>
                <IconButton
                    size="sm"
                    tone="danger"
                    aria-label={`Delete ${tag.name}`}
                    disabled={pending}
                    onClick={onDelete}>
                    <Icon.TrashCan />
                </IconButton>
            </div>
        </div>
    );
}

export default function TagList() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [createName, setCreateName] = useState('');
    const [editingTag, setEditingTag] = useState<Tag | null>(null);
    const [editName, setEditName] = useState('');
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

    const query = searchParams.get('q') || '';
    const deferredQuery = useDeferredValue(query.trim());

    const tagsQuery = useQuery({
        queryKey: queryKeys.tags.list({
            query: deferredQuery,
            limit: TAG_LIST_LIMIT
        }),
        queryFn: () => fetchTags({
            query: deferredQuery,
            limit: TAG_LIST_LIMIT
        })
    });

    const invalidateTagLists = () => {
        queryClient.invalidateQueries({
            queryKey: queryKeys.tags.all(),
            exact: false
        });
    };

    const handleSearchChange = (value: string) => {
        setSearchParams((currentSearchParams) => {
            const nextSearchParams = new URLSearchParams(currentSearchParams);

            if (value.trim()) {
                nextSearchParams.set('q', value);
            } else {
                nextSearchParams.delete('q');
            }

            nextSearchParams.delete('py');
            return nextSearchParams;
        }, { replace: true });
    };

    const handleViewLibrary = (
        tagIds: string[],
        mode: MusicTagFilterMode = DEFAULT_MUSIC_TAG_FILTER_MODE
    ) => {
        const librarySearchParams = createMusicTagFilterSearchParams(tagIds, mode);
        const search = librarySearchParams.toString();

        navigate({
            pathname: '/library',
            search: search ? `?${search}` : ''
        });
    };

    const handleStartSelect = () => {
        setSelectedTagIds([]);
        setIsSelectMode(true);
    };

    const handleStopSelect = () => {
        setSelectedTagIds([]);
        setIsSelectMode(false);
    };

    const handleTagToggle = (tagId: string) => {
        setSelectedTagIds((currentTagIds) => {
            if (currentTagIds.includes(tagId)) {
                return currentTagIds.filter(id => id !== tagId);
            }

            return [...currentTagIds, tagId];
        });
    };

    const handleCreateConfirm = (name: string) => {
        if (pendingAction) {
            return;
        }

        void (async () => {
            setPendingAction('create');

            try {
                const response = await createTag({ name });

                if (response.type === 'error') {
                    toast.error(getGraphQueryErrorMessage(response));
                    return;
                }

                setIsCreateDialogOpen(false);
                setCreateName('');
                invalidateTagLists();
                toast.success('Created tag');
            } finally {
                setPendingAction(null);
            }
        })();
    };

    const handleStartRename = (tag: Tag) => {
        setEditingTag(tag);
        setEditName(tag.name);
    };

    const handleRenameConfirm = (name: string) => {
        if (pendingAction || !editingTag) {
            return;
        }

        const tagId = editingTag.id;

        void (async () => {
            setPendingAction(`rename:${tagId}`);

            try {
                const response = await renameTag({
                    id: tagId,
                    name
                });

                if (response.type === 'error') {
                    toast.error(getGraphQueryErrorMessage(response));
                    return;
                }

                musicStore.replaceTag(response.renameTag);
                setEditingTag(null);
                setEditName('');
                invalidateTagLists();
                toast.success('Renamed tag');
            } finally {
                setPendingAction(null);
            }
        })();
    };

    const handleDelete = (tag: Tag) => {
        const message = tag.musicCount > 0
            ? `Delete “${tag.name}”? This will remove it from ${getSongCountLabel(tag.musicCount)}.`
            : `Delete “${tag.name}”?`;

        if (!window.confirm(message)) {
            return;
        }

        void (async () => {
            setPendingAction(`delete:${tag.id}`);

            try {
                const response = await deleteTag(tag.id);

                if (response.type === 'error') {
                    toast.error(getGraphQueryErrorMessage(response));
                    return;
                }

                musicStore.removeTagFromMusics(response.deleteTag.id, response.deleteTag.affectedMusicIds);
                setSelectedTagIds((currentTagIds) => currentTagIds.filter(id => id !== response.deleteTag.id));
                invalidateTagLists();
                toast.success('Deleted tag');
            } finally {
                setPendingAction(null);
            }
        })();
    };

    const tags = tagsQuery.data?.type === 'success'
        ? tagsQuery.data.allTags.tags
        : [];
    const selectedTagSet = new Set(selectedTagIds);

    return (
        <>
            <StickyHeader>
                <SearchField
                    value={query}
                    placeholder="Search tags"
                    ariaLabel="Search tags"
                    onChange={handleSearchChange}
                />
                <StickyHeaderActions>
                    {isSelectMode ? (
                        <Button onClick={handleStopSelect}>
                            Done
                        </Button>
                    ) : (
                        <>
                            <Button
                                disabled={pendingAction === 'create'}
                                onClick={() => setIsCreateDialogOpen(true)}>
                                <Icon.Plus /> Create
                            </Button>
                            <Button onClick={handleStartSelect}>
                                <Icon.CheckBox /> Select
                            </Button>
                        </>
                    )}
                </StickyHeaderActions>
            </StickyHeader>

            {isSelectMode && (
                <section className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--b-color-border-subtle)] px-[var(--b-spacing-lg)] py-3">
                    <Text as="p" variant="muted" size="sm">
                        {selectedTagIds.length} selected
                    </Text>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            size="sm"
                            disabled={selectedTagIds.length === tags.length}
                            onClick={() => setSelectedTagIds(tags.map(tag => tag.id))}>
                            Select all
                        </Button>
                        <Button
                            size="sm"
                            disabled={selectedTagIds.length === 0}
                            onClick={() => setSelectedTagIds([])}>
                            Clear
                        </Button>
                    </div>
                </section>
            )}

            {tagsQuery.isLoading && <Loading />}
            {!tagsQuery.isLoading && tagsQuery.data?.type === 'error' && (
                <div className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-md)]">
                    <Text as="p" variant="muted" size="sm">
                        {getGraphQueryErrorMessage(tagsQuery.data)}
                    </Text>
                </div>
            )}
            {!tagsQuery.isLoading && tagsQuery.data?.type !== 'error' && (
                tags.length > 0 ? (
                    <div className={isSelectMode ? 'pb-36' : 'pb-[var(--b-spacing-2xl)]'}>
                        {tags.map(tag => (
                            <TagListItem
                                key={tag.id}
                                tag={tag}
                                isSelectMode={isSelectMode}
                                selected={selectedTagSet.has(tag.id)}
                                pending={pendingAction === `rename:${tag.id}` || pendingAction === `delete:${tag.id}`}
                                onClick={isSelectMode
                                    ? () => handleTagToggle(tag.id)
                                    : () => handleViewLibrary([tag.id])}
                                onRename={() => handleStartRename(tag)}
                                onDelete={() => handleDelete(tag)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-md)]">
                        <Text as="p" variant="muted" size="sm">
                            No tags.
                        </Text>
                    </div>
                )
            )}

            {isSelectMode && selectedTagIds.length > 0 && (
                <section className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[8] mx-auto mt-[var(--b-spacing-lg)] flex w-[min(42rem,calc(100%_-_2rem))] flex-col gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-modal)] p-3">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0">
                            <Text as="h2" size="sm" weight="semibold" truncate>
                                Filter Library
                            </Text>
                            <Text as="p" variant="muted" size="xs" truncate>
                                {selectedTagIds.length} selected
                            </Text>
                        </div>
                        <Button
                            size="sm"
                            onClick={handleStopSelect}>
                            Cancel
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                        <button
                            type="button"
                            className="inline-flex min-h-14 items-center justify-start gap-3 rounded-[var(--b-radius-md)] border border-[var(--b-color-point)] bg-[var(--b-color-point)] px-3 py-2 text-left text-xs font-semibold text-[var(--b-color-background)] transition-[background-color,border-color,transform] hover:border-[var(--b-color-point-dark)] hover:bg-[var(--b-color-point-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] active:scale-[0.98]"
                            onClick={() => handleViewLibrary(selectedTagIds, 'all')}>
                            <Icon.DoubleCheck className="h-[0.95rem] w-[0.95rem] shrink-0" />
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span>AND filter</span>
                                <span className="text-[0.6875rem] font-medium leading-tight opacity-75">
                                    Music with every selected tag
                                </span>
                            </span>
                        </button>
                        <button
                            type="button"
                            className="inline-flex min-h-14 items-center justify-start gap-3 rounded-[var(--b-radius-md)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-subtle)] px-3 py-2 text-left text-xs font-semibold text-[var(--b-color-text-secondary)] transition-[background-color,border-color,color,transform] hover:bg-[var(--b-color-hover)] hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)] active:scale-[0.98]"
                            onClick={() => handleViewLibrary(selectedTagIds, 'any')}>
                            <Icon.Check className="h-[0.95rem] w-[0.95rem] shrink-0" />
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span>OR filter</span>
                                <span className="text-[0.6875rem] font-medium leading-tight text-[var(--b-color-text-muted)]">
                                    Music with any selected tag
                                </span>
                            </span>
                        </button>
                    </div>
                </section>
            )}

            <TextEntryDialog
                open={isCreateDialogOpen}
                title="Create tag"
                value={createName}
                placeholder="Tag name"
                confirmLabel="Create"
                pending={pendingAction === 'create'}
                onValueChange={setCreateName}
                onConfirm={handleCreateConfirm}
                onClose={() => {
                    setIsCreateDialogOpen(false);
                    setCreateName('');
                }}
            />

            <TextEntryDialog
                open={editingTag !== null}
                title="Rename tag"
                value={editName}
                placeholder="Tag name"
                confirmLabel="Rename"
                pending={editingTag ? pendingAction === `rename:${editingTag.id}` : false}
                onValueChange={setEditName}
                onConfirm={handleRenameConfirm}
                onClose={() => {
                    setEditingTag(null);
                    setEditName('');
                }}
            />
        </>
    );
}
