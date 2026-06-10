import {
    useDeferredValue,
    useState
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cva } from 'class-variance-authority';
import classNames from 'classnames';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useModal } from '~/components/app/ModalProvider';
import {
    Badge,
    Button,
    IconButton,
    ListSelectionToolbar,
    Loading,
    SearchField,
    SelectionCheckButton,
    StickyHeader,
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
import {
    createTagView,
    deleteTagView,
    fetchTagViews,
    renameTagView
} from '~/api/tag-views';
import { queryKeys } from '~/api/query-keys';
import { toast } from '~/modules/toast';
import {
    buildTagDeleteConfirmationMessage,
    createMusicTagFilterSearchParams,
    DEFAULT_MUSIC_TAG_FILTER_MODE,
    getTagUsageSummary,
    type MusicTagFilterMode
} from '~/modules/music-tags';
import type {
    Tag,
    TagView
} from '~/models/type';
import { musicStore } from '~/store/music';

const cx = classNames;

const TAG_LIST_LIMIT = 100;
const TAG_LIST_SECTION_PARAM = 'section';

type TagListSection = 'tags' | 'views';

interface TagViewDraft {
    tagIds: string[];
    tagMode: MusicTagFilterMode;
}

type TagSelectionIntent = 'browse' | 'create-filter';

const resolveTagListSection = (value: string | null): TagListSection => {
    return value === 'views' ? 'views' : 'tags';
};

const tagListItemIconClass = cva(
    'flex h-10 w-10 items-center justify-center rounded-[var(--b-radius-md)] border bg-[var(--b-color-surface-subtle)]',
    {
        variants: {
            selected: {
                true: 'border-[var(--b-color-point)] bg-[var(--b-color-point)] text-[var(--b-color-background)]',
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
                true: '',
                false: ''
            }
        },
        defaultVariants: {
            selected: false
        }
    }
);

const tagListTabClass = cva(
    [
        'relative flex min-h-10 items-center justify-center gap-2 border-b-2 bg-transparent px-1 text-sm font-semibold transition-colors sm:justify-start sm:px-0',
        'appearance-none shadow-none ring-0 hover:bg-transparent active:bg-transparent focus:bg-transparent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0'
    ],
    {
        variants: {
            selected: {
                true: 'border-[var(--b-color-focus)] text-[var(--b-color-point)]',
                false: 'border-transparent text-[var(--b-color-text-muted)] hover:text-[var(--b-color-text)]'
            }
        }
    }
);


const getGraphQueryErrorMessage = (response: {
    type: 'error';
    errors: { message: string }[];
}) => response.errors[0]?.message ?? 'Tag request failed';

const getTagViewModeLabel = (mode: MusicTagFilterMode) => {
    return mode === 'any' ? 'Match any' : 'Match all';
};

const getTagViewModeDescription = (mode: MusicTagFilterMode) => {
    return mode === 'any' ? 'At least one selected tag' : 'Every selected tag';
};

const getTagCountLabel = (count: number) => {
    if (count === 0) {
        return 'No tags';
    }

    return count === 1 ? '1 tag' : `${count} tags`;
};

const getTagViewSummary = (view: TagView) => {
    return `${getTagCountLabel(view.tagIds.length)} · ${getTagViewModeLabel(view.tagMode)}`;
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
            {isSelectMode ? (
                <SelectionCheckButton
                    selected={selected}
                    className="pointer-events-none h-10 w-10 p-0"
                    tabIndex={-1}
                    aria-hidden="true"
                />
            ) : (
                <span className={tagListItemIconClass({ selected: false })}>
                    <Icon.Tags className="h-5 w-5" />
                </span>
            )}
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
            <span className="flex min-w-0 flex-wrap justify-end gap-1">
                <Badge>{getTagUsageSummary(tag)}</Badge>
            </span>
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

function TagViewListItem({
    view,
    pending,
    onClick,
    onRename,
    onDelete
}: {
    view: TagView;
    pending: boolean;
    onClick: () => void;
    onRename: () => void;
    onDelete: () => void;
}) {
    const hasTags = view.tagIds.length > 0;

    return (
        <div className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-stretch border-b border-[var(--b-color-border-subtle)] transition-colors hover:bg-[var(--b-color-hover)]">
            <button
                type="button"
                aria-label={hasTags
                    ? `Open ${view.name} saved filter`
                    : `${view.name} saved filter has no tags`}
                className={cx(
                    tagListRowClass({ interactive: 'browse' }),
                    'border-b-0 hover:bg-transparent disabled:cursor-not-allowed disabled:opacity-60'
                )}
                disabled={!hasTags}
                onClick={onClick}>
                <span className={tagListItemIconClass({ selected: false })}>
                    <Icon.Filter className="h-5 w-5" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                    <Text weight="semibold" truncate>
                        {view.name}
                    </Text>
                    <Text variant="muted" size="xs" truncate>
                        {hasTags ? view.tags.map(tag => tag.name).join(', ') : 'No tags left in this saved filter'}
                    </Text>
                </span>
                <Badge>{getTagViewSummary(view)}</Badge>
            </button>
            <div className="flex items-center gap-1 pr-[var(--b-spacing-md)]">
                <IconButton
                    size="sm"
                    aria-label={`Rename ${view.name} saved filter`}
                    disabled={pending}
                    onClick={onRename}>
                    <Icon.Pencil />
                </IconButton>
                <IconButton
                    size="sm"
                    tone="danger"
                    aria-label={`Delete ${view.name} saved filter`}
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
    const { confirm } = useModal();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [createName, setCreateName] = useState('');
    const [editingTag, setEditingTag] = useState<Tag | null>(null);
    const [editName, setEditName] = useState('');
    const [savingViewDraft, setSavingViewDraft] = useState<TagViewDraft | null>(null);
    const [saveViewName, setSaveViewName] = useState('');
    const [editingView, setEditingView] = useState<TagView | null>(null);
    const [editViewName, setEditViewName] = useState('');
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [tagSelectionIntent, setTagSelectionIntent] = useState<TagSelectionIntent>('browse');
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
    const [selectedTagMode, setSelectedTagMode] = useState<MusicTagFilterMode>(DEFAULT_MUSIC_TAG_FILTER_MODE);

    const section = resolveTagListSection(searchParams.get(TAG_LIST_SECTION_PARAM));
    const query = searchParams.get('q') || '';
    const unusedOnly = searchParams.get('unused') === '1';
    const deferredQuery = useDeferredValue(query.trim());

    const tagsQuery = useQuery({
        queryKey: queryKeys.tags.list({
            query: deferredQuery,
            limit: TAG_LIST_LIMIT,
            unusedOnly
        }),
        queryFn: () => fetchTags({
            query: deferredQuery,
            limit: TAG_LIST_LIMIT,
            unusedOnly
        })
    });

    const viewsQuery = useQuery({
        queryKey: queryKeys.tagViews.list(),
        queryFn: fetchTagViews
    });

    const invalidateTagLists = () => {
        queryClient.invalidateQueries({
            queryKey: queryKeys.tags.all(),
            exact: false
        });
    };

    const invalidateTagViews = () => {
        queryClient.invalidateQueries({
            queryKey: queryKeys.tagViews.all(),
            exact: false
        });
    };

    const invalidateTagDomain = () => {
        invalidateTagLists();
        invalidateTagViews();
    };

    const handleSectionChange = (nextSection: TagListSection) => {
        setSearchParams((currentSearchParams) => {
            const nextSearchParams = new URLSearchParams(currentSearchParams);

            if (nextSection === 'tags') {
                nextSearchParams.delete(TAG_LIST_SECTION_PARAM);
            } else {
                nextSearchParams.set(TAG_LIST_SECTION_PARAM, nextSection);
                nextSearchParams.delete('unused');
            }

            nextSearchParams.delete('q');
            nextSearchParams.delete('py');
            return nextSearchParams;
        }, { replace: true });
        handleStopSelect();
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

    const handleStartSelect = (intent: TagSelectionIntent = 'browse') => {
        setSelectedTagIds([]);
        setSelectedTagMode(DEFAULT_MUSIC_TAG_FILTER_MODE);
        setTagSelectionIntent(intent);
        setIsSelectMode(true);
    };

    const handleStartCreateFilter = () => {
        setSearchParams((currentSearchParams) => {
            const nextSearchParams = new URLSearchParams(currentSearchParams);

            nextSearchParams.delete(TAG_LIST_SECTION_PARAM);
            nextSearchParams.delete('unused');
            nextSearchParams.delete('q');
            nextSearchParams.delete('py');
            return nextSearchParams;
        }, { replace: true });
        handleStartSelect('create-filter');
    };

    const handleStopSelect = () => {
        setSelectedTagIds([]);
        setSelectedTagMode(DEFAULT_MUSIC_TAG_FILTER_MODE);
        setTagSelectionIntent('browse');
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
                invalidateTagDomain();
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
                invalidateTagDomain();
                toast.success('Renamed tag');
            } finally {
                setPendingAction(null);
            }
        })();
    };

    const handleDelete = async (tag: Tag) => {
        if (!(await confirm({
            title: `Delete “${tag.name}”?`,
            description: buildTagDeleteConfirmationMessage(tag),
            confirmLabel: 'Delete tag',
            tone: 'danger'
        }))) {
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
                invalidateTagDomain();
                toast.success(response.deleteTag.affectedSmartViewIds.length > 0
                    ? 'Deleted tag and updated saved filters'
                    : 'Deleted tag');
            } finally {
                setPendingAction(null);
            }
        })();
    };

    const handleStartSaveView = () => {
        setSavingViewDraft({
            tagIds: [...selectedTagIds],
            tagMode: selectedTagMode
        });
        setSaveViewName('');
    };

    const handleCreateViewConfirm = (name: string) => {
        if (pendingAction || !savingViewDraft) {
            return;
        }

        void (async () => {
            setPendingAction('create-view');

            try {
                const response = await createTagView({
                    name,
                    tagIds: savingViewDraft.tagIds,
                    tagMode: savingViewDraft.tagMode
                });

                if (response.type === 'error') {
                    toast.error(getGraphQueryErrorMessage(response));
                    return;
                }

                setSavingViewDraft(null);
                setSaveViewName('');
                setSelectedTagIds([]);
                setIsSelectMode(false);
                invalidateTagDomain();
                handleSectionChange('views');
                toast.success('Saved filter');
            } finally {
                setPendingAction(null);
            }
        })();
    };

    const handleStartRenameView = (view: TagView) => {
        setEditingView(view);
        setEditViewName(view.name);
    };

    const handleRenameViewConfirm = (name: string) => {
        if (pendingAction || !editingView) {
            return;
        }

        const viewId = editingView.id;

        void (async () => {
            setPendingAction(`rename-view:${viewId}`);

            try {
                const response = await renameTagView({
                    id: viewId,
                    name
                });

                if (response.type === 'error') {
                    toast.error(getGraphQueryErrorMessage(response));
                    return;
                }

                setEditingView(null);
                setEditViewName('');
                invalidateTagViews();
                toast.success('Renamed saved filter');
            } finally {
                setPendingAction(null);
            }
        })();
    };

    const handleDeleteView = async (view: TagView) => {
        if (!(await confirm({
            title: `Delete “${view.name}”?`,
            description: 'This saved filter will be removed. Your tags and music will stay unchanged.',
            confirmLabel: 'Delete filter',
            tone: 'danger'
        }))) {
            return;
        }

        void (async () => {
            setPendingAction(`delete-view:${view.id}`);

            try {
                const response = await deleteTagView(view.id);

                if (response.type === 'error') {
                    toast.error(getGraphQueryErrorMessage(response));
                    return;
                }

                invalidateTagDomain();
                toast.success('Deleted saved filter');
            } finally {
                setPendingAction(null);
            }
        })();
    };

    const tags = tagsQuery.data?.type === 'success'
        ? tagsQuery.data.allTags.tags
        : [];
    const views = viewsQuery.data?.type === 'success'
        ? viewsQuery.data.tagViews.views.filter((view) => {
            const normalizedQuery = deferredQuery.toLowerCase();

            return view.name.toLowerCase().includes(normalizedQuery) ||
                view.tags.some(tag => tag.name.toLowerCase().includes(normalizedQuery));
        })
        : [];
    const selectedTagSet = new Set(selectedTagIds);

    return (
        <>
            <StickyHeader>
                <SearchField
                    value={query}
                    placeholder={section === 'views' ? 'Search saved filters' : 'Search tags'}
                    ariaLabel={section === 'views' ? 'Search saved filters' : 'Search tags'}
                    onChange={handleSearchChange}
                />
            </StickyHeader>

            <nav
                aria-label="Tag page sections"
                className="border-b border-[var(--b-color-border-subtle)] px-[var(--b-spacing-lg)]">
                <div role="tablist" className="grid grid-cols-2 gap-6 sm:inline-flex sm:grid-cols-none sm:gap-6">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={section === 'tags'}
                        className={tagListTabClass({ selected: section === 'tags' })}
                        onClick={() => handleSectionChange('tags')}>
                        <Icon.Tags className="h-4 w-4" /> Tags
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={section === 'views'}
                        className={tagListTabClass({ selected: section === 'views' })}
                        onClick={() => handleSectionChange('views')}>
                        <Icon.Filter className="h-4 w-4" /> Saved filters
                    </button>
                </div>
            </nav>

            <section className="flex items-center justify-between gap-[var(--b-spacing-md)] px-[var(--b-spacing-lg)] py-[var(--b-spacing-md)] max-sm:flex-col max-sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Text as="h2" size="title" weight="semibold" className="truncate">
                        {section === 'views' ? 'Saved filters' : 'Tags'}
                    </Text>
                    <Text as="p" variant="muted" size="xs" className="truncate">
                        {section === 'views'
                            ? `${views.length} saved filters`
                            : unusedOnly
                                ? `${tags.length} unused tags`
                                : `${tags.length} tags`}
                    </Text>
                </div>

                <div className="inline-flex items-center justify-self-end gap-2 max-sm:w-full max-sm:justify-end">
                    {section === 'views' ? (
                        <Button
                            size="sm"
                            aria-label="Create saved filter"
                            onClick={handleStartCreateFilter}>
                            <Icon.Plus /> Create
                        </Button>
                    ) : isSelectMode ? null : (
                        <>
                            <Button
                                size="sm"
                                disabled={pendingAction === 'create'}
                                onClick={() => setIsCreateDialogOpen(true)}>
                                <Icon.Plus /> Create
                            </Button>
                        </>
                    )}
                </div>
            </section>

            {section === 'tags' && tags.length > 0 && (
                <ListSelectionToolbar
                    sticky
                    className="top-[60px] px-[var(--b-spacing-lg)] pb-2 pt-0 max-sm:top-[96px]"
                    isSelecting={isSelectMode}
                    selectedCount={selectedTagIds.length}
                    totalCount={tags.length}
                    selectLabel="Select"
                    selectedLabel="tags"
                    onStartSelect={() => handleStartSelect('browse')}
                    onStopSelect={handleStopSelect}
                    onSelectAll={() => setSelectedTagIds(tags.map(tag => tag.id))}
                    onClear={() => setSelectedTagIds([])}
                />
            )}

            {section === 'tags' && (
                <>
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
                            <div className={isSelectMode ? 'pb-48' : 'pb-[var(--b-spacing-2xl)]'}>
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
                                    {unusedOnly ? 'No unused tags.' : 'No tags.'}
                                </Text>
                            </div>
                        )
                    )}
                </>
            )}

            {section === 'views' && (
                <>
                    {viewsQuery.isLoading && <Loading />}
                    {!viewsQuery.isLoading && viewsQuery.data?.type === 'error' && (
                        <div className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-md)]">
                            <Text as="p" variant="muted" size="sm">
                                {getGraphQueryErrorMessage(viewsQuery.data)}
                            </Text>
                        </div>
                    )}
                    {!viewsQuery.isLoading && viewsQuery.data?.type !== 'error' && (
                        views.length > 0 ? (
                            <div className="pb-[var(--b-spacing-2xl)]">
                                {views.map(view => (
                                    <TagViewListItem
                                        key={view.id}
                                        view={view}
                                        pending={pendingAction === `rename-view:${view.id}` || pendingAction === `delete-view:${view.id}`}
                                        onClick={() => handleViewLibrary(view.tagIds, view.tagMode)}
                                        onRename={() => handleStartRenameView(view)}
                                        onDelete={() => handleDeleteView(view)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-md)]">
                                <Text as="p" variant="muted" size="sm">
                                    No saved filters yet. Create one to reuse a tag combination.
                                </Text>
                            </div>
                        )
                    )}
                </>
            )}

            {section === 'tags' && isSelectMode && selectedTagIds.length > 0 && (
                <section className="sticky bottom-[max(12px,env(safe-area-inset-bottom))] z-[8] mx-auto mt-[var(--b-spacing-lg)] flex w-[min(544px,calc(100%_-_32px))] flex-col gap-2 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-modal)] p-2">
                    <div className="grid grid-cols-2 gap-1 rounded-[var(--b-radius-md)] bg-[var(--b-color-surface-subtle)] p-1">
                        <button
                            type="button"
                            aria-pressed={selectedTagMode === 'all'}
                            className={cx(
                                'min-h-9 rounded-[var(--b-radius-sm)] px-3 text-xs font-semibold text-[var(--b-color-text-secondary)] transition-colors hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                                selectedTagMode === 'all' && 'bg-[var(--b-color-surface-input)] text-[var(--b-color-text)]'
                            )}
                            onClick={() => setSelectedTagMode('all')}>
                            Match all
                        </button>
                        <button
                            type="button"
                            aria-pressed={selectedTagMode === 'any'}
                            className={cx(
                                'min-h-9 rounded-[var(--b-radius-sm)] px-3 text-xs font-semibold text-[var(--b-color-text-secondary)] transition-colors hover:text-[var(--b-color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-color-focus)]',
                                selectedTagMode === 'any' && 'bg-[var(--b-color-surface-input)] text-[var(--b-color-text)]'
                            )}
                            onClick={() => setSelectedTagMode('any')}>
                            Match any
                        </button>
                    </div>
                    <Text as="p" variant="muted" size="xs" className="px-1" truncate>
                        {getTagCountLabel(selectedTagIds.length)} · {getTagViewModeDescription(selectedTagMode)}
                    </Text>
                    <div className={cx('grid gap-2', tagSelectionIntent === 'create-filter' ? 'grid-cols-1' : 'grid-cols-2 max-sm:grid-cols-1')}>
                        {tagSelectionIntent !== 'create-filter' && (
                            <Button
                                fullWidth
                                onClick={() => handleViewLibrary(selectedTagIds, selectedTagMode)}>
                                <Icon.Filter /> Show songs
                            </Button>
                        )}
                        <Button
                            fullWidth
                            onClick={handleStartSaveView}>
                            <Icon.Plus /> Save filter
                        </Button>
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
                open={savingViewDraft !== null}
                title="Save filter"
                description={savingViewDraft
                    ? `${getTagViewModeLabel(savingViewDraft.tagMode)} · ${getTagCountLabel(savingViewDraft.tagIds.length)}. Stored under Tags > Saved filters.`
                    : undefined}
                value={saveViewName}
                placeholder="Filter name"
                confirmLabel="Save filter"
                pending={pendingAction === 'create-view'}
                onValueChange={setSaveViewName}
                onConfirm={handleCreateViewConfirm}
                onClose={() => {
                    setSavingViewDraft(null);
                    setSaveViewName('');
                }}
            />

            <TextEntryDialog
                open={editingView !== null}
                title="Rename saved filter"
                value={editViewName}
                placeholder="Filter name"
                confirmLabel="Rename"
                pending={editingView ? pendingAction === `rename-view:${editingView.id}` : false}
                onValueChange={setEditViewName}
                onConfirm={handleRenameViewConfirm}
                onClose={() => {
                    setEditingView(null);
                    setEditViewName('');
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
