import { BaseStore } from './base-store';

import type { Music } from '~/models/type';

import * as sort from '~/modules/sort';

import { getMusics } from '~/api/library';
import { MusicListener } from '~/socket';

const SORT_STATE = {
    NAME: 'name',
    NAME_DESC: 'nameDesc',
    ARTIST_NAME: 'artist',
    ARTIST_NAME_DESC: 'artistDesc',
    ALBUM_NAME: 'album',
    ALBUM_NAME_DESC: 'albumDesc',
    PLAY_COUNT: 'playCount',
    PLAY_COUNT_DESC: 'playCountDesc',
    CREATED_AT: 'createdAt',
    CREATED_AT_DESC: 'createdAtDesc'
} as const;

interface MusicStoreState {
    loaded: boolean;
    musics: Music[];
    musicMap: Map<string, Music>;
    sortedFrom: typeof SORT_STATE[keyof typeof SORT_STATE];
}

class MusicStore extends BaseStore<MusicStoreState> {
    init = false;
    listener: MusicListener;

    constructor() {
        super();
        this.state = {
            loaded: false,
            sortedFrom: SORT_STATE.PLAY_COUNT_DESC,
            musics: [],
            musicMap: new Map()
        };
        this.listener = new MusicListener();
        this.listener.connect({
            onLike: ({ id, isLiked }) => {
                this.set({
                    musics: this.state.musics.map((music) => {
                        if (music.id === id) {
                            music.isLiked = isLiked;
                        }
                        return music;
                    })
                });
            },
            onHate: ({ id, isHated }) => {
                this.set({
                    musics: this.state.musics.map((music) => {
                        if (music.id === id) {
                            music.isHated = isHated;
                        }
                        return music;
                    })
                });
            },
            onCount: ({ id, playCount, lastPlayedAt, totalPlayedMs }) => {
                this.set((prevState) => {
                    let nextMusics = prevState.musics.map((music) => {
                        if (music.id === id) {
                            music.playCount = playCount;
                            music.lastPlayedAt = lastPlayedAt;
                            music.totalPlayedMs = totalPlayedMs;
                        }
                        return music;
                    });

                    if (prevState.sortedFrom === SORT_STATE.PLAY_COUNT_DESC) {
                        nextMusics = sort.sortByPlayCount(nextMusics);
                    } else if (prevState.sortedFrom === SORT_STATE.PLAY_COUNT) {
                        nextMusics = sort.sortByPlayCount(nextMusics).reverse();
                    }

                    return { musics: nextMusics };
                });
            }
        });
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
        getMusics().then(({ data }) => {
            this.set({
                loaded: true,
                musics: data.allMusics,
                musicMap: new Map(data.allMusics.map(music => [music.id, music])),
                sortedFrom: SORT_STATE.PLAY_COUNT_DESC
            });
        });
    }

    get sortItems() {
        return [{
            text: 'Name (A-Z)',
            isActive: this.state.sortedFrom === SORT_STATE.NAME,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByName(prevState.musics),
                    sortedFrom: SORT_STATE.NAME
                }));
            }
        }, {
            text: 'Name (Z-A)',
            isActive: this.state.sortedFrom === SORT_STATE.NAME_DESC,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByName(prevState.musics).reverse(),
                    sortedFrom: SORT_STATE.NAME_DESC
                }));
            }
        }, {
            text: 'Artist Name (A to Z)',
            isActive: this.state.sortedFrom === SORT_STATE.ARTIST_NAME,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByArtistName(prevState.musics),
                    sortedFrom: SORT_STATE.ARTIST_NAME
                }));
            }
        }, {
            text: 'Artist Name (Z to A)',
            isActive: this.state.sortedFrom === SORT_STATE.ARTIST_NAME_DESC,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByArtistName(prevState.musics).reverse(),
                    sortedFrom: SORT_STATE.ARTIST_NAME_DESC
                }));
            }
        }, {
            text: 'Album Name (A to Z)',
            isActive: this.state.sortedFrom === SORT_STATE.ALBUM_NAME,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByAlbumName(prevState.musics),
                    sortedFrom: SORT_STATE.ALBUM_NAME
                }));
            }
        }, {
            text: 'Album Name (Z to A)',
            isActive: this.state.sortedFrom === SORT_STATE.ALBUM_NAME_DESC,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByAlbumName(prevState.musics).reverse(),
                    sortedFrom: SORT_STATE.ALBUM_NAME_DESC
                }));
            }
        }, {
            text: 'Play Count (High to Low)',
            isActive: this.state.sortedFrom === SORT_STATE.PLAY_COUNT_DESC,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByPlayCount(prevState.musics),
                    sortedFrom: SORT_STATE.PLAY_COUNT_DESC
                }));
            }
        }, {
            text: 'Play Count (Low to High)',
            isActive: this.state.sortedFrom === SORT_STATE.PLAY_COUNT,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByPlayCount(prevState.musics).reverse(),
                    sortedFrom: SORT_STATE.PLAY_COUNT
                }));
            }
        }, {
            text: 'Date Added (New to Old)',
            isActive: this.state.sortedFrom === SORT_STATE.CREATED_AT_DESC,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByCreatedAt(prevState.musics),
                    sortedFrom: SORT_STATE.CREATED_AT_DESC
                }));
            }
        }, {
            text: 'Date Added (Old to New)',
            isActive: this.state.sortedFrom === SORT_STATE.CREATED_AT,
            onClick: () => {
                this.set((prevState) => ({
                    musics: sort.sortByCreatedAt(prevState.musics).reverse(),
                    sortedFrom: SORT_STATE.CREATED_AT
                }));
            }
        }];
    }
}

export const musicStore = new MusicStore();
