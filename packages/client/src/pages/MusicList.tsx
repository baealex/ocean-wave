import { useAppStore as useStore } from '~/store/base-store';
import { useDeferredValue } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
    Button,
    FixedVirtualList,
    StickyHeader,
    StickyHeaderActions,
    ItemSortPanelContent,
    Loading,
    SearchField,
    StateMessage
} from '~/components/shared';
import {
    MusicListItem,
    MusicActionPanelContent,
    MusicTagFilterPanelContent,
    SmartMusicFilterPanelContent
} from '~/components/music';
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
import {
    DEFAULT_MUSIC_TAG_FILTER_MODE,
    MUSIC_TAG_FILTER_MODE_PARAM,
    MUSIC_TAG_FILTER_PARAM,
    filterMusicsByTagIds,
    getMusicTagFilterLabel,
    parseMusicTagIdsParam,
    resolveMusicTagFilterMode,
    type MusicTagFilterMode
} from '~/modules/music-tags';

import { musicStore } from '~/store/music';
import { queueStore } from '~/store/queue';

const MUSIC_LIST_ROW_HEIGHT = 80;
const SMART_FILTER_PARAM = 'filter';

export default function Music() {
    const navigate = useNavigate();
    const resetQueue = useResetQueue();
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

        window.addEventListener('popstate', () => {
            setSearchParams(nextSearchParams, { replace: true });
        }, { once: true });
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

        window.addEventListener('popstate', () => {
            setSearchParams(nextSearchParams, { replace: true });
        }, { once: true });
        panel.close();
    };

    const availableMusics = (musics?.filter(music => !music.isHated)) ?? [];
    const smartFilteredMusics = filterMusicsBySmartFilter(availableMusics, smartFilterId);
    const tagFilteredMusics = filterMusicsByTagIds(smartFilteredMusics, tagFilterIds, tagFilterMode);
    const filteredMusics = tagFilteredMusics.filter(music =>
        music.name.toLowerCase().includes(deferredQuery) ||
        music.artist.name.toLowerCase().includes(deferredQuery) ||
        music.album.name.toLowerCase().includes(deferredQuery)
    );

    return (
        <>
            <StickyHeader>
                <SearchField
                    value={query}
                    placeholder="Search music, artist, album"
                    ariaLabel="Search music"
                    onChange={handleSearchChange}
                />
                <StickyHeaderActions>
                    <Button
                        disabled={filteredMusics.length === 0}
                        onClick={() => void resetQueue(filteredMusics.map(music => music.id))}>
                        <Icon.Play /> Play
                    </Button>
                    <Button
                        size="sm"
                        active={isSmartFilterActive}
                        aria-pressed={isSmartFilterActive}
                        aria-label="Filter music"
                        onClick={() => panel.open({
                            title: 'Music Filter',
                            content: (
                                <SmartMusicFilterPanelContent
                                    activeFilterId={smartFilterId}
                                    onSelect={handleSmartFilterChange}
                                />
                            )
                        })}>
                        <Icon.Filter /> {activeSmartFilter.shortLabel}
                    </Button>
                    <Button
                        size="sm"
                        active={isTagFilterActive}
                        aria-pressed={isTagFilterActive}
                        aria-label="Filter music by tags"
                        onClick={() => panel.open({
                            title: 'Tag Filter',
                            content: (
                                <MusicTagFilterPanelContent
                                    selectedTagIds={tagFilterIds}
                                    mode={tagFilterMode}
                                    onApply={handleTagFilterChange}
                                />
                            )
                        })}>
                        <Icon.Tags /> {getMusicTagFilterLabel(tagFilterIds.length)}
                    </Button>
                    <Button
                        size="sm"
                        aria-label="Sort music"
                        onClick={() => panel.open({
                            title: 'Music Sort',
                            content: (
                                <ItemSortPanelContent items={musicStore.sortItems} />
                            )
                        })}>
                        <Icon.Sort />
                    </Button>
                </StickyHeaderActions>
            </StickyHeader>
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
