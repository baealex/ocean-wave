export const STREAM_PROFILES = {
    original: { direct: true, format: null, bitrate: null, estimatedBytesPerHour: null },
    high: { direct: false, format: 'aac', bitrate: '192k', estimatedBytesPerHour: 86_400_000 },
    balanced: { direct: false, format: 'aac', bitrate: '128k', estimatedBytesPerHour: 57_600_000 },
    'data-saver': { direct: false, format: 'aac', bitrate: '64k', estimatedBytesPerHour: 28_800_000 }
} as const;
export type StreamProfile = keyof typeof STREAM_PROFILES;

export const resolveStreamProfile = ({ profile, sourceCodec, supportedCodecs }: { profile: unknown; sourceCodec: string; supportedCodecs: string[] }) => {
    const name: StreamProfile = typeof profile === 'string' && profile in STREAM_PROFILES ? profile as StreamProfile : 'balanced';
    const selected = STREAM_PROFILES[name];
    const direct = selected.direct || (name === 'high' && supportedCodecs.includes(sourceCodec.toLowerCase()));
    return { name, ...selected, direct };
};

export const parseByteRange = (value: string | undefined, size: number) => {
    if (!value) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) return undefined;
    let start = match[1] ? Number(match[1]) : Math.max(size - Number(match[2]), 0);
    let end = match[2] && match[1] ? Number(match[2]) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return undefined;
    end = Math.min(end, size - 1);
    return { start, end };
};

export class TranscodePool {
    private active = 0;
    constructor(private readonly maximum = 2) {}
    acquire() { if (this.active >= this.maximum) return false; this.active += 1; return true; }
    release() { this.active = Math.max(0, this.active - 1); }
    get status() { return { active: this.active, maximum: this.maximum }; }
}

export const transcodePool = new TranscodePool(Number(process.env.MAX_TRANSCODES) || 2);

export const transcodeCacheKey = ({ stableId, updatedAtMs, profile }: { stableId: string; updatedAtMs: number; profile: StreamProfile }) => `${stableId}-${Math.round(updatedAtMs)}-${profile}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
