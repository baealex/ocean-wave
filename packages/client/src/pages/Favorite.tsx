import { useDeferredValue } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    MusicActionPanelContent,
    MusicListItem,
    RemotePlaybackOwnershipNotice,
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
import {
    usePlaybackSignal,
    useRemotePlaybackOwnership,
    useResetQueue
} from '~/hooks';
import * as Icon from '~/icon';

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

const FAVORITE_LIST_ROW_HEIGHT = 80;
const SMART_FILTER_PARAM = 'filter';

export default function Music() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();
    const remotePlaybackOwnership = useRemotePlaybackOwnership();
    const playbackSignal = usePlaybackSignal();
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
        music.recordingVersionTitle?.toLowerCase().includes(deferredQuery) ||
        music.releaseVersionTitle?.toLowerCase().includes(deferredQuery) ||
        music.artistDisplayName.toLowerCase().includes(deferredQuery) ||
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
                        aria-label={remotePlaybackOwnership
                            ? 'Play favorites unavailable while another device owns playback'
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
            {remotePlaybackOwnership && (
                <RemotePlaybackOwnershipNotice className="mx-[var(--b-spacing-lg)] mb-[var(--b-spacing-md)]" />
            )}
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
                            artistName={music.artistDisplayName}
                            musicName={music.name}
                            versionTitle={[music.recordingVersionTitle, music.releaseVersionTitle]
                                .filter(Boolean).join(' · ')}
                            musicCodec={music.codec}
                            isLiked={music.isLiked}
                            playbackSignal={playbackSignal?.musicId === music.id ? playbackSignal : undefined}
                            onClick={() => queueStore.add(music.id)}
                            onLongPress={() => panel.open({
                                title: 'Related to this music',
                                content: (
                                    <MusicActionPanelContent
                                        id={music.id}
                                        onAlbumClick={() => navigate(`/album/${music.album.id}`)}
                                        onArtistClick={(artistId) => navigate(`/artist/${artistId}`)}
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
