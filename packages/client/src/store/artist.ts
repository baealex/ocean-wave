import { BaseStore } from './base-store';

import type { Artist } from '~/models/type';

import * as sort from '~/modules/sort';

import { getArtists } from '~/api/library';

const SORT_STATE = {
    NAME: 'name',
    NAME_DESC: 'nameDesc',
    ALBUM_COUNT: 'albumCount',
    ALBUM_COUNT_DESC: 'albumCountDesc',
    MUSIC_COUNT: 'musicCount',
    MUSIC_COUNT_DESC: 'musicCountDesc',
    CREATED_AT: 'createdAt',
    CREATED_AT_DESC: 'createdAtDesc'
} as const;

interface ArtistStoreState {
    loaded: boolean;
    artists: Artist[];
    sortedFrom: typeof SORT_STATE[keyof typeof SORT_STATE];
}

class ArtistStore extends BaseStore<ArtistStoreState> {
    init = false;

    constructor() {
        super();
        this.state = {
            loaded: false,
            artists: [],
            sortedFrom: SORT_STATE.MUSIC_COUNT_DESC
        };
    }

    get state() {
        if (!this.init) {
            this.init = true;
            this.sync();
        }
        return super.state;
    }

    set state(state) {
        super.state = state;
    }

    async sync() {
        getArtists().then(({ data }) => {
            this.set({
                loaded: true,
                artists: data.allArtists,
                sortedFrom: SORT_STATE.MUSIC_COUNT_DESC
            });
        });
    }

    get sortItems() {
        return [{
            text: 'Name (A-Z)',
            isActive: this.state.sortedFrom === SORT_STATE.NAME,
            onClick: () => {
                this.set({
                    artists: sort.sortByName(this.state.artists),
                    sortedFrom: SORT_STATE.NAME
                });
            }
        }, {
            text: 'Name (Z-A)',
            isActive: this.state.sortedFrom === SORT_STATE.NAME_DESC,
            onClick: () => {
                this.set({
                    artists: sort.sortByName(this.state.artists).reverse(),
                    sortedFrom: SORT_STATE.NAME_DESC
                });
            }
        }, {
            text: 'Album Count (High to Low)',
            isActive: this.state.sortedFrom === SORT_STATE.ALBUM_COUNT_DESC,
            onClick: () => {
                this.set({
                    artists: sort.sortByAlbumCount(this.state.artists),
                    sortedFrom: SORT_STATE.ALBUM_COUNT_DESC
                });
            }
        }, {
            text: 'Album Count (Low to High)',
            isActive: this.state.sortedFrom === SORT_STATE.ALBUM_COUNT,
            onClick: () => {
                this.set({
                    artists: sort.sortByAlbumCount(this.state.artists).reverse(),
                    sortedFrom: SORT_STATE.ALBUM_COUNT
                });
            }
        }, {
            text: 'Music Count (High to Low)',
            isActive: this.state.sortedFrom === SORT_STATE.MUSIC_COUNT_DESC,
            onClick: () => {
                this.set({
                    artists: sort.sortByMusicCount(this.state.artists),
                    sortedFrom: SORT_STATE.MUSIC_COUNT_DESC
                });
            }
        }, {
            text: 'Music Count (Low to High)',
            isActive: this.state.sortedFrom === SORT_STATE.MUSIC_COUNT,
            onClick: () => {
                this.set({
                    artists: sort.sortByMusicCount(this.state.artists).reverse(),
                    sortedFrom: SORT_STATE.MUSIC_COUNT
                });
            }
        }, {
            text: 'Created At (New to Old)',
            isActive: this.state.sortedFrom === SORT_STATE.CREATED_AT_DESC,
            onClick: () => {
                this.set({
                    artists: sort.sortByCreatedAt(this.state.artists),
                    sortedFrom: SORT_STATE.CREATED_AT_DESC
                });
            }
        }, {
            text: 'Created At (Old to New)',
            isActive: this.state.sortedFrom === SORT_STATE.CREATED_AT,
            onClick: () => {
                this.set({
                    artists: sort.sortByCreatedAt(this.state.artists).reverse(),
                    sortedFrom: SORT_STATE.CREATED_AT
                });
            }
        }];
    }
}

export const artistStore = new ArtistStore();
