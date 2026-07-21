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

    enum PlaybackQueueContextType {
        album
        playlist
        queue
    }

    enum PersonalListeningSessionLength {
        short
        standard
        long
    }

    enum PersonalListeningSessionScope {
        focused
        explore
    }

    enum PersonalListeningSessionReasonCode {
        START_TRACK
        SAME_ALBUM
        SAME_ARTIST
        SHARED_SMART_VIEW
        SHARED_TAG
        SHARED_GENRE
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
        contextType: PlaybackQueueContextType!
        contextId: ID
        contextTitle: String
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

    type PersonalListeningSessionItem {
        musicId: ID!
        reasonCodes: [PersonalListeningSessionReasonCode!]!
    }

    type PersonalListeningSessionResult {
        type: String!
        queue: PlaybackQueue!
        conflict: PlaybackQueueConflict
        items: [PersonalListeningSessionItem!]!
        generatedAt: String!
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

    input PlaybackHistoryLineageInput {
        clientSessionId: String!
        branchId: String
        parentBranchId: String
        branchBasePlayedMs: Float
        startedAt: String!
        accumulatedPlayedMs: Float!
        hadSeek: Boolean!
        updatedAt: String!
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
        playbackHistory: PlaybackHistoryLineageInput
    }

    input SavePlaybackQueueInput {
        musicIds: [ID!]!
        sourceMusicIds: [ID!]!
        currentIndex: Int
        contextType: PlaybackQueueContextType
        contextId: ID
        contextTitle: String
        shuffle: Boolean!
        repeatMode: PlaybackQueueRepeatMode!
        expectedRevision: Int!
    }

    input CreatePersonalListeningSessionInput {
        startMusicId: ID!
        length: PersonalListeningSessionLength!
        scope: PersonalListeningSessionScope!
        expectedRevision: Int!
        expectedPlaybackSessionRevision: Int!
        requestingEndpointId: ID!
        registrationGeneration: Int!
        registrationProof: String!
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
        savePlaybackQueue(
            input: SavePlaybackQueueInput!
            originClientId: String
        ): PlaybackQueueSaveResult!
        createPersonalListeningSession(
            input: CreatePersonalListeningSessionInput!
            originClientId: String
        ): PersonalListeningSessionResult!
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
