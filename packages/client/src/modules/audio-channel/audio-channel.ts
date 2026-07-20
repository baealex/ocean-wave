import type { Music } from '~/models/type';

export interface AudioChannelEventHandler {
    onPlay?: () => void;
    onPause?: () => void;
    onStop?: () => void;
    onEnded: () => void;
    onTimeUpdate: (time: number, mix: (fadeTime: number, onMix: () => void) => void) => void;
    onSkipToNext?: () => void;
    onSkipToPrevious?: () => void;
}

export interface AudioChannel {
    load: (music: Music) => void;
    play: () => void;
    playWithResult: () => Promise<void>;
    beginMutedPlayback: () => Promise<void>;
    commitMutedPlayback: () => Promise<void>;
    cancelMutedPlayback: () => void;
    getCurrentTime: () => number;
    pause: () => void;
    stop: () => void;
    seek: (time: number) => void;
    seekWithResult: (time: number) => boolean;
    download: (music: Music) => void;
    dispose: () => void;
}
