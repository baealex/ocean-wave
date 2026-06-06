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
        createPlaylist(name: String!, musicIds: [ID!]): Playlist!
        deletePlaylist(id: ID!): PlaylistDeletePayload!
        renamePlaylist(id: ID!, name: String!): PlaylistUpdatePayload!
        reorderPlaylists(ids: [ID!]!): PlaylistOrderPayload!
        addMusicToPlaylist(id: ID!, musicIds: [ID!]!): PlaylistMusicChangePayload!
        moveMusicToPlaylist(fromId: ID!, toId: ID!, musicIds: [ID!]!): PlaylistMoveMusicPayload!
        removeMusicFromPlaylist(id: ID!, musicIds: [ID!]!): PlaylistMusicChangePayload!
        reorderPlaylistMusics(id: ID!, musicIds: [ID!]!): PlaylistMusicOrderPayload!
    }
`;

export const playlistTypeDefs = `
    ${playlistType}
    ${playlistQuery}
    ${playlistMutation}
`;
