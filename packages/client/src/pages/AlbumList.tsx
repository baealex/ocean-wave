import { useAppStore as useStore } from '~/store/base-store';
import { useDeferredValue } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
    ItemSortPanelContent,
    Loading,
    Button,
    StickyHeader,
    SearchField,
    FixedVirtualList,
    StateMessage
} from '~/components/shared';
import { AlbumListItem } from '~/components/album';
import * as Icon from '~/icon';

import { panel } from '~/modules/panel';

import { albumStore } from '~/store/album';

const ALBUM_LIST_ROW_HEIGHT = 88;

export default function Album() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [{ albums, loaded }] = useStore(albumStore);
    const query = searchParams.get('q') || '';
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    const handleSearchChange = (value: string) => {
        const nextSearchParams = new URLSearchParams(searchParams);

        if (value.trim()) {
            nextSearchParams.set('q', value);
        } else {
            nextSearchParams.delete('q');
        }

        setSearchParams(nextSearchParams, { replace: true });
    };

    const filteredAlbums = albums
        ?.filter(album =>
            album.name.toLowerCase().includes(deferredQuery) ||
            album.artist.name.toLowerCase().includes(deferredQuery)
        ) ?? [];

    return (
        <>
            <StickyHeader>
                <SearchField
                    value={query}
                    placeholder="Search albums or artists"
                    ariaLabel="Search albums"
                    onChange={handleSearchChange}
                />
                <Button
                    size="sm"
                    aria-label="Sort albums"
                    onClick={() => panel.open({
                        title: 'Album Sort',
                        content: (
                            <ItemSortPanelContent items={albumStore.sortItems} />
                        )
                    })}>
                    <Icon.Sort />
                </Button>
            </StickyHeader>
            {!loaded && (
                <Loading />
            )}
            {loaded && (
                <FixedVirtualList
                    items={filteredAlbums}
                    rowHeight={ALBUM_LIST_ROW_HEIGHT}
                    overscanPx={ALBUM_LIST_ROW_HEIGHT * 8}
                    getKey={(album) => album.id}
                    emptyState={(
                        <StateMessage
                            className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-2xl)]"
                            icon={<Icon.Disc />}
                            heading={query.trim() ? 'No albums found.' : 'No albums yet.'}
                            description={query.trim()
                                ? 'Try a different album or artist search.'
                                : 'Albums will appear after music is added to your library.'}
                        />
                    )}
                    renderItem={(album) => (
                        <AlbumListItem
                            albumName={album.name}
                            albumCover={album.cover}
                            artistName={album.artist.name}
                            publishedYear={album.publishedYear}
                            musicCount={album.musics?.length}
                            onClick={() => navigate(`/album/${album.id}`)}
                        />
                    )}
                />
            )}
        </>
    );
}
