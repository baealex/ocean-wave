import { useDeferredValue } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    LibraryPlaybackSurface,
    MusicActionPanelContent,
    MusicListItem,
    MusicTagFilterPanelContent,
    SmartMusicFilterPanelContent
} from '~/components/music';

import {
    Button,
    CollectionHeader,
    FixedVirtualList,
    ItemSortPanelContent,
    Loading,
    PanelContent,
    SearchField,
    StateMessage,
    StickyHeaderActions
} from '~/components/shared';
import { useRemotePlaybackOwnership, useResetQueue } from '~/hooks';
import * as Icon from '~/icon';
import {
    DEFAULT_MUSIC_TAG_FILTER_MODE,
    filterMusicsByTagIds,
    getMusicTagFilterLabel,
    MUSIC_TAG_FILTER_MODE_PARAM,
    MUSIC_TAG_FILTER_PARAM,
    type MusicTagFilterMode,
    parseMusicTagIdsParam,
    resolveMusicTagFilterMode
} from '~/modules/music-tags';
import { panel } from '~/modules/panel';
import {
    REMOTE_PLAYBACK_OWNERSHIP_MESSAGE,
    REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
} from '~/modules/playback-ownership';
import {
    DEFAULT_SMART_MUSIC_FILTER_ID,
    filterMusicsBySmartFilter,
    getSmartMusicFilterOption,
    resolveSmartMusicFilterId,
    type SmartMusicFilterId
} from '~/modules/smart-music-filters';
import { useAppStore as useStore } from '~/store/base-store';

import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';

const MUSIC_LIST_ROW_HEIGHT = 80;
const SMART_FILTER_PARAM = 'filter';

export default function Music() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();
    const remotePlaybackOwnership = useRemotePlaybackOwnership();
    const [searchParams, setSearchParams] = useSearchParams();

    const [{ musics, loaded }] = useStore(musicStore);
    const query = searchParams.get('q') || '';
    const smartFilterId = resolveSmartMusicFilterId(searchParams.get(SMART_FILTER_PARAM));
    const tagFilterIds = parseMusicTagIdsParam(searchParams.get(MUSIC_TAG_FILTER_PARAM));
    const tagFilterMode = resolveMusicTagFilterMode(searchParams.get(MUSIC_TAG_FILTER_MODE_PARAM));
    const activeSmartFilter = getSmartMusicFilterOption(smartFilterId);
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());
    const isSmartFilterActive = smartFilterId !== DEFAULT_SMART_MUSIC_FILTER_ID;
    const isTagFilterActive = tagFilterIds.length > 0;

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

    const handleSmartFilterChange = (filterId: SmartMusicFilterId) => {
        const nextSearchParams = new URLSearchParams(searchParams);

        if (filterId === DEFAULT_SMART_MUSIC_FILTER_ID) {
            nextSearchParams.delete(SMART_FILTER_PARAM);
        } else {
            nextSearchParams.set(SMART_FILTER_PARAM, filterId);
        }

        nextSearchParams.delete('py');

        setSearchParams(nextSearchParams, { replace: true });
    };

    const handleTagFilterChange = (
        selectedTagIds: string[],
        mode: MusicTagFilterMode
    ) => {
        const nextSearchParams = new URLSearchParams(searchParams);

        if (selectedTagIds.length > 0) {
            nextSearchParams.set(MUSIC_TAG_FILTER_PARAM, selectedTagIds.join(','));
        } else {
            nextSearchParams.delete(MUSIC_TAG_FILTER_PARAM);
        }

        if (selectedTagIds.length > 0 && mode !== DEFAULT_MUSIC_TAG_FILTER_MODE) {
            nextSearchParams.set(MUSIC_TAG_FILTER_MODE_PARAM, mode);
        } else {
            nextSearchParams.delete(MUSIC_TAG_FILTER_MODE_PARAM);
        }

        nextSearchParams.delete('py');

        setSearchParams(nextSearchParams, { replace: true });
    };

    const availableMusics = (musics?.filter(music => !music.isHated)) ?? [];
    const smartFilteredMusics = filterMusicsBySmartFilter(availableMusics, smartFilterId);
    const tagFilteredMusics = filterMusicsByTagIds(smartFilteredMusics, tagFilterIds, tagFilterMode);
    const filteredMusics = tagFilteredMusics.filter(music =>
        music.name.toLowerCase().includes(deferredQuery) ||
        music.artist.name.toLowerCase().includes(deferredQuery) ||
        music.album.name.toLowerCase().includes(deferredQuery)
    );
    const hasActiveFilters = Boolean(query.trim()) || isSmartFilterActive || isTagFilterActive;
    const summary = !loaded
        ? 'Loading library'
        : hasActiveFilters
            ? `${filteredMusics.length.toLocaleString()} of ${availableMusics.length.toLocaleString()} songs`
            : `${availableMusics.length.toLocaleString()} songs`;

    const openSmartFilter = () => panel.open({
        title: 'Music Filter',
        content: (
            <SmartMusicFilterPanelContent
                activeFilterId={smartFilterId}
                onSelect={handleSmartFilterChange}
            />
        )
    });

    const openTagFilter = () => panel.open({
        title: 'Tag Filter',
        content: (
            <MusicTagFilterPanelContent
                selectedTagIds={tagFilterIds}
                mode={tagFilterMode}
                onApply={(selectedTagIds, mode) => {
                    handleTagFilterChange(selectedTagIds, mode);
                    panel.close();
                }}
            />
        )
    });

    const openSort = () => panel.open({
        title: 'Music Sort',
        content: <ItemSortPanelContent items={musicStore.sortItems} />
    });

    const openMobileOptions = () => panel.open({
        title: 'Library options',
        content: (
            <PanelContent
                items={[
                    {
                        id: 'smart-filter',
                        icon: <Icon.Filter />,
                        text: 'Music filter',
                        description: activeSmartFilter.label,
                        active: isSmartFilterActive,
                        onClick: openSmartFilter
                    },
                    {
                        id: 'tag-filter',
                        icon: <Icon.Tags />,
                        text: 'Tag filter',
                        description: getMusicTagFilterLabel(tagFilterIds.length),
                        active: isTagFilterActive,
                        onClick: openTagFilter
                    },
                    {
                        id: 'sort',
                        icon: <Icon.Sort />,
                        text: 'Sort music',
                        description: musicStore.sortItems.find(item => item.isActive)?.text,
                        onClick: openSort
                    }
                ]}
            />
        )
    });

    return (
        <>
            <CollectionHeader
                title="Library"
                summary={summary}
                actions={(
                    <Button
                        variant="primary"
                        aria-label={remotePlaybackOwnership
                            ? 'Play library unavailable while another device owns playback'
                            : undefined}
                        aria-describedby={remotePlaybackOwnership
                            ? REMOTE_PLAYBACK_OWNERSHIP_NOTICE_ID
                            : undefined}
                        title={remotePlaybackOwnership
                            ? REMOTE_PLAYBACK_OWNERSHIP_MESSAGE
                            : undefined}
                        disabled={filteredMusics.length === 0 || Boolean(remotePlaybackOwnership)}
                        onClick={() => void resetQueue(filteredMusics.map(music => music.id))}>
                        <Icon.Play /> Play
                    </Button>
                )}>
                <SearchField
                    value={query}
                    placeholder="Search music, artist, album"
                    ariaLabel="Search music"
                    onChange={handleSearchChange}
                />
                <StickyHeaderActions>
                    <Button
                        className="max-sm:hidden"
                        size="sm"
                        active={isSmartFilterActive}
                        aria-pressed={isSmartFilterActive}
                        aria-label="Filter music"
                        onClick={openSmartFilter}>
                        <Icon.Filter /> {activeSmartFilter.shortLabel}
                    </Button>
                    <Button
                        className="max-sm:hidden"
                        size="sm"
                        active={isTagFilterActive}
                        aria-pressed={isTagFilterActive}
                        aria-label="Filter music by tags"
                        onClick={openTagFilter}>
                        <Icon.Tags /> {getMusicTagFilterLabel(tagFilterIds.length)}
                    </Button>
                    <Button
                        className="max-sm:hidden"
                        size="sm"
                        aria-label="Sort music"
                        onClick={openSort}>
                        <Icon.Sort />
                    </Button>
                    <Button
                        className="sm:hidden"
                        size="sm"
                        active={isSmartFilterActive || isTagFilterActive}
                        aria-label="Open library filters and sorting"
                        onClick={openMobileOptions}>
                        <Icon.Filter /> Options
                    </Button>
                </StickyHeaderActions>
            </CollectionHeader>
            <LibraryPlaybackSurface />
            {!loaded && (
                <Loading />
            )}
            {loaded && (
                <FixedVirtualList
                    items={filteredMusics}
                    rowHeight={MUSIC_LIST_ROW_HEIGHT}
                    overscanPx={MUSIC_LIST_ROW_HEIGHT * 6}
                    getKey={(music) => music.id}
                    emptyState={(
                        <StateMessage
                            className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-2xl)]"
                            icon={<Icon.Music />}
                            heading={query.trim() ? 'No music found.' : 'No music yet.'}
                            description={query.trim()
                                ? 'Try a different search, filter, or tag combination.'
                                : 'Add music to your library to start listening.'}
                        />
                    )}
                    renderItem={(music) => (
                        <MusicListItem
                            key={music.id}
                            albumName={music.album.name}
                            albumCover={music.album.cover}
                            artistName={music.artist.name}
                            musicName={music.name}
                            musicCodec={music.codec}
                            isLiked={music.isLiked}
                            isHated={music.isHated}
                            onClick={() => queueStore.add(music.id)}
                            onLongPress={() => panel.open({
                                title: 'Related to this music',
                                content: (
                                    <MusicActionPanelContent
                                        id={music.id}
                                        onAlbumClick={() => navigate(`/album/${music.album.id}`)}
                                        onArtistClick={() => navigate(`/artist/${music.artist.id}`)}
                                    />
                                )
                            })}
                        />
                    )}
                />
            )}
        </>
    );
}
