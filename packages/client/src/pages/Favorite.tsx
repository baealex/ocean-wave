import { useAppStore as useStore } from '~/store/base-store';
import { useDeferredValue } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
    Button,
    CollectionHeader,
    StickyHeaderActions,
    Loading,
    FixedVirtualList,
    ItemSortPanelContent,
    PanelContent,
    SearchField,
    StateMessage
} from '~/components/shared';
import { MusicListItem, MusicActionPanelContent, SmartMusicFilterPanelContent } from '~/components/music';
import * as Icon from '~/icon';

import { panel } from '~/modules/panel';
import { useResetQueue } from '~/hooks';
import {
    DEFAULT_SMART_MUSIC_FILTER_ID,
    filterMusicsBySmartFilter,
    getSmartMusicFilterOption,
    resolveSmartMusicFilterId,
    type SmartMusicFilterId
} from '~/modules/smart-music-filters';

import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';

const FAVORITE_LIST_ROW_HEIGHT = 80;
const SMART_FILTER_PARAM = 'filter';

export default function Music() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();
    const [searchParams, setSearchParams] = useSearchParams();

    const [{ musics, loaded }] = useStore(musicStore);
    const query = searchParams.get('q') || '';
    const smartFilterId = resolveSmartMusicFilterId(searchParams.get(SMART_FILTER_PARAM));
    const activeSmartFilter = getSmartMusicFilterOption(smartFilterId);
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());
    const isSmartFilterActive = smartFilterId !== DEFAULT_SMART_MUSIC_FILTER_ID;

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

    const favoriteMusics = (musics?.filter(music => !music.isHated && music.isLiked)) ?? [];
    const smartFilteredMusics = filterMusicsBySmartFilter(favoriteMusics, smartFilterId);
    const filteredMusics = smartFilteredMusics.filter(music =>
        music.name.toLowerCase().includes(deferredQuery) ||
        music.artist.name.toLowerCase().includes(deferredQuery) ||
        music.album.name.toLowerCase().includes(deferredQuery)
    );
    const hasActiveFilters = Boolean(query.trim()) || isSmartFilterActive;
    const summary = !loaded
        ? 'Loading favorites'
        : hasActiveFilters
            ? `${filteredMusics.length.toLocaleString()} of ${favoriteMusics.length.toLocaleString()} liked songs`
            : `${favoriteMusics.length.toLocaleString()} liked songs`;

    const openSmartFilter = () => panel.open({
        title: 'Favorite Filter',
        content: (
            <SmartMusicFilterPanelContent
                activeFilterId={smartFilterId}
                onSelect={handleSmartFilterChange}
            />
        )
    });

    const openSort = () => panel.open({
        title: 'Music Sort',
        content: <ItemSortPanelContent items={musicStore.sortItems} />
    });

    const openMobileOptions = () => panel.open({
        title: 'Favorite options',
        content: (
            <PanelContent
                items={[
                    {
                        id: 'smart-filter',
                        icon: <Icon.Filter />,
                        text: 'Favorite filter',
                        description: activeSmartFilter.label,
                        active: isSmartFilterActive,
                        onClick: openSmartFilter
                    },
                    {
                        id: 'sort',
                        icon: <Icon.Sort />,
                        text: 'Sort favorites',
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
                title="Favorites"
                summary={summary}
                actions={(
                    <Button
                        variant="primary"
                        disabled={filteredMusics.length === 0}
                        onClick={() => void resetQueue(filteredMusics.map(music => music.id))}>
                        <Icon.Play /> Play
                    </Button>
                )}>
                <SearchField
                    value={query}
                    placeholder="Search liked music"
                    ariaLabel="Search favorite music"
                    onChange={handleSearchChange}
                />
                <StickyHeaderActions>
                    <Button
                        className="max-sm:hidden"
                        size="sm"
                        active={isSmartFilterActive}
                        aria-pressed={isSmartFilterActive}
                        aria-label="Filter favorite music"
                        onClick={openSmartFilter}>
                        <Icon.Filter /> {activeSmartFilter.shortLabel}
                    </Button>
                    <Button
                        className="max-sm:hidden"
                        size="sm"
                        aria-label="Sort favorite music"
                        onClick={openSort}>
                        <Icon.Sort />
                    </Button>
                    <Button
                        className="sm:hidden"
                        size="sm"
                        active={isSmartFilterActive}
                        aria-label="Open favorite filters and sorting"
                        onClick={openMobileOptions}>
                        <Icon.Filter /> Options
                    </Button>
                </StickyHeaderActions>
            </CollectionHeader>
            {!loaded && (
                <Loading />
            )}
            {loaded && (
                <FixedVirtualList
                    items={filteredMusics}
                    rowHeight={FAVORITE_LIST_ROW_HEIGHT}
                    overscanPx={FAVORITE_LIST_ROW_HEIGHT * 6}
                    getKey={(music) => music.id}
                    emptyState={(
                        <StateMessage
                            className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-2xl)]"
                            icon={<Icon.Heart />}
                            heading={query.trim() || isSmartFilterActive ? 'No favorites found.' : 'No favorites yet.'}
                            description={query.trim() || isSmartFilterActive
                                ? 'Try a different search or favorite filter.'
                                : 'Liked songs will appear here.'}
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
