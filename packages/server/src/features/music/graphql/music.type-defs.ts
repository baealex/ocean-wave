import { gql } from '~/modules/graphql';
import { albumType } from '../../../schema/album';
import { artistType } from '../../../schema/artist';

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

    type PlaybackRecordPayload {
        id: ID!
        playCount: Int!
        lastPlayedAt: String
        totalPlayedMs: Float!
        countedAsPlay: Boolean!
        deduped: Boolean!
    }

    input RecordPlaybackInput {
        id: ID!
        playedMs: Float!
        completionRate: Float
        startedAt: String
        source: String
        clientSessionId: String
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
        setMusicLiked(id: ID!, isLiked: Boolean!, originClientId: String): MusicLikedPayload!
        setMusicHated(id: ID!, isHated: Boolean!, originClientId: String): MusicHatedPayload!
        recordPlayback(input: RecordPlaybackInput!, originClientId: String): PlaybackRecordPayload
    }
`;

export const musicTypeDefs = `
    ${musicType}
    ${musicQuery}
    ${musicMutation}
`;
