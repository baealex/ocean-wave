import { gql } from '~/modules/graphql';
import { albumType } from '../../../schema/album';
import { artistType } from '../../../schema/artist';
import { artistCreditType } from '../../../schema/artist-credit';

export const musicType: string = gql`
    type MusicFileVersion {
        id: ID!
        filePath: String!
        codec: String!
        container: String!
        bitrate: Float!
        sampleRate: Float!
        duration: Float!
        syncStatus: String!
        metadataSyncStatus: String!
        metadataSyncError: String
        isPreferred: Boolean!
        isSelected: Boolean!
        isPlayable: Boolean!
    }

    enum MusicGroupingCandidateKind {
        ALTERNATE_FILE
        SAME_RECORDING
    }

    type MusicGroupingCandidate {
        kind: MusicGroupingCandidateKind!
        music: Music!
        reasons: [String!]!
    }

    type Music {
        id: ID!
        name: String!
        recordingTitle: String!
        titleOverride: String
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
        discNumber: Int
        trackNumber: Int
        recordingVersionTitle: String
        releaseVersionTitle: String
        filePath: String!
        files: [MusicFileVersion!]!
        recordingAppearances: [Music!]!
        groupingCandidates: [MusicGroupingCandidate!]!
        hasMetadataOverride: Boolean!
        isLiked: Boolean!
        isHated: Boolean!
        createdAt: String!
        artist: Artist! @deprecated(reason: "Use artistCredits or artistDisplayName; removal is planned for the next breaking schema version.")
        artistDisplayName: String!
        artistCredits: [ArtistCredit!]!
        recordingArtistCredits: [ArtistCredit!]!
        hasReleaseTrackArtistCredits: Boolean!
        album: Album!
        genres: [Genre!]!
        tags: [Tag!]!
    }

    enum LibraryRediscoveryReasonCode {
        RECENTLY_ADDED
        LIKED_NOT_RECENTLY_PLAYED
        NEVER_PLAYED
        RARELY_PLAYED
        FORGOTTEN_ALBUM
        FREQUENTLY_COMPLETED
        TAG_AFFINITY
        GENRE_AFFINITY
        LIBRARY_FALLBACK
    }

    type LibraryRediscoveryTrackCandidate {
        musicId: ID!
        score: Int!
        reasonCodes: [LibraryRediscoveryReasonCode!]!
    }

    type LibraryRediscoveryAlbumCandidate {
        albumId: ID!
        representativeMusicId: ID!
        trackCount: Int!
        lastPlayedAt: String
        score: Int!
        reasonCodes: [LibraryRediscoveryReasonCode!]!
    }

    type LibraryRediscovery {
        generatedAt: String!
        eligibleMusicCount: Int!
        recentlyAdded: [LibraryRediscoveryTrackCandidate!]!
        dormantLiked: [LibraryRediscoveryTrackCandidate!]!
        underplayed: [LibraryRediscoveryTrackCandidate!]!
        forgottenAlbums: [LibraryRediscoveryAlbumCandidate!]!
        fallback: [LibraryRediscoveryTrackCandidate!]!
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
        titleOverride: String
        recordingVersionTitle: String
        artist: String @deprecated(reason: "Use artistCredits; removal is planned for the next breaking schema version.")
        artistCredits: [ArtistCreditInput!]
        recordingArtistCredits: [ArtistCreditInput!]
        releaseTrackArtistCredits: [ArtistCreditInput!]
        album: String!
        albumArtist: String @deprecated(reason: "Use albumArtistCredits; removal is planned for the next breaking schema version.")
        albumArtistCredits: [ArtistCreditInput!]
        publishedYear: String!
        releaseType: ReleaseType
        totalDiscs: Int
        releaseVersionTitle: String
        discNumber: Int
        trackNumber: Int
        genres: [String!]!
    }

    enum MusicMetadataStorage {
        FILE_AND_DATABASE
        DATABASE_ONLY
    }

    enum MusicMetadataOwner {
        RECORDING
        RELEASE
        RELEASE_TRACK
    }

    type MusicMetadataChange {
        field: String!
        label: String!
        before: String!
        after: String!
        owner: MusicMetadataOwner!
        storage: MusicMetadataStorage!
    }

    type MusicMetadataFilePreview {
        fileId: ID!
        stableId: ID!
        filePath: String!
        syncStatus: String!
        willWrite: Boolean!
        changes: [MusicMetadataChange!]!
    }

    type MusicMetadataPreviewIssue {
        code: String!
        message: String!
        blocking: Boolean!
        fileId: ID
    }

    type MusicMetadataPreview {
        token: String!
        hasChanges: Boolean!
        changes: [MusicMetadataChange!]!
        files: [MusicMetadataFilePreview!]!
        issues: [MusicMetadataPreviewIssue!]!
        preservedPolicies: [String!]!
    }

    type MusicMetadataOperationTarget {
        fileId: ID!
        filePath: String!
        status: String!
        errorCode: String
        errorMessage: String
    }

    type MusicMetadataOperation {
        operationId: ID!
        status: String!
        retryable: Boolean!
        errorCode: String
        errorMessage: String
        music: Music
        targets: [MusicMetadataOperationTarget!]!
        createdAt: String
        updatedAt: String
    }

    ${artistType}

    ${albumType}

    ${artistCreditType}
`;

export const musicQuery = gql`
    type Query {
        allMusics(filter: MusicFilterInput): [Music!]!
        allHatedMusics: [Music!]!
        libraryRediscovery(limit: Int): LibraryRediscovery!
        music(id: ID!): Music!
        previewMusicMetadataUpdate(input: UpdateMusicMetadataInput!): MusicMetadataPreview!
        musicMetadataOperations(musicId: ID!): [MusicMetadataOperation!]!
    }
`;

export const musicMutation = gql`
    type Mutation {
        setMusicLiked(id: ID!, isLiked: Boolean!, originClientId: String): MusicLikedPayload!
        setMusicHated(id: ID!, isHated: Boolean!, originClientId: String): MusicHatedPayload!
        updateMusicMetadata(input: UpdateMusicMetadataInput!, previewToken: String!, originClientId: String): MusicMetadataOperation!
        retryMusicMetadataOperation(operationId: ID!, originClientId: String): MusicMetadataOperation!
        recoverMusicMetadataOperation(operationId: ID!, originClientId: String): MusicMetadataOperation!
        setPreferredMusicFile(musicId: ID!, fileId: ID, originClientId: String): Music!
        groupMusicAsAlternateFile(musicId: ID!, targetMusicId: ID!, originClientId: String): Music!
        ungroupMusicFile(musicId: ID!, fileId: ID!, originClientId: String): Music!
        linkMusicRecordings(musicId: ID!, targetMusicId: ID!, originClientId: String): Music!
        unlinkMusicRecording(musicId: ID!, originClientId: String): Music!
        recordPlayback(input: RecordPlaybackInput!, originClientId: String): PlaybackRecordPayload
    }
`;

export const musicTypeDefs = `
    ${musicType}
    ${musicQuery}
    ${musicMutation}
`;
