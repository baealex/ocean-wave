import type { PlaybackSessionSnapshot } from '~/api/playback-session';

export type PlaybackSignalLocation = 'local' | 'remote';
export type PlaybackSignalState = 'paused' | 'playing';

export interface PlaybackSignal {
    location: PlaybackSignalLocation;
    musicId: string;
    state: PlaybackSignalState;
}

interface ResolvePlaybackSignalOptions {
    currentTrackId: string | null;
    isPlaying: boolean;
    localDeviceId: string | null;
    snapshot: PlaybackSessionSnapshot | null;
}

export const resolvePlaybackSignal = ({
    currentTrackId,
    isPlaying,
    localDeviceId,
    snapshot
}: ResolvePlaybackSignalOptions): PlaybackSignal | null => {
    const isRemotePlayback = Boolean(
        snapshot
        && snapshot.state !== 'stopped'
        && snapshot.activeDeviceId
        && localDeviceId
        && snapshot.activeDeviceId !== localDeviceId
        && snapshot.currentMusicId
    );

    if (
        isRemotePlayback
        && snapshot
        && snapshot.state !== 'stopped'
        && snapshot.currentMusicId
    ) {
        return {
            location: 'remote',
            musicId: snapshot.currentMusicId,
            state: snapshot.state
        };
    }

    if (!currentTrackId) {
        return null;
    }

    return {
        location: 'local',
        musicId: currentTrackId,
        state: isPlaying ? 'playing' : 'paused'
    };
};

export const getPlaybackSignalLabel = ({ location, state }: PlaybackSignal) => {
    const stateLabel = state === 'playing' ? 'Playing' : 'Paused';

    return location === 'remote' ? `${stateLabel} elsewhere` : stateLabel;
};
