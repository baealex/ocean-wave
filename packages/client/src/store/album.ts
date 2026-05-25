import { BaseStore } from './base-store';

import type { Album } from '~/models/type';

import * as sort from '~/modules/sort';

import { getAlbums } from '~/api/library';

const SORT_STATE = {
    NAME: 'name',
    NAME_DESC: 'nameDesc',
    ARTIST_NAME: 'artist',
    ARTIST_NAME_DESC: 'artistDesc',
    PUBLISHED_YEAR: 'publishedYear',
    PUBLISHED_YEAR_DESC: 'publishedYearDesc',
    CREATED_AT: 'createdAt',
    CREATED_AT_DESC: 'createdAtDesc'
} as const;

interface AlbumStoreState {
    loaded: boolean;
    albums: Album[];
    sortedFrom: typeof SORT_STATE[keyof typeof SORT_STATE];
}

class AlbumStore extends BaseStore<AlbumStoreState> {
    init = false;

    constructor() {
        super();
        this.state = {
            loaded: false,
            albums: [],
            sortedFrom: SORT_STATE.NAME
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
        getAlbums().then(({ data }) => {
            this.set({
                loaded: true,
                albums: data.allAlbums,
                sortedFrom: SORT_STATE.NAME
            });
        });
    }

    get sortItems() {
        return [{
            text: 'Name (A-Z)',
            isActive: this.state.sortedFrom === SORT_STATE.NAME,
            onClick: () => {
                this.set((prevState) => ({
                    albums: sort.sortByName(prevState.albums),
                    sortedFrom: SORT_STATE.NAME
                }));
            }
        },
        {
            text: 'Name (Z-A)',
            isActive: this.state.sortedFrom === SORT_STATE.NAME_DESC,
            onClick: () => {
                this.set((prevState) => ({
                    albums: sort.sortByName(prevState.albums).reverse(),
                    sortedFrom: SORT_STATE.NAME_DESC
                }));
            }
        },
        {
            text: 'Artist Name (A to Z)',
            isActive: this.state.sortedFrom === SORT_STATE.ARTIST_NAME,
            onClick: () => {
                this.set((prevState) => ({
                    albums: sort.sortByArtistName(prevState.albums),
                    sortedFrom: SORT_STATE.ARTIST_NAME
                }));
            }
        },
        {
            text: 'Artist Name (Z to A)',
            isActive: this.state.sortedFrom === SORT_STATE.ARTIST_NAME_DESC,
            onClick: () => {
                this.set((prevState) => ({
                    albums: sort.sortByArtistName(prevState.albums).reverse(),
                    sortedFrom: SORT_STATE.ARTIST_NAME_DESC
                }));
            }
        },
        {
            text: 'Published Year (New to Old)',
            isActive: this.state.sortedFrom === SORT_STATE.PUBLISHED_YEAR,
            onClick: () => {
                this.set((prevState) => ({
                    albums: sort.sortByPublishedYear(prevState.albums),
                    sortedFrom: SORT_STATE.PUBLISHED_YEAR
                }));
            }
        },
        {
            text: 'Published Year (Old to New)',
            isActive: this.state.sortedFrom === SORT_STATE.PUBLISHED_YEAR_DESC,
            onClick: () => {
                this.set((prevState) => ({
                    albums: sort.sortByPublishedYear(prevState.albums).reverse(),
                    sortedFrom: SORT_STATE.PUBLISHED_YEAR_DESC
                }));
            }
        },
        {
            text: 'Created At (New to Old)',
            isActive: this.state.sortedFrom === SORT_STATE.CREATED_AT_DESC,
            onClick: () => {
                this.set((prevState) => ({
                    albums: sort.sortByCreatedAt(prevState.albums),
                    sortedFrom: SORT_STATE.CREATED_AT_DESC
                }));
            }
        },
        {
            text: 'Created At (Old to New)',
            isActive: this.state.sortedFrom === SORT_STATE.CREATED_AT,
            onClick: () => {
                this.set((prevState) => ({
                    albums: sort.sortByCreatedAt(prevState.albums).reverse(),
                    sortedFrom: SORT_STATE.CREATED_AT
                }));
            }
        }];
    }
}

export const albumStore = new AlbumStore();
