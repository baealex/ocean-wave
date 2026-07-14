import { gql } from '~/modules/graphql';

export const playbackType = gql`
    enum PlaybackState {
        playing
        paused
        stopped
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

    input ReportPlaybackStateInput {
        deviceId: String!
        sequence: Int!
        claimActive: Boolean!
        state: PlaybackState!
        currentMusicId: ID
        positionMs: Float!
        observedAt: String
    }
`;

export const playbackQuery = gql`
    type Query {
        playbackSession: PlaybackSession
    }
`;

export const playbackMutation = gql`
    type Mutation {
        reportPlaybackState(
            input: ReportPlaybackStateInput!
            originClientId: String
        ): PlaybackSessionReportResult!
    }
`;

export const playbackTypeDefs = `
    ${playbackType}
    ${playbackQuery}
    ${playbackMutation}
`;
