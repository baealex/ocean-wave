import { useAppStore as useStore } from '~/store/base-store';
import { useDeferredValue } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
    FixedVirtualList,
    ItemSortPanelContent,
    Loading,
    Button,
    CollectionHeader,
    StickyHeaderActions,
    SearchField,
    StateMessage
} from '~/components/shared';
import { ArtistListItem } from '~/components/artist';

import * as Icon from '~/icon';

import { panel } from '~/modules/panel';

import { artistStore } from '~/store/artist';

const ARTIST_LIST_ROW_HEIGHT = 96;

export default function ArtistList() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [{ artists, loaded }] = useStore(artistStore);
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

    const filteredArtists = (artists
        ?.filter(artist =>
            artist.name.toLowerCase().includes(deferredQuery)
        )) ?? [];
    const artistCount = artists?.length ?? 0;
    const summary = !loaded
        ? 'Loading artists'
        : query.trim()
            ? `${filteredArtists.length.toLocaleString()} of ${artistCount.toLocaleString()} artists`
            : `${artistCount.toLocaleString()} artists`;

    return (
        <>
            <CollectionHeader title="Artists" summary={summary}>
                <SearchField
                    value={query}
                    placeholder="Search artists"
                    ariaLabel="Search artists"
                    onChange={handleSearchChange}
                />
                <StickyHeaderActions>
                    <Button
                        size="sm"
                        aria-label="Sort artists"
                        onClick={() => panel.open({
                            title: 'Artist Sort',
                            content: (
                                <ItemSortPanelContent items={artistStore.sortItems} />
                            )
                        })}>
                        <Icon.Sort />
                    </Button>
                </StickyHeaderActions>
            </CollectionHeader>
            {!loaded && (
                <Loading />
            )}
            {loaded && (
                <FixedVirtualList
                    items={filteredArtists}
                    rowHeight={ARTIST_LIST_ROW_HEIGHT}
                    overscanPx={ARTIST_LIST_ROW_HEIGHT * 5}
                    getKey={(artist) => artist.id}
                    emptyState={(
                        <StateMessage
                            className="px-[var(--b-spacing-lg)] py-[var(--b-spacing-2xl)]"
                            icon={<Icon.User />}
                            heading={query.trim() ? 'No artists found.' : 'No artists yet.'}
                            description={query.trim()
                                ? 'Try a different artist search.'
                                : 'Artists will appear after music is added to your library.'}
                        />
                    )}
                    renderItem={(artist) => (
                        <ArtistListItem
                            key={artist.id}
                            artistName={artist.name}
                            artistCover={artist.latestAlbum?.cover || ''}
                            musicCount={artist.musicCount}
                            albumCount={artist.albumCount}
                            onClick={() => navigate(`/artist/${artist.id}`)}
                        />
                    )}
                />
            )}
        </>
    );
}
