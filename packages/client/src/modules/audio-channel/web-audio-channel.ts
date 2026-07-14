import { webAudioContext } from '../web-audio-context';
import type { AudioChannel, AudioChannelEventHandler } from './audio-channel';
import type { Music } from '~/models/type';

import { audioSettingsStore } from '~/store/audio-settings';
import { shouldStartMix } from './mix-timing';

export class WebAudioChannel implements AudioChannel {
    private audio: HTMLAudioElement;
    private backgroundAudio: HTMLAudioElement;
    private handler: AudioChannelEventHandler;
    private mixInterval: ReturnType<typeof setInterval> | null;
    private loadedDuration: number | null;
    private pendingSeekTime: number | null;
    private ignoreNextPause: boolean;

    constructor(_handler: AudioChannelEventHandler) {
        this.audio = new Audio();
        this.backgroundAudio = new Audio();
        this.mixInterval = null;
        this.loadedDuration = null;
        this.pendingSeekTime = null;
        this.ignoreNextPause = false;
        this.handler = {
            onPlay: () => _handler.onPlay?.(),
            onPause: () => {
                if (this.ignoreNextPause) {
                    this.ignoreNextPause = false;
                    return;
                }

                _handler.onPause?.();
            },
            onStop: () => _handler.onStop?.(),
            onEnded: () => _handler.onEnded(),
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
                                this.audio.volume = 1;
                                this.backgroundAudio.volume = 0;
                                webAudioContext.setGain(this.audio, 1);
                                webAudioContext.setGain(this.backgroundAudio, 0);
                                this.backgroundAudio.pause();
                                webAudioContext.disconnect(this.backgroundAudio);
                                clearInterval(this.mixInterval!);
                                this.mixInterval = null;
                            }
                        }, fadeTime * 1000 / 10);
                        _handler.onEnded();
                    }
                });
            }
        };

        this.setNewAudio();
    }

    setNewAudio() {
        this.audio = new Audio();
        this.audio.addEventListener('play', this.handler.onPlay!);
        this.audio.addEventListener('pause', this.handler.onPause!);
        this.audio.addEventListener('abort', this.handler.onStop!);
        this.audio.addEventListener('ended', this.handler.onEnded!);
        this.audio.addEventListener('timeupdate', this.handler.onTimeUpdate as () => void);
        this.audio.addEventListener('loadedmetadata', this.applyPendingSeek);
    }

    swapAudio() {
        const tempAudio = this.audio;
        tempAudio.removeEventListener('play', this.handler.onPlay!);
        tempAudio.removeEventListener('pause', this.handler.onPause!);
        tempAudio.removeEventListener('abort', this.handler.onStop!);
        tempAudio.removeEventListener('ended', this.handler.onEnded!);
        tempAudio.removeEventListener('timeupdate', this.handler.onTimeUpdate as () => void);
        tempAudio.removeEventListener('loadedmetadata', this.applyPendingSeek);
        this.backgroundAudio = tempAudio;
    }

    load(music: Music) {
        let audioResource: string;

        const { format, bitrate, useOriginal } = audioSettingsStore.state;
        this.loadedDuration = music.duration;
        this.pendingSeekTime = null;

        if (useOriginal) {
            audioResource = `/api/audio/${music.id}?notranscode=true`;
        } else {
            audioResource = `/api/audio/${music.id}?format=${format}&bitrate=${bitrate}`;
        }

        this.audio.pause();
        this.audio.src = audioResource;
        this.audio.currentTime = 0;
        this.audio.load();
    }

    play() {
        if (!webAudioContext.initialized()) {
            webAudioContext.init();
        }
        webAudioContext.connect(this.audio);
        webAudioContext.setGain(this.audio, this.audio.volume);
        this.audio.play();
    }

    pause() {
        this.audio.pause();
    }

    stop() {
        this.pendingSeekTime = null;
        this.ignoreNextPause = !this.audio.paused;
        this.audio.pause();
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

    download(music: Music) {
        const audioResource = `/api/audio/${music.id}?notranscode=true`;
        const a = document.createElement('a');
        a.href = audioResource;
        a.download = music.filePath.split('/').pop()!;
        a.click();
    }

    dispose() {
        if (this.mixInterval) {
            clearInterval(this.mixInterval);
            this.mixInterval = null;
        }

        this.audio.removeEventListener('play', this.handler.onPlay!);
        this.audio.removeEventListener('pause', this.handler.onPause!);
        this.audio.removeEventListener('abort', this.handler.onStop!);
        this.audio.removeEventListener('ended', this.handler.onEnded!);
        this.audio.removeEventListener('timeupdate', this.handler.onTimeUpdate as () => void);
        this.audio.removeEventListener('loadedmetadata', this.applyPendingSeek);
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
}
