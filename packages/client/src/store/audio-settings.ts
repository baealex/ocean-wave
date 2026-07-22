import { BaseStore } from './base-store';

export interface AudioSettings {
    format: 'mp3' | 'aac';
    bitrate: '64k' | '96k' | '128k' | '192k' | '256k' | '320k';
    useOriginal: boolean;
    profile: 'original' | 'high' | 'balanced' | 'data-saver';
}

class AudioSettingsStore extends BaseStore<AudioSettings> {
    constructor() {
        super();

        let savedSettings: AudioSettings | null = null;

        const savedSettingsJson = localStorage.getItem('audio-settings');
        if (savedSettingsJson) {
            savedSettings = JSON.parse(savedSettingsJson);
        }

        this.state = {
            format: 'mp3',
            bitrate: '128k',
            useOriginal: true,
            ...savedSettings,
            profile: savedSettings?.profile ?? (savedSettings?.useOriginal === false ? 'balanced' : 'original')
        };
    }

    private saveSettings() {
        localStorage.setItem('audio-settings', JSON.stringify(this.state));
    }

    setFormat(format: AudioSettings['format']) {
        this.set({ format });
        this.saveSettings();
    }

    setBitrate(bitrate: AudioSettings['bitrate']) {
        this.set({ bitrate });
        this.saveSettings();
    }

    setUseOriginal(useOriginal: boolean) {
        this.set({ useOriginal, profile: useOriginal ? 'original' : 'balanced' });
        this.saveSettings();
    }

    setProfile(profile: AudioSettings['profile']) {
        const settings = profile === 'original'
            ? { profile, useOriginal: true as const }
            : profile === 'high'
                ? { profile, useOriginal: false as const, format: 'aac' as const, bitrate: '192k' as const }
                : profile === 'data-saver'
                    ? { profile, useOriginal: false as const, format: 'aac' as const, bitrate: '64k' as const }
                    : { profile, useOriginal: false as const, format: 'aac' as const, bitrate: '128k' as const };
        this.set(settings);
        this.saveSettings();
    }
}

export const audioSettingsStore = new AudioSettingsStore();
