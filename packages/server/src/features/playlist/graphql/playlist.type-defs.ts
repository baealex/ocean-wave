import { gql } from '~/modules/graphql';
import { musicType } from '../../music/graphql';

export const playlistType = gql`
    type Playlist {
        id: ID!
        name: String!
        musics: [Music!]!
        musicCount: Int!
        headerMusics: [Music!]!
        createdAt: String!
        updatedAt: String!
    }

    type PlaylistDeletePayload {
        id: ID!
    }

    type PlaylistUpdatePayload {
        id: ID!
        name: String!
    }

    type PlaylistOrderPayload {
        ids: [ID!]!
    }

    type PlaylistMusicChangePayload {
        id: ID!
        musicIds: [ID!]!
        musicCount: Int!
        headerMusics: [Music!]!
    }

    type PlaylistMoveMusicPayload {
        fromId: ID!
        formHeaderMusics: [Music!]!
        fromMusicCount: Int!
        toId: ID!
        toMusicCount: Int!
        toHeaderMusics: [Music!]!
        musicIds: [ID!]!
    }

    type PlaylistMusicOrderPayload {
        id: ID!
        musicIds: [ID!]!
        headerMusics: [Music!]!
    }

    ${musicType}
`;

export const playlistQuery = gql`
    type Query {
        allPlaylist: [Playlist!]!
        playlist(id: ID!): Playlist!
    }
`;

export const playlistMutation = gql`
    type Mutation {
        createPlaylist(name: String!, musicIds: [ID!], originClientId: String): Playlist!
        deletePlaylist(id: ID!, originClientId: String): PlaylistDeletePayload!
        renamePlaylist(id: ID!, name: String!, originClientId: String): PlaylistUpdatePayload!
        reorderPlaylists(ids: [ID!]!, originClientId: String): PlaylistOrderPayload!
        addMusicToPlaylist(id: ID!, musicIds: [ID!]!, originClientId: String): PlaylistMusicChangePayload!
        moveMusicToPlaylist(fromId: ID!, toId: ID!, musicIds: [ID!]!, originClientId: String): PlaylistMoveMusicPayload!
        removeMusicFromPlaylist(id: ID!, musicIds: [ID!]!, originClientId: String): PlaylistMusicChangePayload!
        reorderPlaylistMusics(id: ID!, musicIds: [ID!]!, originClientId: String): PlaylistMusicOrderPayload!
    }
`;

export const playlistTypeDefs = `
    ${playlistType}
    ${playlistQuery}
    ${playlistMutation}
`;
