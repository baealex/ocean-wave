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
        skipCount: Int!
        lastSkippedAt: String
        completionCount: Int!
        lastCompletedAt: String
        trackNumber: Int!
        filePath: String!
        hasMetadataOverride: Boolean!
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
        skipCount: Int!
        lastSkippedAt: String
        completionCount: Int!
        lastCompletedAt: String
        countedAsPlay: Boolean!
        completionRate: Float!
        outcome: PlaybackOutcome!
        deduped: Boolean!
    }

    enum PlaybackOutcome {
        listen
        skip
        complete
        legacy
    }

    enum PlaybackEndReason {
        ended
        skipped
        stopped
        handoff
        unload
        recovery
        legacy
    }

    input RecordPlaybackInput {
        id: ID!
        playedMs: Float!
        completionRate: Float
        startedAt: String
        endedAt: String
        endReason: PlaybackEndReason
        hadSeek: Boolean
        source: String
        clientSessionId: String
        branchId: String
        parentBranchId: String
        branchBasePlayedMs: Float
    }

    enum TagFilterMode {
        ALL
        ANY
    }

    input MusicFilterInput {
        tagIds: [ID!]
        tagMode: TagFilterMode
    }

    input UpdateMusicMetadataInput {
        id: ID!
        title: String!
        artist: String!
        album: String!
        albumArtist: String
        publishedYear: String!
        trackNumber: Int!
        genres: [String!]!
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
        updateMusicMetadata(input: UpdateMusicMetadataInput!, originClientId: String): Music!
        recordPlayback(input: RecordPlaybackInput!, originClientId: String): PlaybackRecordPayload
    }
`;

export const musicTypeDefs = `
    ${musicType}
    ${musicQuery}
    ${musicMutation}
`;
