import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    initialized: vi.fn().mockReturnValue(true),
    init: vi.fn(),
    setGain: vi.fn(),
    shouldStartMix: vi.fn().mockReturnValue(true)
}));

vi.mock('../web-audio-context', () => ({
    webAudioContext: {
        connect: mocks.connect,
        disconnect: mocks.disconnect,
        initialized: mocks.initialized,
        init: mocks.init,
        setGain: mocks.setGain
    }
}));

vi.mock('./mix-timing', () => ({
    shouldStartMix: mocks.shouldStartMix
}));

vi.mock('~/store/audio-settings', () => ({
    audioSettingsStore: {
        state: {
            format: 'mp3',
            bitrate: 320,
            useOriginal: false
        }
    }
}));

type AudioListener = EventListenerOrEventListenerObject;

class FakeAudio {
    static instances: FakeAudio[] = [];

    currentTime = 0;
    duration = 60;
    ended = false;
    error: { code: number } | null = null;
    paused = true;
    readyState = 4;
    src = '';
    volume = 1;
    private readonly listeners = new Map<string, Set<AudioListener>>();

    constructor() {
        FakeAudio.instances.push(this);
    }

    readonly play = vi.fn(async () => {
        this.ended = false;
        this.paused = false;
        this.dispatch('play');
    });

    readonly pause = vi.fn(() => {
        const wasPlaying = !this.paused;
        this.paused = true;
        if (wasPlaying) {
            this.dispatch('pause');
        }
    });

    readonly load = vi.fn();

    addEventListener(type: string, listener: AudioListener) {
        const listeners = this.listeners.get(type) ?? new Set<AudioListener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: AudioListener) {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type: string) {
        const event = new Event(type);
        for (const listener of this.listeners.get(type) ?? []) {
            if (typeof listener === 'function') {
                listener.call(this, event);
            } else {
                listener.handleEvent(event);
            }
        }
    }
}

import type { Music } from '~/models/type';
import { WebAudioChannel } from './web-audio-channel';

const music = {
    id: '1',
    filePath: '/music/one.mp3',
    duration: 60
} as Music;

const createCrossfade = async () => {
    let channel!: WebAudioChannel;
    channel = new WebAudioChannel({
        onEnded: () => {
            channel.load(music);
            channel.play();
        },
        onTimeUpdate: (_time, mix) => {
            mix(20, () => undefined);
        }
    });

    const outgoing = FakeAudio.instances[FakeAudio.instances.length - 1]!;
    await channel.beginMutedPlayback();
    outgoing.currentTime = 50;
    outgoing.dispatch('timeupdate');
    const incoming = FakeAudio.instances[FakeAudio.instances.length - 1]!;

    expect(outgoing.paused).toBe(false);
    expect(incoming.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    return { channel, incoming, outgoing };
};

describe('WebAudioChannel handoff safety', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        FakeAudio.instances = [];
        vi.stubGlobal('Audio', FakeAudio);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it.each([
        ['source release', (channel: WebAudioChannel) => channel.pause()],
        ['target abort', (channel: WebAudioChannel) => channel.cancelMutedPlayback()]
    ])('silences both crossfade channels during %s', async (_label, silence) => {
        const { channel, incoming, outgoing } = await createCrossfade();

        silence(channel);

        expect(incoming.pause).toHaveBeenCalled();
        expect(outgoing.pause).toHaveBeenCalled();
        expect(incoming.paused).toBe(true);
        expect(outgoing.paused).toBe(true);
        expect(incoming.volume).toBe(1);
        expect(outgoing.volume).toBe(0);
        expect(mocks.setGain).toHaveBeenCalledWith(incoming, 1, 0);
        expect(mocks.setGain).toHaveBeenCalledWith(outgoing, 0, 0);
        expect(mocks.disconnect).toHaveBeenCalledWith(outgoing);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('resumes the normalized incoming channel after a crossfade rollback', async () => {
        const { channel, incoming, outgoing } = await createCrossfade();
        channel.pause();

        await expect(channel.playWithResult()).resolves.toBeUndefined();

        expect(incoming.play).toHaveBeenCalledTimes(2);
        expect(incoming.paused).toBe(false);
        expect(incoming.volume).toBe(1);
        expect(outgoing.paused).toBe(true);
        expect(outgoing.volume).toBe(0);
    });

    it('restarts an ended warm-up before making it audible', async () => {
        const channel = new WebAudioChannel({
            onEnded: () => undefined,
            onTimeUpdate: () => undefined
        });
        const audio = FakeAudio.instances[FakeAudio.instances.length - 1]!;
        await channel.beginMutedPlayback();
        audio.ended = true;
        audio.paused = true;

        await expect(channel.commitMutedPlayback()).resolves.toBeUndefined();

        expect(audio.play).toHaveBeenCalledTimes(2);
        expect(audio.paused).toBe(false);
        expect(mocks.setGain).toHaveBeenLastCalledWith(audio, 1, 0);
    });

    it('keeps an ended warm-up muted when restart fails', async () => {
        const channel = new WebAudioChannel({
            onEnded: () => undefined,
            onTimeUpdate: () => undefined
        });
        const audio = FakeAudio.instances[FakeAudio.instances.length - 1]!;
        await channel.beginMutedPlayback();
        audio.ended = true;
        audio.paused = true;
        const error = new DOMException('Playback restart failed.', 'NotAllowedError');
        audio.play.mockRejectedValueOnce(error);

        await expect(channel.commitMutedPlayback()).rejects.toBe(error);

        expect(mocks.setGain).not.toHaveBeenCalledWith(audio, 1, 0);
        expect(audio.paused).toBe(true);
    });

    it('rejects an errored warm-up without making it audible', async () => {
        const channel = new WebAudioChannel({
            onEnded: () => undefined,
            onTimeUpdate: () => undefined
        });
        const audio = FakeAudio.instances[FakeAudio.instances.length - 1]!;
        await channel.beginMutedPlayback();
        audio.error = { code: 3 };

        await expect(channel.commitMutedPlayback()).rejects.toMatchObject({
            name: 'NotSupportedError'
        });

        expect(audio.play).toHaveBeenCalledOnce();
        expect(mocks.setGain).not.toHaveBeenCalledWith(audio, 1, 0);
    });
});
