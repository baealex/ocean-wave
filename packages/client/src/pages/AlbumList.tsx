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
    Select,
    StickyHeaderActions,
    SearchField,
    StateMessage
} from '~/components/shared';
import { AlbumCollectionCard } from '~/components/album';
import * as Icon from '~/icon';

import { panel } from '~/modules/panel';
import {
    filterAlbumsByRelease,
    getReleaseTypeLabel,
    RELEASE_TYPE_OPTIONS,
    resolveReleaseTypeFilter
} from '~/modules/releases';

import { albumStore } from '~/store/album';

export default function Album() {
    const [searchParams, setSearchParams] = useSearchParams();

    const [{ albums, loaded }] = useStore(albumStore);
    const query = searchParams.get('q') || '';
    const releaseType = resolveReleaseTypeFilter(searchParams.get('type'));
    const deferredQuery = useDeferredValue(query);

    const handleSearchChange = (value: string) => {
        const nextSearchParams = new URLSearchParams(searchParams);

        if (value.trim()) {
            nextSearchParams.set('q', value);
        } else {
            nextSearchParams.delete('q');
        }

        setSearchParams(nextSearchParams, { replace: true });
    };

    const handleReleaseTypeChange = (value: string) => {
        const nextSearchParams = new URLSearchParams(searchParams);
        const nextReleaseType = resolveReleaseTypeFilter(value);

        if (nextReleaseType) {
            nextSearchParams.set('type', nextReleaseType);
        } else {
            nextSearchParams.delete('type');
        }

        setSearchParams(nextSearchParams, { replace: true });
    };

    const filteredAlbums = filterAlbumsByRelease({
        albums: albums ?? [],
        query: deferredQuery,
        releaseType
    });
    const albumCount = albums?.length ?? 0;
    const hasActiveFilters = Boolean(query.trim() || releaseType);
    const summary = !loaded
        ? 'Loading albums'
        : hasActiveFilters
            ? `${filteredAlbums.length.toLocaleString()} of ${albumCount.toLocaleString()} albums`
            : `${albumCount.toLocaleString()} albums`;

    return (
        <>
            <CollectionHeader title="Albums" summary={summary}>
                <SearchField
                    value={query}
                    placeholder="Search albums, artists, or types"
                    ariaLabel="Search albums"
                    onChange={handleSearchChange}
                />
                <StickyHeaderActions>
                    <Select
                        ariaLabel="Filter albums by release type"
                        selected={[
                            { value: '', label: 'All release types' },
                            ...RELEASE_TYPE_OPTIONS
                        ].find(option => option.value === releaseType)}
                        options={[
                            { value: '', label: 'All release types' },
                            ...RELEASE_TYPE_OPTIONS
                        ]}
                        onChange={handleReleaseTypeChange}
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
                            heading={hasActiveFilters ? 'No releases found.' : 'No albums yet.'}
                            description={hasActiveFilters
                                ? 'Try a different search or release type.'
                                : 'Albums will appear after music is added to your library.'}
                        />
                    )}
                    renderItem={(album) => (
                        <AlbumCollectionCard
                            albumId={album.id}
                            albumName={album.name}
                            albumCover={album.cover}
                            artistName={album.artistDisplayName}
                            publishedYear={album.publishedYear}
                            releaseType={getReleaseTypeLabel(album.releaseType)}
                            musicCount={album.musics?.length}
                        />
                    )}
                />
            )}
        </>
    );
}
