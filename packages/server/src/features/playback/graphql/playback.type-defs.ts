import { gql } from '~/modules/graphql';

export const playbackType = gql`
    enum PlaybackState {
        playing
        paused
        stopped
    }

    enum PlaybackQueueRepeatMode {
        none
        one
        all
    }

    type PlaybackSession {
        id: ID!
        state: PlaybackState!
        activeDeviceId: String
        currentMusicId: ID
        positionMs: Float!
        positionUpdatedAt: String!
        startedAt: String
        revision: Int!
        serverTime: String!
    }

    type PlaybackSessionConflict {
        reason: String!
        session: PlaybackSession!
    }

    type PlaybackSessionReportResult {
        type: String!
        session: PlaybackSession!
        conflict: PlaybackSessionConflict
    }

    type PlaybackQueue {
        id: ID!
        musicIds: [ID!]!
        sourceMusicIds: [ID!]!
        currentIndex: Int
        shuffle: Boolean!
        repeatMode: PlaybackQueueRepeatMode!
        revision: Int!
        updatedAt: String!
    }

    type PlaybackQueueConflict {
        reason: String!
        queue: PlaybackQueue!
    }

    type PlaybackQueueSaveResult {
        type: String!
        queue: PlaybackQueue!
        conflict: PlaybackQueueConflict
    }

    input ReportPlaybackStateInput {
        deviceId: String!
        sequence: Int!
        claimActive: Boolean!
        state: PlaybackState!
        currentMusicId: ID
        positionMs: Float!
        observedAt: String
    }

    input SavePlaybackQueueInput {
        musicIds: [ID!]!
        sourceMusicIds: [ID!]!
        currentIndex: Int
        shuffle: Boolean!
        repeatMode: PlaybackQueueRepeatMode!
        expectedRevision: Int!
    }
`;

export const playbackQuery = gql`
    type Query {
        playbackSession: PlaybackSession
        playbackQueue: PlaybackQueue
    }
`;

export const playbackMutation = gql`
    type Mutation {
        reportPlaybackState(
            input: ReportPlaybackStateInput!
            originClientId: String
        ): PlaybackSessionReportResult!
        savePlaybackQueue(input: SavePlaybackQueueInput!): PlaybackQueueSaveResult!
    }
`;

export const playbackTypeDefs = `
    ${playbackType}
    ${playbackQuery}
    ${playbackMutation}
`;
