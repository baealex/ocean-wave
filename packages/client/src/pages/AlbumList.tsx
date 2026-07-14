import { useAppStore as useStore } from '~/store/base-store';
import { useDeferredValue } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
    ItemSortPanelContent,
    Button,
    COLLECTION_CARD_HEIGHT_OFFSET,
    CollectionGridSkeleton,
    CollectionHeader,
    FixedVirtualGrid,
    StickyHeaderActions,
    SearchField,
    StateMessage
} from '~/components/shared';
import { AlbumCollectionCard } from '~/components/album';
import * as Icon from '~/icon';

import { panel } from '~/modules/panel';

import { albumStore } from '~/store/album';

export default function Album() {
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
    const albumCount = albums?.length ?? 0;
    const summary = !loaded
        ? 'Loading albums'
        : query.trim()
            ? `${filteredAlbums.length.toLocaleString()} of ${albumCount.toLocaleString()} albums`
            : `${albumCount.toLocaleString()} albums`;

    return (
        <>
            <CollectionHeader title="Albums" summary={summary}>
                <SearchField
                    value={query}
                    placeholder="Search albums or artists"
                    ariaLabel="Search albums"
                    onChange={handleSearchChange}
                />
                <StickyHeaderActions>
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
                </StickyHeaderActions>
            </CollectionHeader>
            {!loaded && (
                <CollectionGridSkeleton label="Loading albums" />
            )}
            {loaded && (
                <FixedVirtualGrid
                    items={filteredAlbums}
                    ariaLabel="Albums"
                    getKey={(album) => album.id}
                    itemHeightOffset={COLLECTION_CARD_HEIGHT_OFFSET}
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
                        <AlbumCollectionCard
                            albumId={album.id}
                            albumName={album.name}
                            albumCover={album.cover}
                            artistName={album.artist.name}
                            publishedYear={album.publishedYear}
                            musicCount={album.musics?.length}
                        />
                    )}
                />
            )}
        </>
    );
}
