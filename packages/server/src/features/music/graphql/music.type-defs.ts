import { gql } from '~/modules/graphql';
import { artistType } from '../../../schema/artist';
import { albumType } from '../../../schema/album';

export const musicType: string = gql`
    type Music {
        id: ID!
        name: String!
        duration: Float!
        codec: String!
        bitrate: Float!
        sampleRate: Float!
        playCount: Int!
        lastPlayedAt: String
        totalPlayedMs: Float!
        trackNumber: Int!
        filePath: String!
        isLiked: Boolean!
        isHated: Boolean!
        createdAt: String!
        artist: Artist!
        album: Album!
        genres: [Genre!]!
        tags: [Tag!]!
    }

    type Genre {
        id: ID!
        name: String!
    }

    type MusicLikedPayload {
        id: ID!
        isLiked: Boolean!
    }

    type MusicHatedPayload {
        id: ID!
        isHated: Boolean!
    }

    enum TagFilterMode {
        ALL
        ANY
    }

    input MusicFilterInput {
        tagIds: [ID!]
        tagMode: TagFilterMode
    }

    ${artistType}

    ${albumType}
`;

export const musicQuery = gql`
    type Query {
        allMusics(filter: MusicFilterInput): [Music!]!
        allHatedMusics: [Music!]!
        music(id: ID!): Music!
    }
`;

export const musicMutation = gql`
    type Mutation {
        setMusicLiked(id: ID!, isLiked: Boolean!): MusicLikedPayload!
        setMusicHated(id: ID!, isHated: Boolean!): MusicHatedPayload!
    }
`;

export const musicTypeDefs = `
    ${musicType}
    ${musicQuery}
    ${musicMutation}
`;
