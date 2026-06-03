import { useAppStore as useStore } from '~/store/base-store';
import { useDeferredValue } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
    Button,
    StickyHeader,
    StickyHeaderActions,
    Loading,
    FixedVirtualList,
    ItemSortPanelContent,
    SearchField
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

    const handleSearchChange = (value: string) => {
        const nextSearchParams = new URLSearchParams(searchParams);

        if (value.trim()) {
            nextSearchParams.set('q', value);
        } else {
            nextSearchParams.delete('q');
        }

        nextSearchParams.delete('py');
        setSearchParams(nextSearchParams, { replace: true });
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

    return (
        <>
            <StickyHeader>
                <SearchField
                    value={query}
                    placeholder="Search liked music"
                    ariaLabel="Search favorite music"
                    onChange={handleSearchChange}
                />
                <StickyHeaderActions>
                    <Button onClick={() => void resetQueue(filteredMusics.map(music => music.id))}>
                        <Icon.Play /> Play
                    </Button>
                    <Button
                        size="sm"
                        aria-label="Filter favorite music"
                        onClick={() => panel.open({
                            title: 'Favorite Filter',
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
                    rowHeight={FAVORITE_LIST_ROW_HEIGHT}
                    overscanPx={FAVORITE_LIST_ROW_HEIGHT * 6}
                    getKey={(music) => music.id}
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
