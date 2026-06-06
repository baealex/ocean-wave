import type { Playlist } from '~/models/type';

import { graphQuery } from './graphql';
import {
    type OriginClientVariables,
    withOriginClientId
} from './origin-client';

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
    return graphQuery<{ createPlaylist: Playlist }, { name: string; musicIds: string[] } & OriginClientVariables>(
        `mutation CreatePlaylist($name: String!, $musicIds: [ID!], $originClientId: String) {
            createPlaylist(name: $name, musicIds: $musicIds, originClientId: $originClientId) {
                ${PLAYLIST_FIELDS}
            }
        }`,
        withOriginClientId({ name, musicIds })
    );
}

export function renamePlaylist({ id, name }: { id: string; name: string }) {
    return graphQuery<{
        renamePlaylist: { id: string; name: string };
    }, { id: string; name: string } & OriginClientVariables>(
        `mutation RenamePlaylist($id: ID!, $name: String!, $originClientId: String) {
            renamePlaylist(id: $id, name: $name, originClientId: $originClientId) {
                id
                name
            }
        }`,
        withOriginClientId({ id, name })
    );
}

export function deletePlaylist(id: string) {
    return graphQuery<{
        deletePlaylist: { id: string };
    }, { id: string } & OriginClientVariables>(
        `mutation DeletePlaylist($id: ID!, $originClientId: String) {
            deletePlaylist(id: $id, originClientId: $originClientId) {
                id
            }
        }`,
        withOriginClientId({ id })
    );
}

export function reorderPlaylists(ids: string[]) {
    return graphQuery<{
        reorderPlaylists: { ids: string[] };
    }, { ids: string[] } & OriginClientVariables>(
        `mutation ReorderPlaylists($ids: [ID!]!, $originClientId: String) {
            reorderPlaylists(ids: $ids, originClientId: $originClientId) {
                ids
            }
        }`,
        withOriginClientId({ ids })
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
    }, { id: string; musicIds: string[] } & OriginClientVariables>(
        `mutation AddMusicToPlaylist($id: ID!, $musicIds: [ID!]!, $originClientId: String) {
            addMusicToPlaylist(id: $id, musicIds: $musicIds, originClientId: $originClientId) {
                ${PLAYLIST_MUSIC_CHANGE_FIELDS}
            }
        }`,
        withOriginClientId({ id, musicIds })
    );
}

export function moveMusicToPlaylist({ fromId, toId, musicIds }: { fromId: string; toId: string; musicIds: string[] }) {
    return graphQuery<{
        moveMusicToPlaylist: {
            fromId: string;
            formHeaderMusics: Array<{ id: string }>;
            fromMusicCount: number;
            toId: string;
            toMusicCount: number;
            toHeaderMusics: Array<{ id: string }>;
            musicIds: string[];
        };
    }, { fromId: string; toId: string; musicIds: string[] } & OriginClientVariables>(
        `mutation MoveMusicToPlaylist($fromId: ID!, $toId: ID!, $musicIds: [ID!]!, $originClientId: String) {
            moveMusicToPlaylist(
                fromId: $fromId,
                toId: $toId,
                musicIds: $musicIds,
                originClientId: $originClientId
            ) {
                fromId
                formHeaderMusics {
                    id
                }
                fromMusicCount
                toId
                toMusicCount
                toHeaderMusics {
                    id
                }
                musicIds
            }
        }`,
        withOriginClientId({ fromId, toId, musicIds })
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
    }, { id: string; musicIds: string[] } & OriginClientVariables>(
        `mutation RemoveMusicFromPlaylist($id: ID!, $musicIds: [ID!]!, $originClientId: String) {
            removeMusicFromPlaylist(id: $id, musicIds: $musicIds, originClientId: $originClientId) {
                ${PLAYLIST_MUSIC_CHANGE_FIELDS}
            }
        }`,
        withOriginClientId({ id, musicIds })
    );
}

export function reorderPlaylistMusics({ id, musicIds }: { id: string; musicIds: string[] }) {
    return graphQuery<{
        reorderPlaylistMusics: {
            id: string;
            musicIds: string[];
            headerMusics: Array<{ id: string }>;
        };
    }, { id: string; musicIds: string[] } & OriginClientVariables>(
        `mutation ReorderPlaylistMusics($id: ID!, $musicIds: [ID!]!, $originClientId: String) {
            reorderPlaylistMusics(id: $id, musicIds: $musicIds, originClientId: $originClientId) {
                id
                musicIds
                headerMusics {
                    id
                }
            }
        }`,
        withOriginClientId({ id, musicIds })
    );
}
