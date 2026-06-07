import {
    type ReactNode,
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

const resolveTagListSection = (value: string | null): TagListSection => {
    return value === 'views' ? 'views' : 'tags';
};

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

const tagListActiveButtonClass = 'border-[var(--b-color-focus)] bg-[var(--b-color-active)] !text-[var(--b-color-point)] [&_svg]:!text-[var(--b-color-point)]';

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

function TagSelectionActionButton({
    icon,
    label,
    description,
    primary = false,
    onClick
}: {
    icon: ReactNode;
    label: string;
    description: string;
    primary?: boolean;
    onClick: () => void;
}) {
    return (
        <Button
            variant={primary ? 'primary' : 'secondary'}
            fullWidth
            className="min-h-14 justify-start px-3 py-2 text-left"
            onClick={onClick}>
            {icon}
            <span className="flex min-w-0 flex-col gap-0.5">
                <span>{label}</span>
                <span className={cx(
                    'text-[0.6875rem] font-medium leading-tight',
                    primary ? 'opacity-75' : 'text-[var(--b-color-text-muted)]'
                )}>
                    {description}
                </span>
            </span>
        </Button>
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

    const handleUnusedOnlyToggle = () => {
        setSearchParams((currentSearchParams) => {
            const nextSearchParams = new URLSearchParams(currentSearchParams);

            if (unusedOnly) {
                nextSearchParams.delete('unused');
            } else {
                nextSearchParams.set('unused', '1');
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
        setSelectedTagMode(DEFAULT_MUSIC_TAG_FILTER_MODE);
        setIsSelectMode(true);
    };

    const handleStopSelect = () => {
        setSelectedTagIds([]);
        setSelectedTagMode(DEFAULT_MUSIC_TAG_FILTER_MODE);
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
                <StickyHeaderActions>
                    {section === 'tags' && isSelectMode ? (
                        <Button onClick={handleStopSelect}>
                            Done
                        </Button>
                    ) : section === 'tags' ? (
                        <>
                            <Button
                                disabled={pendingAction === 'create'}
                                onClick={() => setIsCreateDialogOpen(true)}>
                                <Icon.Plus /> Create
                            </Button>
                            <Button
                                aria-pressed={unusedOnly}
                                className={unusedOnly ? tagListActiveButtonClass : undefined}
                                onClick={handleUnusedOnlyToggle}>
                                <Icon.Filter /> Unused
                            </Button>
                            <Button onClick={handleStartSelect}>
                                <Icon.CheckBox /> Select
                            </Button>
                        </>
                    ) : (
                        <Button
                            onClick={() => {
                                handleSectionChange('tags');
                                handleStartSelect();
                            }}>
                            <Icon.Plus /> Create filter
                        </Button>
                    )}
                </StickyHeaderActions>
            </StickyHeader>

            <section className="flex gap-2 border-b border-[var(--b-color-border-subtle)] px-[var(--b-spacing-lg)] py-3">
                <Button
                    size="sm"
                    aria-pressed={section === 'tags'}
                    className={section === 'tags' ? tagListActiveButtonClass : undefined}
                    onClick={() => handleSectionChange('tags')}>
                    <Icon.Tags /> Tags
                </Button>
                <Button
                    size="sm"
                    aria-pressed={section === 'views'}
                    className={section === 'views' ? tagListActiveButtonClass : undefined}
                    onClick={() => handleSectionChange('views')}>
                    <Icon.Filter /> Saved filters
                </Button>
            </section>

            {section === 'tags' && isSelectMode && (
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
                                    No saved filters. Select tags and save a filter first.
                                </Text>
                            </div>
                        )
                    )}
                </>
            )}

            {section === 'tags' && isSelectMode && selectedTagIds.length > 0 && (
                <section className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[8] mx-auto mt-[var(--b-spacing-lg)] flex w-[min(42rem,calc(100%_-_2rem))] flex-col gap-3 rounded-[var(--b-radius-lg)] border border-[var(--b-color-border-subtle)] bg-[var(--b-color-surface-modal)] p-3">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0">
                            <Text as="h2" size="sm" weight="semibold" truncate>
                                {getTagCountLabel(selectedTagIds.length)} selected
                            </Text>
                            <Text as="p" variant="muted" size="xs" truncate>
                                Pick how the selected tags should match.
                            </Text>
                        </div>
                        <Button
                            size="sm"
                            onClick={handleStopSelect}>
                            Cancel
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                        <Button
                            fullWidth
                            aria-pressed={selectedTagMode === 'all'}
                            className={cx(
                                'min-h-14 justify-start px-3 py-2 text-left',
                                selectedTagMode === 'all' ? tagListActiveButtonClass : undefined
                            )}
                            onClick={() => setSelectedTagMode('all')}>
                            <Icon.DoubleCheck />
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span>Match all</span>
                                <span className="text-[0.6875rem] font-medium leading-tight text-[var(--b-color-text-muted)]">
                                    Every selected tag
                                </span>
                            </span>
                        </Button>
                        <Button
                            fullWidth
                            aria-pressed={selectedTagMode === 'any'}
                            className={cx(
                                'min-h-14 justify-start px-3 py-2 text-left',
                                selectedTagMode === 'any' ? tagListActiveButtonClass : undefined
                            )}
                            onClick={() => setSelectedTagMode('any')}>
                            <Icon.Check />
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span>Match any</span>
                                <span className="text-[0.6875rem] font-medium leading-tight text-[var(--b-color-text-muted)]">
                                    At least one selected tag
                                </span>
                            </span>
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                        <TagSelectionActionButton
                            primary
                            icon={<Icon.Filter />}
                            label="Show songs"
                            description={getTagViewModeDescription(selectedTagMode)}
                            onClick={() => handleViewLibrary(selectedTagIds, selectedTagMode)}
                        />
                        <TagSelectionActionButton
                            icon={<Icon.Plus />}
                            label="Save filter"
                            description="Keep this tag set"
                            onClick={handleStartSaveView}
                        />
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
