import type { PlaybackEndpointRegistrationState } from '~/socket/playback-endpoint';

export const PLAYBACK_CONTROLLER_REFRESH_TIMEOUT_MS = 5_000;

export const playbackControllerRegistrationKey = (
    registration: PlaybackEndpointRegistrationState
) => [
    registration.endpointId,
    registration.registrationGeneration,
    registration.commandEpoch,
    registration.registrationProof
].join('\u0000');
