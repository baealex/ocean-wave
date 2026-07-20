export const PLAYBACK_HANDOFF_REQUEST = 'playback:handoff-request';
export const PLAYBACK_HANDOFF_RELEASE = 'playback:handoff-release';
export const PLAYBACK_HANDOFF_ACTIVATE = 'playback:handoff-activate';
export const PLAYBACK_HANDOFF_ABORT_TARGET = 'playback:handoff-abort-target';
export const PLAYBACK_HANDOFF_SETTLE_SOURCE = 'playback:handoff-settle-source';
export const PLAYBACK_HANDOFF_STATUS = 'playback:handoff-status';

export const HANDOFF_REQUEST_ACK_TIMEOUT_MS = 5_000;
export const HANDOFF_RELEASE_TIMEOUT_MS = 5_000;
export const HANDOFF_ACTIVATION_TIMEOUT_MS = 10_000;
export const HANDOFF_TARGET_ABORT_TIMEOUT_MS = 2_000;
export const HANDOFF_SOURCE_SETTLE_TIMEOUT_MS = 5_000;
export const HANDOFF_RESULT_RETENTION_MS = 120_000;

export type PlaybackHandoffState = 'playing' | 'paused';
export type PlaybackHandoffSourceState = PlaybackHandoffState | 'stopped';

export const normalizePlaybackHandoffState = (
    state: string
): PlaybackHandoffState | null => {
    if (state === 'playing') {
        return 'playing';
    }
    if (state === 'paused' || state === 'stopped') {
        return 'paused';
    }
    return null;
};

export const playbackHandoffStateMatchesSource = (
    sourceState: string,
    handoffState: PlaybackHandoffState
) => normalizePlaybackHandoffState(sourceState) === handoffState;

export interface PlaybackHandoffQueueSnapshot {
    id: string;
    musicIds: string[];
    sourceMusicIds: string[];
    currentIndex: number;
    shuffle: boolean;
    repeatMode: 'none' | 'one' | 'all';
    revision: number;
    updatedAt: string;
}

export interface PlaybackHandoffSnapshot {
    sessionRevision: number;
    queueRevision: number;
    state: PlaybackHandoffState;
    currentMusicId: string;
    currentIndex: number;
    positionMs: number;
    queue: PlaybackHandoffQueueSnapshot;
}

export interface PlaybackHandoffHistoryTransfer {
    clientSessionId: string;
    branchId: string;
    parentBranchId: string | null;
    branchBasePlayedMs: number;
    trackId: string;
    startedAt: string;
    accumulatedPlayedMs: number;
    hadSeek: boolean;
    updatedAt: string;
}

export interface PlaybackHandoffRequest {
    protocolVersion: 1;
    commandEpoch: string;
    handoffId: string;
    sourceEndpointId: string;
    targetEndpointId: string;
    expectedSessionRevision: number;
    expectedQueueRevision: number;
    targetClaimSequence: number;
    force: boolean;
}

export const PLAYBACK_HANDOFF_ERROR_CODES = [
    'INVALID_HANDOFF',
    'UNAUTHORIZED_HANDOFF',
    'SESSION_NOT_FOUND',
    'SOURCE_NOT_ACTIVE',
    'TARGET_ALREADY_ACTIVE',
    'SOURCE_OFFLINE',
    'SOURCE_STILL_ONLINE',
    'UNSUPPORTED_HANDOFF',
    'STALE_SESSION_REVISION',
    'STALE_QUEUE_REVISION',
    'HANDOFF_IN_PROGRESS',
    'RELEASE_TIMEOUT',
    'SOURCE_STATE_MISMATCH',
    'TARGET_STATE_MISMATCH',
    'AUTOPLAY_BLOCKED',
    'MEDIA_NOT_READY',
    'MEDIA_UNAVAILABLE',
    'QUEUE_UNAVAILABLE',
    'CLAIM_FAILED',
    'ACTIVATION_TIMEOUT',
    'ROLLBACK_FAILED',
    'RECOVERY_REQUIRED'
] as const;

export type PlaybackHandoffErrorCode = typeof PLAYBACK_HANDOFF_ERROR_CODES[number];

export interface PlaybackHandoffError {
    code: PlaybackHandoffErrorCode;
    message: string;
    retryable: boolean;
    forceAllowed: boolean;
}

export interface PlaybackHandoffReleaseDispatch {
    protocolVersion: 1;
    commandEpoch: string;
    handoffId: string;
    handoffSequence: number;
    sourceEndpointId: string;
    sourceRegistrationGeneration: number;
    targetEndpointId: string;
    targetRegistrationGeneration: number;
    issuedAt: string;
    releaseBy: string;
    snapshot: PlaybackHandoffSnapshot;
}

export type PlaybackHandoffReleaseAck =
    | {
        protocolVersion: 1;
        handoffId: string;
        handoffSequence: number;
        sourceEndpointId: string;
        sourceRegistrationGeneration: number;
        status: 'released';
        endpointSequence: number;
        positionMs: number;
        playbackHistory: PlaybackHandoffHistoryTransfer | null;
      }
    | {
        protocolVersion: 1;
        handoffId: string;
        handoffSequence: number;
        sourceEndpointId: string;
        sourceRegistrationGeneration: number;
        status: 'rejected';
        lastEndpointSequence: number;
        error: PlaybackHandoffError;
      };

export interface PlaybackHandoffActivationDispatch {
    protocolVersion: 1;
    commandEpoch: string;
    handoffId: string;
    handoffSequence: number;
    sourceEndpointId: string;
    targetEndpointId: string;
    targetRegistrationGeneration: number;
    claimSessionRevision: number;
    activateBy: string;
    snapshot: PlaybackHandoffSnapshot;
    playbackHistory: PlaybackHandoffHistoryTransfer | null;
}

export type PlaybackHandoffActivationAck =
    | {
        protocolVersion: 1;
        handoffId: string;
        handoffSequence: number;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        status: 'completed';
        endpointSequence: number;
        positionMs: number;
      }
    | {
        protocolVersion: 1;
        handoffId: string;
        handoffSequence: number;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        status: 'rejected';
        lastEndpointSequence: number;
        error: PlaybackHandoffError;
      };

export interface PlaybackHandoffTargetAbortDispatch {
    protocolVersion: 1;
    commandEpoch: string;
    handoffId: string;
    handoffSequence: number;
    targetEndpointId: string;
    targetRegistrationGeneration: number;
    reason: PlaybackHandoffError;
}

export interface PlaybackHandoffTargetAbortAck {
    protocolVersion: 1;
    handoffId: string;
    handoffSequence: number;
    targetEndpointId: string;
    targetRegistrationGeneration: number;
    status: 'paused';
}

export interface PlaybackHandoffSourceSettleDispatch {
    protocolVersion: 1;
    commandEpoch: string;
    handoffId: string;
    handoffSequence: number;
    sourceEndpointId: string;
    sourceRegistrationGeneration: number;
    action: 'complete' | 'cancel' | 'restore';
    sessionRevision: number | null;
    queueRevision: number;
    snapshot: PlaybackHandoffSnapshot;
    reason: PlaybackHandoffError | null;
}

export type PlaybackHandoffSourceSettleAck =
    | {
        protocolVersion: 1;
        handoffId: string;
        handoffSequence: number;
        sourceEndpointId: string;
        sourceRegistrationGeneration: number;
        status: 'settled';
        endpointSequence: number;
        positionMs: number;
      }
    | {
        protocolVersion: 1;
        handoffId: string;
        handoffSequence: number;
        sourceEndpointId: string;
        sourceRegistrationGeneration: number;
        status: 'rejected';
        lastEndpointSequence: number;
        error: PlaybackHandoffError;
      };

export type PlaybackHandoffPhase =
    | 'accepted'
    | 'releasing'
    | 'claiming'
    | 'activating'
    | 'completed'
    | 'rolled_back'
    | 'rejected'
    | 'timed_out'
    | 'recovery_required';

export interface PlaybackHandoffStatus {
    protocolVersion: 1;
    commandEpoch: string;
    handoffId: string;
    sourceEndpointId: string;
    targetEndpointId: string;
    handoffSequence: number | null;
    phase: PlaybackHandoffPhase;
    deduplicated: boolean;
    sessionRevision: number | null;
    queueRevision: number | null;
    occurredAt: string;
    error: PlaybackHandoffError | null;
}

export type PlaybackHandoffRequestAck = PlaybackHandoffStatus;
