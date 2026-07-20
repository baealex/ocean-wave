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
        activeDeviceSequence: Int!
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

    type PlaybackEndpoint {
        id: ID!
        capabilities: [String!]!
        lastSeenAt: String!
        online: Boolean!
        active: Boolean!
        registrationGeneration: Int
    }

    type PlaybackDevice {
        id: ID!
        name: String!
        type: String!
        lastSeenAt: String!
        online: Boolean!
        active: Boolean!
        endpoints: [PlaybackEndpoint!]!
    }

    type PlaybackDeviceRegistry {
        commandEpoch: String!
        activeEndpointId: ID
        serverTime: String!
        devices: [PlaybackDevice!]!
    }

    type PlaybackDeviceRenameResult {
        deviceId: ID!
        name: String!
    }

    input ReportPlaybackStateInput {
        deviceId: String!
        registrationGeneration: Int!
        registrationProof: String!
        sequence: Int!
        expectedRevision: Int!
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

    input RenamePlaybackDeviceInput {
        deviceId: ID!
        name: String!
    }
`;

export const playbackQuery = gql`
    type Query {
        playbackSession: PlaybackSession
        playbackQueue: PlaybackQueue
        playbackDeviceRegistry: PlaybackDeviceRegistry!
    }
`;

export const playbackMutation = gql`
    type Mutation {
        reportPlaybackState(
            input: ReportPlaybackStateInput!
            originClientId: String
        ): PlaybackSessionReportResult!
        savePlaybackQueue(input: SavePlaybackQueueInput!): PlaybackQueueSaveResult!
        renamePlaybackDevice(
            input: RenamePlaybackDeviceInput!
            originClientId: String
        ): PlaybackDeviceRenameResult!
    }
`;

export const playbackTypeDefs = `
    ${playbackType}
    ${playbackQuery}
    ${playbackMutation}
`;
