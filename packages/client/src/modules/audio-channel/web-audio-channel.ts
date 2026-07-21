import { webAudioContext } from '../web-audio-context';
import type { AudioChannel, AudioChannelEventHandler } from './audio-channel';
import type { Music } from '~/models/type';

import { audioSettingsStore } from '~/store/audio-settings';
import { resolveMixDuration, shouldStartMix } from './mix-timing';
import { audioRetryDelay, MAX_AUDIO_RETRIES, withRetryToken } from '../network-retry';
import { toast } from '../toast';

export class WebAudioChannel implements AudioChannel {
    private audio: HTMLAudioElement;
    private backgroundAudio: HTMLAudioElement;
    private handler: AudioChannelEventHandler;
    private mixInterval: ReturnType<typeof setInterval> | null;
    private loadedDuration: number | null;
    private pendingSeekTime: number | null;
    private ignoreNextPause: boolean;
    private mixStartedAtMs: number | null;
    private mixOutgoingStartedAtSeconds: number | null;
    private mixDurationMs: number;
    private loadingMixTarget: boolean;
    private currentResource: string | null;
    private retryAttempt: number;
    private retryTimer: ReturnType<typeof setTimeout> | null;

    constructor(_handler: AudioChannelEventHandler) {
        this.audio = new Audio();
        this.backgroundAudio = new Audio();
        this.mixInterval = null;
        this.loadedDuration = null;
        this.pendingSeekTime = null;
        this.ignoreNextPause = false;
        this.mixStartedAtMs = null;
        this.mixOutgoingStartedAtSeconds = null;
        this.mixDurationMs = 0;
        this.loadingMixTarget = false;
        this.currentResource = null;
        this.retryAttempt = 0;
        this.retryTimer = null;
        this.handler = {
            onPlay: () => _handler.onPlay?.(),
            onPlaying: () => {
                this.retryAttempt = 0;
                _handler.onPlaying?.();
            },
            onWaiting: () => _handler.onWaiting?.(),
            onPause: () => {
                if (this.ignoreNextPause) {
                    this.ignoreNextPause = false;
                    return;
                }

                _handler.onPause?.();
            },
            onStop: () => _handler.onStop?.(),
            onEnded: () => _handler.onEnded(),
            onCrossfadeStart: () => _handler.onCrossfadeStart?.(),
            onCrossfadeEnd: listenedMs => _handler.onCrossfadeEnd?.(listenedMs),
            onTimeUpdate: () => {
                _handler.onTimeUpdate(this.audio.currentTime, (fadeTime: number, onMix: () => void) => {
                    const shouldMix = shouldStartMix({
                        currentTime: this.audio.currentTime,
                        fadeTime,
                        metadataDuration: this.loadedDuration,
                        mediaDuration: this.audio.duration
                    });

                    if (!this.mixInterval && shouldMix) {
                        onMix();
                        this.mixStartedAtMs = Date.now();
                        const mixDuration = resolveMixDuration({
                            metadataDuration: this.loadedDuration,
                            mediaDuration: this.audio.duration
                        });
                        const remainingSeconds = mixDuration === null
                            ? fadeTime
                            : Math.max(mixDuration - this.audio.currentTime, 0);
                        this.mixDurationMs = Math.min(
                            fadeTime,
                            remainingSeconds
                        ) * 1_000;
                        this.mixOutgoingStartedAtSeconds = Number.isFinite(
                            this.audio.currentTime
                        )
                            ? this.audio.currentTime
                            : null;
                        this.handler.onCrossfadeStart?.();

                        this.swapAudio();
                        this.setNewAudio();

                        this.audio.volume = 0;
                        this.backgroundAudio.volume = 1;
                        webAudioContext.setGain(this.backgroundAudio, 1);

                        this.mixInterval = setInterval(() => {
                            const nextAudioVolume = Math.round((this.audio.volume + 0.1) * 10) / 10;
                            const nextBackgroundAudioVolume = Math.round((this.backgroundAudio.volume - 0.1) * 10) / 10;

                            this.audio.volume = nextAudioVolume;
                            this.backgroundAudio.volume = nextBackgroundAudioVolume;
                            webAudioContext.setGain(this.audio, nextAudioVolume);
                            webAudioContext.setGain(this.backgroundAudio, nextBackgroundAudioVolume);

                            if (this.audio.volume >= 1) {
                                this.finishMix(true);
                            }
                        }, fadeTime * 1000 / 10);
                        this.loadingMixTarget = true;
                        try {
                            _handler.onEnded();
                        } finally {
                            this.loadingMixTarget = false;
                        }
                        return true;
                    }

                    return false;
                });
            }
        };

        this.setNewAudio();
    }

    setNewAudio() {
        this.audio = new Audio();
        this.audio.addEventListener('play', this.handler.onPlay!);
        this.audio.addEventListener('playing', this.handler.onPlaying!);
        this.audio.addEventListener('waiting', this.handler.onWaiting!);
        this.audio.addEventListener('pause', this.handler.onPause!);
        this.audio.addEventListener('abort', this.handler.onStop!);
        this.audio.addEventListener('ended', this.handler.onEnded!);
        this.audio.addEventListener('timeupdate', this.handler.onTimeUpdate as () => void);
        this.audio.addEventListener('loadedmetadata', this.applyPendingSeek);
        this.audio.addEventListener('error', this.handleNetworkError);
    }

    swapAudio() {
        const tempAudio = this.audio;
        tempAudio.removeEventListener('play', this.handler.onPlay!);
        tempAudio.removeEventListener('playing', this.handler.onPlaying!);
        tempAudio.removeEventListener('waiting', this.handler.onWaiting!);
        tempAudio.removeEventListener('pause', this.handler.onPause!);
        tempAudio.removeEventListener('abort', this.handler.onStop!);
        tempAudio.removeEventListener('ended', this.handler.onEnded!);
        tempAudio.removeEventListener('timeupdate', this.handler.onTimeUpdate as () => void);
        tempAudio.removeEventListener('loadedmetadata', this.applyPendingSeek);
        tempAudio.removeEventListener('error', this.handleNetworkError);
        this.backgroundAudio = tempAudio;
    }

    load(music: Music) {
        if (this.mixInterval && !this.loadingMixTarget) {
            this.finishMix(false);
        }

        let audioResource: string;

        const { format, bitrate, useOriginal, profile } = audioSettingsStore.state;
        this.loadedDuration = music.duration;
        this.pendingSeekTime = null;

        if (useOriginal) {
            audioResource = `/api/audio/${music.id}?notranscode=true&profile=original`;
        } else {
            const canPlay = typeof this.audio.canPlayType === 'function'
                ? this.audio.canPlayType.bind(this.audio)
                : () => '';
            const codecs = [
                canPlay('audio/mpeg') ? 'mp3' : '',
                canPlay('audio/aac') ? 'aac' : '',
                canPlay('audio/ogg') ? 'ogg' : ''
            ].filter(Boolean).join(',');
            audioResource = `/api/audio/${music.id}?profile=${profile}&format=${format}&bitrate=${bitrate}&codecs=${codecs}`;
        }
        this.currentResource = audioResource;
        this.retryAttempt = 0;

        this.audio.pause();
        this.audio.src = audioResource;
        this.audio.currentTime = 0;
        this.audio.load();
    }

    play() {
        void this.playWithResult().catch(() => undefined);
    }

    playWithResult() {
        if (!webAudioContext.initialized()) {
            webAudioContext.init();
        }
        webAudioContext.connect(this.audio);
        webAudioContext.setGain(this.audio, this.audio.volume);
        return this.audio.play();
    }

    beginMutedPlayback() {
        if (!webAudioContext.initialized()) {
            webAudioContext.init();
        }
        webAudioContext.connect(this.audio);
        webAudioContext.setGain(this.audio, 0, 0);
        return this.audio.play();
    }

    async commitMutedPlayback() {
        if (this.audio.error) {
            throw new DOMException(
                'The muted playback warm-up failed before activation.',
                'NotSupportedError'
            );
        }
        if (this.audio.paused || this.audio.ended) {
            await this.audio.play();
        }
        if (this.audio.error || this.audio.paused || this.audio.ended) {
            throw new DOMException(
                'The muted playback warm-up is no longer active.',
                'AbortError'
            );
        }
        webAudioContext.setGain(this.audio, 1, 0);
    }

    cancelMutedPlayback() {
        this.pause();
        webAudioContext.setGain(this.audio, 1, 0);
    }

    getCurrentTime() {
        return this.audio.currentTime;
    }

    pause() {
        const mixing = this.mixInterval !== null;
        if (mixing) {
            this.finishMix(false);
        }
        this.audio.pause();
        this.backgroundAudio.pause();
    }

    stop() {
        this.pendingSeekTime = null;
        this.ignoreNextPause = !this.audio.paused;
        this.pause();
        this.audio.currentTime = 0;
        this.handler.onStop?.();
    }

    seek(time: number) {
        if (!Number.isFinite(time) || time < 0) {
            return;
        }

        if (this.audio.readyState === 0) {
            this.pendingSeekTime = time;
            return;
        }

        this.audio.currentTime = time;
    }

    seekWithResult(time: number) {
        if (!Number.isFinite(time) || time < 0 || this.audio.readyState === 0) {
            return false;
        }

        this.audio.currentTime = time;
        return true;
    }

    download(music: Music) {
        const audioResource = `/api/audio/${music.id}?notranscode=true`;
        const a = document.createElement('a');
        a.href = audioResource;
        a.download = music.filePath.split('/').pop()!;
        a.click();
    }

    dispose() {
        if (this.mixInterval) {
            this.finishMix(false);
        }

        this.audio.removeEventListener('play', this.handler.onPlay!);
        this.audio.removeEventListener('playing', this.handler.onPlaying!);
        this.audio.removeEventListener('waiting', this.handler.onWaiting!);
        this.audio.removeEventListener('pause', this.handler.onPause!);
        this.audio.removeEventListener('abort', this.handler.onStop!);
        this.audio.removeEventListener('ended', this.handler.onEnded!);
        this.audio.removeEventListener('timeupdate', this.handler.onTimeUpdate as () => void);
        this.audio.removeEventListener('loadedmetadata', this.applyPendingSeek);
        this.audio.removeEventListener('error', this.handleNetworkError);
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.audio.pause();
        this.backgroundAudio.pause();
        webAudioContext.disconnect(this.audio);
        webAudioContext.disconnect(this.backgroundAudio);
    }

    private applyPendingSeek = () => {
        if (this.pendingSeekTime === null) {
            return;
        }

        const time = this.pendingSeekTime;
        this.pendingSeekTime = null;
        this.seek(time);
    };

    private handleNetworkError = () => {
        if (!this.currentResource || this.retryAttempt >= MAX_AUDIO_RETRIES) {
            toast.error('Playback could not reconnect. Check Connection diagnostics, then retry.');
            return;
        }
        const resumeAt = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
        this.retryAttempt += 1;
        const retry = () => {
            this.pendingSeekTime = resumeAt;
            this.audio.src = withRetryToken(this.currentResource as string, this.retryAttempt);
            this.audio.load();
            void this.audio.play().catch(() => undefined);
        };
        if (!navigator.onLine) {
            window.addEventListener('online', retry, { once: true });
            return;
        }
        this.retryTimer = setTimeout(retry, audioRetryDelay(this.retryAttempt));
    };

    private finishMix(completed: boolean) {
        if (!this.mixInterval || this.mixStartedAtMs === null) {
            return;
        }

        clearInterval(this.mixInterval);
        this.mixInterval = null;
        const maximumElapsedMs = completed
            ? this.mixDurationMs
            : Math.min(
                Math.max(Date.now() - this.mixStartedAtMs, 0),
                this.mixDurationMs
            );
        const mediaAdvancedMs = this.mixOutgoingStartedAtSeconds !== null
            && Number.isFinite(this.backgroundAudio.currentTime)
            ? Math.max(
                (this.backgroundAudio.currentTime
                    - this.mixOutgoingStartedAtSeconds) * 1_000,
                0
            )
            : 0;
        const listenedMs = Math.min(mediaAdvancedMs, maximumElapsedMs);
        this.mixStartedAtMs = null;
        this.mixOutgoingStartedAtSeconds = null;
        this.mixDurationMs = 0;
        this.audio.volume = 1;
        this.backgroundAudio.volume = 0;
        webAudioContext.setGain(this.audio, 1, 0);
        webAudioContext.setGain(this.backgroundAudio, 0, 0);
        this.backgroundAudio.pause();
        webAudioContext.disconnect(this.backgroundAudio);
        this.handler.onCrossfadeEnd?.(listenedMs);
    }
}
