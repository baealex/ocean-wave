import type { Playlist } from '~/models/type';

import { graphQuery } from './graphql';

const PLAYLIST_FIELDS = `
    id
    name
    musicCount
    createdAt
    updatedAt
    headerMusics {
        id
    }
`;

const PLAYLIST_MUSIC_CHANGE_FIELDS = `
    id
    musicIds
    musicCount
    headerMusics {
        id
    }
`;

export function createPlaylist({ name, musicIds = [] }: { name: string; musicIds?: string[] }) {
    return graphQuery<{ createPlaylist: Playlist }, { name: string; musicIds: string[] }>(
        `mutation CreatePlaylist($name: String!, $musicIds: [ID!]) {
            createPlaylist(name: $name, musicIds: $musicIds) {
                ${PLAYLIST_FIELDS}
            }
        }`,
        { name, musicIds }
    );
}

export function renamePlaylist({ id, name }: { id: string; name: string }) {
    return graphQuery<{ renamePlaylist: { id: string; name: string } }, { id: string; name: string }>(
        `mutation RenamePlaylist($id: ID!, $name: String!) {
            renamePlaylist(id: $id, name: $name) {
                id
                name
            }
        }`,
        { id, name }
    );
}

export function deletePlaylist(id: string) {
    return graphQuery<{ deletePlaylist: { id: string } }, { id: string }>(
        `mutation DeletePlaylist($id: ID!) {
            deletePlaylist(id: $id) {
                id
            }
        }`,
        { id }
    );
}

export function reorderPlaylists(ids: string[]) {
    return graphQuery<{ reorderPlaylists: { ids: string[] } }, { ids: string[] }>(
        `mutation ReorderPlaylists($ids: [ID!]!) {
            reorderPlaylists(ids: $ids) {
                ids
            }
        }`,
        { ids }
    );
}

export function addMusicToPlaylist({ id, musicIds }: { id: string; musicIds: string[] }) {
    return graphQuery<{
        addMusicToPlaylist: {
            id: string;
            musicIds: string[];
            musicCount: number;
            headerMusics: Array<{ id: string }>;
        };
    }, { id: string; musicIds: string[] }>(
        `mutation AddMusicToPlaylist($id: ID!, $musicIds: [ID!]!) {
            addMusicToPlaylist(id: $id, musicIds: $musicIds) {
                ${PLAYLIST_MUSIC_CHANGE_FIELDS}
            }
        }`,
        { id, musicIds }
    );
}

export function moveMusicToPlaylist({ fromId, toId, musicIds }: { fromId: string; toId: string; musicIds: string[] }) {
    return graphQuery<{
        moveMusicToPlaylist: {
            fromId: string;
            formHeaderMusics: Array<{ id: string }>;
            toId: string;
            toMusicCount: number;
            toHeaderMusics: Array<{ id: string }>;
            musicIds: string[];
        };
    }, { fromId: string; toId: string; musicIds: string[] }>(
        `mutation MoveMusicToPlaylist($fromId: ID!, $toId: ID!, $musicIds: [ID!]!) {
            moveMusicToPlaylist(fromId: $fromId, toId: $toId, musicIds: $musicIds) {
                fromId
                formHeaderMusics {
                    id
                }
                toId
                toMusicCount
                toHeaderMusics {
                    id
                }
                musicIds
            }
        }`,
        { fromId, toId, musicIds }
    );
}

export function removeMusicFromPlaylist({ id, musicIds }: { id: string; musicIds: string[] }) {
    return graphQuery<{
        removeMusicFromPlaylist: {
            id: string;
            musicIds: string[];
            musicCount: number;
            headerMusics: Array<{ id: string }>;
        };
    }, { id: string; musicIds: string[] }>(
        `mutation RemoveMusicFromPlaylist($id: ID!, $musicIds: [ID!]!) {
            removeMusicFromPlaylist(id: $id, musicIds: $musicIds) {
                ${PLAYLIST_MUSIC_CHANGE_FIELDS}
            }
        }`,
        { id, musicIds }
    );
}

export function reorderPlaylistMusics({ id, musicIds }: { id: string; musicIds: string[] }) {
    return graphQuery<{
        reorderPlaylistMusics: {
            id: string;
            musicIds: string[];
            headerMusics: Array<{ id: string }>;
        };
    }, { id: string; musicIds: string[] }>(
        `mutation ReorderPlaylistMusics($id: ID!, $musicIds: [ID!]!) {
            reorderPlaylistMusics(id: $id, musicIds: $musicIds) {
                id
                musicIds
                headerMusics {
                    id
                }
            }
        }`,
        { id, musicIds }
    );
}
