export const PLAYBACK_COMMAND_REQUEST = 'playback:command-request';
export const PLAYBACK_COMMAND_EXECUTE = 'playback:command-execute';
export const PLAYBACK_COMMAND_START = 'playback:command-start';
export const PLAYBACK_COMMAND_RESULT = 'playback:command-result';
export const PLAYBACK_COMMAND_STATUS = 'playback:command-status';

export const CONTROLLER_REQUEST_ACK_TIMEOUT_MS = 5_000;
export const TARGET_READY_TIMEOUT_MS = 2_000;
export const START_REQUEST_TIMEOUT_MS = 2_000;
export const EXECUTION_GRANT_TTL_MS = 2_000;
export const COMMAND_COMPLETION_TIMEOUT_MS = 10_000;
export const CONTROLLER_RECOVERY_WINDOW_MS = 60_000;
export const COMMAND_RESULT_RETENTION_MS = 120_000;

export const PLAYBACK_COMMAND_TYPES = [
    'play',
    'pause',
    'seek',
    'next',
    'previous'
] as const;

export type PlaybackCommandType = typeof PLAYBACK_COMMAND_TYPES[number];

export type PlaybackCommand =
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'seek'; positionMs: number }
    | { type: 'next' }
    | { type: 'previous' };

export interface PlaybackCommandRequest {
    protocolVersion: 1;
    commandId: string;
    targetEndpointId: string;
    expectedSessionRevision: number;
    expectedQueueRevision: number | null;
    command: PlaybackCommand;
}

export interface PlaybackCommandState {
    state: 'playing' | 'paused' | 'stopped';
    currentMusicId: string | null;
    currentIndex: number | null;
    positionMs: number;
}

export interface PlaybackCommandDispatch extends PlaybackCommandRequest {
    requesterEndpointId: string;
    targetRegistrationGeneration: number;
    commandSequence: number;
    issuedAt: string;
    readyBy: string;
    expectedSource: PlaybackCommandState & {
        sessionRevision: number;
        queueRevision: number | null;
    };
    desiredResult: Omit<PlaybackCommandState, 'positionMs'> & {
        position:
            | { mode: 'absolute'; positionMs: number }
            | { mode: 'capture-current' };
    };
}

export const PLAYBACK_COMMAND_ERROR_CODES = [
    'INVALID_COMMAND',
    'UNAUTHORIZED_COMMAND',
    'SESSION_NOT_FOUND',
    'TARGET_NOT_ACTIVE',
    'TARGET_OFFLINE',
    'UNSUPPORTED_COMMAND',
    'STALE_SESSION_REVISION',
    'STALE_QUEUE_REVISION',
    'COMMAND_IN_PROGRESS',
    'COMMAND_EXPIRED',
    'TARGET_READY_TIMEOUT',
    'START_REQUEST_TIMEOUT',
    'COMMAND_COMPLETION_TIMEOUT',
    'TARGET_STATE_MISMATCH',
    'AUTOPLAY_BLOCKED',
    'MEDIA_NOT_READY',
    'MEDIA_UNAVAILABLE',
    'QUEUE_EMPTY',
    'STATE_COMMIT_FAILED'
] as const;

export type PlaybackCommandErrorCode = typeof PLAYBACK_COMMAND_ERROR_CODES[number];

export interface PlaybackCommandError {
    code: PlaybackCommandErrorCode;
    retryable: boolean;
    message: string;
}

export type PlaybackCommandExecuteAck =
    | {
        protocolVersion: 1;
        commandId: string;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        commandSequence: number;
        status: 'ready';
        lastEndpointSequence: number;
      }
    | {
        protocolVersion: 1;
        commandId: string;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        commandSequence: number;
        status: 'rejected';
        lastEndpointSequence: number;
        error: PlaybackCommandError;
      };

export interface PlaybackCommandStartRequest {
    protocolVersion: 1;
    commandId: string;
    targetEndpointId: string;
    targetRegistrationGeneration: number;
    commandSequence: number;
    startRequestId: string;
}

export type PlaybackCommandStartAck =
    | {
        protocolVersion: 1;
        commandId: string;
        status: 'granted';
        executionToken: string;
        startWithinMs: number;
        completeWithinMs: number;
      }
    | {
        protocolVersion: 1;
        commandId: string;
        status: 'rejected';
        error: PlaybackCommandError;
      };

export type PlaybackCommandExecutionResult =
    | {
        protocolVersion: 1;
        commandId: string;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        commandSequence: number;
        executionToken: string;
        status: 'completed';
        endpointSequence: number;
        observedAt: string;
        resultingState: PlaybackCommandState;
      }
    | {
        protocolVersion: 1;
        commandId: string;
        targetEndpointId: string;
        targetRegistrationGeneration: number;
        commandSequence: number;
        executionToken: string;
        status: 'rejected';
        lastEndpointSequence: number;
        observedAt: string;
        error: PlaybackCommandError;
      };

export interface PlaybackCommandResultAck {
    protocolVersion: 1;
    commandId: string;
    targetEndpointId: string;
    targetRegistrationGeneration: number;
    commandSequence: number;
    disposition: 'committed' | 'duplicate' | 'rejected' | 'expired';
    commandStatus: 'completed' | 'rejected' | 'timed_out';
    sessionRevision: number | null;
    queueRevision: number | null;
    occurredAt: string;
    error: PlaybackCommandError | null;
}

export interface PlaybackCommandStatus {
    protocolVersion: 1;
    commandEpoch: string;
    commandId: string;
    status: 'accepted' | 'completed' | 'rejected' | 'timed_out';
    deduplicated: boolean;
    targetEndpointId: string;
    commandSequence: number | null;
    sessionRevision: number | null;
    queueRevision: number | null;
    occurredAt: string;
    error: PlaybackCommandError | null;
}

export interface PlaybackCommandParseFailure {
    protocolVersion: 1;
    commandEpoch: string;
    commandId: string | null;
    targetEndpointId: string | null;
    status: 'rejected';
    occurredAt: string;
    error: PlaybackCommandError & { code: 'INVALID_COMMAND' };
}

export type PlaybackCommandRequestAck = PlaybackCommandStatus | PlaybackCommandParseFailure;
