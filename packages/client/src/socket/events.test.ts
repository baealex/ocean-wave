import {
    describe,
    expect,
    it
} from 'vitest';

import {
    MUSIC_COUNT,
    MUSIC_HATE,
    MUSIC_LIKE,
    MUSIC_TAGS_UPDATED
} from './music-listener';
import {
    PLAYLIST_ADD_MUSIC,
    PLAYLIST_CHANGE_MUSIC_ORDER,
    PLAYLIST_CHANGE_ORDER,
    PLAYLIST_CREATE,
    PLAYLIST_DELETE,
    PLAYLIST_MOVE_MUSIC,
    PLAYLIST_REMOVE_MUSIC,
    PLAYLIST_UPDATE
} from './playlist-listener';
import {
    TAG_CREATED,
    TAG_LIST_INVALIDATED,
    TAG_RENAMED
} from './tag-listener';

describe('socket event names', () => {
    it('uses namespaced notification event names', () => {
        expect({
            MUSIC_LIKE,
            MUSIC_HATE,
            MUSIC_COUNT,
            MUSIC_TAGS_UPDATED,
            PLAYLIST_CREATE,
            PLAYLIST_DELETE,
            PLAYLIST_UPDATE,
            PLAYLIST_CHANGE_ORDER,
            PLAYLIST_ADD_MUSIC,
            PLAYLIST_MOVE_MUSIC,
            PLAYLIST_REMOVE_MUSIC,
            PLAYLIST_CHANGE_MUSIC_ORDER,
            TAG_CREATED,
            TAG_RENAMED,
            TAG_LIST_INVALIDATED
        }).toEqual({
            MUSIC_LIKE: 'music:like-updated',
            MUSIC_HATE: 'music:hate-updated',
            MUSIC_COUNT: 'music:play-count-updated',
            MUSIC_TAGS_UPDATED: 'music:tags-updated',
            PLAYLIST_CREATE: 'playlist:created',
            PLAYLIST_DELETE: 'playlist:deleted',
            PLAYLIST_UPDATE: 'playlist:renamed',
            PLAYLIST_CHANGE_ORDER: 'playlist:order-updated',
            PLAYLIST_ADD_MUSIC: 'playlist:music-added',
            PLAYLIST_MOVE_MUSIC: 'playlist:music-moved',
            PLAYLIST_REMOVE_MUSIC: 'playlist:music-removed',
            PLAYLIST_CHANGE_MUSIC_ORDER: 'playlist:music-order-updated',
            TAG_CREATED: 'tag:created',
            TAG_RENAMED: 'tag:renamed',
            TAG_LIST_INVALIDATED: 'tag:list-invalidated'
        });
    });
});

